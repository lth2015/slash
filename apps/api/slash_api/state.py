"""Process-wide state: loads .env.local at import; exposes the Skill registry
and the currently-selected profiles.
"""

from __future__ import annotations

import getpass
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from slash_api.registry import SkillRegistry, load_registry

REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = Path(os.environ.get("SLASH_SKILLS_DIR", REPO_ROOT / "skills"))

# Load .env.local (gitignored) at repo root before anything else reads env.
_dotenv_path = REPO_ROOT / ".env.local"
if _dotenv_path.exists():
    load_dotenv(_dotenv_path)


@dataclass
class SelectedProfiles:
    """Currently selected profiles. Updated by POST /context."""

    aws: str | None = None
    gcp: str | None = None
    k8s: str | None = None
    llm_enabled: bool = False


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
    gcp: str | None = None,
    k8s: str | None = None,
    llm_enabled: bool | None = None,
) -> SelectedProfiles:
    # Accept explicit None means "unchanged" — we use sentinel strings for clearing.
    if aws is not None:
        _selected.aws = aws or None
    if gcp is not None:
        _selected.gcp = gcp or None
    if k8s is not None:
        _selected.k8s = k8s or None
    if llm_enabled is not None:
        _selected.llm_enabled = bool(llm_enabled)
    return _selected
