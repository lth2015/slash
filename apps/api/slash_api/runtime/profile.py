"""Profile inventory — reads AWS / GCP / K8s context from standard locations.

Per docs/05-safety-audit.md §5, Slash does NOT store credentials itself.
It only lists available profile names and tells the runtime which env vars
to set when spawning a skill's bash.
"""

from __future__ import annotations

import configparser
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ProfileInventory:
    aws_profiles: list[str] = field(default_factory=list)
    gcp_configurations: list[str] = field(default_factory=list)
    k8s_contexts: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "aws_profiles": self.aws_profiles,
            "gcp_configurations": self.gcp_configurations,
            "k8s_contexts": self.k8s_contexts,
            "errors": self.errors,
        }


def read_profiles() -> ProfileInventory:
    inv = ProfileInventory()
    inv.aws_profiles = _read_aws_profiles(inv.errors)
    inv.gcp_configurations = _read_gcp_configs(inv.errors)
    inv.k8s_contexts = _read_k8s_contexts(inv.errors)
    return inv


def _read_aws_profiles(errors: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for path in (Path.home() / ".aws/credentials", Path.home() / ".aws/config"):
        if not path.exists():
            continue
        cfg = configparser.ConfigParser()
        try:
            cfg.read(path)
        except configparser.Error as exc:
            errors.append(f"{path}: {exc}")
            continue
        for section in cfg.sections():
            # ~/.aws/config uses "profile <name>" except for "default"
            name = section
            if section.startswith("profile "):
                name = section[len("profile "):]
            if name and name not in seen:
                seen.add(name)
                out.append(name)
    return out


def _read_gcp_configs(errors: list[str]) -> list[str]:
    gcloud = shutil.which("gcloud")
    if not gcloud:
        return []
    try:
        res = subprocess.run(
            [gcloud, "config", "configurations", "list", "--format=value(name)"],
            capture_output=True,
            timeout=5,
            text=True,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        errors.append(f"gcloud: {exc}")
        return []
    if res.returncode != 0:
        errors.append(f"gcloud exited {res.returncode}")
        return []
    return [line.strip() for line in res.stdout.splitlines() if line.strip()]


def _read_k8s_contexts(errors: list[str]) -> list[str]:
    kubectl = shutil.which("kubectl")
    if not kubectl:
        return []
    try:
        res = subprocess.run(
            [kubectl, "config", "get-contexts", "-o=name"],
            capture_output=True,
            timeout=5,
            text=True,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        errors.append(f"kubectl: {exc}")
        return []
    if res.returncode != 0:
        errors.append(f"kubectl exited {res.returncode}")
        return []
    return [line.strip() for line in res.stdout.splitlines() if line.strip()]


def env_for_profile(kind: str, name: str | None) -> dict[str, str]:
    """Return the extra env vars the runtime must inject for a given profile kind.

    The runtime passes these via subprocess `env=` (never through shell).
    Missing name → return {} and let the skill's bash fall back to its own default.
    """
    if name is None:
        return {}
    if kind == "aws":
        return {"AWS_PROFILE": name}
    if kind == "gcp":
        return {"CLOUDSDK_ACTIVE_CONFIG_NAME": name}
    if kind == "k8s":
        # We don't override KUBECONFIG. The skill's bash passes --context <name> explicitly.
        return {}
    return {}


def env_contains_none(env_updates: dict[str, str]) -> bool:
    return all(v is not None for v in env_updates.values())


def merged_env(*updates: dict[str, str]) -> dict[str, str]:
    env = dict(os.environ)
    for u in updates:
        env.update(u)
    return env
