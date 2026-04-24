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
    gitlab_profiles: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "aws_profiles": self.aws_profiles,
            "gcp_configurations": self.gcp_configurations,
            "k8s_contexts": self.k8s_contexts,
            "gitlab_profiles": self.gitlab_profiles,
            "errors": self.errors,
        }


def read_profiles() -> ProfileInventory:
    inv = ProfileInventory()
    inv.aws_profiles = _read_aws_profiles(inv.errors)
    inv.gcp_configurations = _read_gcp_configs(inv.errors)
    inv.k8s_contexts = _read_k8s_contexts(inv.errors)
    inv.gitlab_profiles = _read_gitlab_profiles(inv.errors)
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
    if kind == "gitlab":
        # GitLab skills use the `glab` CLI, which reads GITLAB_HOST and
        # GITLAB_TOKEN from env. Those live in ~/.config/slash/gitlab.toml
        # keyed by profile name. Token never enters argv or audit.stdout.
        return _gitlab_env_for(name)
    return {}


def _gitlab_env_for(name: str) -> dict[str, str]:
    cfg_path = Path.home() / ".config/slash/gitlab.toml"
    if not cfg_path.exists():
        return {}
    profile = _parse_gitlab_toml(cfg_path).get(name)
    if not profile:
        return {}
    out: dict[str, str] = {}
    if profile.get("base_url"):
        out["GITLAB_HOST"] = profile["base_url"]
    if profile.get("token"):
        out["GITLAB_TOKEN"] = profile["token"]
    return out


def _read_gitlab_profiles(errors: list[str]) -> list[str]:
    """List GitLab profile names declared in ~/.config/slash/gitlab.toml.

    File format (minimal TOML, handled without a library to keep deps small):

        [default]
        base_url = "https://gitlab.com"
        token = "glpat-..."

        [corp]
        base_url = "https://gitlab.corp.internal"
        token = "glpat-..."
    """
    cfg_path = Path.home() / ".config/slash/gitlab.toml"
    if not cfg_path.exists():
        return []
    try:
        return list(_parse_gitlab_toml(cfg_path).keys())
    except OSError as exc:
        errors.append(f"{cfg_path}: {exc}")
        return []


def _parse_gitlab_toml(path: Path) -> dict[str, dict[str, str]]:
    """Minimal TOML subset: [section] + key = "value" lines only.

    Deliberate non-use of tomllib to avoid pulling a dep boundary for
    a 6-line config file. Unsupported constructs (nested tables, arrays,
    multi-line strings) silently skipped — authors get a clean parse or
    nothing.
    """
    result: dict[str, dict[str, str]] = {}
    current: dict[str, str] | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            if section:
                current = {}
                result[section] = current
            continue
        if current is None:
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            current[key] = value
    return result


def env_contains_none(env_updates: dict[str, str]) -> bool:
    return all(v is not None for v in env_updates.values())


def merged_env(*updates: dict[str, str]) -> dict[str, str]:
    env = dict(os.environ)
    for u in updates:
        env.update(u)
    return env
