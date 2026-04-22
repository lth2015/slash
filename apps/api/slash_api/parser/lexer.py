"""Strict lexer per docs/02-command-reference.md §2.1.

Contract:
- Only a single space separates tokens. Double space → InvalidToken.
- Forbidden characters: | & ; $( ` > < newline tab. They produce InvalidToken.
- Quoted strings use double quotes with only \\\" as an escape. No variable
  expansion. No backticks. No heredoc.
- Identifiers must start with a letter or underscore.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from slash_api.parser.errors import ParseError


class TokenKind(str, Enum):
    SLASH = "SLASH"            # the leading "/"
    WORD = "WORD"              # identifier / number / duration / ref
    STRING = "STRING"          # quoted string (cooked value)
    FLAG = "FLAG"              # --name or --name=value (value split later)


@dataclass(frozen=True)
class Token:
    kind: TokenKind
    value: str
    offset: int
    length: int


FORBIDDEN = set("|&;`><\n\t")
_LETTER = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
_DIGIT = set("0123456789")
_ID_TAIL = _LETTER | _DIGIT | set("-_./=")  # '=' allows key=value as a single token (kubectl-style)
_FLAG_NAME = set("abcdefghijklmnopqrstuvwxyz") | _DIGIT | {"-"}


def tokenize(text: str) -> list[Token]:
    """Return the token stream or raise ParseError with a precise offset."""
    if not text:
        raise ParseError("InvalidToken", "command is empty", offset=0, length=0)
    if text[0] != "/":
        raise ParseError(
            "InvalidToken",
            "command must start with '/'",
            offset=0,
            length=1,
        )

    tokens: list[Token] = [Token(TokenKind.SLASH, "/", 0, 1)]
    i = 1
    n = len(text)
    # After the leading slash we expect immediately a word (namespace).
    # Disallow whitespace before namespace.
    if i < n and text[i] == " ":
        raise ParseError(
            "InvalidToken",
            "no space allowed between '/' and namespace",
            offset=i,
            length=1,
        )

    while i < n:
        ch = text[i]

        if ch == " ":
            # Exactly one space between tokens. Double-space and trailing-space are errors.
            if i + 1 >= n:
                raise ParseError(
                    "InvalidToken",
                    "trailing space",
                    offset=i,
                    length=1,
                )
            if text[i + 1] == " ":
                raise ParseError(
                    "InvalidToken",
                    "only a single space is allowed between tokens",
                    offset=i,
                    length=2,
                )
            i += 1
            continue

        if ch in FORBIDDEN:
            raise ParseError(
                "InvalidToken",
                f"forbidden character {ch!r}",
                offset=i,
                length=1,
            )

        if ch == "$" and i + 1 < n and text[i + 1] == "(":
            raise ParseError(
                "InvalidToken",
                "command substitution '$(...)' is not allowed",
                offset=i,
                length=2,
            )

        if ch == '"':
            tok, advance = _read_string(text, i)
            tokens.append(tok)
            i += advance
            continue

        if ch == "-" and i + 1 < n and text[i + 1] == "-":
            tok, advance = _read_flag(text, i)
            tokens.append(tok)
            i += advance
            continue

        if ch == "-" and i + 1 < n and text[i + 1] != "-":
            # Single dash is not a valid flag in Slash.
            raise ParseError(
                "InvalidToken",
                "short flags are not supported; use --long-name",
                offset=i,
                length=2,
            )

        # WORD: identifier / number / duration / ref starting here.
        tok, advance = _read_word(text, i)
        tokens.append(tok)
        i += advance

    return tokens


# --- helpers ---------------------------------------------------------------


def _read_string(text: str, start: int) -> tuple[Token, int]:
    assert text[start] == '"'
    i = start + 1
    n = len(text)
    buf: list[str] = []
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n and text[i + 1] == '"':
            buf.append('"')
            i += 2
            continue
        if ch == "\\":
            # any other backslash is forbidden inside a quoted string
            raise ParseError(
                "InvalidToken",
                'only \\" is a valid escape inside a quoted string',
                offset=i,
                length=2,
            )
        if ch == '"':
            return Token(TokenKind.STRING, "".join(buf), start, i - start + 1), i - start + 1
        if ch in FORBIDDEN:
            raise ParseError(
                "InvalidToken",
                f"forbidden character {ch!r} inside quoted string",
                offset=i,
                length=1,
            )
        buf.append(ch)
        i += 1
    raise ParseError(
        "InvalidToken",
        "unterminated quoted string",
        offset=start,
        length=n - start,
    )


def _read_flag(text: str, start: int) -> tuple[Token, int]:
    assert text[start : start + 2] == "--"
    i = start + 2
    n = len(text)
    name_start = i
    while i < n and text[i] in _FLAG_NAME:
        i += 1
    if i == name_start:
        raise ParseError(
            "InvalidToken",
            "empty flag name after '--'",
            offset=start,
            length=2,
        )
    name = text[name_start:i]
    # If followed by '=', the value is attached; we return the flag token and
    # the parser will read the next word. But attached '=value' form is explicitly
    # supported: we absorb it into a single FLAG token with an '=' marker.
    if i < n and text[i] == "=":
        # Walk to the end of the attached value. Respect quoting.
        j = i + 1
        if j < n and text[j] == '"':
            val_tok, length = _read_string(text, j)
            j += length
            value = val_tok.value
            return Token(TokenKind.FLAG, f"{name}=\x00{value}", start, j - start), j - start
        # Otherwise read a word.
        val_start = j
        while j < n and text[j] != " ":
            if text[j] in FORBIDDEN:
                raise ParseError(
                    "InvalidToken",
                    f"forbidden character {text[j]!r} in flag value",
                    offset=j,
                    length=1,
                )
            j += 1
        if j == val_start:
            raise ParseError(
                "InvalidToken",
                f"empty value after '--{name}='",
                offset=val_start,
                length=0,
            )
        value = text[val_start:j]
        return Token(TokenKind.FLAG, f"{name}=\x00{value}", start, j - start), j - start
    # Plain flag; its value (if any) is the following word.
    return Token(TokenKind.FLAG, name, start, i - start), i - start


def _read_word(text: str, start: int) -> tuple[Token, int]:
    n = len(text)
    i = start
    ch = text[i]
    # @ref
    if ch == "@":
        return _read_ref(text, start)
    # identifier (letter/_ then tails) OR number/duration (digits then optional unit)
    if ch in _LETTER or ch == "_":
        i += 1
        while i < n and text[i] in _ID_TAIL:
            i += 1
        word = text[start:i]
        return Token(TokenKind.WORD, word, start, i - start), i - start
    if ch in _DIGIT:
        while i < n and text[i] in _DIGIT:
            i += 1
        # optional duration unit s/m/h/d
        if i < n and text[i] in "smhd":
            i += 1
            # must be followed by space or EOF (i.e. a complete token)
            if i < n and text[i] != " ":
                raise ParseError(
                    "InvalidToken",
                    "unexpected character after duration unit",
                    offset=i,
                    length=1,
                )
        word = text[start:i]
        return Token(TokenKind.WORD, word, start, i - start), i - start
    raise ParseError(
        "InvalidToken",
        f"unexpected character {ch!r}",
        offset=start,
        length=1,
    )


def _read_ref(text: str, start: int) -> tuple[Token, int]:
    assert text[start] == "@"
    n = len(text)
    i = start + 1
    # @<identifier>/<identifier>
    ns_start = i
    if i >= n or text[i] not in _LETTER and text[i] != "_":
        raise ParseError(
            "InvalidToken",
            "@ref must be of the form @namespace/name",
            offset=start,
            length=1,
        )
    while i < n and text[i] in _ID_TAIL and text[i] != "/":
        i += 1
    if i >= n or text[i] != "/":
        raise ParseError(
            "InvalidToken",
            "@ref must contain '/' separating namespace and name",
            offset=start,
            length=i - start,
        )
    i += 1
    name_start = i
    if i >= n:
        raise ParseError(
            "InvalidToken",
            "@ref missing name after '/'",
            offset=start,
            length=i - start,
        )
    while i < n and text[i] in _ID_TAIL and text[i] != "/":
        i += 1
    if name_start == i:
        raise ParseError(
            "InvalidToken",
            "@ref name is empty",
            offset=start,
            length=i - start,
        )
    _ = ns_start  # retained for readability
    return Token(TokenKind.WORD, text[start:i], start, i - start), i - start
