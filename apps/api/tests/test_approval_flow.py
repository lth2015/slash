"""End-to-end approval flow — HITL state machine.

Pins down docs/05 §2: write skill stages a PendingPlan, decide can only
happen once, rejected run_id cannot be re-approved. All bash execution
funnels through the runtime mock (SLASH_MOCK_*) so we never spawn real
kubectl / aws.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from slash_api.main import app
from slash_api.registry.loader import load_registry


REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = REPO_ROOT / "skills"


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    """Test client with a throwaway audit path + subprocess mocks wired so
    real bash (kubectl / aws) is never spawned."""
    monkeypatch.setenv("SLASH_AUDIT_PATH", str(tmp_path / "audit.jsonl"))

    # Mock subprocess output: anything approved gets this fake stdout.
    stdout_fixture = tmp_path / "mock-stdout.txt"
    stdout_fixture.write_text("deployment.apps/web scaled\n")
    monkeypatch.setenv("SLASH_MOCK_STDOUT_PATH", str(stdout_fixture))
    monkeypatch.setenv("SLASH_MOCK_EXIT", "0")

    # Load real registry so /execute knows about cluster.scale et al.
    reg = load_registry(SKILLS_DIR)
    from slash_api import state

    state._registry = reg
    # Pin a fake k8s ctx so /cluster commands don't fail MissingContext.
    # Also pin aws for any /infra aws skill we might want.
    state.set_selected(k8s="local-test", k8s_tier="safe")
    state.set_selected(aws="default", aws_tier="safe")

    return TestClient(app)


def test_write_stages_plan_and_does_not_execute(client):
    """/execute on a write skill returns awaiting_approval + rich plan
    narration; bash must NOT run yet (mock stdout would leak if it did)."""
    r = client.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "awaiting_approval"
    assert body["mode"] == "write"
    assert body["approval_required"] is True
    assert body["approval_state"] == "pending"
    # Planner output — from cluster.scale's spec.plan.target/steps
    assert body["target"] == "deploy/web"
    assert body["steps"] and len(body["steps"]) >= 3
    assert "Scale deployment web to 3 replicas" in body["steps"]
    assert body["risk"] in ("low", "medium", "high")
    # No bash ran — stdout_excerpt must be absent/empty on an awaiting_approval
    assert not body.get("stdout_excerpt")
    assert not body.get("exit_code")


def test_approve_runs_bash_and_returns_timestamps(client):
    stage = client.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    ).json()
    run_id = stage["run_id"]

    r = client.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "approve"},
        headers={"X-Slash-Actor": "human-alice"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decided"] is True
    assert body["decision"] == "approve"
    assert body["state"] == "ok"
    assert body["exit_code"] == 0
    # Runner contract: started_at / ended_at must travel with every executed run
    assert body["started_at"] and body["ended_at"]


def test_reject_blocks_execution(client):
    stage = client.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    ).json()
    run_id = stage["run_id"]

    r = client.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "reject", "comment": "wrong env"},
        headers={"X-Slash-Actor": "human-alice"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "rejected"
    # No exit_code, no timestamps on reject (bash never ran)
    assert body.get("exit_code") is None
    assert not body.get("started_at")
    assert not body.get("ended_at")


def test_cannot_approve_after_reject(client):
    """THE gate: once a plan is rejected, the same run_id can never be
    approved. This protects the contract that rejected writes stay rejected
    — a malicious or confused retry can't resurrect them."""
    stage = client.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    ).json()
    run_id = stage["run_id"]

    # First: reject
    r1 = client.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "reject", "comment": "nope"},
        headers={"X-Slash-Actor": "human-alice"},
    )
    assert r1.status_code == 200

    # Second: try to approve — must fail
    r2 = client.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "approve"},
        headers={"X-Slash-Actor": "human-alice"},
    )
    assert r2.status_code in (404, 409), r2.text
    detail = r2.json().get("detail") or {}
    assert detail.get("code") in ("NotFound", "AlreadyDecided"), detail


def test_cannot_decide_twice(client):
    """Idempotency guard: approve then approve again → 409 / 404."""
    stage = client.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    ).json()
    run_id = stage["run_id"]

    r1 = client.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "approve"},
        headers={"X-Slash-Actor": "human-alice"},
    )
    assert r1.status_code == 200

    r2 = client.post(
        f"/approvals/{run_id}/decide",
        json={"decision": "approve"},
        headers={"X-Slash-Actor": "human-alice"},
    )
    assert r2.status_code in (404, 409)


def test_decide_requires_human_actor_header(client):
    """docs/05 §5.2: LLM MUST NOT call /approvals/decide — we enforce with
    an X-Slash-Actor header check. Missing header → 403."""
    stage = client.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    ).json()
    run_id = stage["run_id"]

    r = client.post(f"/approvals/{run_id}/decide", json={"decision": "approve"})
    assert r.status_code == 403, r.text
    assert (r.json().get("detail") or {}).get("code") == "ForbiddenActor"


def test_approvals_list_shows_pending_state(client):
    """GET /approvals returns each pending plan with approval_state=pending
    and the planner narration so a page refresh rebuilds the card intact."""
    client.post(
        "/execute",
        json={"text": "/cluster scale web --replicas 3 --ns api --reason test"},
    )

    r = client.get("/approvals")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    item = [i for i in items if i["skill_id"] == "cluster.scale"][0]
    assert item["approval_state"] == "pending"
    assert item["target"] == "deploy/web"
    assert item["steps"]
    assert item["risk"] in ("low", "medium", "high")
