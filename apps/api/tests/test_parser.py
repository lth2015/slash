"""Golden parser tests. See docs/02-command-reference.md §2.2 & §5.1."""

from __future__ import annotations

import pytest

from slash_api.parser.errors import ParseError
from slash_api.parser.parser import ArgSpec, CommandAST, SkillSpec, parse

# --- hand-crafted registry for tests ---------------------------------------


def _s(
    id: str,
    namespace: str,
    target: str | None,
    noun: tuple[str, ...],
    verb: str,
    args: tuple[ArgSpec, ...] = (),
    mode: str = "read",
) -> SkillSpec:
    return SkillSpec(
        id=id, namespace=namespace, target=target, noun=noun, verb=verb, mode=mode, args=args
    )


SKILLS: list[SkillSpec] = [
    _s(
        "infra.aws.vm.list",
        "infra",
        "aws",
        ("vm",),
        "list",
        (
            ArgSpec("region", "--region", "string", default="us-east-1"),
            ArgSpec("tag", "--tag", "map<string,string>", repeatable=True),
        ),
    ),
    _s(
        "infra.aws.vm.snapshot.create",
        "infra",
        "aws",
        ("vm", "snapshot"),
        "create",
        (
            ArgSpec("id", None, "string", required=True, positional=True),
            ArgSpec("name", "--name", "string", required=True),
        ),
        mode="write",
    ),
    _s(
        "infra.aws.vm.stop",
        "infra",
        "aws",
        ("vm",),
        "stop",
        (
            ArgSpec("id", None, "string", required=True, positional=True),
            ArgSpec("force", "--force", "bool"),
        ),
        mode="write",
    ),
    _s(
        "cluster.scale",
        "cluster",
        None,  # target is runtime ctx; registry key for /cluster uses None target
        (),
        "scale",
        (
            ArgSpec("deploy", None, "string", required=True, positional=True),
            ArgSpec("replicas", "--replicas", "int", required=True),
            ArgSpec("ns", "--ns", "string", required=True),
            ArgSpec("reason", "--reason", "string", required=True),
        ),
        mode="write",
    ),
    _s(
        "cluster.rollout.restart",
        "cluster",
        None,
        ("rollout",),
        "restart",
        (
            ArgSpec("deploy", None, "string", required=True, positional=True),
            ArgSpec("ns", "--ns", "string", required=True),
        ),
        mode="write",
    ),
    _s(
        "app.list",
        "app",
        None,
        (),
        "list",
        (),
    ),
    _s(
        "app.get",
        "app",
        None,
        (),
        "get",
        (ArgSpec("name", None, "string", required=True, positional=True),),
    ),
    _s(
        "app.config.update",
        "app",
        None,
        ("config",),
        "update",
        (
            ArgSpec("name", None, "string", required=True, positional=True),
            ArgSpec("env", "--env", "string", required=True),
            ArgSpec("file", "--file", "string", required=True),
        ),
        mode="write",
    ),
    _s(
        "ops.audit.logs",
        "ops",
        None,
        ("audit",),
        "logs",
        (
            ArgSpec("since", "--since", "duration"),
            ArgSpec("user", "--user", "string"),
        ),
    ),
    _s(
        "ops.alert.ack",
        "ops",
        None,
        ("alert",),
        "ack",
        (
            ArgSpec("id", None, "string", required=True, positional=True),
            ArgSpec("reason", "--reason", "string", required=True),
        ),
        mode="write",
    ),
]


def registry(namespace: str, target: str | None) -> list[SkillSpec]:
    # For /cluster we accept any concrete ctx as target but store under None.
    if namespace == "cluster":
        return [s for s in SKILLS if s.namespace == "cluster"]
    return [s for s in SKILLS if s.namespace == namespace and s.target == target]


# --- legal (happy) parses --------------------------------------------------


def test_parses_read_with_defaults() -> None:
    ast = parse("/infra aws vm list", registry)
    assert isinstance(ast, CommandAST)
    assert ast.skill_id == "infra.aws.vm.list"
    assert ast.flags["region"] == "us-east-1"


