"""Capability layer — static composition of atomic skills with findings.

See docs/09-capabilities.md for the contract. The package deliberately
re-uses slash_api.runtime.execute for every subprocess invocation; no
second entry point exists.
"""

from slash_api.capability.dsl import (
    DSLError,
    compile_finding,
    eval_finding,
)
from slash_api.capability.executor import CapabilityResult, execute_capability
from slash_api.capability.loader import (
    CapabilityRegistry,
    CapabilitySpec,
    StepSpec,
    FindingSpec,
    load_capabilities,
)

__all__ = [
    "CapabilityRegistry",
    "CapabilitySpec",
    "CapabilityResult",
    "DSLError",
    "FindingSpec",
    "StepSpec",
    "compile_finding",
    "eval_finding",
    "execute_capability",
    "load_capabilities",
]
