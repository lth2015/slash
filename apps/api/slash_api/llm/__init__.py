"""Gemini 2.5 Flash explain-only integration. See docs/05-safety-audit.md §3."""

from slash_api.llm.client import ExplainResponse, explain, is_enabled
from slash_api.llm.divergence import check_divergence

__all__ = ["explain", "is_enabled", "ExplainResponse", "check_divergence"]
