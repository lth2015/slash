"""Parse a RunResult's stdout according to skill.output rules.

Supports:
  parse: json         → python object
  parse: text         → string unchanged
  parse: lines        → list of non-empty lines

If `output.path` is a dotted jmespath-style path, we navigate in.
Only a small safe subset is supported (no filters): "A.B[].C" semantics — anything with [] means "flatten each element into a list".
"""

from __future__ import annotations

import json
from typing import Any


class OutputError(Exception):
    pass


def parse_output(stdout: str, output_spec: dict) -> Any:
    parse = (output_spec or {}).get("parse", "text")
    if parse == "json":
        if not stdout.strip():
            return []
        try:
            value = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise OutputError(f"stdout is not valid JSON: {exc}") from exc
        path = output_spec.get("path")
        if path:
            value = _apply_path(value, path)
        return value
    if parse == "lines":
        return [line for line in stdout.splitlines() if line.strip()]
    # default: text
    return stdout


def _apply_path(value: Any, path: str) -> Any:
    """Navigate `value` by dot segments; '[]' means flatten the list at that step."""
    cursor: Any = value
    for segment in path.split("."):
        if not segment:
            continue
        if segment.endswith("[]"):
            key = segment[:-2]
            if key:
                cursor = _get(cursor, key)
            if not isinstance(cursor, list):
                return []
            # flatten one level
            flat: list[Any] = []
            for item in cursor:
                if isinstance(item, list):
                    flat.extend(item)
                else:
                    flat.append(item)
            cursor = flat
        else:
            cursor = _get(cursor, segment)
    return cursor


def _get(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    if isinstance(value, list):
        # apply to each
        return [_get(v, key) for v in value]
    return None


def lookup_column(row: Any, key: str, fallback: Any = None) -> Any:
    """Resolve a column key like 'Tags.Name' or 'State.Name' against a row dict."""
    cursor: Any = row
    for segment in key.split("."):
        if cursor is None:
            return fallback
        if isinstance(cursor, dict):
            cursor = cursor.get(segment)
        elif isinstance(cursor, list):
            # Special-case EC2-ish: list of {Key,Value}; use Key-lookup
            if all(isinstance(x, dict) and "Key" in x and "Value" in x for x in cursor):
                match = next((x["Value"] for x in cursor if x.get("Key") == segment), None)
                cursor = match
            else:
                return fallback
        else:
            return fallback
    return cursor if cursor is not None else fallback
