"""Runner contract — single entry, argv-only, uniform RunResult.

Pins down the hard contract from docs/03 §2.4 + docs/05 §T1:
  - Every skill execution funnels through runtime.execute (never shell=True).
  - RunResult carries started_at / ended_at as ISO-8601 UTC timestamps.
  - Both read and write paths hit the same function object.
"""

from __future__ import annotations

import re
from pathlib import Path

from slash_api.runtime import RunResult, execute
from slash_api.runtime import execute as run_bash  # the alias used by routers
from slash_api.routers import approvals as approvals_router
from slash_api.routers import execute as execute_router

_ISO_UTC = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)


def test_run_result_carries_iso_timestamps(tmp_path: Path) -> None:
    stdout_fixture = tmp_path / "out.txt"
    stdout_fixture.write_text("hello")

    result = execute(
        ["/bin/echo", "unused"],
        env={"SLASH_MOCK_STDOUT_PATH": str(stdout_fixture), "SLASH_MOCK_EXIT": "0"},
        timeout_s=5.0,
    )

    assert isinstance(result, RunResult)
    assert result.stdout == "hello"
    assert result.exit_code == 0
    assert _ISO_UTC.match(result.started_at), f"started_at invalid: {result.started_at!r}"
    assert _ISO_UTC.match(result.ended_at), f"ended_at invalid: {result.ended_at!r}"
    assert result.started_at <= result.ended_at  # lexicographic == chronological for ISO


def test_run_result_timestamps_on_timeout() -> None:
    """Even on timeout, started_at and ended_at must be populated — audit
    queries need a time range for every run, not just happy paths."""
    result = execute(
        ["/bin/sleep", "5"],
        env={"SLASH_MOCK_LATENCY_MS": "1000", "SLASH_MOCK_EXIT": "0"},
        timeout_s=0.5,  # latency (1000ms) > timeout (500ms) → mock-timeout branch
    )
    assert result.timed_out is True
    assert _ISO_UTC.match(result.started_at)
    assert _ISO_UTC.match(result.ended_at)


def test_run_result_timestamps_on_exec_not_found() -> None:
    """Executable-not-found path also returns a RunResult with timestamps
    (auditor must know we tried, even if the child never spawned)."""
    result = execute(
        ["/definitely/not/a/real/binary_" + "x" * 8],
        env={},
        timeout_s=5.0,
    )
    assert result.exit_code == 127
    assert _ISO_UTC.match(result.started_at)
    assert _ISO_UTC.match(result.ended_at)


def test_read_and_write_share_the_same_runner() -> None:
    """Both routers import the SAME callable as their executor. If someone
    later forks the runtime for write-only, this test flags it immediately.
    """
    assert execute_router.run_bash is run_bash
    assert approvals_router.run_bash is run_bash
    assert execute_router.run_bash is approvals_router.run_bash


def test_runner_never_passes_shell_true() -> None:
    """Source-level guard: subprocess.run must not be called with shell=True.
    The docstring may mention the string (e.g. "never shell=True") for human
    readers, so we look for it as an actual kwarg, not a free occurrence.
    See docs/05 §T1."""
    import re

    src = Path(__file__).resolve().parents[1] / "slash_api" / "runtime" / "executor.py"
    text = src.read_text()
    # Pattern: subprocess.run( ... shell = True ... ) across newlines.
    offender = re.search(r"subprocess\.run\([^)]*shell\s*=\s*True", text, flags=re.DOTALL)
    assert offender is None, "subprocess.run(..., shell=True) detected"
    assert "shell=False" in text  # sanity: the explicit disable is still there
