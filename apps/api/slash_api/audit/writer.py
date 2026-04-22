"""Append-only JSONL audit writer + query + redact.

See docs/05-safety-audit.md §4.3, §4.4.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_AUDIT_PATH_ENV = "SLASH_AUDIT_PATH"
# repo_root / var / audit.jsonl — resolve from this file's location, not CWD.
# parents[0]=audit, [1]=slash_api, [2]=api, [3]=apps, [4]=repo root
_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_PATH = _REPO_ROOT / "var" / "audit.jsonl"

_lock = threading.Lock()


# --- redaction -------------------------------------------------------------

_AKID = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
_GCP_TOKEN = re.compile(r"\bya29\.[A-Za-z0-9_\-]{60,}\b")
_AUTH_HEADER = re.compile(r"(Authorization:\s*Bearer\s+)[^\s\"']+", re.IGNORECASE)
_PASSWORD_EQ = re.compile(r"\b(password|passwd|pwd|secret|token)\s*=\s*\S+", re.IGNORECASE)


def redact(text: str) -> tuple[str, list[str]]:
    hits: list[str] = []
    if not isinstance(text, str):
        return text, hits
    new = text
    if _AKID.search(new):
        hits.append("aws_access_key_id")
        new = _AKID.sub("[REDACTED_AKID]", new)
    if _GCP_TOKEN.search(new):
        hits.append("gcp_oauth_token")
        new = _GCP_TOKEN.sub("[REDACTED_GCP_TOKEN]", new)
    if _AUTH_HEADER.search(new):
        hits.append("authorization_header")
        new = _AUTH_HEADER.sub(r"\1[REDACTED_TOKEN]", new)
    if _PASSWORD_EQ.search(new):
        hits.append("password_eq")
        new = _PASSWORD_EQ.sub(r"\1=[REDACTED]", new)
    return new, hits


# --- writer ----------------------------------------------------------------


def _path() -> Path:
    raw = os.environ.get(_AUDIT_PATH_ENV)
    if raw:
        return Path(raw)
    return _DEFAULT_PATH


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def append(event: dict[str, Any]) -> None:
    """Serialize and append a single event to the audit log.

    Caller passes a pre-shaped dict (see docs/05 §4.2). We:
      - add `ts` if missing (UTC ISO-8601)
      - redact string fields under `command`, `approval_reason`, `summary`
      - if `stdout` is given, hash → stdout_sha256 and drop the raw
      - serialize as a single JSON line with sorted keys
    """
    ev = dict(event)
    ev.setdefault("ts", datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"))

    redactions: set[str] = set()
    for key in ("command", "approval_reason", "summary"):
        if key in ev and isinstance(ev[key], str):
            new, hits = redact(ev[key])
            ev[key] = new
            redactions.update(hits)

    if "stdout" in ev:
        raw = ev.pop("stdout") or ""
        ev["stdout_sha256"] = _sha(raw)
    if "stderr" in ev:
        raw = ev.pop("stderr") or ""
        ev["stderr_sha256"] = _sha(raw)

    if redactions:
        ev.setdefault("redactions", sorted(redactions))

    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(ev, ensure_ascii=False, sort_keys=True)
    with _lock:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


# --- query -----------------------------------------------------------------


def query(
    *,
    since_seconds: int | None = None,
    user: str | None = None,
    command_prefix: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Scan the audit log, filter, return most-recent first."""
    path = _path()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    cutoff_iso: str | None = None
    if since_seconds is not None:
        from datetime import timedelta

        cutoff_iso = (
            (datetime.now(UTC) - timedelta(seconds=since_seconds))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if cutoff_iso and ev.get("ts", "") < cutoff_iso:
                continue
            if user and ev.get("user") != user:
                continue
            if command_prefix and not (ev.get("command", "")).startswith(command_prefix):
                continue
            out.append(ev)
    # newest first, capped
    out.reverse()
    return out[:limit]
