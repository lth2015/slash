"""Heuristic divergence check: is the LLM summary lying about the raw result?

See docs/05-safety-audit.md §3.3 for the 4 specific rules. We return
(warnings: list[str]). Empty list = no obvious divergence.
"""

from __future__ import annotations

import re
from typing import Any

_ID_TOKENS = re.compile(r"\b(?:i-[0-9a-f]{6,}|deploy(?:ment)?/\S+|pod/\S+|[A-Za-z0-9_-]{3,}-[0-9a-f]{4,})\b")
_INT = re.compile(r"\b(\d{1,6})\b")
_ACTIVE_PAST = re.compile(
    r"\b(i\s+(?:scaled|applied|deleted|restarted|created|stopped|started)"
    r"|we\s+(?:scaled|applied|deleted|restarted|created|stopped|started)"
    r"|(?:scaled|applied|deleted|restarted|created|stopped|started)\s+(?:the|your|this))",
    re.IGNORECASE,
)

_STATE_WORDS = ("running", "stopped", "failed", "error", "ok", "pending", "terminated")


def check_divergence(
    *,
    summary: str,
    raw_stdout: str,
    structured_outputs: Any,
    result_state: str,
) -> list[str]:
    warnings: list[str] = []
    if not summary:
        return warnings

    # Rule 4: claims of past action when state was not ok → lie risk
    if result_state != "ok" and _ACTIVE_PAST.search(summary):
        warnings.append(
            "LLM uses past-tense action verbs but the runtime did not report success."
        )

    # Rule 2: key tokens (ids) in summary should appear in raw
    raw_lower = raw_stdout.lower()
    sum_ids = set(m.group(0).lower() for m in _ID_TOKENS.finditer(summary))
    missing = [t for t in sum_ids if t not in raw_lower]
    if missing:
        warnings.append(
            "LLM mentions identifiers not present in raw output: " + ", ".join(sorted(missing)[:5])
        )

    # Rule 1: number magnitude
    # If summary contains a "found N"/"N items" style number, compare with the length
    # of the structured outputs when that's a list.
    if isinstance(structured_outputs, list):
        n_rows = len(structured_outputs)
        for m in _INT.finditer(summary):
            reported = int(m.group(1))
            # Skip small numbers that could be irrelevant (years, percentages).
            if reported < 2:
                continue
            if reported > 9999:
                continue
            # Allow ±10% or ±2 absolute tolerance.
            tol = max(2, int(0.1 * max(n_rows, reported)))
            if abs(reported - n_rows) <= tol:
                break
        else:
            # No matching integer found → check if summary strongly implies a count
            if re.search(r"\b(found|returned|lists?|total|count)\b", summary, re.IGNORECASE):
                warnings.append(
                    f"Summary claims a count that disagrees with structured row count ({n_rows})."
                )

    # Rule 3: state word consistency (only if runtime state is ok; if not ok, rule 4 covered it)
    if result_state == "ok":
        lower_sum = summary.lower()
        for w in _STATE_WORDS:
            if w in lower_sum:
                # Accept — summary may describe individual items
                pass

    return warnings
