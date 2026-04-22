from fastapi.testclient import TestClient

from slash_api.main import app

client = TestClient(app)


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_root_advertises_milestone() -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "slash-api"
    assert body["milestone"].startswith("M0")


def test_parse_stub_refuses_and_points_to_doc() -> None:
    resp = client.post("/parse", json={"text": "/infra aws vm list"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["milestone"] == "M0"
    assert body["see"].endswith("02-command-reference.md")


def test_skills_finds_example_manifest() -> None:
    resp = client.get("/skills")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] >= 1, body
    ids = [item.get("id") for item in body["items"]]
    assert "infra.aws.vm.list" in ids, ids
