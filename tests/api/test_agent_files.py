"""Agent config files + version snapshots/rollback (EXP-004 / EXP-007)."""

# covers: T-EXP-04 T-EXP-07

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
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "app.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="test-pass")
    conn.close()
    settings = Settings(
        db_path=db,
        workspace_dir=tmp_path / "workspace",
        secret_key="test-secret",
        access_ttl_seconds=3600,
        session_ttl_seconds=86400,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def login(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "test-pass"}
    )
    assert response.status_code == 200, response.text


def test_agent_files_publish_versions_and_rollback(
    client: TestClient, tmp_path: Path,
) -> None:
    login(client)
    created = client.post("/api/v1/agents", json={"name": "文件测试专家"})
    assert created.status_code == 201, created.text
    agent_id = created.json()["agentId"]

    files = client.get(f"/api/v1/agents/{agent_id}/files")
    assert files.status_code == 200
    assert files.json()["items"] == []

    put = client.put(
        f"/api/v1/agents/{agent_id}/files/USER.md",
        json={"content": "v1 prompt"},
    )
    assert put.status_code == 200
    assert put.json()["content"] == "v1 prompt"

    draft = (
        tmp_path / "workspace" / ".polyopus" / "tenants" / "default"
        / "agents" / agent_id / "draft"
    )
    assert (draft / "USER.md").read_text(encoding="utf-8") == "v1 prompt"

    one = client.get(f"/api/v1/agents/{agent_id}/files/USER.md")
    assert one.json()["content"] == "v1 prompt"

    published = client.post(f"/api/v1/agents/{agent_id}/publish")
    assert published.status_code == 200
    assert published.json()["version"] == 1

    client.put(
        f"/api/v1/agents/{agent_id}/files/USER.md",
        json={"content": "v2 prompt"},
    )

    versions = client.get(f"/api/v1/agents/{agent_id}/versions")
    assert versions.status_code == 200
    assert versions.json()["items"][0]["version"] == 1
    assert versions.json()["items"][0]["isCurrent"] is True

    snapshot = client.get(f"/api/v1/agents/{agent_id}/versions/1")
    assert snapshot.status_code == 200
    assert snapshot.json()["files"]["USER.md"] == "v1 prompt"

    rollback = client.post(
        f"/api/v1/agents/{agent_id}/rollback", json={"version": 1}
    )
    assert rollback.status_code == 200
    assert client.get(
        f"/api/v1/agents/{agent_id}/files/USER.md"
    ).json()["content"] == "v1 prompt"

    removed = client.delete(f"/api/v1/agents/{agent_id}/files/USER.md")
    assert removed.status_code == 200
    assert client.get(
        f"/api/v1/agents/{agent_id}/files/USER.md"
    ).status_code == 404
    assert not (draft / "USER.md").exists()


def test_agent_file_name_is_validated(client: TestClient) -> None:
    login(client)
    agent = client.post("/api/v1/agents", json={"name": "非法文件名"}).json()
    response = client.put(
        f"/api/v1/agents/{agent['agentId']}/files/bad%20name",
        json={"content": "x"},
    )
    assert response.status_code in (400, 422)


def test_delete_agent_purges_workspace_draft(
    client: TestClient, tmp_path: Path,
) -> None:
    login(client)
    agent = client.post("/api/v1/agents", json={"name": "工作区清理"}).json()
    agent_id = agent["agentId"]
    assert client.put(
        f"/api/v1/agents/{agent_id}/files/AGENTS.md",
        json={"content": "guide"},
    ).status_code == 200
    draft = (
        tmp_path / "workspace" / ".polyopus" / "tenants" / "default"
        / "agents" / agent_id / "draft"
    )
    assert (draft / "AGENTS.md").exists()

    assert client.delete(f"/api/v1/agents/{agent_id}").status_code == 200
    assert not draft.exists()
