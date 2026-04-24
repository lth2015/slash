"""Gemini 2.5 Flash read-only integration. See docs/05-safety-audit.md §3."""

from slash_api.llm.client import ExplainResponse, explain, help_answer, is_enabled
from slash_api.llm.divergence import check_divergence

__all__ = ["explain", "help_answer", "is_enabled", "ExplainResponse", "check_divergence"]
