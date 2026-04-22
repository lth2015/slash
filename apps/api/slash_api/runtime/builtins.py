"""Built-in skills (no bash subprocess).

Currently:
  - audit_query: tail/filter var/audit.jsonl
  - diagnose:    read audit rows for a target; result is consumed by /explain

Each handler returns (state, outputs, error_code, error_message). stdout is left
empty (nothing to redact); callers know there was no subprocess.
"""

from __future__ import annotations

import re
from typing import Any

from slash_api.audit import query as audit_query

_DURATION = re.compile(r"^(\d+)([smhd])$")
_UNITS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def run_builtin(kind: str, args: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
    if kind == "audit_query":
        return _audit_query(args)
    if kind == "diagnose":
        return _diagnose(args)
    return "error", None, "BuiltinUnknown", f"no built-in named {kind!r}"


def _parse_duration(text: str | None) -> int | None:
    if not text:
        return None
    m = _DURATION.match(str(text))
    if not m:
        return None
    return int(m.group(1)) * _UNITS[m.group(2)]


def _audit_query(args: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
    rows = audit_query(
        since_seconds=_parse_duration(args.get("since")),
        user=args.get("user"),
        command_prefix=args.get("command_prefix"),
        limit=500,
    )
    return "ok", rows, None, None


def _diagnose(args: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
    target = args.get("target", "")
    rows = audit_query(since_seconds=7 * 86400, command_prefix=None, limit=500)
    matched = [r for r in rows if target.lower() in (r.get("command") or "").lower()]
    return "ok", {
        "target": target,
        "match_count": len(matched),
        "recent_runs": matched[:20],
    }, None, None
