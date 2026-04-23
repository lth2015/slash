"""Pending-plan store (in-memory; single-user demo)."""

from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Literal

Decision = Literal["approve", "reject"]


@dataclass
class PendingPlan:
    run_id: str
    command: str
    skill_id: str
    skill_version: str
    mode: Literal["read", "write"]
    danger: bool
    # argv to execute if approved. For single-step skills, `argv` is the
    # rendered argv and `argv_steps` is empty. For multi-step skills
    # (spec.bash.steps), `argv_steps` carries the ordered list of
    # (step_id, argv) pairs and `argv` is set to the first step's argv
    # for backwards-compat display (e.g. audit, approvals list).
    argv: list[str]
    env: dict[str, str]
    timeout_s: float
    # human-readable plan for UI (diff text, rollback hint)
    plan_text: str = ""
    rollback_hint: str = ""
    before: dict | None = None
    after: dict | None = None
    reason: str = ""
    # Planner output — human-readable narration rendered at plan time.
    # `target` is a one-line resource ref ("deploy/web"); `steps` is the
    # ordered sequence a reviewer will see before approving. `risk` is an
    # ordinal derived from the manifest (danger / labels.risk).
    target: str = ""
    steps: list[str] = field(default_factory=list)
    risk: str = "medium"
    # Serialized AST (from parser.to_dict) captured at plan time. Stashed
    # here so the approve/reject audit events carry the SAME parsed shape
    # as the stage event, without re-parsing.
    parsed_command: dict = field(default_factory=dict)
    # Multi-step manifests (spec.bash.steps) stash their full (step_id, argv)
    # sequence here. Empty list for single-step skills.
    argv_steps: list[tuple[str, list[str]]] = field(default_factory=list)
    # profile summary for audit
    profile_kind: str | None = None
    profile_name: str | None = None
    output_spec: dict = field(default_factory=dict)
    # Pre-rendered preflight argv (run immediately before bash.argv on approve).
    preflight_argv: list[str] = field(default_factory=list)
    # Pre-rendered rollback slash command (empty string if no automatic rollback).
    # Only populated for write skills whose spec.rollback renders to a "/"-prefixed
    # command with all placeholders resolved at plan time.
    rollback_command: str = ""
    # Drift snapshot captured at plan time. None if the write was staged
    # outside the 60s drift window. Surviving to approval lets the Approval
    # Card remind the reviewer of the recent switch.
    drift: dict | None = None
    created_at: float = field(default_factory=time.time)

    # decision
    decided_at: float | None = None
    decision: Decision | None = None
    decided_by: str | None = None
    decision_reason: str | None = None

    @property
    def approval_state(self) -> str:
        """Explicit state label for the UI and audit:
           pending  — plan staged, no decision yet
           approved — human approved; the runtime either is running or has run
           rejected — human rejected; runtime will never run this plan"""
        if self.decision == "approve":
            return "approved"
        if self.decision == "reject":
            return "rejected"
        return "pending"

    def to_dict(self) -> dict:
        d = asdict(self)
        # redact env (it may contain profile hints only, but be safe)
        d["env"] = {k: v for k, v in d["env"].items() if k in {"AWS_PROFILE", "CLOUDSDK_ACTIVE_CONFIG_NAME"}}
        return d


_lock = threading.Lock()
_store: dict[str, PendingPlan] = {}


def put(plan: PendingPlan) -> None:
    with _lock:
        _store[plan.run_id] = plan


def get(run_id: str) -> PendingPlan | None:
    with _lock:
        return _store.get(run_id)


def remove(run_id: str) -> None:
    with _lock:
        _store.pop(run_id, None)


def list_pending() -> list[PendingPlan]:
    with _lock:
        return [p for p in _store.values() if p.decision is None]


def decide(
    run_id: str,
    *,
    decision: Decision,
    by: str,
    reason: str | None = None,
) -> PendingPlan | None:
    """Atomically mark a plan decided. Returns the plan if this call was the decider."""
    with _lock:
        plan = _store.get(run_id)
        if plan is None:
            return None
        if plan.decision is not None:
            return None  # already decided
        plan.decision = decision
        plan.decided_by = by
        plan.decided_at = time.time()
        plan.decision_reason = reason
        return plan
