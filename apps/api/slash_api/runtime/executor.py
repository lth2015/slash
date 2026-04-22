"""Bash executor — spawns subprocess with argv (never shell=True).

Supports:
- hard timeout
- env injection
- live stdout/stderr capture (streamed later via WS; for now sync)
- mock stdout/exit for harness tests (via env SLASH_MOCK_STDOUT_PATH, SLASH_MOCK_EXIT, SLASH_MOCK_LATENCY_MS)
"""

from __future__ import annotations

import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class RunResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool
    argv: list[str]


def execute(
    argv: list[str],
    env: dict[str, str],
    timeout_s: float,
) -> RunResult:
    """Run argv synchronously. Returns RunResult (never raises on non-zero).

    Harness hooks (used only when the caller explicitly sets env vars):
      SLASH_MOCK_STDOUT_PATH — path to a file; its contents become stdout
      SLASH_MOCK_EXIT       — override exit code
      SLASH_MOCK_STDERR     — literal stderr
      SLASH_MOCK_LATENCY_MS — sleep this many ms before "completing"
    """
    mock_path = env.get("SLASH_MOCK_STDOUT_PATH") or os.environ.get("SLASH_MOCK_STDOUT_PATH")
    if mock_path:
        stdout = Path(mock_path).read_text()
        exit_code = int(env.get("SLASH_MOCK_EXIT", os.environ.get("SLASH_MOCK_EXIT", "0")))
        stderr = env.get("SLASH_MOCK_STDERR", os.environ.get("SLASH_MOCK_STDERR", ""))
        latency_ms = int(env.get("SLASH_MOCK_LATENCY_MS", os.environ.get("SLASH_MOCK_LATENCY_MS", "0")))
        timed_out = False
        if latency_ms > timeout_s * 1000:
            timed_out = True
            exit_code = -1
            stdout = ""
            stderr = (stderr + "\n[mock timeout]" ) if stderr else "[mock timeout]"
        elif latency_ms > 0:
            time.sleep(latency_ms / 1000.0)
        return RunResult(
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            duration_ms=latency_ms,
            timed_out=timed_out,
            argv=argv,
        )

    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            # Explicitly disable shell — argv is a list, values never parsed by sh/bash.
            shell=False,
        )
        duration_ms = int((time.monotonic() - t0) * 1000)
        return RunResult(
            exit_code=proc.returncode,
            stdout=proc.stdout,
            stderr=proc.stderr,
            duration_ms=duration_ms,
            timed_out=False,
            argv=argv,
        )
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        return RunResult(
            exit_code=-1,
            stdout=exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or ""),
            stderr=(exc.stderr.decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")) + "\n[timeout]",
            duration_ms=duration_ms,
            timed_out=True,
            argv=argv,
        )
    except FileNotFoundError as exc:
        return RunResult(
            exit_code=127,
            stdout="",
            stderr=f"executable not found: {exc.filename}",
            duration_ms=0,
            timed_out=False,
            argv=argv,
        )
