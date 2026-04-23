"""Runtime — bash executor, profile loader, output parser.

See docs/03-architecture.md §2.4 and docs/04-skills.md §3.
"""

from slash_api.runtime.builder import BuildError, build_argv, build_argv_steps
from slash_api.runtime.builtins import run_builtin
from slash_api.runtime.executor import RunResult, execute, execute_steps
from slash_api.runtime.output import parse_output
from slash_api.runtime.profile import ProfileInventory, read_profiles

__all__ = [
    "build_argv",
    "build_argv_steps",
    "BuildError",
    "execute",
    "execute_steps",
    "RunResult",
    "parse_output",
    "read_profiles",
    "ProfileInventory",
    "run_builtin",
]
