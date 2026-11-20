"""V1-14: connector catalog, encrypted instances, probe and OAuth state."""

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
PASSWORD = "admin-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "connectors.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="connector-secret", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield db, client


def test_connector_instance_encrypts_and_probes(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    catalog = client.get("/api/v1/connectors/catalog")
    assert catalog.status_code == 200, catalog.text
    kinds = {row["kind"] for row in catalog.json()["items"]}
    assert {"github", "webhook", "imap"} <= kinds

    created = client.post("/api/v1/connectors/instances", json={
        "kind": "webhook",
        "displayName": "部署回调",
        "config": {"url": "https://example.com/hook", "token": "top-secret"},
    })
    assert created.status_code == 201, created.text
    instance = created.json()
    assert instance["configured"] is True
    assert "config" not in instance and "token" not in instance
    instance_id = instance["instanceId"]

    conn = m.connect(db)
    try:
        encrypted = conn.execute(
            "SELECT config_enc FROM connector_instances WHERE instance_id = ?",
            (instance_id,),
        ).fetchone()[0]
    finally:
        conn.close()
    assert "example.com" not in encrypted
    assert "top-secret" not in encrypted

    probed = client.post(f"/api/v1/connectors/instances/{instance_id}/probe")
    assert probed.status_code == 200, probed.text
    assert probed.json()["ok"] is True
    assert probed.json()["status"] == "active"

    updated = client.patch(f"/api/v1/connectors/instances/{instance_id}", json={
        "displayName": "部署回调 v2",
    })
    assert updated.status_code == 200
    assert updated.json()["displayName"] == "部署回调 v2"

    bad = client.post("/api/v1/connectors/instances", json={
        "kind": "webhook", "displayName": "缺配置", "config": {},
    })
    assert bad.status_code == 201
    bad_id = bad.json()["instanceId"]
    failed = client.post(f"/api/v1/connectors/instances/{bad_id}/probe")
    assert failed.status_code == 200
    assert failed.json()["ok"] is False
    assert failed.json()["status"] == "error"

    assert client.delete(
        f"/api/v1/connectors/instances/{instance_id}"
    ).status_code == 200


def test_oauth_state_is_validated(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    started = client.post("/api/v1/connectors/oauth/start", json={"kind": "github"})
    assert started.status_code == 200, started.text
    state = started.json()["stateId"]
    assert "connect.invalid" in started.json()["authorizeUrl"]

    pending = client.get(f"/api/v1/connectors/oauth/pending/{state}")
    assert pending.status_code == 200
    assert pending.json()["status"] == "pending"

    denied = client.get("/api/v1/connectors/oauth/callback", params={
        "state": "os_missing", "code": "abc",
    })
    assert denied.status_code == 400
    assert denied.json()["error"]["code"] == "VALIDATION_FAILED"

    done = client.get("/api/v1/connectors/oauth/callback", params={
        "state": state, "code": "code-123",
    })
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "authorized"

    after = client.get(f"/api/v1/connectors/oauth/pending/{state}")
    assert after.json()["status"] == "authorized"


def test_mcp_instance_visual_config_probes_by_server_shape(
    env: tuple[Path, TestClient]
) -> None:
    _db, client = env
    catalog = client.get("/api/v1/connectors/catalog").json()["items"]
    assert any(row["kind"] == "mcp" for row in catalog)

    created = client.post("/api/v1/connectors/instances", json={
        "kind": "mcp",
        "displayName": "我的 MCP",
        "config": {"servers": {
            "knowledge": {"type": "http", "url": "https://mcp.example.com/mcp"},
        }},
    })
    assert created.status_code == 201, created.text
    instance_id = created.json()["instanceId"]
    ok = client.post(f"/api/v1/connectors/instances/{instance_id}/probe")
    assert ok.json()["ok"] is True

    patch = client.patch(f"/api/v1/connectors/instances/{instance_id}", json={
        "config": {"servers": {"broken": {"type": "http", "url": ""}}},
    })
    assert patch.status_code == 200, patch.text
    failed = client.post(f"/api/v1/connectors/instances/{instance_id}/probe")
    assert failed.json()["ok"] is False
    assert "url required" in failed.json()["error"]
