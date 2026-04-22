"""Skill harness runner.

Auto-discovers `skills/**/tests/cases.yaml` and runs each case as a pytest
parameter. Each case pins a canonical slash input + mock fixture + expected
outcome. The runner drives the subprocess mock layer (see runtime/executor.py
`SLASH_MOCK_STDOUT_PATH` / `SLASH_MOCK_EXIT` / `SLASH_MOCK_STDERR`) so no
cloud / cluster is hit.

cases.yaml schema
  cases:
    - name: "happy path"
      input: "/infra aws vm list --region us-east-1"
      mock:                              # optional (skip for builtins)
        stdout: "aws-ec2-happy.json"     # path relative to tests/fixtures/
        exit: 0
        stderr: ""
      expect:
        state: "ok"                      # ok | error | awaiting_approval
        error_code: "ExecutionError"     # only meaningful for state=error
        outputs_len: 2                   # when outputs is a list
        outputs_row0:                    # dotted paths into outputs[0]
          InstanceId: "i-0a1b2c3d"
        danger: true                     # body.danger (write/danger skills)
        profile_name: "harness"          # body.profile_name (write skills)
        has_before: true                 # body.before is not None (plan.argv)
        has_after: true                  # body.after is not None
        has_rollback_command: true       # body.rollback_command truthy
        body_equals:                     # generic: compare top-level fields
          skill_id: "cluster.scale"
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = REPO_ROOT / "skills"

# Before importing slash_api.* modules, pin a deterministic default profile so
# preflight ("No AWS profile selected…") doesn't short-circuit read skills.
os.environ.setdefault("SLASH_DEFAULT_AWS_PROFILE", "harness")
os.environ.setdefault("SLASH_DEFAULT_GCP_CONFIG", "harness")
os.environ.setdefault("SLASH_DEFAULT_KUBE_CONTEXT", "harness")


def _collect() -> list[pytest.ParameterSet]:
    out: list[pytest.ParameterSet] = []
    for cases_yaml in sorted(SKILLS_DIR.rglob("tests/cases.yaml")):
        doc = yaml.safe_load(cases_yaml.read_text()) or {}
        skill_dir = cases_yaml.parent.parent
        for case in doc.get("cases", []) or []:
            case_id = f"{skill_dir.relative_to(SKILLS_DIR)}::{case['name']}"
            out.append(pytest.param(skill_dir, case, id=case_id))
    return out


@pytest.fixture(scope="session")
def client() -> TestClient:
    from slash_api.main import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_pins() -> None:
    """Reset session pin state before every harness case.

    Without this, the ctx.unpin test clears k8s/aws/gcp pins and every
    subsequent infra/cluster test fails preflight with MissingContext.
    Pinning back to 'harness' (the same name SLASH_DEFAULT_* seeds at
    import) makes each test self-contained."""
    from slash_api.state import set_selected

    set_selected(
        aws="harness", aws_tier="safe",
        gcp="harness", gcp_tier="safe",
        k8s="harness", k8s_tier="safe",
    )


@pytest.mark.parametrize("skill_dir,case", _collect())
def test_skill_case(
    skill_dir: Path,
    case: dict[str, Any],
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock = case.get("mock") or {}

    if "stdout" in mock:
        fixture = skill_dir / "tests" / "fixtures" / mock["stdout"]
        assert fixture.exists(), f"missing fixture: {fixture}"
        monkeypatch.setenv("SLASH_MOCK_STDOUT_PATH", str(fixture))
    monkeypatch.setenv("SLASH_MOCK_EXIT", str(mock.get("exit", 0)))
    if "stderr" in mock:
        monkeypatch.setenv("SLASH_MOCK_STDERR", str(mock["stderr"]))

    r = client.post("/execute", json={"text": case["input"]})
    assert r.status_code in (200, 400), r.text
    body = r.json()

    expect = case.get("expect") or {}

    if "state" in expect:
        got_state = body.get("state") if r.status_code == 200 else body.get("detail", {}).get("code", "parse_error")
        assert got_state == expect["state"], f"state mismatch: want {expect['state']!r}, got {got_state!r}; body={body}"

    if "error_code" in expect and expect["error_code"] is not None:
        assert body.get("error_code") == expect["error_code"], body

    if "outputs_len" in expect and expect["outputs_len"] >= 0:
        outputs = body.get("outputs")
        if isinstance(outputs, list):
            assert len(outputs) == expect["outputs_len"], f"row count: want {expect['outputs_len']}, got {len(outputs)}"
        else:
            pytest.fail(f"outputs is not a list for a case with outputs_len: got {type(outputs).__name__}")

    if "outputs_row0" in expect:
        outputs = body.get("outputs")
        assert isinstance(outputs, list) and outputs, "need non-empty list outputs"
        row0 = outputs[0]
        for dotted, want in expect["outputs_row0"].items():
            got = _resolve(row0, dotted)
            assert got == want, f"row0.{dotted}: want {want!r}, got {got!r}"

    if "danger" in expect:
        assert body.get("danger") == expect["danger"], f"danger: want {expect['danger']}, got {body.get('danger')}"

    if "profile_name" in expect:
        assert body.get("profile_name") == expect["profile_name"], \
            f"profile_name: want {expect['profile_name']!r}, got {body.get('profile_name')!r}"

    if "has_before" in expect:
        has = body.get("before") is not None
        assert has == expect["has_before"], f"has_before: want {expect['has_before']}, got {has}"

    if "has_after" in expect:
        has = body.get("after") is not None
        assert has == expect["has_after"], f"has_after: want {expect['has_after']}, got {has}"

    if "has_rollback_command" in expect:
        has = bool(body.get("rollback_command"))
        assert has == expect["has_rollback_command"], \
            f"has_rollback_command: want {expect['has_rollback_command']}, got {has}"

    if "body_equals" in expect:
        for key, want in expect["body_equals"].items():
            assert body.get(key) == want, f"body.{key}: want {want!r}, got {body.get(key)!r}"


def _resolve(row: Any, dotted: str) -> Any:
    cur: Any = row
    for seg in dotted.split("."):
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(seg)
            continue
        if isinstance(cur, list) and all(isinstance(x, dict) and "Key" in x and "Value" in x for x in cur):
            match = next((x["Value"] for x in cur if x.get("Key") == seg), None)
            cur = match
            continue
        return None
    return cur
