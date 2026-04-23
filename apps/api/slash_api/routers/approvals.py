"""Approval endpoints — list pending, decide, execute on approve."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from slash_api import audit
from slash_api.hitl import decide, list_pending, remove
from slash_api.runtime import RunResult, parse_output
from slash_api.runtime import execute as run_bash
from slash_api.state import user

router = APIRouter(tags=["approvals"])


class ApprovalItem(BaseModel):
    run_id: str
    command: str
    skill_id: str
    mode: str
    danger: bool
    plan_text: str
    rollback_hint: str
    before: dict | None
    after: dict | None
    reason: str
    profile_kind: str | None
    profile_name: str | None
    # Planner narration (captured at plan time; stable across a page refresh).
    target: str = ""
    steps: list[str] = []
    risk: str = "medium"
    approval_required: bool = True


class ApprovalList(BaseModel):
    items: list[ApprovalItem]


class DecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    comment: str | None = None
    yes_token: str | None = None   # for danger, client sends "YES"


class DecisionResponse(BaseModel):
    run_id: str
    decided: bool
    decision: str | None
    state: str
    exit_code: int | None = None
    duration_ms: int | None = None
    outputs: Any = None
    stdout_excerpt: str | None = None
    stderr_excerpt: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    output_spec: dict | None = None
    # ISO-8601 UTC timestamps of the subprocess, if it ran (approve path).
    started_at: str | None = None
    ended_at: str | None = None
    # Present only on state=ok for a write skill that declared an executable
    # spec.rollback. Client can wire a "Roll back" button that pre-fills the
    # CommandBar with this string; the rollback still goes through /execute +
    # HITL approval.
    rollback_command: str | None = None


@router.get("/approvals", response_model=ApprovalList)
def list_approvals() -> ApprovalList:
    items = [
        ApprovalItem(
            run_id=p.run_id,
            command=p.command,
            skill_id=p.skill_id,
            mode=p.mode,
            danger=p.danger,
            plan_text=p.plan_text,
            rollback_hint=p.rollback_hint,
            before=p.before,
            after=p.after,
            reason=p.reason,
            profile_kind=p.profile_kind,
            profile_name=p.profile_name,
            target=p.target,
            steps=list(p.steps),
            risk=p.risk,
            approval_required=(p.mode == "write"),
        )
        for p in list_pending()
    ]
    return ApprovalList(items=items)


@router.post("/approvals/{run_id}/decide", response_model=DecisionResponse)
def decide_approval(
    run_id: str,
    req: DecisionRequest,
    x_slash_actor: str | None = Header(default=None, alias="X-Slash-Actor"),
) -> DecisionResponse:
    # Human actor header required — LLM MUST NOT call this endpoint (05 §5.2 rule).
    if not x_slash_actor or not x_slash_actor.startswith("human-"):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "ForbiddenActor",
                "message": "X-Slash-Actor header starting with 'human-' is required.",
            },
        )

    # Fetch pending
    from slash_api.hitl import get as get_plan
    plan = get_plan(run_id)
    if plan is None:
        raise HTTPException(status_code=404, detail={"code": "NotFound", "message": "plan not found"})
    if plan.decision is not None:
        raise HTTPException(status_code=409, detail={"code": "AlreadyDecided", "message": "plan already decided"})

    # Danger gate — require the approver to type the environment name back.
    # This is a stronger filter than "YES" because it forces the approver to
    # read the resolved context (which is what they're actually committing
    # to), and typos reveal misapprehensions about the target.
    if plan.danger and req.decision == "approve":
        want = (plan.profile_name or "YES").strip()
        got = (req.yes_token or "").strip()
        if got != want:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "DangerConfirmRequired",
                    "message": f"Type the environment name {want!r} to approve this danger plan.",
                    "expected": want,
                },
            )

    decided = decide(run_id, decision=req.decision, by=x_slash_actor, reason=req.comment)
    if decided is None:
        raise HTTPException(status_code=409, detail={"code": "AlreadyDecided", "message": "race: decided elsewhere"})

    if req.decision == "reject":
        audit.append({
            "run_id": run_id,
            "user": user(),
            "actor": x_slash_actor,
            "command": plan.command,
            "skill_id": plan.skill_id,
            "skill_version": plan.skill_version,
            "mode": "write",
            "state": "rejected",
            "approval_reason": req.comment,
            "profile": {"kind": plan.profile_kind, "name": plan.profile_name},
        })
        remove(run_id)
        return DecisionResponse(run_id=run_id, decided=True, decision="reject", state="rejected")

    # Approve path — replay preflight (resource may have changed since plan),
    # then run the real command.
    if plan.preflight_argv:
        pf_result = run_bash(plan.preflight_argv, plan.env, min(plan.timeout_s, 15.0))
        if pf_result.timed_out or pf_result.exit_code != 0:
            first = pf_result.stderr.strip().splitlines()[0] if pf_result.stderr.strip() else ""
            err_msg = (
                "preflight timed out" if pf_result.timed_out else
                f"preflight exited {pf_result.exit_code}" + (f": {first}" if first else "")
            )
            audit.append({
                "run_id": run_id,
                "user": user(),
                "actor": x_slash_actor,
                "command": plan.command,
                "skill_id": plan.skill_id,
                "skill_version": plan.skill_version,
                "mode": "write",
                "state": "error",
                "approval_reason": plan.reason or req.comment,
                "profile": {"kind": plan.profile_kind, "name": plan.profile_name},
                "summary": f"preflight blocked apply: {err_msg}",
            })
            remove(run_id)
            return DecisionResponse(
                run_id=run_id,
                decided=True,
                decision="approve",
                state="error",
                error_code="PreflightFailed",
                error_message=err_msg,
                output_spec=plan.output_spec,
            )

    result = run_bash(plan.argv, plan.env, plan.timeout_s)
    state, outputs, err_code, err_msg = _shape_result(result, plan.output_spec)

    audit.append({
        "run_id": run_id,
        "user": user(),
        "actor": x_slash_actor,
        "command": plan.command,
        "skill_id": plan.skill_id,
        "skill_version": plan.skill_version,
        "mode": "write",
        "state": state,
        "approval_reason": plan.reason or req.comment,
        "plan": {"before": plan.before, "after": plan.after},
        "profile": {"kind": plan.profile_kind, "name": plan.profile_name},
        "exit_code": result.exit_code,
        "duration_ms": result.duration_ms,
        "started_at": result.started_at,
        "ended_at": result.ended_at,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "summary": err_msg or "applied",
        # Store the pre-rendered rollback so /audit queries can surface it
        # long after the in-memory plan is gone.
        "rollback_command": plan.rollback_command or "",
    })

    remove(run_id)

    return DecisionResponse(
        run_id=run_id,
        decided=True,
        decision="approve",
        state=state,
        exit_code=result.exit_code,
        duration_ms=result.duration_ms,
        outputs=outputs,
        stdout_excerpt=result.stdout[:4000],
        stderr_excerpt=result.stderr[:2000],
        error_code=err_code,
        error_message=err_msg,
        output_spec=plan.output_spec,
        rollback_command=(plan.rollback_command or None) if state == "ok" else None,
        started_at=result.started_at or None,
        ended_at=result.ended_at or None,
    )


def _shape_result(result: RunResult, output_spec: dict) -> tuple[str, Any, str | None, str | None]:
    if result.timed_out:
        return "error", None, "Timeout", "Command exceeded its timeout."
    success_codes = output_spec.get("success_codes") or [0]
    if result.exit_code not in success_codes:
        first = result.stderr.strip().splitlines()[0] if result.stderr.strip() else "no stderr"
        return "error", None, "ExecutionError", f"exit code {result.exit_code} (expected {success_codes}): {first}"
    try:
        outputs = parse_output(result.stdout, output_spec)
    except Exception as exc:  # noqa: BLE001
        return "error", None, "OutputParseError", str(exc)
    return "ok", outputs, None, None
