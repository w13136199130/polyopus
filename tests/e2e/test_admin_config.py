"""Admin model provider CRUD, storage snapshot and security policy editing."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "admin.db"
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "note.txt").write_text("hello", encoding="utf-8")
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(
        db_path=db, secret_key="secret", access_ttl_seconds=3600,
        session_ttl_seconds=86400, workspace_dir=workspace,
        embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def test_provider_crud_encrypts_key_and_probes(env: tuple[Path, TestClient]) -> None:
    db, client = env
    created = client.post("/api/v1/admin/providers", json={
        "name": "本地兼容",
        "baseUrl": "http://127.0.0.1:9/v1",
        "apiKey": "sk-secret",
        "models": ["deepseek-flash", "deepseek-chat"],
    })
    assert created.status_code == 201, created.text
    provider = created.json()
    assert provider["configured"] is True
    assert "apiKey" not in provider and "sk-secret" not in str(provider)
    provider_id = provider["providerId"]
    assert [m["name"] for m in provider["models"]] == ["deepseek-flash", "deepseek-chat"]

    conn = m.connect(db)
    try:
        encrypted = conn.execute(
            "SELECT api_key_enc FROM providers WHERE provider_id = ?", (provider_id,)
        ).fetchone()[0]
    finally:
        conn.close()
    assert "sk-secret" not in encrypted

    listed = client.get("/api/v1/admin/providers").json()
    assert listed["env"]["configured"] is False
    assert any(row["providerId"] == provider_id for row in listed["items"])

    updated = client.patch(f"/api/v1/admin/providers/{provider_id}", json={
        "name": "本地兼容 v2",
        "models": ["deepseek-flash"],
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "本地兼容 v2"
    assert [m["name"] for m in updated.json()["models"]] == ["deepseek-flash"]

    probed = client.post(f"/api/v1/admin/providers/{provider_id}/probe")
    assert probed.status_code == 200, probed.text
    assert probed.json()["ok"] is False
    assert probed.json()["status"] == "error"

    assert client.delete(
        f"/api/v1/admin/providers/{provider_id}"
    ).json()["ok"] is True
    assert all(
        row["providerId"] != provider_id
        for row in client.get("/api/v1/admin/providers").json()["items"]
    )


def test_storage_snapshot_reports_local_paths(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    snapshot = client.get("/api/v1/admin/storage")
    assert snapshot.status_code == 200, snapshot.text
    body = snapshot.json()
    assert body["backend"] == "local"
    assert body["db"]["bytes"] > 0
    assert body["workspace"]["files"] >= 1
    assert any(item["status"] == "v1.1" for item in body["remoteBackends"])


def test_security_policy_publish_and_rollback(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    first = client.get("/api/v1/admin/security")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["policy"]["rules"]
    assert body["posture"]["workspaceJail"] is True
    assert any(row["toolKey"] == "fs.write" for row in body["tools"])
    assert body["policy"]["version"] is None  # defaults, not yet published

    rules = [
        {
            "rid": "r-deny-write-admin", "priority": 999,
            "when": {"tool": "fs.write"}, "effect": "deny",
        },
        {
            "rid": "r-allow-read-admin", "priority": 50,
            "when": {"tools": ["fs.read"]}, "effect": "allow",
        },
    ]
    published = client.put("/api/v1/admin/security/policy", json={"rules": rules})
    assert published.status_code == 200, published.text
    version = published.json()["policy"]["version"]
    assert any(rule["rid"] == "r-deny-write-admin"
               for rule in published.json()["policy"]["rules"])

    second = client.put("/api/v1/admin/security/policy", json={
        "rules": [rules[1]],
    })
    assert second.status_code == 200, second.text
    assert second.json()["policy"]["version"] != version

    rolled = client.post(
        "/api/v1/admin/security/policy/rollback", json={"version": version}
    )
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["policy"]["version"] == version

    bad = client.put("/api/v1/admin/security/policy", json={
        "rules": [{"rid": "x", "priority": 1, "when": {}, "effect": "nope"}],
    })
    assert bad.status_code in (400, 422)


def test_overview_aggregates_queue_and_usage(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    created = client.post("/api/v1/tickets", json={"title": "总览测试任务"})
    assert created.status_code == 201, created.text

    body = client.get("/api/v1/admin/overview")
    assert body.status_code == 200, body.text
    data = body.json()
    assert set(data["health"]) >= {
        "activeSessions", "queueDepth", "runningTurns", "openAttentions",
        "runs24h", "failedRuns24h", "errorRate", "p95LatencyMs",
    }
    assert data["tickets"]["queued"] >= 1
    assert data["usage"]["todayTokens"] >= 0
    assert isinstance(data["recentAudit"], list)
    assert any(item["title"] == "总览测试任务" for item in data["recentTickets"])
