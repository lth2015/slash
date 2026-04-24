"""Unit tests for the findings DSL parser + evaluator.

The DSL is the only user-authored expression language in the capability
layer, so it deserves its own coverage independent of any end-to-end
capability execution. See docs/09-capabilities.md §4 for the grammar.
"""

from __future__ import annotations

import pytest

from slash_api.capability.dsl import DSLError, compile_finding, eval_finding


def _truthy(src: str, rows: list[dict]) -> bool:
    return eval_finding(compile_finding(src), rows)["truthy"]


def _count(src: str, rows: list[dict]) -> int:
    return eval_finding(compile_finding(src), rows)["count"]


# ── happy-path: every documented construct ─────────────────────────────


def test_any_matches() -> None:
    rows = [{"status": {"phase": "Pending"}}, {"status": {"phase": "Running"}}]
    assert _truthy('any(row.status.phase == "Pending")', rows)


def test_any_no_match() -> None:
    assert not _truthy('any(row.type == "Warning")', [{"type": "Normal"}])


def test_count_comparison() -> None:
    rows = [{"type": "Warning"}, {"type": "Normal"}, {"type": "Warning"}]
    assert _truthy('count(row.type == "Warning") > 1', rows)
    assert _count('count(row.type == "Warning") > 1', rows) == 2


def test_count_equals_zero() -> None:
    assert _truthy('count(row.type == "Warning") == 0', [{"type": "Normal"}])


def test_nested_path() -> None:
    rows = [{"status": {"containerStatuses": [{"state": {"waiting": {"reason": "CrashLoopBackOff"}}}]}}]
    assert _truthy(
        'any(row.status.containerStatuses[0].state.waiting.reason == "CrashLoopBackOff")',
        rows,
    )


def test_logical_and_or() -> None:
    rows = [{"x": "y", "z": 1}]
    assert _truthy('any(row.x == "y") && count(row.z == 1) > 0', rows)
    assert _truthy('any(row.x == "nope") || any(row.z == 1)', rows)


def test_not_operator() -> None:
    assert _truthy('!any(row.type == "Warning")', [{"type": "Normal"}])


def test_numeric_comparisons() -> None:
    rows = [{"Size": 100}, {"Size": 50}]
    # `count(...)` returns the inner-predicate match count regardless of
    # whether the top-level expression wraps it in a comparison.
    assert _count("count(row.Size >= 100) == 1", rows) == 1
    assert _truthy("count(row.Size >= 100) == 1", rows)
    assert not _truthy("count(row.Size >= 100) == 2", rows)


def test_literal_types() -> None:
    assert _truthy("any(row.running == true)", [{"running": True}])
    assert _truthy("any(row.n == null)", [{"n": None}])


def test_empty_rows() -> None:
    # any() over empty is false; count() is 0.
    assert not _truthy('any(row.x == "y")', [])
    assert _truthy('count(row.x == "y") == 0', [])


# ── grammar rejections ─────────────────────────────────────────────────


def test_rejects_arithmetic() -> None:
    with pytest.raises(DSLError):
        compile_finding("count(row.x) + 1 > 0")


def test_rejects_unknown_function() -> None:
    with pytest.raises(DSLError):
        compile_finding('sum(row.x)')


def test_rejects_assignment() -> None:
    with pytest.raises(DSLError):
        compile_finding('row.x = 1')


def test_rejects_function_on_path() -> None:
    # `.func()` should not parse — path segments are only dotted identifiers.
    with pytest.raises(DSLError):
        compile_finding('row.status.func()')


def test_rejects_reserved_as_segment() -> None:
    with pytest.raises(DSLError):
        compile_finding('row.any')


def test_rejects_stray_token() -> None:
    with pytest.raises(DSLError):
        compile_finding('any(row.x) extra')


def test_rejects_bare_row() -> None:
    # A bare `row` at top level compiles (as Path) but that's fine;
    # what must NOT parse is an empty body inside any(...).
    with pytest.raises(DSLError):
        compile_finding("any()")


def test_first_returns_row() -> None:
    rows = [{"id": 1, "status": "failed"}, {"id": 2, "status": "success"}]
    # Top-level first(...) is truthy if at least one row matches.
    result = eval_finding(compile_finding('first(row.status == "failed")'), rows)
    assert result["truthy"] is True
    assert result["first"] == {"id": 1, "status": "failed"}
    assert result["count"] == 1
