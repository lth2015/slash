"""POST /execute — parse (re-check) + build argv + (write) stage pending plan + run now for read.

On success for read: returns the whole Run result inline (Demo — no WS yet).
On write: returns 202 with run_id + state=awaiting_approval. Client polls /runs
or re-queries /approvals to refresh the UI.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from slash_api import audit
from slash_api.hitl import PendingPlan
from slash_api.hitl import put as put_plan
from slash_api.parser import ParseError, parse
from slash_api.runtime import (
    RunResult,
    build_argv,
    build_argv_steps,
    parse_output,
    run_builtin,
)
from slash_api.runtime import (
    execute as run_bash,
)
from slash_api.runtime.builder import BuildContext
from slash_api.runtime.profile import env_for_profile, merged_env
from slash_api.state import drift_seconds, registry, selected, user

_DRIFT_WINDOW_SECONDS = 60.0

router = APIRouter(tags=["execute"])


class ExecuteRequest(BaseModel):
    text: str


class ExecuteResponse(BaseModel):
    run_id: str
    state: str                # "ok" | "error" | "awaiting_approval"
    skill_id: str | None = None
    mode: str | None = None
    danger: bool = False
    # result fields (read path)
    argv: list[str] | None = None
    outputs: Any = None
    stdout_excerpt: str | None = None
    stderr_excerpt: str | None = None
    duration_ms: int | None = None
    exit_code: int | None = None
    output_spec: dict | None = None
    # ISO-8601 UTC timestamps bracketing the subprocess; populated for read
    # runs and for write runs that are approved + executed via /approvals.
    started_at: str | None = None
    ended_at: str | None = None
    # plan fields (write path)
    plan_text: str | None = None
    rollback_hint: str | None = None
    rollback_command: str | None = None  # pre-rendered, parse-ready slash command
    before: dict | None = None
    after: dict | None = None
    # Planner narration (write path) — rendered from spec.plan.target and
    # spec.plan.steps at plan time. `risk` is an ordinal derived from the
    # manifest (danger / metadata.labels.risk). `approval_required` is a
    # redundant hint for clients: true iff mode == "write".
    target: str | None = None
    steps: list[str] | None = None
    risk: str | None = None
    approval_required: bool = False
    # HITL state machine — "pending" for newly-staged writes, "approved" /
    # "rejected" only ever observed on approval decide responses, never here.
    # Clients can rely on this field to drive UI state without inferring
    # from `state == "awaiting_approval"`.
    approval_state: str | None = None
    # Resolved profile — the ctx/profile this run will target. For danger
    # skills the Approval card requires the reviewer to type this back
    # verbatim as the confirmation token.
    profile_kind: str | None = None
    profile_name: str | None = None
    # Drift guard — populated when a write is issued within 60s of a pin
    # change. Shape: {"kind": "k8s", "name": "prod", "since_seconds": 14}.
    drift: dict | None = None
    # error fields
    error_code: str | None = None
    error_message: str | None = None


def _build_ctx(ast, sel, manifest: dict | None = None) -> BuildContext:
    args: dict[str, Any] = dict(ast.flags)
    for i, positional_name in enumerate(_positional_names(ast)):
        if i < len(ast.positional):
            args[positional_name] = ast.positional[i]
    profile_kind, profile_name = _resolve_profile(ast, sel, manifest)
    # k8s_context is threaded separately so `${profile.k8s.context}` can
    # resolve regardless of the declared profile kind. For /cluster the
    # --ctx override has highest priority; other namespaces that happen to
    # declare profile.kind=k8s also use the same override path so /app and
    # /cluster stay aligned.
    if ast.namespace == "cluster" or profile_kind == "k8s":
        k8s_context = ast.overrides.get("ctx") or sel.k8s
    else:
        k8s_context = sel.k8s
    return BuildContext(
        args=args,
        positional=list(ast.positional),
        profile_kind=profile_kind,
        profile_name=profile_name,
        k8s_context=k8s_context,
    )


def _positional_names(ast) -> list[str]:
    skill = _skill_for(ast.skill_id)
    if skill is None:
        return []
    return [a.name for a in skill.args if a.positional]


def _skill_for(skill_id: str):
    reg = registry()
    for s in reg.all_skills():
        if s.id == skill_id:
            return s
    return None


def _resolve_profile(ast, sel, manifest: dict | None = None) -> tuple[str | None, str | None]:
    """Resolve (profile_kind, profile_name) for the run.

    /infra   — provider comes from the positional target; profile name from
               --profile override or session pin.
    /cluster — kind is always k8s; name from --ctx override or session pin.
    other    — driven by the manifest's spec.profile.kind. /app skills that
               declare profile.kind=k8s use the same k8s pin + --ctx override
               path as /cluster; aws/gcp fall back to --profile + pin.
    """
    # Manifest-driven path: any namespace whose skill declares a profile.kind
    # should resolve from the matching pin. This keeps resolution symmetric
    # across /cluster and /app, which both wrap kubectl.
    declared_kind = None
    if manifest is not None:
        declared_kind = (manifest.get("spec", {}).get("profile") or {}).get("kind")
    if ast.namespace == "infra":
        override = ast.overrides.get("profile")
        if ast.target == "aws":
            return "aws", override or sel.aws
        if ast.target == "gcp":
            return "gcp", override or sel.gcp
    if ast.namespace == "cluster":
        resolved = ast.overrides.get("ctx") or sel.k8s
        return "k8s", resolved
    # Non-infra/non-cluster namespaces (/app, /ops, /ctx …) — let the
    # skill's declared profile.kind drive resolution. `/app` wraps kubectl
    # and therefore reuses the k8s pin + --ctx override path.
    if declared_kind == "k8s":
        resolved = ast.overrides.get("ctx") or sel.k8s
        return "k8s", resolved
    if declared_kind == "aws":
        override = ast.overrides.get("profile")
        return "aws", override or sel.aws
    if declared_kind == "gcp":
        override = ast.overrides.get("profile")
        return "gcp", override or sel.gcp
    return None, None


def _manifest(skill) -> dict:
    """Read the on-disk manifest for a SkillSpec using the path captured at load time."""
    import yaml

    if not skill.manifest_path:
        raise FileNotFoundError(f"no manifest_path recorded for {skill.id}")
    with open(skill.manifest_path, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _preflight(skill, sel, manifest, ast) -> str | None:
    """Return an error message if we should NOT execute; None if ok."""
    profile_kind = (manifest.get("spec", {}).get("profile") or {}).get("kind")
    profile_required = bool((manifest.get("spec", {}).get("profile") or {}).get("required"))

    # Skills that don't need any cloud/k8s profile (e.g. /ops audit logs) — pass.
    if profile_kind in (None, "none"):
        return None

    if skill.namespace == "infra":
        kind = "aws" if skill.target == "aws" else "gcp"
        override = ast.overrides.get("profile")
        chosen = override or (sel.aws if kind == "aws" else sel.gcp)
        if profile_required and not chosen:
            return (
                f"No {kind.upper()} profile set. Pin one with "
                f"`/ctx pin {kind} <name>` or pass `--profile <name>`."
            )
        return None
    # /cluster and any namespace whose manifest declares profile.kind=k8s
    # (currently /app) share the same k8s pin + --ctx override path.
    if profile_required and profile_kind == "k8s":
        resolved = ast.overrides.get("ctx") or sel.k8s
        if not resolved:
            return (
                "No k8s context set. Pin one with "
                "`/ctx pin k8s <name>` or pass `--ctx <name>`."
            )
    # Aws/gcp declared at manifest level for non-/infra namespaces fall through
    # the same pin-or-override check.
    if profile_required and profile_kind in ("aws", "gcp"):
        override = ast.overrides.get("profile")
        chosen = override or (sel.aws if profile_kind == "aws" else sel.gcp)
        if not chosen:
            return (
                f"No {profile_kind.upper()} profile set. Pin one with "
                f"`/ctx pin {profile_kind} <name>` or pass `--profile <name>`."
            )
    return None


@router.post("/execute", response_model=ExecuteResponse)
def execute(req: ExecuteRequest) -> ExecuteResponse:
    reg = registry()
    try:
        ast = parse(req.text, reg.lookup)
    except ParseError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": exc.code,
                "message": exc.message,
                "offset": exc.offset,
                "length": exc.length,
                "suggestions": list(exc.suggestions),
            },
        ) from exc

    skill = _skill_for(ast.skill_id)
    if skill is None:
        raise HTTPException(status_code=500, detail="skill vanished from registry")

    sel = selected()
    try:
        manifest = _manifest(skill)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    pre = _preflight(skill, sel, manifest, ast)
    if pre:
        raise HTTPException(status_code=400, detail={"code": "MissingContext", "message": pre})

    ctx = _build_ctx(ast, sel, manifest)

    # Determine profile env injection
    env_update = env_for_profile(ctx.profile_kind or "", ctx.profile_name)
    timeout_s = _timeout(manifest)

    output_spec = manifest.get("spec", {}).get("output") or {}

    run_id = f"r_{uuid.uuid4().hex[:12]}"

    # Write → stage plan, do NOT execute
    if skill.mode == "write":
        # Multi-step (spec.bash.steps) vs single-step (spec.bash.argv). Loader
        # enforces exclusivity; here we pick the shape once and stash both
        # fields on PendingPlan for unambiguous downstream dispatch.
        argv_steps = build_argv_steps(manifest, ctx)
        argv = argv_steps[0][1] if argv_steps else build_argv(manifest, ctx)
        plan_before, plan_after = _render_plan(manifest, ctx, env_update, timeout_s)
        pf_argv = _render_preflight(manifest, ctx)
        rollback_cmd = _render_rollback(manifest, ctx, plan_before, plan_after)
        drift_info = _compute_drift(skill, ctx)
        plan_target = _render_plan_target(manifest, ctx)
        plan_steps = _render_plan_steps(manifest, ctx)
        plan_risk = _derive_risk(skill, manifest)
        parsed = ast.to_dict()
        plan_summary = {
            "target": plan_target,
            "steps": list(plan_steps),
            "before": plan_before,
            "after": plan_after,
            "rollback_command": rollback_cmd,
        }
        plan = PendingPlan(
            run_id=run_id,
            command=req.text,
            skill_id=skill.id,
            skill_version=_skill_version(manifest),
            mode="write",
            danger=skill.danger,
            argv=argv,
            env=merged_env(env_update),
            timeout_s=timeout_s,
            plan_text=_plan_text(req.text, plan_before, plan_after, manifest),
            rollback_hint=str(manifest.get("spec", {}).get("rollback") or "").strip(),
            before=plan_before,
            after=plan_after,
            reason=ast.flags.get("reason", "") or "",
            profile_kind=ctx.profile_kind,
            profile_name=ctx.profile_name,
            output_spec=output_spec,
            preflight_argv=pf_argv,
            rollback_command=rollback_cmd,
            drift=drift_info,
            target=plan_target,
            steps=plan_steps,
            risk=plan_risk,
            parsed_command=parsed,
            argv_steps=argv_steps if len(argv_steps) > 1 else [],
        )
        put_plan(plan)

        audit.append({
            "run_id": run_id,
            "user": user(),
            "command": req.text,
            "parsed_command": parsed,
            "skill_id": skill.id,
            "skill_version": _skill_version(manifest),
            "mode": "write",
            "risk": plan_risk,
            "state": "awaiting_approval",
            "plan_summary": plan_summary,
            "profile": {"kind": ctx.profile_kind, "name": ctx.profile_name},
        })

        return ExecuteResponse(
            run_id=run_id,
            state="awaiting_approval",
            skill_id=skill.id,
            mode="write",
            danger=skill.danger,
            argv=argv,
            plan_text=plan.plan_text,
            rollback_hint=plan.rollback_hint,
            rollback_command=plan.rollback_command or None,
            before=plan.before,
            after=plan.after,
            output_spec=output_spec,
            profile_kind=ctx.profile_kind,
            profile_name=ctx.profile_name,
            drift=drift_info,
            target=plan_target or None,
            steps=list(plan_steps),
            risk=plan_risk,
            approval_required=True,
            approval_state="pending",
        )

    # Read → run now. Built-in vs bash branch.
    read_risk = _derive_risk(skill, manifest)
    parsed_read = ast.to_dict()
    builtin_name = manifest.get("spec", {}).get("builtin")
    if builtin_name:
        builtin_config = manifest.get("spec", {}).get("builtin_config") or {}
        state, outputs, err_code, err_msg = run_builtin(builtin_name, ctx, builtin_config)
        audit.append({
            "run_id": run_id,
            "user": user(),
            "command": req.text,
            "parsed_command": parsed_read,
            "skill_id": skill.id,
            "skill_version": _skill_version(manifest),
            "mode": "read",
            "risk": read_risk,
            "state": state,
            "execution_argv": ["<builtin>", builtin_name],
            "profile": {"kind": ctx.profile_kind, "name": ctx.profile_name},
            "summary": err_msg or _brief_summary(outputs),
        })
        return ExecuteResponse(
            run_id=run_id,
            state=state,
            skill_id=skill.id,
            mode="read",
            danger=skill.danger,
            argv=["<builtin>", builtin_name],
            outputs=outputs,
            stdout_excerpt="",
            stderr_excerpt="",
            duration_ms=0,
            exit_code=0,
            output_spec=output_spec,
            error_code=err_code,
            error_message=err_msg,
        )

    argv = build_argv(manifest, ctx)
    env = merged_env(env_update)

    # Preflight: optional guard that must exit 0 before we run the real command.
    pf_err = _run_preflight(manifest, ctx, env, timeout_s)
    if pf_err is not None:
        audit.append({
            "run_id": run_id,
            "user": user(),
            "command": req.text,
            "parsed_command": parsed_read,
            "skill_id": skill.id,
            "skill_version": _skill_version(manifest),
            "mode": "read",
            "risk": read_risk,
            "state": "error",
            "execution_argv": argv,
            "profile": {"kind": ctx.profile_kind, "name": ctx.profile_name},
            "summary": f"preflight failed: {pf_err}",
        })
        return ExecuteResponse(
            run_id=run_id,
            state="error",
            skill_id=skill.id,
            mode="read",
            danger=skill.danger,
            argv=argv,
            output_spec=output_spec,
            error_code="PreflightFailed",
            error_message=pf_err,
        )

    result = run_bash(argv, env, timeout_s)
    state, outputs, err_code, err_msg = _shape_result(result, output_spec)

    audit.append({
        "run_id": run_id,
        "user": user(),
        "command": req.text,
        "parsed_command": parsed_read,
        "skill_id": skill.id,
        "skill_version": _skill_version(manifest),
        "mode": "read",
        "risk": read_risk,
        "state": state,
        "exit_code": result.exit_code,
        "duration_ms": result.duration_ms,
        "started_at": result.started_at,
        "ended_at": result.ended_at,
        "execution_argv": argv,
        "profile": {"kind": ctx.profile_kind, "name": ctx.profile_name},
        "stdout": result.stdout,
        "stderr": result.stderr,
        "summary": (err_msg or _brief_summary(outputs)),
    })

    return ExecuteResponse(
        run_id=run_id,
        state=state,
        skill_id=skill.id,
        mode="read",
        danger=skill.danger,
        argv=argv,
        outputs=outputs,
        stdout_excerpt=result.stdout[:4000],
        stderr_excerpt=result.stderr[:2000],
        duration_ms=result.duration_ms,
        exit_code=result.exit_code,
        output_spec=output_spec,
        error_code=err_code,
        error_message=err_msg,
        started_at=result.started_at or None,
        ended_at=result.ended_at or None,
    )


def _shape_result(result: RunResult, output_spec: dict) -> tuple[str, Any, str | None, str | None]:
    if result.timed_out:
        return "error", None, "Timeout", "Command exceeded its timeout."
    success_codes = output_spec.get("success_codes") or [0]
    if result.exit_code not in success_codes:
        stderr_line = result.stderr.strip().splitlines()[0] if result.stderr.strip() else "no stderr"
        return (
            "error",
            None,
            "ExecutionError",
            f"exit code {result.exit_code} (expected {success_codes}): {stderr_line}",
        )
    try:
        outputs = parse_output(result.stdout, output_spec)
    except Exception as exc:  # noqa: BLE001
        return "error", None, "OutputParseError", str(exc)
    return "ok", outputs, None, None


def _compute_drift(skill, ctx: BuildContext) -> dict | None:
    """Return a drift snapshot iff the pin for this skill's profile kind was
    changed within the last _DRIFT_WINDOW_SECONDS. `None` otherwise.

    Structure:
      {"kind": "k8s" | "aws" | "gcp",
       "name": "<pin name>",
       "since_seconds": 14.2}

    The idea: any write that arrives right after a `/ctx pin` call was issued
    is suspicious (muscle memory — the user was just working elsewhere).
    The Plan card uses this to print "Context switched X s ago · Intended?"
    as a second-look nudge without blocking the flow.
    """
    kind = ctx.profile_kind
    if kind not in ("k8s", "aws", "gcp"):
        return None
    since = drift_seconds(kind)
    if since is None or since >= _DRIFT_WINDOW_SECONDS:
        return None
    return {
        "kind": kind,
        "name": ctx.profile_name or "",
        "since_seconds": round(since, 1),
    }


def _render_rollback(manifest: dict, ctx: BuildContext, before: dict | None, after: dict | None) -> str:
    """Interpolate spec.rollback with the full context (args + profile + ${before}
    + ${after}). Returns a slash command string iff the rendered text starts with
    "/"; prose rollback hints return "". The empty string signals "no automatic
    rollback possible" to the UI.

    Safety: we render ONLY — the renderer is string-level substitution. The
    rendered command still has to be parsed and re-approved through the normal
    /execute + HITL flow before it runs. There is no back-channel here.
    """
    tmpl = str(manifest.get("spec", {}).get("rollback") or "").strip()
    if not tmpl or not tmpl.startswith("/"):
        return ""
    from slash_api.runtime.builder import _interpolate

    extra: dict[str, Any] = {}
    if before and "value" in before:
        extra["before"] = str(before.get("value") or "").strip()
    if after and "value" in after:
        extra["after"] = str(after.get("value") or "").strip()
    ext_ctx = BuildContext(
        args={**ctx.args, **extra},
        positional=ctx.positional,
        profile_kind=ctx.profile_kind,
        profile_name=ctx.profile_name,
        k8s_context=ctx.k8s_context,
    )
    rendered = _interpolate(tmpl, ext_ctx).strip()
    # Refuse to emit a command with unresolved placeholders — it would fail parse
    # anyway, better to hide the button than offer a broken command.
    if "${" in rendered or "<" in rendered:
        return ""
    return rendered


def _render_preflight(manifest: dict, ctx: BuildContext) -> list[str]:
    """Interpolate the skill's preflight.argv list. Returns [] if no preflight
    is declared. Kept separate from execution so /execute can stash the rendered
    argv on the PendingPlan and approvals can replay it at approve-time."""
    pf = (manifest.get("spec", {}).get("preflight") or {})
    argv_tmpl = pf.get("argv")
    if not isinstance(argv_tmpl, list) or not argv_tmpl:
        return []
    from slash_api.runtime.builder import _interpolate

    return [_interpolate(el, ctx) if isinstance(el, str) else str(el) for el in argv_tmpl]


def _run_preflight(manifest: dict, ctx: BuildContext, env: dict[str, str], timeout_s: float) -> str | None:
    """Run the skill's preflight.argv if present. Return None on success or a
    one-line error message on failure. Preflight uses the same env as the main
    command but its own argv template."""
    argv = _render_preflight(manifest, ctx)
    if not argv:
        return None
    result = run_bash(argv, env, min(timeout_s, 15.0))
    if result.timed_out:
        return "preflight check timed out"
    if result.exit_code != 0:
        first = result.stderr.strip().splitlines()[0] if result.stderr.strip() else ""
        return f"preflight exited {result.exit_code}" + (f": {first}" if first else "")
    return None


def _brief_summary(outputs: Any) -> str:
    if isinstance(outputs, list):
        return f"{len(outputs)} row(s)"
    if isinstance(outputs, dict):
        return "object"
    if isinstance(outputs, str):
        return f"{len(outputs.splitlines())} line(s)"
    return "ok"


def _timeout(manifest: dict) -> float:
    raw = manifest.get("spec", {}).get("timeout") or manifest.get("spec", {}).get("bash", {}).get("timeout")
    if not raw:
        return 30.0
    s = str(raw).strip()
    if s.endswith("s"):
        return float(s[:-1])
    if s.endswith("m"):
        return float(s[:-1]) * 60
    if s.endswith("h"):
        return float(s[:-1]) * 3600
    try:
        return float(s)
    except ValueError:
        return 30.0


def _skill_version(manifest: dict) -> str:
    return str(manifest.get("metadata", {}).get("version", "0.0.0"))


def _render_plan(manifest: dict, ctx: BuildContext, env_update: dict, timeout_s: float):
    plan_spec = manifest.get("spec", {}).get("plan") or {}
    before: dict | None = None
    after: dict | None = None
    plan_argv = plan_spec.get("argv")
    if plan_argv:
        # Run the plan read once to capture "before"
        argv = build_argv({"spec": {"bash": {"argv": plan_argv, "expand": []}}}, ctx)
        env = merged_env(env_update)
        res = run_bash(argv, env, timeout_s)
        before_raw = res.stdout.strip()
        diff = plan_spec.get("diff") or {}
        if res.exit_code == 0 and diff.get("before_source") == "stdout":
            before = {"value": before_raw}
            after_tmpl = diff.get("after_value", "")
            after_rendered = _interpolate_scalar(after_tmpl, ctx)
            after = {"value": after_rendered}
    return before, after


def _interpolate_scalar(template: str, ctx: BuildContext) -> str:
    from slash_api.runtime.builder import _interpolate  # reuse

    return _interpolate(template, ctx) if template else ""


def _render_plan_target(manifest: dict, ctx: BuildContext) -> str:
    """Render spec.plan.target — a one-line resource ref like `deploy/web`.
    Returns "" when the manifest doesn't declare one (optional field)."""
    tmpl = (manifest.get("spec", {}).get("plan") or {}).get("target")
    if not isinstance(tmpl, str) or not tmpl.strip():
        return ""
    return _interpolate_scalar(tmpl, ctx).strip()


