"""Capability executor — sequential step runs + findings engine.

Per docs/09-capabilities.md: every step goes through the single
runtime.execute() entry. No second subprocess path. Read-only v0.7.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from slash_api.capability.dsl import eval_finding
from slash_api.capability.loader import CapabilitySpec, FindingSpec
from slash_api.parser.parser import CommandAST, SkillSpec
from slash_api.runtime import execute as run_bash
from slash_api.runtime.builder import BuildContext, build_argv
from slash_api.runtime.output import parse_output
from slash_api.runtime.profile import env_for_profile, merged_env


@dataclass
class StepRunResult:
    id: str
    skill_id: str
    state: str  # "ok" | "error" | "skipped"
    exit_code: int | None
    duration_ms: int
    started_at: str
    ended_at: str
    argv: list[str]
    outputs: Any = None
    stdout_excerpt: str = ""
    stderr_excerpt: str = ""
    error_code: str | None = None
    error_message: str | None = None


@dataclass
class FindingResult:
    id: str
    severity: str
    message: str
    suggest: str | None
    count: int
    from_step: str


@dataclass
class CapabilityResult:
    run_id: str
    capability_id: str
    state: str  # "ok" | "error" | "partial"
    duration_ms: int
    started_at: str
    ended_at: str
    steps: list[StepRunResult] = field(default_factory=list)
    findings: list[FindingResult] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    failed_step: str | None = None


def execute_capability(
    *,
    cap: CapabilitySpec,
    ast: CommandAST,
    skill_by_id: dict[str, SkillSpec],
    skill_manifests: dict[str, dict],
    profile_kind: str | None,
    profile_name: str | None,
    k8s_context: str | None,
) -> CapabilityResult:
    """Run `cap` against the runtime. Short-circuits on the first failed
    step. Findings are only evaluated if all steps succeed — a partial run
    can't produce meaningful findings."""

    run_id = f"r_cap_{uuid.uuid4().hex[:10]}"
    started = _iso_now()
    t0 = _monotonic_ms()

    # Build the runtime.BuildContext reused by every step. Capabilities share
    # one profile resolution (they should: they all target the same domain).
    cap_args: dict[str, Any] = dict(ast.flags)
    if ast.positional and cap.args:
        # Same convention as Skill: positional args are mapped by declaration order.
        pos_specs = [a for a in cap.args if a.positional]
        for i, spec in enumerate(pos_specs):
            if i < len(ast.positional):
                cap_args[spec.name] = ast.positional[i]

    env_update = env_for_profile(profile_kind or "", profile_name)
    env = merged_env(env_update)

    step_results: list[StepRunResult] = []
    step_outputs: dict[str, Any] = {}

    for step in cap.steps:
        manifest = skill_manifests.get(step.skill_id)
        if manifest is None:
            return _fail_early(
                run_id=run_id,
                cap=cap,
                started=started,
                t0=t0,
                step_id=step.id,
                code="MissingSkill",
                msg=f"step {step.id} references missing skill {step.skill_id}",
            )

        # Merge the capability args + the step's declared overrides, evaluating
        # ${args.x} refs lazily. Positional args bind by their declaration order
        # within the child skill.
        skill_spec = skill_by_id[step.skill_id]
        step_arg_map = _resolve_step_args(step.args, cap_args, step_outputs)

        # Split into (positional order, flag dict) for the build context.
        positional: list[Any] = []
        flags: dict[str, Any] = {}
        for spec in skill_spec.args:
            if spec.name not in step_arg_map:
                if spec.default is not None:
                    flags[spec.name] = spec.default
                continue
            if spec.positional:
                positional.append(step_arg_map[spec.name])
            else:
                flags[spec.name] = step_arg_map[spec.name]

        ctx = BuildContext(
            args=flags,
            positional=positional,
            profile_kind=profile_kind,
            profile_name=profile_name,
            k8s_context=k8s_context,
        )

        argv = build_argv(manifest, ctx)
        timeout_s = _timeout(manifest)
        sub_started = _iso_now()
        sub_t0 = _monotonic_ms()
        result = run_bash(argv, env, timeout_s)
        sub_ended = _iso_now()
        duration = _monotonic_ms() - sub_t0

        output_spec = manifest.get("spec", {}).get("output") or {}
        success_codes = output_spec.get("success_codes") or [0]
        if result.exit_code not in success_codes or result.timed_out:
            step_results.append(
                StepRunResult(
                    id=step.id,
                    skill_id=step.skill_id,
                    state="error",
                    exit_code=result.exit_code,
                    duration_ms=duration,
                    started_at=sub_started,
                    ended_at=sub_ended,
                    argv=argv,
                    stdout_excerpt=_excerpt(result.stdout),
                    stderr_excerpt=_excerpt(result.stderr),
                    error_code="Timeout" if result.timed_out else "ExecutionError",
                    error_message=(result.stderr or result.stdout).strip()[:400],
                )
            )
            total = _monotonic_ms() - t0
            return CapabilityResult(
                run_id=run_id,
                capability_id=cap.id,
                state="error",
                duration_ms=total,
                started_at=started,
                ended_at=_iso_now(),
                steps=step_results,
                findings=[],
                error_code=step_results[-1].error_code,
                error_message=step_results[-1].error_message,
                failed_step=step.id,
            )

        try:
            parsed = parse_output(result.stdout, output_spec)
        except Exception as exc:  # noqa: BLE001 — treat output-parse as step error
            step_results.append(
                StepRunResult(
                    id=step.id,
                    skill_id=step.skill_id,
                    state="error",
                    exit_code=result.exit_code,
                    duration_ms=duration,
                    started_at=sub_started,
                    ended_at=sub_ended,
                    argv=argv,
                    stdout_excerpt=_excerpt(result.stdout),
                    stderr_excerpt="",
                    error_code="OutputParseError",
                    error_message=str(exc)[:400],
                )
            )
            total = _monotonic_ms() - t0
            return CapabilityResult(
                run_id=run_id,
                capability_id=cap.id,
                state="error",
                duration_ms=total,
                started_at=started,
                ended_at=_iso_now(),
                steps=step_results,
                findings=[],
                error_code="OutputParseError",
                error_message=str(exc)[:400],
                failed_step=step.id,
            )

        step_outputs[step.id] = parsed
        step_results.append(
            StepRunResult(
                id=step.id,
                skill_id=step.skill_id,
                state="ok",
                exit_code=result.exit_code,
                duration_ms=duration,
                started_at=sub_started,
                ended_at=sub_ended,
                argv=argv,
                outputs=parsed,
                stdout_excerpt=_excerpt(result.stdout),
            )
        )

    # All steps ok — run findings.
    findings: list[FindingResult] = []
    for f in cap.findings:
        rows = step_outputs.get(f.from_step)
        rows_list = rows if isinstance(rows, list) else ([rows] if rows is not None else [])
        try:
            out = eval_finding(f.when_compiled, rows_list)
        except Exception as exc:  # noqa: BLE001 — findings must never crash the run
            out = {"truthy": False, "count": 0, "first": None, "error": str(exc)}
        if not out.get("truthy"):
            continue
        findings.append(
            FindingResult(
                id=f.id,
                severity=f.severity,
                message=_interp(f.message, out, cap_args),
                suggest=_interp(f.suggest, out, cap_args) if f.suggest else None,
                count=int(out.get("count", 0)),
                from_step=f.from_step,
            )
        )

    total = _monotonic_ms() - t0
    return CapabilityResult(
        run_id=run_id,
        capability_id=cap.id,
        state="ok",
        duration_ms=total,
        started_at=started,
        ended_at=_iso_now(),
        steps=step_results,
        findings=findings,
    )


