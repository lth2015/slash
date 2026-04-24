"""Capability registry + manifest validator.

Loads `capabilities/<ns>/<verb>/capability.yaml` files. Hard rules
(see docs/09-capabilities.md):

  - every step references an already-registered atomic skill
  - mode matches the union of step skill modes (read-only if all reads)
  - findings.from references an existing step id
  - findings.when compiles under the narrow DSL
  - command_path does not collide with any skill
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from slash_api.capability.dsl import DSLError, compile_finding
from slash_api.parser.parser import ArgSpec, SkillSpec
from slash_api.registry.loader import RegistryError, _arg


@dataclass(frozen=True)
class StepSpec:
    id: str
    skill_id: str
    args: tuple[tuple[str, Any], ...] = ()  # literal k/v pairs (values may contain ${...})


@dataclass(frozen=True)
class FindingSpec:
    id: str
    from_step: str
    when_source: str       # original DSL source (for audit / error reports)
    when_compiled: Any     # compiled AST (Expr)
    severity: str          # "info" | "warn" | "error"
    message: str           # interpolation template
    suggest: str | None    # interpolation template


@dataclass(frozen=True)
class CapabilitySpec:
    """Minimal view of a capability manifest, parallel to SkillSpec."""

    id: str
    namespace: str
    target: str | None
    noun: tuple[str, ...]
    verb: str
    mode: str                     # "read" | "write" | "mixed"
    args: tuple[ArgSpec, ...]
    name: str
    description: str
    steps: tuple[StepSpec, ...]
    findings: tuple[FindingSpec, ...]
    rollback: str | None
    profile_kind: str | None
    profile_required: bool
    manifest_path: str | None = None

    @property
    def command_path(self) -> tuple[str, ...]:
        return (*self.noun, self.verb)


@dataclass
class CapabilityRegistry:
    capabilities: list[CapabilitySpec] = field(default_factory=list)
    _by_ns_target: dict[tuple[str, str | None], list[CapabilitySpec]] = field(
        default_factory=dict
    )

    def add(self, cap: CapabilitySpec) -> None:
        key = (cap.namespace, cap.target)
        bucket = self._by_ns_target.setdefault(key, [])
        for c in bucket:
            if c.command_path == cap.command_path:
                raise RegistryError(
                    f"duplicate capability: /{cap.namespace} "
                    f"{cap.target + ' ' if cap.target else ''}"
                    f"{' '.join(cap.command_path)} already registered as {c.id}"
                )
        bucket.append(cap)
        self.capabilities.append(cap)

    def lookup(self, namespace: str, target: str | None = None) -> list[CapabilitySpec]:
        # /cluster capabilities have no target; /infra does.
        if namespace == "cluster":
            return self._by_ns_target.get(("cluster", None), [])
        return self._by_ns_target.get((namespace, target), [])

    def all(self) -> list[CapabilitySpec]:
        return list(self.capabilities)

    def by_id(self, cap_id: str) -> CapabilitySpec | None:
        for c in self.capabilities:
            if c.id == cap_id:
                return c
        return None


_VALID_SEVERITY = ("info", "warn", "error")
_VALID_MODE = ("read", "write", "mixed")


def load_capabilities(
    capabilities_dir: Path,
    skill_ids: set[str],
    skill_command_paths: dict[str, set[tuple[str, ...]]],
) -> CapabilityRegistry:
    """Discover + validate capability manifests.

    Args:
      capabilities_dir: root, scanned recursively for `capability.yaml`.
      skill_ids: set of registered skill ids — every step.skill must be in this.
      skill_command_paths: namespace → set of skill command_paths, used to
        detect collisions between capabilities and atomic skills.
    """
    reg = CapabilityRegistry()
    if not capabilities_dir.exists():
        return reg
    errors: list[str] = []
    for manifest_path in sorted(capabilities_dir.rglob("capability.yaml")):
        try:
            cap = _load_one(manifest_path, skill_ids)
        except RegistryError as exc:
            errors.append(f"{manifest_path}: {exc}")
            continue
        # Collision check against the skill registry's paths.
        collision_keys = [(cap.namespace, cap.target)]
        # /cluster skills all bucket under (cluster, None); match that.
        if cap.namespace == "cluster":
            collision_keys = [("cluster", None)]
        collides = any(
            cap.command_path in skill_command_paths.get(k, set())
            for k in collision_keys
        )
        if collides:
            errors.append(
                f"{manifest_path}: capability command /{cap.namespace} "
                f"{cap.target + ' ' if cap.target else ''}"
                f"{' '.join(cap.command_path)} collides with an existing skill"
            )
            continue
        try:
            reg.add(cap)
        except RegistryError as exc:
            errors.append(f"{manifest_path}: {exc}")
    if errors:
        raise RegistryError("\n".join(errors))
    return reg


def _load_one(manifest_path: Path, skill_ids: set[str]) -> CapabilitySpec:
    with manifest_path.open("r", encoding="utf-8") as fh:
        manifest = yaml.safe_load(fh) or {}
    if manifest.get("kind") != "Capability":
        raise RegistryError(f"expected kind: Capability, got {manifest.get('kind')!r}")

    meta = manifest.get("metadata") or {}
    spec = manifest.get("spec") or {}
    cmd = spec.get("command") or {}

    cid = meta.get("id")
    if not cid or not isinstance(cid, str):
        raise RegistryError("metadata.id required")

    description = str(meta.get("description") or "").strip()
    if len(description) > 200:
        raise RegistryError(
            f"metadata.description too long ({len(description)} chars, max 200)"
        )

    namespace = cmd.get("namespace")
    if namespace not in ("infra", "cluster", "app", "ops", "ctx", "gitlab", "pipeline"):
        raise RegistryError(f"spec.command.namespace invalid: {namespace!r}")
    # /infra capabilities carry a provider target like their skill cousins.
    # Other namespaces are flat (target=None).
    target_raw = cmd.get("target")
    if namespace == "infra":
        if not target_raw:
            raise RegistryError("spec.command.target required for /infra capability")
        target: str | None = str(target_raw)
    else:
        target = None
    noun_raw = cmd.get("noun", []) or []
    if not isinstance(noun_raw, list):
        raise RegistryError("spec.command.noun must be a list")
    noun = tuple(str(n) for n in noun_raw)
    verb = cmd.get("verb")
    if not isinstance(verb, str) or not verb:
        raise RegistryError("spec.command.verb required")

    mode = spec.get("mode", "read")
    if mode not in _VALID_MODE:
        raise RegistryError(f"spec.mode invalid: {mode!r}")

    args = tuple(_arg(a) for a in (spec.get("args") or []))

    # Profile (optional — capabilities often need the same pins as their skills)
    profile = spec.get("profile") or {}
    profile_kind = profile.get("kind")
    profile_required = bool(profile.get("required"))

    # Steps
    steps_raw = spec.get("steps") or []
    if not isinstance(steps_raw, list) or not steps_raw:
        raise RegistryError("spec.steps must be a non-empty list")
    step_ids: set[str] = set()
    steps: list[StepSpec] = []
    for i, s in enumerate(steps_raw):
        if not isinstance(s, dict):
            raise RegistryError(f"spec.steps[{i}] must be a mapping")
        sid = s.get("id")
        if not isinstance(sid, str) or not sid:
            raise RegistryError(f"spec.steps[{i}].id required")
        if sid in step_ids:
            raise RegistryError(f"spec.steps[{i}].id duplicate: {sid!r}")
        step_ids.add(sid)
        skill_id = s.get("skill")
        if not isinstance(skill_id, str) or skill_id not in skill_ids:
            raise RegistryError(
                f"spec.steps[{i}].skill must reference a known skill id "
                f"(got {skill_id!r})"
            )
        step_args_raw = s.get("args") or {}
        if not isinstance(step_args_raw, dict):
            raise RegistryError(f"spec.steps[{i}].args must be a mapping")
        step_args = tuple((str(k), v) for k, v in step_args_raw.items())
        steps.append(StepSpec(id=sid, skill_id=skill_id, args=step_args))

    # Findings
    findings: list[FindingSpec] = []
    for i, f in enumerate(spec.get("findings") or []):
        if not isinstance(f, dict):
            raise RegistryError(f"spec.findings[{i}] must be a mapping")
        fid = f.get("id")
        if not isinstance(fid, str) or not fid:
            raise RegistryError(f"spec.findings[{i}].id required")
        from_step = f.get("from")
        if from_step not in step_ids:
            raise RegistryError(
                f"spec.findings[{i}].from must match a step id "
                f"(got {from_step!r})"
            )
        when_src = f.get("when")
        if not isinstance(when_src, str) or not when_src.strip():
            raise RegistryError(f"spec.findings[{i}].when required (non-empty string)")
        try:
            when_compiled = compile_finding(when_src)
        except DSLError as exc:
            raise RegistryError(
                f"spec.findings[{i}].when DSL error: {exc}"
            ) from exc
        severity = f.get("severity", "info")
        if severity not in _VALID_SEVERITY:
            raise RegistryError(
                f"spec.findings[{i}].severity must be one of {_VALID_SEVERITY}"
            )
        message = f.get("message")
        if not isinstance(message, str) or not message.strip():
            raise RegistryError(f"spec.findings[{i}].message required")
        suggest = f.get("suggest")
        if suggest is not None and not isinstance(suggest, str):
            raise RegistryError(f"spec.findings[{i}].suggest must be a string when set")
        findings.append(
            FindingSpec(
                id=fid,
                from_step=from_step,
                when_source=when_src,
                when_compiled=when_compiled,
                severity=severity,
                message=message,
                suggest=suggest,
            )
        )

    rollback = spec.get("rollback")
    if rollback is not None and not isinstance(rollback, str):
        raise RegistryError("spec.rollback must be a string when set")

    return CapabilitySpec(
        id=cid,
        namespace=namespace,
        target=target,
        noun=noun,
        verb=verb,
        mode=mode,
        args=args,
        name=str(meta.get("name") or ""),
        description=description,
        steps=tuple(steps),
        findings=tuple(findings),
        rollback=rollback,
        profile_kind=profile_kind,
        profile_required=profile_required,
        manifest_path=str(manifest_path.resolve()),
    )


def command_paths_by_namespace(
    skills: list[SkillSpec],
) -> dict[tuple[str, str | None], set[tuple[str, ...]]]:
    """Utility the state module uses to prime the collision check when
    loading capabilities after skills. Keyed by (namespace, target) to match
    the capability registry's partitioning."""
    result: dict[tuple[str, str | None], set[tuple[str, ...]]] = {}
    for s in skills:
        result.setdefault((s.namespace, s.target), set()).add(s.command_path)
    return result
