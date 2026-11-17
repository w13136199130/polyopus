"""V1-11: agent draft/publish, immutable thread pins, builtin templates."""

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
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "agents.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as c:
        login = c.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield c


def test_agent_publish_and_thread_pin(client: TestClient) -> None:
    listed = client.get("/api/v1/agents")
    assert listed.status_code == 200, listed.text
    assert len(listed.json()["templates"]) >= 3

    created = client.post("/api/v1/agents", json={
        "name": "代码专家",
        "description": "v1",
        "model": "deepseek-flash",
        "systemPrompt": "你是代码专家 v1",
    })
    assert created.status_code == 201, created.text
    agent = created.json()
    agent_id = agent["agentId"]
    assert agent["status"] == "draft" and agent["version"] == 0

    published = client.post(f"/api/v1/agents/{agent_id}/publish")
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert published.json()["version"] == 1

    first_thread = client.post("/api/v1/threads", json={
        "title": "old thread", "agentId": agent_id,
    })
    assert first_thread.status_code == 201, first_thread.text
    first_version = first_thread.json()["agentVersionId"]
    assert first_version is not None

    updated = client.patch(f"/api/v1/agents/{agent_id}", json={
        "systemPrompt": "你是代码专家 v2",
    })
    assert updated.status_code == 200, updated.text
    # Draft change alone must not move the published version.
    assert updated.json()["version"] == 1
    assert updated.json()["systemPrompt"] == "你是代码专家 v1"

    second_publish = client.post(f"/api/v1/agents/{agent_id}/publish")
    assert second_publish.status_code == 200
    assert second_publish.json()["version"] == 2
    assert second_publish.json()["systemPrompt"] == "你是代码专家 v2"

    threads = client.get("/api/v1/threads").json()["items"]
    old = next(row for row in threads if row["threadId"] == first_thread.json()["threadId"])
    assert old["agentVersionId"] == first_version

    new_thread = client.post("/api/v1/threads", json={
        "title": "new thread", "agentId": agent_id,
    })
    assert new_thread.status_code == 201
    assert new_thread.json()["agentVersionId"] != first_version

    test_turn = client.post(f"/api/v1/agents/{agent_id}/test", json={
        "message": "hello draft",
    })
    assert test_turn.status_code == 200, test_turn.text
    assert test_turn.json()["status"] == "queued"
    assert test_turn.json()["threadId"]
