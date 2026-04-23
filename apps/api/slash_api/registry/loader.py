"""Load and validate skill manifests, index them for parser lookups.

See docs/04-skills-system.md §1–§2. M1 scope: in-memory load on startup.
Hot-reload lands later.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from slash_api.parser.parser import ArgSpec, SkillSpec


class RegistryError(Exception):
    """Raised when a manifest is malformed or collides with another."""


@dataclass
class SkillRegistry:
    skills: list[SkillSpec] = field(default_factory=list)
    # Index by (namespace, target) → list of SkillSpec; target is None for /app /ops.
    _by_ns_target: dict[tuple[str, str | None], list[SkillSpec]] = field(default_factory=dict)

    def add(self, skill: SkillSpec) -> None:
        key = (skill.namespace, skill.target)
        bucket = self._by_ns_target.setdefault(key, [])
        # collision check on full command path
        for s in bucket:
            if s.command_path == skill.command_path:
                raise RegistryError(
                    f"duplicate command: {skill.namespace} {skill.target} "
                    f"{' '.join(skill.command_path)} "
                    f"already registered as {s.id}"
                )
        bucket.append(skill)
        self.skills.append(skill)

    def lookup(self, namespace: str, target: str | None) -> list[SkillSpec]:
        # For /cluster any target is valid; stored under (cluster, None)
        if namespace == "cluster":
            return self._by_ns_target.get(("cluster", None), [])
        return self._by_ns_target.get((namespace, target), [])

    def all_skills(self) -> list[SkillSpec]:
        return list(self.skills)


# --- loader ----------------------------------------------------------------


def load_registry(skills_dir: Path) -> SkillRegistry:
    registry = SkillRegistry()
    if not skills_dir.exists():
        return registry
    errors: list[str] = []
    for manifest_path in sorted(skills_dir.rglob("skill.yaml")):
        try:
            skill = _load_one(manifest_path)
        except RegistryError as exc:
            errors.append(f"{manifest_path}: {exc}")
            continue
        skill_with_path = SkillSpec(
            id=skill.id,
            namespace=skill.namespace,
            target=skill.target,
            noun=skill.noun,
            verb=skill.verb,
            mode=skill.mode,
            args=skill.args,
            danger=skill.danger,
            name=skill.name,
            description=skill.description,
            manifest_path=str(manifest_path.resolve()),
        )
        try:
            registry.add(skill_with_path)
        except RegistryError as exc:
            errors.append(f"{manifest_path}: {exc}")
    if errors:
        # Fail loud on startup: we must not silently swallow bad skills (see 04 §3.1).
        raise RegistryError("\n".join(errors))
    return registry


def _load_one(manifest_path: Path) -> SkillSpec:
    with manifest_path.open("r", encoding="utf-8") as fh:
        manifest = yaml.safe_load(fh) or {}
    if not isinstance(manifest, dict):
        raise RegistryError("manifest must be a mapping")
    meta = manifest.get("metadata") or {}
    spec = manifest.get("spec") or {}
    cmd = spec.get("command") or {}

    missing = [k for k in ("id",) if not meta.get(k)]
    if missing:
        raise RegistryError(f"metadata missing: {missing}")

    namespace = cmd.get("namespace")
    if namespace not in ("infra", "cluster", "app", "ops", "ctx"):
        raise RegistryError(f"spec.command.namespace invalid: {namespace!r}")
    target_raw = cmd.get("target")
    # Canonicalize: /app /ops /ctx store None; /cluster stores None; /infra keeps provider.
    if namespace in ("app", "ops", "ctx"):
        target: str | None = None
    elif namespace == "cluster":
        target = None
    else:
        if not target_raw:
            raise RegistryError("spec.command.target required for /infra")
        target = str(target_raw)

    noun_raw = cmd.get("noun", []) or []
    if isinstance(noun_raw, str):
        raise RegistryError("spec.command.noun must be a list, not a string")
    if not isinstance(noun_raw, list):
        raise RegistryError("spec.command.noun must be a list")
    noun = tuple(str(n) for n in noun_raw)

    verb = cmd.get("verb")
    if not isinstance(verb, str) or not verb:
        raise RegistryError("spec.command.verb required")

    mode = spec.get("mode", "read")
    if mode not in ("read", "write"):
        raise RegistryError(f"spec.mode invalid: {mode!r}")

    args = tuple(_arg(a) for a in (spec.get("args") or []))

    # Preflight sanity: description must be a short string if present.
    description = str(meta.get("description") or "").strip()
    if len(description) > 200:
        raise RegistryError(
            f"metadata.description too long ({len(description)} chars, max 200)"
        )

    # Preflight block validation: if present, must be a mapping with argv list.
    preflight = spec.get("preflight")
    if preflight is not None:
        if not isinstance(preflight, dict):
            raise RegistryError("spec.preflight must be a mapping")
        pf_argv = preflight.get("argv")
        if not isinstance(pf_argv, list) or not all(isinstance(x, str) for x in pf_argv):
            raise RegistryError("spec.preflight.argv must be a list of strings")

    # success_codes must be list of ints if present.
    success_codes = (spec.get("output") or {}).get("success_codes")
    if success_codes is not None:
        if not isinstance(success_codes, list) or not all(isinstance(x, int) for x in success_codes):
            raise RegistryError("spec.output.success_codes must be a list of ints")

    # danger_reason required when danger: true
    if bool(spec.get("danger", False)):
        if not str(spec.get("danger_reason") or "").strip():
            raise RegistryError(
                "spec.danger_reason required when danger: true"
            )

    # Planner narration (optional per skill this phase; enforced as hard-required
    # in a later commit once the focal write skills have it). If a skill DOES
    # declare spec.plan.steps / spec.plan.target, validate shape here so
    # malformed manifests fail at startup rather than at plan time.
    plan_block = spec.get("plan")
    if plan_block is not None:
        if not isinstance(plan_block, dict):
            raise RegistryError("spec.plan must be a mapping")
        steps = plan_block.get("steps")
        if steps is not None:
            if not isinstance(steps, list) or not steps:
                raise RegistryError(
                    "spec.plan.steps must be a non-empty list of strings when set"
                )
            for i, s in enumerate(steps):
                if not isinstance(s, str) or not s.strip():
                    raise RegistryError(
                        f"spec.plan.steps[{i}] must be a non-empty string"
                    )
        target_tmpl = plan_block.get("target")
        if target_tmpl is not None and not isinstance(target_tmpl, str):
            raise RegistryError("spec.plan.target must be a string when set")

    return SkillSpec(
        id=str(meta["id"]),
        namespace=namespace,
        target=target,
        noun=noun,
        verb=verb,
        mode=mode,
        args=args,
        danger=bool(spec.get("danger", False)),
        name=str(meta.get("name") or ""),
        description=description,
    )


def _arg(raw: dict[str, Any]) -> ArgSpec:
    if not isinstance(raw, dict):
        raise RegistryError("each arg must be a mapping")
    name = raw.get("name")
    if not isinstance(name, str) or not name:
        raise RegistryError("arg.name required")
    typ = raw.get("type")
    if not isinstance(typ, str) or not typ:
        raise RegistryError(f"arg.type required on {name!r}")
    flag = raw.get("flag")
    positional = bool(raw.get("positional", False))
    if flag and not isinstance(flag, str):
        raise RegistryError(f"arg.flag must be string on {name!r}")
    if not flag and not positional:
        raise RegistryError(f"arg {name!r}: either flag or positional must be set")
    enum = raw.get("enum")
    enum_tuple: tuple[str, ...] | None = tuple(enum) if isinstance(enum, list) else None
    return ArgSpec(
        name=name,
        flag=flag,
        type=typ,
        required=bool(raw.get("required", False)),
        default=raw.get("default"),
        positional=positional,
        repeatable=bool(raw.get("repeatable", False)),
        enum=enum_tuple,
    )
