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
    # argv to execute if approved
    argv: list[str]
    env: dict[str, str]
    timeout_s: float
    # human-readable plan for UI (diff text, rollback hint)
    plan_text: str = ""
    rollback_hint: str = ""
    before: dict | None = None
    after: dict | None = None
    reason: str = ""
    # profile summary for audit
    profile_kind: str | None = None
    profile_name: str | None = None
    output_spec: dict = field(default_factory=dict)
    # Pre-rendered preflight argv (run immediately before bash.argv on approve).
    preflight_argv: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    # decision
    decided_at: float | None = None
    decision: Decision | None = None
    decided_by: str | None = None
    decision_reason: str | None = None

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
