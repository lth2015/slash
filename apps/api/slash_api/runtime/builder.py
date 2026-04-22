"""Build argv for a skill from its manifest + parsed AST.

Contract (docs/04-skills.md §3 and §7):
- argv is a list. Each element is a safe string.
- ${var}, ${var[key]}, ${profile.<kind>.context} are replaced with parsed values.
- `expand` lets repeatable args add multiple argv elements (e.g. one --filters per tag).
- Values are inserted as complete argv elements; they are NEVER shell-interpreted.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


class BuildError(Exception):
    pass


VAR_REF = re.compile(r"\$\{([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\}")


@dataclass
class BuildContext:
    args: dict[str, Any]
    positional: list[Any]
    profile_kind: str | None
    profile_name: str | None
    k8s_context: str | None = None


def build_argv(manifest: dict, ctx: BuildContext) -> list[str]:
    """Render the skill's bash.argv list into a concrete argv list of strings."""
    bash = manifest.get("spec", {}).get("bash") or {}
    argv = bash.get("argv")
    if not isinstance(argv, list):
        raise BuildError("spec.bash.argv must be a list of strings")

    out: list[str] = []
    for element in argv:
        if not isinstance(element, str):
            raise BuildError(f"argv element must be string, got {type(element).__name__}")
        out.append(_interpolate(element, ctx))

    # expand: list of {when: <flag-name>, as: [...]} applied if arg present and truthy
    for rule in bash.get("expand", []) or []:
        when = rule.get("when")
        tmpl = rule.get("as")
        if not when or not isinstance(tmpl, list):
            continue
        value = ctx.args.get(when)
        if value in (None, "", [], {}):
            continue
        if isinstance(value, dict):
            for k, v in value.items():
                local_ctx = BuildContext(
                    args={**ctx.args, "key": k, "value": v},
                    positional=ctx.positional,
                    profile_kind=ctx.profile_kind,
                    profile_name=ctx.profile_name,
                    k8s_context=ctx.k8s_context,
                )
                for element in tmpl:
                    out.append(_interpolate(element, local_ctx))
        elif isinstance(value, list):
            for v in value:
                local_ctx = BuildContext(
                    args={**ctx.args, "value": v},
                    positional=ctx.positional,
                    profile_kind=ctx.profile_kind,
                    profile_name=ctx.profile_name,
                    k8s_context=ctx.k8s_context,
                )
                for element in tmpl:
                    out.append(_interpolate(element, local_ctx))
        else:
            local_ctx = BuildContext(
                args={**ctx.args, "value": value},
                positional=ctx.positional,
                profile_kind=ctx.profile_kind,
                profile_name=ctx.profile_name,
                k8s_context=ctx.k8s_context,
            )
            for element in tmpl:
                out.append(_interpolate(element, local_ctx))

    return out


def _interpolate(template: str, ctx: BuildContext) -> str:
    def replace(match: re.Match[str]) -> str:
        expr = match.group(1)
        return _resolve(expr, ctx)

    return VAR_REF.sub(replace, template)


def _resolve(expr: str, ctx: BuildContext) -> str:
    # supports:  name   |  name.sub  |  name[key]  |  profile.<kind>.context
    if expr.startswith("profile."):
        # profile.aws   → AWS_PROFILE value
        # profile.k8s.context → cluster context
        parts = expr.split(".")
        if len(parts) == 2 and parts[1] == ctx.profile_kind:
            return ctx.profile_name or ""
        if len(parts) == 3 and parts[1] == "k8s" and parts[2] == "context":
            return ctx.k8s_context or ""
        return ""

    # Top-level `positional` isn't named; by convention we bind named-positional into args.
    # Support simple dotted paths and bracket indexing into nested dicts for args.
    value: Any = ctx.args
    i = 0
    token = ""
    chars = list(expr)
    while i < len(chars):
        ch = chars[i]
        if ch == ".":
            value = _get(value, token)
            token = ""
            i += 1
            continue
        if ch == "[":
            if token:
                value = _get(value, token)
                token = ""
            # read until ]
            j = i + 1
            while j < len(chars) and chars[j] != "]":
                j += 1
            key = "".join(chars[i + 1 : j])
            value = _get(value, key)
            i = j + 1
            continue
        token += ch
        i += 1
    if token:
        value = _get(value, token)
    if value is None:
        return ""
    return str(value)


def _get(value: Any, key: str) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get(key)
    # object attribute fallback — rarely used
    return getattr(value, key, None)