def test_parses_flag_with_value() -> None:
    ast = parse("/infra aws vm list --region us-west-2", registry)
    assert ast.flags["region"] == "us-west-2"


def test_parses_attached_flag() -> None:
    ast = parse("/infra aws vm list --region=us-west-2", registry)
    assert ast.flags["region"] == "us-west-2"


def test_parses_repeatable_map_flag() -> None:
    ast = parse("/infra aws vm list --tag env=prod --tag owner=sre", registry)
    assert ast.flags["tag"] == {"env": "prod", "owner": "sre"}


def test_parses_compound_noun() -> None:
    ast = parse("/infra aws vm snapshot create i-abc --name snap-1", registry)
    assert ast.skill_id == "infra.aws.vm.snapshot.create"
    assert ast.positional == ["i-abc"]
    assert ast.flags["name"] == "snap-1"


def test_parses_cluster_with_ctx_target() -> None:
    ast = parse(
        '/cluster prod scale web --replicas 10 --ns api --reason "launch day"',
        registry,
    )
    assert ast.skill_id == "cluster.scale"
    assert ast.target == "prod"
    assert ast.flags["replicas"] == 10
    assert ast.flags["reason"] == "launch day"


def test_parses_cluster_with_compound_noun() -> None:
    ast = parse("/cluster prod rollout restart web --ns api", registry)
    assert ast.skill_id == "cluster.rollout.restart"
    assert ast.positional == ["web"]


def test_parses_app_no_target() -> None:
    ast = parse("/app list", registry)
    assert ast.skill_id == "app.list"
    assert ast.target is None


def test_parses_app_subnoun() -> None:
    ast = parse('/app config update checkout --env staging --file "./cfg.yaml"', registry)
    assert ast.skill_id == "app.config.update"
    assert ast.flags["file"] == "./cfg.yaml"


def test_parses_ops_duration() -> None:
    ast = parse("/ops audit logs --since 7d", registry)
    assert ast.skill_id == "ops.audit.logs"
    assert ast.flags["since"] == "7d"


def test_parses_quoted_reason() -> None:
    ast = parse('/ops alert ack a-42 --reason "on it"', registry)
    assert ast.flags["reason"] == "on it"


def test_parses_bool_flag() -> None:
    ast = parse("/infra aws vm stop i-abc --force", registry)
    assert ast.flags["force"] is True


# --- illegal parses --------------------------------------------------------


def test_unknown_namespace_suggests() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/infras aws vm list", registry)
    assert exc.value.code == "UnknownNamespace"
    assert "infra" in exc.value.suggestions


def test_missing_target_for_infra() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/infra", registry)
    assert exc.value.code == "MissingTarget"


def test_unknown_command_under_namespace() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/infra aws vms list", registry)
    assert exc.value.code == "UnknownCommand"
    assert exc.value.suggestions  # suggest at least one


def test_unknown_flag() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/infra aws vm list --regions us-east-1", registry)
    assert exc.value.code == "UnknownFlag"


def test_duplicate_flag_rejected() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/infra aws vm list --region a --region b", registry)
    assert exc.value.code == "DuplicateFlag"


def test_int_validation() -> None:
    with pytest.raises(ParseError) as exc:
        parse('/cluster prod scale web --replicas ten --ns api --reason "x"', registry)
    assert exc.value.code == "Validation"


def test_missing_required_positional() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/app get", registry)
    assert exc.value.code == "Validation"


def test_missing_required_flag() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/app get checkout --env prod", registry)
    # "get" skill has no --env declared → UnknownFlag before missing-required check
    assert exc.value.code == "UnknownFlag"


def test_too_many_positionals() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/app get checkout extra", registry)
    assert exc.value.code == "Validation"


def test_forbidden_shell_char() -> None:
    with pytest.raises(ParseError) as exc:
        parse("/infra aws vm list ; rm", registry)
    assert exc.value.code == "InvalidToken"
