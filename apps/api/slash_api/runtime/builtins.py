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
    if kind == "ctx_pin":
        return _ctx_pin(ctx.args)
    if kind == "ctx_unpin":
        return _ctx_unpin(ctx.args)
    if kind == "ctx_show":
        return _ctx_show()
    if kind == "ctx_list":
        return _ctx_list()
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


# ── /ctx builtins ────────────────────────────────────────────────────────
#
# These mutate / expose the session pin. They are marked mode: read on the
# skill side so they don't trigger HITL approval — a pin change touches no
# infrastructure, only the process-local preference that subsequent commands
# read. Every invocation still appends to audit.jsonl via the normal execute
# path, so "who pinned what when" remains traceable.


_VALID_KINDS = ("k8s", "aws", "gcp", "gitlab")
_VALID_TIERS = ("critical", "staging", "safe")


def _ctx_pin(args: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
    from slash_api.state import selected, set_selected

    kind = (args.get("kind") or "").strip()
    name = (args.get("name") or "").strip()
    tier = (args.get("tier") or "safe").strip()
    if kind not in _VALID_KINDS:
        return "error", None, "Validation", f"kind must be one of {_VALID_KINDS}"
    if not name:
        return "error", None, "Validation", "name required"
    if tier not in _VALID_TIERS:
        return "error", None, "Validation", f"tier must be one of {_VALID_TIERS}"

    if kind == "k8s":
        set_selected(k8s=name, k8s_tier=tier)
    elif kind == "aws":
        set_selected(aws=name, aws_tier=tier)
    elif kind == "gcp":
        set_selected(gcp=name, gcp_tier=tier)
    else:  # gitlab
        set_selected(gitlab=name, gitlab_tier=tier)

    sel = selected()
    return "ok", {
        "pinned": {"kind": kind, "name": name, "tier": tier},
        "current": _pin_snapshot(sel),
    }, None, None


def _ctx_unpin(args: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
    from slash_api.state import selected, set_selected

    kind = (args.get("kind") or "").strip()
    if kind not in (*_VALID_KINDS, "all"):
        return "error", None, "Validation", f"kind must be one of {_VALID_KINDS} or 'all'"

    if kind in ("k8s", "all"):
        set_selected(k8s="", k8s_tier="safe")
    if kind in ("aws", "all"):
        set_selected(aws="", aws_tier="safe")
    if kind in ("gcp", "all"):
        set_selected(gcp="", gcp_tier="safe")
    if kind in ("gitlab", "all"):
        set_selected(gitlab="", gitlab_tier="safe")

    sel = selected()
    return "ok", {
        "unpinned": kind,
        "current": _pin_snapshot(sel),
    }, None, None


def _ctx_show() -> tuple[str, Any, str | None, str | None]:
    from slash_api.state import selected

    return "ok", _pin_snapshot(selected()), None, None


def _ctx_list() -> tuple[str, Any, str | None, str | None]:
    """Discover all contexts / profiles from the local OS config. Reads:
      - `kubectl config get-contexts` (or ~/.kube/config)
      - `~/.aws/credentials`
      - `gcloud config configurations list`
    Wrapped by runtime.profile.read_profiles().
    """
    from slash_api.runtime.profile import read_profiles
    from slash_api.state import selected

    inv = read_profiles()
    sel = selected()
    return "ok", {
        "k8s_contexts": inv.k8s_contexts,
        "aws_profiles": inv.aws_profiles,
        "gcp_configurations": inv.gcp_configurations,
        "gitlab_profiles": inv.gitlab_profiles,
        "errors": inv.errors,
        "current": _pin_snapshot(sel),
    }, None, None


def _pin_snapshot(sel: Any) -> dict[str, Any]:
    """Compact view of the current pin state — used by show, pin, unpin."""
    return {
        "k8s": {"name": sel.k8s, "tier": sel.k8s_tier} if sel.k8s else None,
        "aws": {"name": sel.aws, "tier": sel.aws_tier} if sel.aws else None,
        "gcp": {"name": sel.gcp, "tier": sel.gcp_tier} if sel.gcp else None,
        "gitlab": {"name": sel.gitlab, "tier": sel.gitlab_tier} if sel.gitlab else None,
    }
