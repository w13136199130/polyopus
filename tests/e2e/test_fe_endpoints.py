"""V05-22 frontend endpoints: counts, ticket timeline, SSE heartbeat."""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.api.routers import threads as threads_router
from polyopus.config import Settings
from polyopus.domains.tickets import service as tickets
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "fe.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _source(client: TestClient, **overrides: object) -> dict:
    body: dict[str, object] = {
        "name": f"fe-{time.time_ns()}",
        "allowActors": ["alice"],
        "explicitPatterns": ["/polyopus"],
        "generateSecret": False,
        "defaultScope": ["workspace:default", "fs:write"],
    }
    body.update(overrides)
    response = client.post("/api/v1/sources", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _fire(client: TestClient, source: dict, *, text: str = "/polyopus 修复构建") -> str:
    response = client.post(
        f"/api/v1/webhooks/{source['sourceId']}",
        json={
            "external_id": f"e-{time.time_ns()}",
            "thread_key": f"t-{time.time_ns()}",
            "actor": {"id": "alice"},
            "text": text,
        },
    )
    assert response.status_code == 202, response.text
    ticket_id = response.json()["ticketId"]
    assert ticket_id
    return str(ticket_id)


def _run_assignment(db: Path, ticket_id: str) -> str:
    conn = m.connect(db)
    try:
        return tickets.run_assignment(conn, EventStore(conn), ticket_id)
    finally:
        conn.close()


def _rows(db: Path, sql: str, *params: object) -> list[sqlite3.Row]:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def test_counts_match_the_list(env: tuple[Path, TestClient]) -> None:
    db, client = env
    source = _source(client)
    first = _fire(client, source)
    _fire(client, source)

    before = client.get("/api/v1/tickets/counts").json()
    items = client.get("/api/v1/tickets").json()["items"]
    for bucket in ("attention", "running", "queued", "done"):
        assert before[bucket] == len([row for row in items if row["bucket"] == bucket])

    assert _run_assignment(db, first) == "ready"
    after = client.get("/api/v1/tickets/counts").json()
    items = client.get("/api/v1/tickets").json()["items"]
    for bucket in ("attention", "running", "queued", "done"):
        assert after[bucket] == len([row for row in items if row["bucket"] == bucket])
    assert after["done"] == before["done"] + 1


def test_timeline_is_ascending_and_whitelisted(env: tuple[Path, TestClient]) -> None:
    db, client = env
    source = _source(client, maxTotalTokens=1)  # guaranteed blocked -> attention
    ticket_id = _fire(client, source)
    assert _run_assignment(db, ticket_id) == "blocked"

    response = client.get(f"/api/v1/tickets/{ticket_id}/timeline")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert items
    timestamps = [item["at"] for item in items]
    assert timestamps == sorted(timestamps)
    kinds = {item["kind"] for item in items}
    assert {"trigger", "ticket", "assignment", "report", "attention"} <= kinds
    for item in items:
        assert set(item) <= {
            "id", "at", "kind", "title", "description", "actor", "tone", "link",
        }
        assert not {"payload", "secret", "args_json", "result_json"} & set(item)


def test_sse_idle_pings_and_no_buffering(
    env: tuple[Path, TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    _db, client = env
    monkeypatch.setattr(threads_router, "SSE_PING_SECONDS", 0.05)
    thread_id = client.post("/api/v1/threads", json={"title": "sse"}).json()["threadId"]

    pings = 0
    with client.stream(
        "GET",
        f"/api/v1/threads/{thread_id}/events?follow=true",
    ) as response:
        assert response.status_code == 200
        assert response.headers.get("x-accel-buffering") == "no"
        for line in response.iter_lines():
            if line.strip() == ": ping":
                pings += 1
                if pings >= 3:
                    break
    assert pings >= 3
