"""Task center screen (v0.1 card 3): page structure + unsigned demo path."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "ts.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as c:
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield c


def test_index_contains_tasks_screen(client: TestClient) -> None:
    page = client.get("/").text
    for marker in ("tasksView", "tabTasks", "inbox", "buckets",
                   "sendTrigger", "ticketDetail", "演示：webhook 触发器"):
        assert marker in page, f"missing {marker}"
    # XSS guard present for ticket titles
    assert "function esc(" in page


def test_secretless_source_accepts_unsigned_webhook(client: TestClient) -> None:
    """The demo trigger relies on secret-less sources accepting unsigned posts."""
    created = client.post("/api/v1/sources", json={
        "name": "demo-ui", "generate_secret": False,
        "allow_actors": ["alice"], "explicit_patterns": ["/polyopus"],
    })
    assert created.status_code == 201
    assert "secret" not in created.json()

    payload = {
        "external_id": f"ui-{time.time_ns()}",
        "thread_key": "demo",
        "actor": {"id": "alice", "kind": "user"},
        "text": "/polyopus 请检查构建",
    }
    response = client.post(
        f"/api/v1/webhooks/{created.json()['sourceId']}", json=payload
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["disposition"] == "accepted"
    assert body["ticketId"]


def test_screen_end_to_end_via_apis(client: TestClient) -> None:
    """The flows the screen drives: trigger -> list -> stop -> detail."""
    source = client.post("/api/v1/sources", json={
        "name": "demo-e2e", "generate_secret": False,
        "allow_actors": ["alice"], "explicit_patterns": ["/polyopus"],
    }).json()
    ticket_id = client.post(
        f"/api/v1/webhooks/{source['sourceId']}",
        json={"external_id": "e-1", "thread_key": "d",
              "actor": {"id": "alice"}, "text": "/polyopus 任务中心测试"},
    ).json()["ticketId"]

    listed = client.get("/api/v1/tickets").json()["items"]
    assert any(t["ticketId"] == ticket_id and t["bucket"] == "queued"
               for t in listed)

    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["scope"] == ["workspace:default"]

    stopped = client.post(f"/api/v1/tickets/{ticket_id}/stop")
    assert stopped.status_code == 200
    after = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert after["state"] == "ended" and after["bucket"] == "done"
