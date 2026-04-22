"""Golden lexer tests. See docs/02-command-reference.md §2.1."""

from __future__ import annotations

import pytest

from slash_api.parser.errors import ParseError
from slash_api.parser.lexer import TokenKind, tokenize

# --- legal token streams ---------------------------------------------------

LEGAL_CASES = [
    "/infra aws vm list",
    "/infra aws vm list --region us-east-1",
    "/infra aws vm list --region us-east-1 --tag env=prod",
    "/infra aws vm snapshot create i-abc --name snap-1",
    "/cluster kind-sre list pod --ns api",
    "/cluster prod scale web --replicas 10 --ns api",
    '/cluster prod scale web --replicas 10 --ns api --reason "launch day"',
    "/app list",
    "/app get checkout",
    "/app pipeline run deploy-1234",
    '/app config update checkout --env staging --file "./cfg.yaml"',
    "/ops audit logs --since 1d",
    "/ops alert ack a-42 --reason \"on it\"",
    "/ops report generate daily",
    "/app secret bind checkout --env prod --key DB_PW --ref @secret/db-pw",
    "/infra gcp cost summary --window 30d --group-by service",
    "/infra aws vm stop i-abc",
    "/cluster c rollout restart web --ns api --reason \"flush pool\"",
    "/cluster c port-forward web --local 3000 --remote 8080 --ns api",
    "/cluster c exec web --command \"ls /tmp\" --ns api",
]


@pytest.mark.parametrize("src", LEGAL_CASES)
def test_legal_commands_tokenize(src: str) -> None:
    toks = tokenize(src)
    assert toks, "must produce tokens"
    assert toks[0].kind is TokenKind.SLASH
    # Sanity: every token has a positive length and in-bounds offset.
    for t in toks:
        assert t.length > 0
        assert 0 <= t.offset < len(src)


# --- illegal inputs --------------------------------------------------------

ILLEGAL_CASES: list[tuple[str, str]] = [
    ("", "InvalidToken"),
    ("infra aws vm list", "InvalidToken"),                           # no leading /
    ("/ infra aws vm list", "InvalidToken"),                         # space after /
    ("/infra  aws vm list", "InvalidToken"),                         # double space
    ("/infra aws vm list ", "InvalidToken"),                         # trailing space
    ("/infra aws vm list;rm", "InvalidToken"),                        # forbidden ;
    ("/infra aws vm list | grep x", "InvalidToken"),                  # forbidden |
    ("/infra aws vm list & echo", "InvalidToken"),                   # forbidden &
    ("/infra aws vm list `x`", "InvalidToken"),                       # forbidden backtick
    ("/infra aws vm list $(x)", "InvalidToken"),                      # command substitution
    ("/cluster c exec web -- ls /tmp", "InvalidToken"),                # '--' bare separator not allowed
    ("/cluster c port-forward web 3000:8080", "InvalidToken"),        # colon in word
    ("/infra aws vm list --region=\"", "InvalidToken"),                # unterminated string
    ("/infra aws vm list --region=\"us\\x\"", "InvalidToken"),         # bad escape
    ("/infra aws vm list -region us", "InvalidToken"),                 # short flag
    ("/infra aws vm list --", "InvalidToken"),                         # empty flag name
    ("/infra aws vm list\n", "InvalidToken"),                          # newline
    ("/infra aws vm list\t", "InvalidToken"),                          # tab
    ("/infra aws vm list @secret", "InvalidToken"),                    # ref missing /name
    ("/infra aws vm list @secret/", "InvalidToken"),                   # ref empty name
]


@pytest.mark.parametrize("src,code", ILLEGAL_CASES)
def test_illegal_commands_rejected(src: str, code: str) -> None:
    with pytest.raises(ParseError) as exc:
        tokenize(src)
    assert exc.value.code == code, f"expected {code}, got {exc.value.code}: {exc.value.message}"
    assert exc.value.offset >= 0


# --- token-level specifics -------------------------------------------------


def test_quoted_string_preserves_spaces_and_escapes_quote() -> None:
    # Non-attached form: --reason becomes a FLAG token, the quoted value follows as STRING.
    toks = tokenize('/ops alert ack a-1 --reason "hello \\"world\\""')
    assert toks[-2].kind is TokenKind.FLAG
    assert toks[-2].value == "reason"
    assert toks[-1].kind is TokenKind.STRING
    assert toks[-1].value == 'hello "world"'

    # Attached form: value is folded into the FLAG token.
    toks2 = tokenize('/ops alert ack a-1 --reason="hello world"')
    assert toks2[-1].kind is TokenKind.FLAG
    assert toks2[-1].value == "reason=\x00hello world"


def test_attached_flag_value_form() -> None:
    toks = tokenize("/infra aws vm list --region=us-east-1")
    assert toks[-1].kind is TokenKind.FLAG
    assert toks[-1].value == "region=\x00us-east-1"


def test_duration_token_requires_unit_then_space() -> None:
    toks = tokenize("/ops audit logs --since 7d")
    assert toks[-1].value == "7d"


def test_ref_token_roundtrips() -> None:
    toks = tokenize("/app secret bind checkout --env prod --key K --ref @secret/db-pw")
    word_values = [t.value for t in toks if t.kind is TokenKind.WORD]
    assert "@secret/db-pw" in word_values
