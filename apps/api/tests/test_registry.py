"""Registry loader tests. See docs/04-skills-system.md."""

from __future__ import annotations

from pathlib import Path

import pytest

from slash_api.parser.parser import parse
from slash_api.registry.loader import RegistryError, load_registry

# Absolute path to repo root → skills/
REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = REPO_ROOT / "skills"


def test_loads_example_manifest() -> None:
    reg = load_registry(SKILLS_DIR)
    ids = [s.id for s in reg.all_skills()]
    assert "infra.aws.vm.list" in ids


def test_example_manifest_parses_through_registry() -> None:
    reg = load_registry(SKILLS_DIR)
    ast = parse("/infra aws vm list --region us-east-1", reg.lookup)
    assert ast.skill_id == "infra.aws.vm.list"
    assert ast.flags["region"] == "us-east-1"


def test_duplicate_command_rejected(tmp_path: Path) -> None:
    # create two skills at the same command path
    def make(path: Path, skill_id: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            """
apiVersion: slash/v1
kind: Skill
metadata:
  id: %s
  name: t
  version: 0.0.1
spec:
  command: {namespace: infra, target: aws, noun: [vm], verb: list}
  mode: read
  args:
    - {name: region, flag: --region, type: string}
  bash:
    argv: [echo, placeholder]
""".lstrip()
            % skill_id,
            encoding="utf-8",
        )

    a = tmp_path / "a/skill.yaml"
    b = tmp_path / "b/skill.yaml"
    make(a, "first")
    make(b, "second")
    with pytest.raises(RegistryError) as exc:
        load_registry(tmp_path)
    assert "duplicate command" in str(exc.value)


def test_rejects_string_noun(tmp_path: Path) -> None:
    path = tmp_path / "a/skill.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(
        """
apiVersion: slash/v1
kind: Skill
metadata:
  id: bad.one
  name: t
  version: 0.0.1
spec:
  command: {namespace: infra, target: aws, noun: vm, verb: list}
  mode: read
""".lstrip(),
        encoding="utf-8",
    )
    with pytest.raises(RegistryError):
        load_registry(tmp_path)
