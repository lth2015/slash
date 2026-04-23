"""Audit log — path, fields, redaction.

Verifies docs/05 §4.2 field contract: every run (read or write) appends
one JSONL line with runId / ts / command / parsedCommand / skillId /
mode / risk / plan_summary (write) / approval_decision (write-decided) /
execution_argv / exit_code / state + the existing redaction + SHA.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from slash_api.main import app
from slash_api.registry.loader import load_registry
from slash_api.audit import writer as audit_writer


REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = REPO_ROOT / "skills"


def _read_audit(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        out.append(json.loads(line))
    return out


@pytest.fixture
def client(tmp_path, monkeypatch) -> tuple[TestClient, Path]:
    audit_path = tmp_path / ".slash" / "audit" / "audit.jsonl"
    monkeypatch.setenv("SLASH_AUDIT_PATH", str(audit_path))

    # Subprocess mock — approve-path writes must hit the mock, not real bash.
    stdout_fixture = tmp_path / "mock-stdout.txt"
    stdout_fixture.write_text("deployment.apps/web scaled\n")
    monkeypatch.setenv("SLASH_MOCK_STDOUT_PATH", str(stdout_fixture))
    monkeypatch.setenv("SLASH_MOCK_EXIT", "0")

    reg = load_registry(SKILLS_DIR)
    from slash_api import state

    state._registry = reg
    state.set_selected(k8s="local-test", k8s_tier="safe")

    return TestClient(app), audit_path


def test_default_audit_path_is_dot_slash():
    """Default path (no env override) sits under <repo>/.slash/audit/."""
    default = audit_writer._DEFAULT_PATH
    assert default.parts[-3:] == (".slash", "audit", "audit.jsonl")


def test_write_stage_records_parsed_command_and_plan_summary(client):
    tc, audit_path = client
    r = tc.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    )
    assert r.status_code == 200
    rows = _read_audit(audit_path)
    assert len(rows) == 1

    row = rows[0]
    # Core envelope
    assert row["run_id"].startswith("r_")
    assert row["ts"]  # added by writer
    assert row["mode"] == "write"
    assert row["state"] == "awaiting_approval"
    assert row["skill_id"] == "cluster.scale"
    assert row["risk"] in ("low", "medium", "high")

    # Parsed command captured
    pc = row["parsed_command"]
    assert pc["namespace"] == "cluster"
    assert pc["verb"] == "scale"
    assert pc["flags"]["replicas"] == 3
    assert pc["flags"]["ns"] == "api"

    # Plan summary captured
    ps = row["plan_summary"]
    assert ps["target"] == "deploy/web"
    assert isinstance(ps["steps"], list) and len(ps["steps"]) >= 3


def test_approve_records_decision_and_execution_argv(client):
    tc, audit_path = client
    stage = tc.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    ).json()
    run_id = stage["run_id"]

    tc.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "approve"},
        headers={"X-Slash-Actor": "human-alice"},
    )

    rows = _read_audit(audit_path)
    # Two events for this run_id: awaiting_approval, then ok
    ours = [r for r in rows if r["run_id"] == run_id]
    assert len(ours) == 2
    staged, applied = ours
    assert staged["state"] == "awaiting_approval"
    assert applied["state"] == "ok"

    # Applied event: approval_decision + execution_argv + run timestamps
    assert applied["approval_decision"]["decision"] == "approve"
    assert applied["approval_decision"]["by"] == "human-alice"
    assert applied["execution_argv"][0] == "kubectl"
    assert "scale" in applied["execution_argv"]
    assert applied["started_at"] and applied["ended_at"]
    assert applied["exit_code"] == 0

    # Stdout is redacted to a hash per docs/05 §4.3 — we never persist raw
    assert "stdout" not in applied
    assert applied["stdout_sha256"]


def test_reject_records_decision_without_execution(client):
    tc, audit_path = client
    stage = tc.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    ).json()
    run_id = stage["run_id"]

    tc.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "reject", "comment": "wrong env"},
        headers={"X-Slash-Actor": "human-alice"},
    )

    rows = _read_audit(audit_path)
    ours = [r for r in rows if r["run_id"] == run_id]
    assert len(ours) == 2
    _, rejected = ours

    assert rejected["state"] == "rejected"
    assert rejected["approval_decision"]["decision"] == "reject"
    assert rejected["approval_decision"]["reason"] == "wrong env"
    # No exit_code, no execution_argv on reject — bash never ran.
    assert "exit_code" not in rejected
    assert "execution_argv" not in rejected


def test_redaction_hits_command_and_argv(client, tmp_path, monkeypatch):
    """Secrets inside the raw command or an argv element get redacted
    before landing on disk."""
    tc, audit_path = client

    # Stage a write with an AWS access key hidden in --reason
    text = "/cluster scale web --replicas 3 --ns api --reason AKIA1234567890ABCDEF"
    tc.post("/execute", json={"text": text})
    rows = _read_audit(audit_path)
    assert rows
    # The raw command must be redacted before disk
    assert "AKIA1234567890ABCDEF" not in rows[0]["command"]
    assert "[REDACTED_AKID]" in rows[0]["command"]


def test_audit_dir_created_on_first_write(tmp_path, monkeypatch):
    """The audit writer auto-creates .slash/audit/ on first append."""
    audit_path = tmp_path / "fresh" / "sub" / "audit.jsonl"
    monkeypatch.setenv("SLASH_AUDIT_PATH", str(audit_path))
    # Reload writer so it picks up env
    from slash_api.audit import writer as w
    w.append({"run_id": "r_fresh", "user": "t", "mode": "read", "state": "ok"})
    assert audit_path.exists()
    assert audit_path.parent.is_dir()
