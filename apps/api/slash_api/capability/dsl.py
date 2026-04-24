"""Narrow findings DSL — see docs/09-capabilities.md §4.

Grammar (informal):

    expr    := or_expr
    or_expr := and_expr ('||' and_expr)*
    and_expr:= not_expr ('&&' not_expr)*
    not_expr:= '!' not_expr | cmp_or_call
    cmp_or_call := primary (OP literal)?
    primary := call | path | '(' expr ')' | literal
    call    := ('any' | 'count' | 'first') '(' expr ')'
    path    := 'row' ('.' IDENT | '[' NUMBER ']')*
    OP      := '==' | '!=' | '<' | '<=' | '>' | '>='
    literal := STRING | NUMBER | 'true' | 'false' | 'null'

Deliberately not Turing complete. No arithmetic, no functions beyond the
three aggregates, no assignments. Parsed once at load time; evaluated
against a list-of-rows input per finding rule.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Union


class DSLError(ValueError):
    """Raised for any static (parse) or dynamic (eval) DSL failure."""


# ── AST ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Literal:
    value: Any  # str, int, float, bool, None


@dataclass(frozen=True)
class Path:
    parts: tuple[Union[str, int], ...]  # first element is always "row"


@dataclass(frozen=True)
class Call:
    func: str  # "any" | "count" | "first"
    body: "Expr"


@dataclass(frozen=True)
class Cmp:
    left: "Expr"
    op: str  # == != < <= > >=
    right: "Expr"


@dataclass(frozen=True)
class And:
    left: "Expr"
    right: "Expr"


@dataclass(frozen=True)
class Or:
    left: "Expr"
    right: "Expr"


@dataclass(frozen=True)
class Not:
    operand: "Expr"


Expr = Union[Literal, Path, Call, Cmp, And, Or, Not]


# ── Tokenizer ──────────────────────────────────────────────────────────

_TOK_RE = re.compile(
    r"""
    \s*(?:
        (?P<NUMBER>-?\d+(?:\.\d+)?)
      | (?P<STRING>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
      | (?P<OP>==|!=|<=|>=|<|>)
      | (?P<AND>&&)
      | (?P<OR>\|\|)
      | (?P<NOT>!)
      | (?P<LP>\()
      | (?P<RP>\))
      | (?P<LB>\[)
      | (?P<RB>\])
      | (?P<DOT>\.)
      | (?P<COMMA>,)
      | (?P<IDENT>[A-Za-z_][A-Za-z0-9_]*)
    )
    """,
    re.VERBOSE,
)


@dataclass
class _Token:
    kind: str
    value: str
    pos: int


def _tokenize(src: str) -> list[_Token]:
    tokens: list[_Token] = []
    i = 0
    while i < len(src):
        m = _TOK_RE.match(src, i)
        if not m:
            remainder = src[i:].lstrip()
            if not remainder:
                break
            raise DSLError(f"unexpected character at offset {i}: {remainder[:10]!r}")
        if m.end() == i:  # only whitespace matched
            break
        kind = m.lastgroup
        if kind is None:
            raise DSLError(f"tokenizer stalled at offset {i}")
        tokens.append(_Token(kind, m.group(kind), m.start(kind)))
        i = m.end()
    return tokens


# ── Parser (recursive descent) ─────────────────────────────────────────

_CALL_NAMES = ("any", "count", "first")
_KEYWORDS = {"true": True, "false": False, "null": None}


class _Parser:
    def __init__(self, tokens: list[_Token]) -> None:
        self.tokens = tokens
        self.pos = 0

    def peek(self) -> _Token | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def eat(self, kind: str, value: str | None = None) -> _Token:
        t = self.peek()
        if t is None:
            raise DSLError(f"expected {kind} but input ended")
        if t.kind != kind or (value is not None and t.value != value):
            raise DSLError(
                f"expected {kind}{f'={value!r}' if value else ''}, got {t.kind}={t.value!r} at pos {t.pos}"
            )
        self.pos += 1
        return t

    def parse(self) -> Expr:
        expr = self.parse_or()
        if self.peek() is not None:
            t = self.peek()
            assert t is not None
            raise DSLError(f"unexpected trailing token {t.kind}={t.value!r} at pos {t.pos}")
        return expr

    def parse_or(self) -> Expr:
        left = self.parse_and()
        while self._accept("OR"):
            right = self.parse_and()
            left = Or(left, right)
        return left

    def parse_and(self) -> Expr:
        left = self.parse_not()
        while self._accept("AND"):
            right = self.parse_not()
            left = And(left, right)
        return left

    def parse_not(self) -> Expr:
        if self._accept("NOT"):
            operand = self.parse_not()
            return Not(operand)
        return self.parse_cmp()

    def parse_cmp(self) -> Expr:
        left = self.parse_primary()
        tok = self.peek()
        if tok is not None and tok.kind == "OP":
            self.pos += 1
            right = self.parse_primary()
            return Cmp(left, tok.value, right)
        return left

    def parse_primary(self) -> Expr:
        tok = self.peek()
        if tok is None:
            raise DSLError("expected expression, got end of input")
        if tok.kind == "LP":
            self.pos += 1
            inner = self.parse_or()
            self.eat("RP")
            return inner
        if tok.kind == "IDENT" and tok.value in _CALL_NAMES:
            self.pos += 1
            self.eat("LP")
            body = self.parse_or()
            self.eat("RP")
            return Call(tok.value, body)
        if tok.kind == "IDENT" and tok.value == "row":
            return self._parse_path()
        if tok.kind == "IDENT" and tok.value in _KEYWORDS:
            self.pos += 1
            return Literal(_KEYWORDS[tok.value])
        if tok.kind == "NUMBER":
            self.pos += 1
            v: Any = float(tok.value) if "." in tok.value else int(tok.value)
            return Literal(v)
        if tok.kind == "STRING":
            self.pos += 1
            return Literal(_unquote(tok.value))
        raise DSLError(f"unexpected token {tok.kind}={tok.value!r} at pos {tok.pos}")

    def _parse_path(self) -> Path:
        self.eat("IDENT", "row")
        parts: list[str | int] = ["row"]
        while True:
            tok = self.peek()
            if tok is None:
                break
            if tok.kind == "DOT":
                self.pos += 1
                name = self.eat("IDENT").value
                if name in _CALL_NAMES or name in _KEYWORDS:
                    raise DSLError(f"'{name}' is reserved, can't use as path segment")
                parts.append(name)
                continue
            if tok.kind == "LB":
                self.pos += 1
                idx_tok = self.eat("NUMBER")
                self.eat("RB")
                parts.append(int(idx_tok.value))
                continue
            break
        return Path(tuple(parts))

    def _accept(self, kind: str) -> bool:
        tok = self.peek()
        if tok is not None and tok.kind == kind:
            self.pos += 1
            return True
        return False


def _unquote(s: str) -> str:
    # s is either "..." or '...'
    body = s[1:-1]
    return body.encode("utf-8").decode("unicode_escape") if "\\" in body else body


def compile_finding(expr_src: str) -> Expr:
    """Parse a findings expression once at load time.

    Raises DSLError with a message pointing at the offending span.
    """
    tokens = _tokenize(expr_src.strip())
    return _Parser(tokens).parse()


# ── Evaluator ──────────────────────────────────────────────────────────

def eval_finding(expr: Expr, rows: list[dict]) -> dict[str, Any]:
    """Evaluate a compiled expression against a step's output rows.

    Returns a structured result:
      {
        "truthy": bool,      # does the finding match?
        "count":  int,       # number of rows matching the inner predicate
                             # (for aggregate calls — any/count/first)
        "first":  dict|None, # first matching row, for ${first.path} interp
      }
    The top-level expression's value drives `truthy`. `count` and `first`
    default to reasonable values for non-aggregate top-level expressions.
    """
    # Top-level may be a raw aggregate call (any/count/first) or a comparison
    # over one of those. We detect the aggregate body if present to also
    # expose `count` and `first` in the result.
    agg_call = _find_outer_call(expr)
    if agg_call is None:
        value = _eval_on_rows(expr, rows)
        return {"truthy": bool(value), "count": int(bool(value)), "first": None}

    matched_rows: list[dict] = [r for r in rows if _eval_single(agg_call.body, r)]
    if agg_call.func == "any":
        agg_value: Any = len(matched_rows) > 0
    elif agg_call.func == "count":
        agg_value = len(matched_rows)
    else:  # first
        agg_value = matched_rows[0] if matched_rows else None

    top_value = _eval_with_call_bound(expr, agg_call, agg_value, rows)
    return {
        "truthy": bool(top_value),
        "count": len(matched_rows),
        "first": matched_rows[0] if matched_rows else None,
    }


def _find_outer_call(expr: Expr) -> Call | None:
    """Return the outermost aggregate call used by the top-level expression,
    if the shape is `any(...)`, `count(...) OP n`, or `!any(...)` etc."""
    if isinstance(expr, Call):
        return expr
    if isinstance(expr, Cmp):
        for side in (expr.left, expr.right):
            if isinstance(side, Call):
                return side
    if isinstance(expr, Not):
        return _find_outer_call(expr.operand)
    return None


def _eval_with_call_bound(
    expr: Expr, call: Call, call_value: Any, rows: list[dict]
) -> Any:
    """Evaluate `expr`, substituting `call` with the precomputed `call_value`."""
    if expr is call:
        return call_value
    if isinstance(expr, Literal):
        return expr.value
    if isinstance(expr, Path):
        # A bare path at top level doesn't really make sense for a findings
        # rule, but support it: resolve against the FIRST row for debugging.
        return _resolve_path(expr, rows[0] if rows else {})
    if isinstance(expr, Call):
        # Nested aggregate call: evaluate fresh against rows.
        return _eval_aggregate(expr, rows)
    if isinstance(expr, Cmp):
        left = _eval_with_call_bound(expr.left, call, call_value, rows)
        right = _eval_with_call_bound(expr.right, call, call_value, rows)
        return _compare(left, expr.op, right)
    if isinstance(expr, And):
        return bool(
            _eval_with_call_bound(expr.left, call, call_value, rows)
        ) and bool(_eval_with_call_bound(expr.right, call, call_value, rows))
    if isinstance(expr, Or):
        return bool(
            _eval_with_call_bound(expr.left, call, call_value, rows)
        ) or bool(_eval_with_call_bound(expr.right, call, call_value, rows))
    if isinstance(expr, Not):
        return not bool(_eval_with_call_bound(expr.operand, call, call_value, rows))
    raise DSLError(f"unhandled node type {type(expr).__name__}")


def _eval_on_rows(expr: Expr, rows: list[dict]) -> Any:
    """Evaluate an expression without a precomputed aggregate — top-level
    path/literal lookups reference the first row for debug purposes."""
    if isinstance(expr, Literal):
        return expr.value
    if isinstance(expr, Path):
        return _resolve_path(expr, rows[0] if rows else {})
    if isinstance(expr, Call):
        return _eval_aggregate(expr, rows)
    if isinstance(expr, Cmp):
        return _compare(
            _eval_on_rows(expr.left, rows),
            expr.op,
            _eval_on_rows(expr.right, rows),
        )
    if isinstance(expr, And):
        return bool(_eval_on_rows(expr.left, rows)) and bool(_eval_on_rows(expr.right, rows))
    if isinstance(expr, Or):
        return bool(_eval_on_rows(expr.left, rows)) or bool(_eval_on_rows(expr.right, rows))
    if isinstance(expr, Not):
        return not bool(_eval_on_rows(expr.operand, rows))
    raise DSLError(f"unhandled node type {type(expr).__name__}")


def _eval_aggregate(call: Call, rows: list[dict]) -> Any:
    matched = [r for r in rows if _eval_single(call.body, r)]
    if call.func == "any":
        return len(matched) > 0
    if call.func == "count":
        return len(matched)
    return matched[0] if matched else None


def _eval_single(expr: Expr, row: Any) -> Any:
    """Evaluate `expr` against a single row context."""
    if isinstance(expr, Literal):
        return expr.value
    if isinstance(expr, Path):
        return _resolve_path(expr, row)
    if isinstance(expr, Call):
        # Nested aggregate inside a predicate body — treat the current row
        # as a list of one (most uses won't need this, but it shouldn't crash).
        return _eval_aggregate(expr, [row])
    if isinstance(expr, Cmp):
        return _compare(
            _eval_single(expr.left, row),
            expr.op,
            _eval_single(expr.right, row),
        )
    if isinstance(expr, And):
        return bool(_eval_single(expr.left, row)) and bool(_eval_single(expr.right, row))
    if isinstance(expr, Or):
        return bool(_eval_single(expr.left, row)) or bool(_eval_single(expr.right, row))
    if isinstance(expr, Not):
        return not bool(_eval_single(expr.operand, row))
    raise DSLError(f"unhandled node type {type(expr).__name__}")


def _resolve_path(path: Path, root: Any) -> Any:
    cur: Any = root
    # path.parts[0] is always "row"
    for seg in path.parts[1:]:
        if cur is None:
            return None
        if isinstance(seg, int):
            if isinstance(cur, list) and 0 <= seg < len(cur):
                cur = cur[seg]
            else:
                return None
            continue
        if isinstance(cur, dict):
            cur = cur.get(seg)
        else:
            return None
    return cur


def _compare(left: Any, op: str, right: Any) -> bool:
    # Coerce for numeric-vs-numeric-string friendliness; otherwise strict.
    try:
        if op == "==":
            return left == right
        if op == "!=":
            return left != right
        if op == "<":
            return _lt(left, right)
        if op == "<=":
            return _le(left, right)
        if op == ">":
            return _lt(right, left)
        if op == ">=":
            return _le(right, left)
    except TypeError:
        return False
    raise DSLError(f"unknown comparison op {op!r}")


def _lt(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return False
    return a < b


def _le(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return False
    return a <= b