# ── helpers ────────────────────────────────────────────────────────────


_ARG_RE = re.compile(r"\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}")


def _resolve_step_args(
    step_args: tuple[tuple[str, Any], ...],
    cap_args: dict[str, Any],
    step_outputs: dict[str, Any],
) -> dict[str, Any]:
    """Substitute ${args.x} and ${steps.<id>.<path>} refs in step arg values."""
    resolved: dict[str, Any] = {}
    for key, value in step_args:
        if isinstance(value, str):
            resolved[key] = _ARG_RE.sub(
                lambda m: _resolve_ref(m.group(1), cap_args, step_outputs),
                value,
            )
        else:
            resolved[key] = value
    return resolved


def _resolve_ref(expr: str, cap_args: dict[str, Any], step_outputs: dict[str, Any]) -> str:
    # args.name or steps.stepid.path.path
    parts = expr.split(".")
    if not parts:
        return ""
    if parts[0] == "args":
        value: Any = cap_args
        for seg in parts[1:]:
            if isinstance(value, dict):
                value = value.get(seg)
            else:
                return ""
        return "" if value is None else str(value)
    if parts[0] == "steps" and len(parts) >= 2:
        value = step_outputs.get(parts[1])
        for seg in parts[2:]:
            if isinstance(value, dict):
                value = value.get(seg)
            else:
                return ""
        return "" if value is None else str(value)
    return ""


_MSG_RE = re.compile(r"\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}")


def _interp(
    template: str,
    finding_out: dict[str, Any],
    cap_args: dict[str, Any],
) -> str:
    def repl(m: re.Match[str]) -> str:
        expr = m.group(1)
        parts = expr.split(".")
        if parts == ["count"]:
            return str(finding_out.get("count", 0))
        if parts[0] == "first":
            value: Any = finding_out.get("first")
            for seg in parts[1:]:
                if isinstance(value, dict):
                    value = value.get(seg)
                else:
                    return m.group(0)
            return "" if value is None else str(value)
        if parts[0] == "args":
            value = cap_args
            for seg in parts[1:]:
                if isinstance(value, dict):
                    value = value.get(seg)
                else:
                    return m.group(0)
            return "" if value is None else str(value)
        return m.group(0)

    return _MSG_RE.sub(repl, template)


def _fail_early(
    *,
    run_id: str,
    cap: CapabilitySpec,
    started: str,
    t0: int,
    step_id: str,
    code: str,
    msg: str,
) -> CapabilityResult:
    return CapabilityResult(
        run_id=run_id,
        capability_id=cap.id,
        state="error",
        duration_ms=_monotonic_ms() - t0,
        started_at=started,
        ended_at=_iso_now(),
        steps=[],
        findings=[],
        error_code=code,
        error_message=msg,
        failed_step=step_id,
    )


def _timeout(manifest: dict) -> float:
    raw = (manifest.get("spec") or {}).get("timeout", "60s")
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if s.endswith("s"):
        return float(s[:-1])
    if s.endswith("m"):
        return float(s[:-1]) * 60
    if s.endswith("h"):
        return float(s[:-1]) * 3600
    return float(s)


def _excerpt(s: str, limit: int = 4000) -> str:
    s = s or ""
    return s if len(s) <= limit else s[:limit] + "…"


def _iso_now() -> str:
    from datetime import datetime, timezone
    return (
        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    )


def _monotonic_ms() -> int:
    import time
    return int(time.monotonic() * 1000)


# Keep a module-level reference so `skill_manifests` can be passed by
# path and loaded on demand if a caller prefers that pattern.
__all__ = [
    "CapabilityResult",
    "FindingResult",
    "StepRunResult",
    "execute_capability",
]
