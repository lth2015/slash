"""Built-in skills (no bash subprocess).

Currently:
  - audit_query: tail/filter var/audit.jsonl
  - diagnose:    read audit rows for a target; result is consumed by /explain
  - aggregate:   run N read slash commands, bundle their outputs. Used by
                 LLM-composition skills (cluster.diagnose, ops.report, etc.);
                 the aggregated map feeds straight into /explain as evidence.

Each handler returns (state, outputs, error_code, error_message). stdout is
left empty (nothing to redact); callers know there was no subprocess.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from slash_api.audit import query as audit_query

if TYPE_CHECKING:
    from slash_api.runtime.builder import BuildContext

_DURATION = re.compile(r"^(\d+)([smhd])$")
_UNITS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def run_builtin(
    kind: str,
    ctx: BuildContext,
    config: dict | None = None,
) -> tuple[str, Any, str | None, str | None]:
    """Dispatch a builtin by kind.

    `ctx` is the same BuildContext the bash runtime uses — gives access to
    parsed args, profile, and k8s context. `config` is the manifest's
    `spec.builtin_config` block (empty for simple builtins like audit_query).
    """
    cfg = config or {}
    if kind == "audit_query":
        return _audit_query(ctx.args)
    if kind == "diagnose":
        return _diagnose(ctx.args)
    if kind == "aggregate":
        return _aggregate(ctx, cfg)
    return "error", None, "BuiltinUnknown", f"no built-in named {kind!r}"


def _parse_duration(text: str | None) -> int | None:
    if not text:
        return None
    m = _DURATION.match(str(text))
    if not m:
        return None
    return int(m.group(1)) * _UNITS[m.group(2)]


def _audit_query(args: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
    rows = audit_query(
        since_seconds=_parse_duration(args.get("since")),
        user=args.get("user"),
        command_prefix=args.get("command_prefix"),
        limit=500,
    )
    return "ok", rows, None, None


def _diagnose(args: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
    target = args.get("target", "")
    rows = audit_query(since_seconds=7 * 86400, command_prefix=None, limit=500)
    matched = [r for r in rows if target.lower() in (r.get("command") or "").lower()]
    return "ok", {
        "target": target,
        "match_count": len(matched),
        "recent_runs": matched[:20],
    }, None, None


# ── aggregate: compose N read skills ──────────────────────────────────────


def _aggregate(ctx: BuildContext, config: dict) -> tuple[str, Any, str | None, str | None]:
    """Run a list of read slash commands sequentially, return their outputs
    as a single dict keyed by step id.

    Manifest:
      builtin: aggregate
      builtin_config:
        steps:
          - { id: pod_state, run: "/cluster ${profile.k8s.context} describe pod ${pod} --ns ${ns}" }
          - { id: events,    run: "/cluster ${profile.k8s.context} get event --ns ${ns}" }

    Contract:
      - Each `run` is a slash command; ${var} is interpolated from the parent
        ctx before parsing (same interpolator as bash.argv).
      - Sub-skills must be mode: read. Write skills (and nested aggregate)
        are refused — the composer is a read-only observer by design.
      - A sub-step failure does NOT abort the aggregate: its error is
        recorded under its id, other steps run. The overall builtin still
        returns state=ok; the client + LLM can interpret partial data.
    """
    steps = config.get("steps") or []
    if not isinstance(steps, list) or not steps:
        return "error", None, "BuiltinConfig", "aggregate requires builtin_config.steps"

    # Late imports break the circular graph: execute.py imports run_builtin;
    # aggregate then wants to re-enter execute() for sub-calls.
    from fastapi import HTTPException

    from slash_api.routers.execute import ExecuteRequest, execute as execute_route
    from slash_api.runtime.builder import _interpolate

    collected: dict[str, Any] = {}
    for step in steps:
        sid = step.get("id") or f"step_{len(collected)}"
        run_tmpl = step.get("run")
        if not isinstance(run_tmpl, str) or not run_tmpl.startswith("/"):
            collected[sid] = {
                "state": "error",
                "error": "step.run must be a slash command string",
            }
            continue
        rendered = _interpolate(run_tmpl, ctx)

        try:
            resp = execute_route(ExecuteRequest(text=rendered))
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            collected[sid] = {
                "state": "error",
                "error": detail.get("message") or str(detail),
                "command": rendered,
            }
            continue
        except Exception as exc:  # noqa: BLE001
            collected[sid] = {
                "state": "error",
                "error": str(exc),
                "command": rendered,
            }
            continue

        if resp.mode != "read":
            collected[sid] = {
                "state": "error",
                "error": f"sub-step is {resp.mode}, aggregate only runs read skills",
                "command": rendered,
            }
            continue

        collected[sid] = {
            "state": resp.state,
            "outputs": resp.outputs,
            "duration_ms": resp.duration_ms,
            "error": resp.error_message,
            "command": rendered,
            "skill_id": resp.skill_id,
        }

    return "ok", {"steps": collected}, None, None