def _render_plan_steps(manifest: dict, ctx: BuildContext) -> list[str]:
    """Render spec.plan.steps. Each entry is interpolated with `${var}` and
    `${profile.*.*}` just like argv. Loader has already enforced non-empty
    list for write skills; we keep a defensive fallback here."""
    raw = (manifest.get("spec", {}).get("plan") or {}).get("steps") or []
    out: list[str] = []
    for step in raw:
        if not isinstance(step, str):
            continue
        rendered = _interpolate_scalar(step, ctx).strip()
        if rendered:
            out.append(rendered)
    return out


def _derive_risk(skill, manifest: dict) -> str:
    """Map (danger, metadata.labels.risk) → ordinal risk string.
       danger: true              → "high"
       labels.risk in {low,medium,high} → as-is
       else                        → "medium"  (safe default for writes)
    """
    if bool(skill.danger):
        return "high"
    labels = (manifest.get("metadata", {}).get("labels") or {})
    risk = str(labels.get("risk") or "").strip().lower()
    if risk in ("low", "medium", "high"):
        return risk
    return "medium"


def _plan_text(command: str, before: dict | None, after: dict | None, manifest: dict) -> str:
    lines = [f"$ {command}"]
    if before and after:
        lines.append("")
        lines.append(f"before: {json.dumps(before.get('value'))}")
        lines.append(f"after : {json.dumps(after.get('value'))}")
    return "\n".join(lines)
