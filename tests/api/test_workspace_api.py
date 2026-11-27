"""Workspace API tenant boundary for the expert system dir (phase 2)."""

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
    settings.workspace_dir.mkdir(parents=True, exist_ok=True)
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def login(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "test-pass"}
    )
    assert response.status_code == 200, response.text


def _system_paths(items: list[dict[str, object]]) -> list[str]:
    paths: list[str] = []

    def walk(rows: list[dict[str, object]]) -> None:
        for row in rows:
            paths.append(str(row["path"]))
            walk(row.get("children") or [])  # type: ignore[arg-type]

    walk(items)
    return paths


def test_expert_workspace_is_tenant_scoped(client: TestClient, tmp_path: Path) -> None:
    login(client)
    agent = client.post("/api/v1/agents", json={"name": "工作区可见性"}).json()
    agent_id = agent["agentId"]
    assert client.put(
        f"/api/v1/agents/{agent_id}/files/AGENTS.md",
        json={"content": "运维指南"},
    ).status_code == 200

    other = tmp_path / "workspace" / ".polyopus" / "tenants" / "other"
    other_agent = other / "agents" / "ag_other" / "draft"
    other_agent.mkdir(parents=True)
    (other_agent / "SECRET.md").write_text("other tenant", encoding="utf-8")

    tree = client.get("/api/v1/workspace/tree")
    assert tree.status_code == 200
    paths = _system_paths(tree.json()["items"])
    draft = f".polyopus/tenants/default/agents/{agent_id}/draft"
    assert f"{draft}/AGENTS.md" in paths
    assert not any("other" in path or "SECRET.md" in path for path in paths)

    preview = client.get(
        "/api/v1/workspace/file",
        params={"path": f"{draft}/AGENTS.md"},
    )
    assert preview.status_code == 200
    assert preview.json()["content"] == "运维指南"

    forbidden = client.get(
        "/api/v1/workspace/file",
        params={"path": ".polyopus/tenants/other/agents/ag_other/draft/SECRET.md"},
    )
    assert forbidden.status_code == 403
    assert client.get(
        "/api/v1/workspace/tree", params={"path": ".polyopus"},
    ).status_code == 403
    traversal = client.get(
        "/api/v1/workspace/file",
        params={
            "path": ".polyopus/tenants/default/../../../other"
            "/agents/ag_other/draft/SECRET.md",
        },
    )
    assert traversal.status_code == 403
