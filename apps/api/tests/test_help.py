"""POST /help — static catalog fallback + audit contract.

We don't call Gemini in tests (no API key, and we don't want to). The
fallback path must still answer `/help` with a deterministic catalog
tour so the command is usable in air-gapped / LLM-off setups.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from slash_api.main import app
from slash_api.registry.loader import load_registry


REPO_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = REPO_ROOT / "skills"


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    audit_path = tmp_path / ".slash" / "audit" / "audit.jsonl"
    monkeypatch.setenv("SLASH_AUDIT_PATH", str(audit_path))
    # Force LLM off so the deterministic fallback runs.
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    reg = load_registry(SKILLS_DIR)
    from slash_api import state

    state._registry = reg
    return TestClient(app)


def test_help_falls_back_without_llm(client):
    r = client.post("/help", json={"question": "how do I restart a deployment?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert body["llm_used"] is False
    assert body["reason_unavailable"]  # LLM off; populated
    # The static tour lists skills per namespace …
    assert body["summary"]
    assert any(h.startswith("/cluster") for h in body["highlights"])
    # … and gives copy-paste-ready suggestions only from the real catalog.
    assert len(body["suggested_commands"]) > 0
    for cmd in body["suggested_commands"]:
        assert cmd.startswith("/")


def test_help_accepts_empty_question(client):
    """Empty body is valid — means "give me a tour"."""
    r = client.post("/help", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["summary"]
    assert body["suggested_commands"]


def test_help_appends_audit_row(client, tmp_path):
    audit_path = tmp_path / ".slash" / "audit" / "audit.jsonl"
    client.post("/help", json={"question": "list pods somehow"})
    # The writer auto-creates the dir; the file exists after one call.
    assert audit_path.exists()
    rows = [json.loads(l) for l in audit_path.read_text().splitlines() if l.strip()]
    ours = [r for r in rows if r.get("skill_id") == "meta.help"]
    assert len(ours) >= 1
    row = ours[-1]
    assert row["mode"] == "read"
    assert row["state"] == "ok"
    assert row["risk"] == "low"
    # Question text round-trips (it's part of `command`)
    assert "list pods somehow" in row["command"]
