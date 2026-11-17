"""V1-12: tool registry, global switches and per-agent shrinking."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.tools import service as tools
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "tools.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield db, client


def _agent(client: TestClient) -> str:
    response = client.post("/api/v1/agents", json={"name": "工具测试"})
    assert response.status_code == 201, response.text
    return str(response.json()["agentId"])


def test_registry_and_global_switch(env: tuple[Path, TestClient]) -> None:
    db, client = env
    listed = client.get("/api/v1/tools")
    assert listed.status_code == 200, listed.text
    items = {row["toolKey"]: row for row in listed.json()["items"]}
    assert {"fs.read", "fs.write", "demo.sleep"} <= set(items)
    assert items["fs.read"]["risk"] == "low"
    assert items["fs.write"]["sideEffects"] is True

    disabled = client.patch("/api/v1/tools/fs.write", json={"enabledGlobal": False})
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["enabledGlobal"] is False

    agent_id = _agent(client)
    bindings = client.get(f"/api/v1/agents/{agent_id}/tools")
    assert bindings.status_code == 200, bindings.text
    rows = {row["toolKey"]: row for row in bindings.json()["items"]}
    assert rows["fs.write"]["enabled"] is False
    assert rows["fs.read"]["enabled"] is True

    conn = m.connect(db)
    try:
        assert tools.effective_enabled(
            conn, tenant_id="default", agent_id=agent_id, tool_key="fs.write"
        ) is False
    finally:
        conn.close()


def test_per_agent_switch_only_hides(env: tuple[Path, TestClient]) -> None:
    db, client = env
    agent_id = _agent(client)
    response = client.patch(f"/api/v1/agents/{agent_id}/tools", json={
        "items": [
            {"toolKey": "fs.read", "enabled": False},
            {"toolKey": "fs.write", "enabled": True},
        ],
    })
    assert response.status_code == 200, response.text
    rows = {row["toolKey"]: row for row in response.json()["items"]}
    assert rows["fs.read"]["enabled"] is False
    assert rows["fs.write"]["enabled"] is True

    conn = m.connect(db)
    try:
        assert tools.effective_enabled(
            conn, tenant_id="default", agent_id=agent_id, tool_key="fs.read"
        ) is False
        assert tools.effective_enabled(
            conn, tenant_id="default", agent_id=agent_id, tool_key="fs.write"
        ) is True
    finally:
        conn.close()

    unknown = client.patch(f"/api/v1/agents/{agent_id}/tools", json={
        "items": [{"toolKey": "missing.tool", "enabled": True}],
    })
    assert unknown.status_code == 400
    assert unknown.json()["error"]["code"] == "VALIDATION_FAILED"
