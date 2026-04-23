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
from datetime import datetime, timezone
from pathlib import Path


def _iso_utc_now() -> str:
    """ISO-8601 UTC timestamp with millisecond precision (Z suffix)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


@dataclass
class RunResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool
    argv: list[str]
    # Wall-clock ISO-8601 UTC timestamps bracketing the subprocess. Used by the
    # audit trail and the UI's run-timeline to plot "running" duration. Set by
    # `execute()` itself — callers MUST NOT synthesize these.
    started_at: str = ""
    ended_at: str = ""


def execute(
    argv: list[str],
    env: dict[str, str],
    timeout_s: float,
) -> RunResult:
    """THE single local runner entry. All skill execution — read and write,
    every namespace — funnels through this function. Never raises on non-zero.

    Hard contract (docs/03 §2.4, docs/05 §T1):
    - `argv` MUST be a list of already-validated strings. Each element lands
      as-is in `argv[]` of the child process. No string is ever handed to
      `sh -c`, and `subprocess.run(..., shell=False)` is explicit below.
    - Raw user input never reaches this function: the parser + skill's
      `bash.argv` template (see runtime/builder.py) are the only argv source.
    - `env` is the already-merged env dict (profile envs + SLASH_* overrides).
    - Returns a uniform RunResult (stdout, stderr, exit_code, started_at,
      ended_at, duration_ms, timed_out). Callers derive state from there.

    Harness hooks (opt-in via env vars set by the caller):
      SLASH_MOCK_STDOUT_PATH — path to a file; its contents become stdout
      SLASH_MOCK_EXIT       — override exit code
      SLASH_MOCK_STDERR     — literal stderr
      SLASH_MOCK_LATENCY_MS — sleep this many ms before "completing"
    """
    started_at = _iso_utc_now()
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
            started_at=started_at,
            ended_at=_iso_utc_now(),
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
            started_at=started_at,
            ended_at=_iso_utc_now(),
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
            started_at=started_at,
            ended_at=_iso_utc_now(),
        )
    except FileNotFoundError as exc:
        return RunResult(
            exit_code=127,
            stdout="",
            stderr=f"executable not found: {exc.filename}",
            duration_ms=0,
            timed_out=False,
            argv=argv,
            started_at=started_at,
            ended_at=_iso_utc_now(),
        )


def execute_steps(
    argv_steps: list[list[str]],
    env: dict[str, str],
    timeout_s: float,
) -> list[RunResult]:
    """Run a sequence of argv invocations through the same `execute()` entry.
    Short-circuits on the first non-zero exit: remaining steps are NOT spawned
    and are therefore absent from the returned list (callers decide whether to
    synthesize "skipped" placeholders for auditing).

    This is the runtime primitive behind `spec.bash.steps` — used by
    `/app deploy` and any future multi-call write skill. Each step still goes
    through `execute()`, inheriting the argv-only / shell=False / ISO-timestamp
    contract unchanged.

    `timeout_s` is per-step, matching the skill's declared timeout for the
    whole skill; a generous budget is the caller's responsibility for now.
    """
    results: list[RunResult] = []
    for argv in argv_steps:
        res = execute(argv, env, timeout_s)
        results.append(res)
        if res.exit_code != 0 or res.timed_out:
            break
    return results
