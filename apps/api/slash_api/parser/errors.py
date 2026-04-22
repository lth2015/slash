"""Structured parser errors. See docs/02-command-reference.md §5.1."""

from __future__ import annotations

from dataclasses import dataclass

ERROR_CODES = {
    "InvalidToken",
    "UnknownCommand",
    "UnknownFlag",
    "Validation",
    "UnknownNamespace",
    "MissingTarget",
    "MissingVerb",
    "DuplicateFlag",
}


@dataclass
class ParseError(Exception):
    """Structured parse error.

    Attributes:
        code: one of ERROR_CODES.
        message: human-readable, never echoes user input verbatim for sensitive bits.
        offset: column (0-based) in the original input where the problem starts; -1 if unknown.
        length: span length in characters; 0 when pointing to a gap.
        suggestions: up to 3 candidate tokens when code == "UnknownCommand" / "UnknownFlag".
    """

    code: str
    message: str
    offset: int = -1
    length: int = 0
    suggestions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.code not in ERROR_CODES:
            raise AssertionError(f"unknown ParseError code: {self.code}")

    def __str__(self) -> str:  # pragma: no cover
        return f"ParseError.{self.code}: {self.message}"

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "message": self.message,
            "offset": self.offset,
            "length": self.length,
            "suggestions": list(self.suggestions),
        }
