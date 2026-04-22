"""Registry-driven parser. See docs/02-command-reference.md §2.2."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from slash_api.parser.errors import ParseError
from slash_api.parser.lexer import Token, TokenKind, tokenize

NAMESPACES = ("infra", "cluster", "app", "ops")
TARGETED_NS = {"infra", "cluster"}  # these require <target> after the namespace
_TARGETED_NS = TARGETED_NS  # legacy alias
_PROVIDERS_FOR_INFRA = ("aws", "gcp")  # used purely to give nicer UnknownCommand hints


@dataclass(frozen=True)
class ArgSpec:
    name: str
    flag: str | None
    type: str
    required: bool = False
    default: Any = None
    positional: bool = False
    repeatable: bool = False
    enum: tuple[str, ...] | None = None


@dataclass(frozen=True)
class SkillSpec:
    """Minimal view of a skill manifest needed by the parser."""

    id: str
    namespace: str
    target: str | None
    noun: tuple[str, ...]
    verb: str
    mode: str  # "read" | "write"
    args: tuple[ArgSpec, ...]
    danger: bool = False
    manifest_path: str | None = None   # absolute path to skill.yaml, set by loader

    @property
    def command_path(self) -> tuple[str, ...]:
        """The chain of words that identify this command after namespace+target."""
        return (*self.noun, self.verb)


@dataclass
class CommandAST:
    raw: str
    namespace: str
    target: str | None
    skill_id: str
    noun: list[str]
    verb: str
    positional: list[Any] = field(default_factory=list)
    flags: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "namespace": self.namespace,
            "target": self.target,
            "skill_id": self.skill_id,
            "noun": self.noun,
            "verb": self.verb,
            "positional": self.positional,
            "flags": self.flags,
        }


# A registry lookup returns all skills under a (namespace, target) key.
# target is None for /app and /ops.
RegistryLookup = Callable[[str, str | None], list[SkillSpec]]


def parse(text: str, registry: RegistryLookup) -> CommandAST:
    """Parse `text` into a CommandAST using the registry for shape resolution.

    Raises ParseError on any issue.
    """
    tokens = tokenize(text)
    pos = 0

    # 1. leading slash
    if pos >= len(tokens) or tokens[pos].kind != TokenKind.SLASH:
        raise ParseError("InvalidToken", "command must start with '/'", offset=0, length=1)
    pos += 1

    # 2. namespace
    if pos >= len(tokens):
        raise ParseError(
            "UnknownNamespace",
            "missing namespace",
            offset=1,
            length=0,
            suggestions=NAMESPACES,
        )
    ns_tok = tokens[pos]
    if ns_tok.kind is not TokenKind.WORD or ns_tok.value not in NAMESPACES:
        raise ParseError(
            "UnknownNamespace",
            f"unknown namespace {ns_tok.value!r}",
            offset=ns_tok.offset,
            length=ns_tok.length,
            suggestions=_best_matches(ns_tok.value, NAMESPACES),
        )
    namespace = ns_tok.value
    pos += 1

    # 3. target (only for /infra and /cluster)
    target: str | None = None
    if namespace in _TARGETED_NS:
        if pos >= len(tokens) or tokens[pos].kind is not TokenKind.WORD:
            raise ParseError(
                "MissingTarget",
                f"/{namespace} requires a target "
                f"({'provider' if namespace == 'infra' else 'cluster context'}) after the namespace",
                offset=ns_tok.offset + ns_tok.length,
                length=0,
                suggestions=_PROVIDERS_FOR_INFRA if namespace == "infra" else (),
            )
        target = tokens[pos].value
        pos += 1

    # 4. resolve Skill by greedy longest-prefix match over remaining WORD tokens.
    candidates = registry(namespace, target)
    if not candidates:
        raise ParseError(
            "UnknownCommand",
            f"no skills registered under /{namespace}"
            + (f" {target}" if target else ""),
            offset=tokens[pos].offset if pos < len(tokens) else len(text),
            length=0,
        )

    remaining_words: list[Token] = []
    scan = pos
    while scan < len(tokens) and tokens[scan].kind is TokenKind.WORD:
        remaining_words.append(tokens[scan])
        scan += 1

    skill = _longest_match(candidates, [t.value for t in remaining_words])
    if skill is None:
        offset = remaining_words[0].offset if remaining_words else (
            tokens[pos - 1].offset + tokens[pos - 1].length
        )
        path_words = [t.value for t in remaining_words]
        all_commands = [" ".join(s.command_path) for s in candidates]
        raise ParseError(
            "UnknownCommand",
            "no skill matches "
            + (" ".join(path_words) if path_words else "(empty)"),
            offset=offset,
            length=sum(t.length + 1 for t in remaining_words) - 1 if remaining_words else 0,
            suggestions=tuple(_best_matches(" ".join(path_words), all_commands, limit=3)),
        )

    # advance pos past the noun_chain + verb
    consumed = len(skill.noun) + 1
    pos += consumed

    # 5. bind remaining tokens to args.
    positional, flags = _bind_args(skill, tokens, pos, text)

    return CommandAST(
        raw=text,
        namespace=namespace,
        target=target,
        skill_id=skill.id,
        noun=list(skill.noun),
        verb=skill.verb,
        positional=positional,
        flags=flags,
    )


# --- shape / bind helpers --------------------------------------------------


def _longest_match(
    candidates: list[SkillSpec], words: list[str]
) -> SkillSpec | None:
    """Return the skill whose command_path is the longest prefix of `words`."""
    best: SkillSpec | None = None
    best_len = -1
    for s in candidates:
        plen = len(s.command_path)
        if plen <= len(words) and tuple(words[:plen]) == s.command_path and plen > best_len:
            best = s
            best_len = plen
    return best


def _bind_args(
    skill: SkillSpec, tokens: list[Token], start: int, raw: str
) -> tuple[list[Any], dict[str, Any]]:
    positional: list[Any] = []
    flags: dict[str, Any] = {}
    declared_flags = {a.flag: a for a in skill.args if a.flag}
    declared_positional = [a for a in skill.args if a.positional]
    pos_idx = 0

    i = start
    while i < len(tokens):
        tok = tokens[i]
        if tok.kind is TokenKind.FLAG:
            name, value = _split_flag(tok)
            spec = declared_flags.get(f"--{name}")
            if spec is None:
                raise ParseError(
                    "UnknownFlag",
                    f"unknown flag --{name}",
                    offset=tok.offset,
                    length=tok.length,
                    suggestions=_best_matches(
                        f"--{name}", tuple(declared_flags.keys()), limit=3
                    ),
                )
            if value is None:
                # attached value? no. look for next token as value unless next is FLAG
                if i + 1 >= len(tokens) or tokens[i + 1].kind is TokenKind.FLAG:
                    # bool flag semantics: mark True when type == bool, else require value
                    if spec.type == "bool":
                        _set_flag(flags, spec, True, tok, raw)
                        i += 1
                        continue
                    raise ParseError(
                        "Validation",
                        f"flag --{name} requires a value",
                        offset=tok.offset,
                        length=tok.length,
                    )
                val_tok = tokens[i + 1]
                value = _coerce(spec, val_tok)
                i += 2
            else:
                # attached form --name=value
                value = _coerce_raw(spec, value, tok)
                i += 1
            _set_flag(flags, spec, value, tok, raw)
            continue

        if tok.kind is TokenKind.WORD or tok.kind is TokenKind.STRING:
            if pos_idx >= len(declared_positional):
                raise ParseError(
                    "Validation",
                    "too many positional arguments",
                    offset=tok.offset,
                    length=tok.length,
                )
            spec = declared_positional[pos_idx]
            value = _coerce(spec, tok)
            positional.append(value)
            pos_idx += 1
            i += 1
            continue

        raise ParseError(
            "InvalidToken",
            f"unexpected token {tok.value!r}",
            offset=tok.offset,
            length=tok.length,
        )

    # Check required args & apply defaults.
    for spec in skill.args:
        if spec.positional:
            if spec.required and pos_idx <= declared_positional.index(spec):
                raise ParseError(
                    "Validation",
                    f"missing required positional <{spec.name}>",
                    offset=len(raw),
                    length=0,
                )
            continue
        key = spec.name
        if key not in flags:
            if spec.required:
                raise ParseError(
                    "Validation",
                    f"missing required flag {spec.flag}",
                    offset=len(raw),
                    length=0,
                )
            if spec.default is not None:
                flags[key] = spec.default

    return positional, flags


def _split_flag(tok: Token) -> tuple[str, str | None]:
    # FLAG token value is either "name" or "name=\x00value".
    raw = tok.value
    if "=\x00" in raw:
        name, value = raw.split("=\x00", 1)
        return name, value
    return raw, None


def _coerce(spec: ArgSpec, tok: Token) -> Any:
    return _coerce_raw(spec, tok.value, tok)


def _coerce_raw(spec: ArgSpec, raw: str, tok: Token) -> Any:
    t = spec.type
    if t == "string":
        if spec.enum and raw not in spec.enum:
            raise ParseError(
                "Validation",
                f"{spec.name}: {raw!r} not in {list(spec.enum)}",
                offset=tok.offset,
                length=tok.length,
            )
        return raw
    if t == "int":
        if not raw.lstrip("-").isdigit():
            raise ParseError(
                "Validation",
                f"{spec.name}: expected int, got {raw!r}",
                offset=tok.offset,
                length=tok.length,
            )
        return int(raw)
    if t == "bool":
        if raw in ("true", "false"):
            return raw == "true"
        raise ParseError(
            "Validation",
            f"{spec.name}: expected bool (true|false), got {raw!r}",
            offset=tok.offset,
            length=tok.length,
        )
    if t == "duration":
        if not raw or raw[-1] not in "smhd" or not raw[:-1].isdigit():
            raise ParseError(
                "Validation",
                f"{spec.name}: expected duration like 7d, got {raw!r}",
                offset=tok.offset,
                length=tok.length,
            )
        return raw
    if t.startswith("map<"):
        # raw form: k=v; repeated for map.
        if "=" not in raw:
            raise ParseError(
                "Validation",
                f"{spec.name}: expected key=value pair, got {raw!r}",
                offset=tok.offset,
                length=tok.length,
            )
        k, v = raw.split("=", 1)
        return {k: v}
    # Unknown type → treat as opaque string but still return raw.
    return raw


def _set_flag(
    flags: dict[str, Any], spec: ArgSpec, value: Any, tok: Token, raw: str
) -> None:
    if spec.repeatable:
        if spec.type.startswith("map<"):
            existing = flags.setdefault(spec.name, {})
            if not isinstance(existing, dict):
                existing = {}
                flags[spec.name] = existing
            existing.update(value if isinstance(value, dict) else {})
        else:
            flags.setdefault(spec.name, []).append(value)
        return
    if spec.name in flags:
        raise ParseError(
            "DuplicateFlag",
            f"flag {spec.flag} specified more than once",
            offset=tok.offset,
            length=tok.length,
        )
    flags[spec.name] = value
    _ = raw  # reserved for future richer errors


# --- small utilities -------------------------------------------------------


def _best_matches(needle: str, hay: tuple[str, ...] | list[str], limit: int = 3) -> tuple[str, ...]:
    if not needle:
        return tuple(list(hay)[:limit])
    scored = sorted(hay, key=lambda c: _damerau_levenshtein(needle, c))
    return tuple(scored[:limit])


def _damerau_levenshtein(a: str, b: str) -> int:
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    d = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        d[i][0] = i
    for j in range(lb + 1):
        d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost,
            )
            if (
                i > 1
                and j > 1
                and a[i - 1] == b[j - 2]
                and a[i - 2] == b[j - 1]
            ):
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + cost)
    return d[la][lb]
