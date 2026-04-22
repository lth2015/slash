"""Append-only JSONL audit log. See docs/05-safety-audit.md §4."""

from slash_api.audit.writer import append, query, redact

__all__ = ["append", "query", "redact"]
