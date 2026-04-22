"""Process-wide state: loads .env.local at import; exposes the Skill registry
and the currently-pinned contexts (k8s / aws / gcp) with per-pin tier and
drift tracking. See docs/03-architecture.md §2.6 and UI spec §10 (Pins).
"""

from __future__ import annotations

import getpass
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

from slash_api.registry import SkillRegistry, load_registry

REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = Path(os.environ.get("SLASH_SKILLS_DIR", REPO_ROOT / "skills"))

# Load .env.local (gitignored) at repo root before anything else reads env.
_dotenv_path = REPO_ROOT / ".env.local"
if _dotenv_path.exists():
    load_dotenv(_dotenv_path)


Tier = Literal["critical", "staging", "safe"]
_TIERS: tuple[Tier, ...] = ("critical", "staging", "safe")


@dataclass
class SelectedProfiles:
    """Currently pinned contexts. Each kind (k8s/aws/gcp) carries its own name
    and explicit tier label. `last_pinned_at` records the wall-clock time of
    the most recent pin change per kind so the drift-guard can detect commands
    issued within N seconds of a context switch."""

    aws: str | None = None
    aws_tier: Tier = "safe"
    gcp: str | None = None
    gcp_tier: Tier = "safe"
    k8s: str | None = None
    k8s_tier: Tier = "safe"
    llm_enabled: bool = False
    # kind -> unix seconds of most recent pin change (for drift guard)
    last_pinned_at: dict[str, float] = field(default_factory=dict)


_registry: SkillRegistry | None = None
_reg_lock = threading.Lock()

_selected = SelectedProfiles(
    aws=os.environ.get("SLASH_DEFAULT_AWS_PROFILE"),
    gcp=os.environ.get("SLASH_DEFAULT_GCP_CONFIG"),
    k8s=os.environ.get("SLASH_DEFAULT_KUBE_CONTEXT"),
    llm_enabled=os.environ.get("SLASH_LLM_DEFAULT", "off").lower() == "on",
)


def user() -> str:
    try:
        return getpass.getuser()
    except Exception:  # noqa: BLE001
        return os.environ.get("USER", "local")


def registry() -> SkillRegistry:
    global _registry
    with _reg_lock:
        if _registry is None:
            _registry = load_registry(SKILLS_DIR)
    return _registry


def reload_registry() -> SkillRegistry:
    global _registry
    with _reg_lock:
        _registry = load_registry(SKILLS_DIR)
    return _registry


def selected() -> SelectedProfiles:
    return _selected


def set_selected(
    *,
    aws: str | None = None,
    aws_tier: Tier | None = None,
    gcp: str | None = None,
    gcp_tier: Tier | None = None,
    k8s: str | None = None,
    k8s_tier: Tier | None = None,
    llm_enabled: bool | None = None,
) -> SelectedProfiles:
    """Mutate the session pin. Explicit None means 'unchanged'; the empty
    string means 'clear this pin'. Tiers are only persisted when their name
    counterpart is also being set (prevents a tier from hanging orphaned)."""
    now = time.time()
    # k8s
    if k8s is not None:
        prev = _selected.k8s
        _selected.k8s = k8s or None
        if (_selected.k8s or "") != (prev or ""):
            _selected.last_pinned_at["k8s"] = now
        if k8s_tier is not None and k8s_tier in _TIERS:
            _selected.k8s_tier = k8s_tier
        elif not _selected.k8s:
            _selected.k8s_tier = "safe"
    # aws
    if aws is not None:
        prev = _selected.aws
        _selected.aws = aws or None
        if (_selected.aws or "") != (prev or ""):
            _selected.last_pinned_at["aws"] = now
        if aws_tier is not None and aws_tier in _TIERS:
            _selected.aws_tier = aws_tier
        elif not _selected.aws:
            _selected.aws_tier = "safe"
    # gcp
    if gcp is not None:
        prev = _selected.gcp
        _selected.gcp = gcp or None
        if (_selected.gcp or "") != (prev or ""):
            _selected.last_pinned_at["gcp"] = now
        if gcp_tier is not None and gcp_tier in _TIERS:
            _selected.gcp_tier = gcp_tier
        elif not _selected.gcp:
            _selected.gcp_tier = "safe"
    # llm
    if llm_enabled is not None:
        _selected.llm_enabled = bool(llm_enabled)
    return _selected


def drift_seconds(kind: str) -> float | None:
    """Wall-clock seconds since the kind's pin was last changed, or None if
    never pinned in this process."""
    ts = _selected.last_pinned_at.get(kind)
    if ts is None:
        return None
    return time.time() - ts
