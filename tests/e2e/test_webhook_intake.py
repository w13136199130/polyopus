"""Slice ② cards 1-3: webhook idempotency, gate, ticket+mandate."""

# covers: T-INTAKE-02 T-INTAKE-03

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
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
    db = tmp_path / "wh.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _create_source(client: TestClient, **overrides: object) -> dict:
    body: dict[str, object] = {
        "name": "ci",
        "allow_actors": ["alice"],
        "explicit_patterns": ["/polyopus"],
    }
    body.update(overrides)
    response = client.post("/api/v1/sources", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _signed_post(client: TestClient, url: str, secret: str, payload: dict) -> object:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    sig = hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
    return client.post(url, json=payload, headers={"X-Signature": sig})


def test_webhook_replay_ten_times_creates_one_ticket(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    source = _create_source(client)
    url = f"/api/v1/webhooks/{source['sourceId']}"
    payload = {
        "kind": "ci.failed",
        "external_id": "build-42",
        "thread_key": "ci:main",
        "actor": {"id": "alice", "kind": "user"},
        "text": "/polyopus 主分支构建失败了，请排查",
    }

    ticket_ids = set()
    for _ in range(10):
        response = _signed_post(client, url, source["secret"], payload)
        assert response.status_code == 202, response.text
        body = response.json()
        assert body["disposition"] == "accepted"
        if body["ticketId"]:
            ticket_ids.add(body["ticketId"])

    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("SELECT count(*) FROM triggers").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM tickets").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM mandates").fetchone()[0] == 1
        ticket = conn.execute("SELECT ticket_id, state, bucket FROM tickets").fetchone()
    finally:
        conn.close()
    assert len(ticket_ids) == 1
    assert ticket[0] in ticket_ids
    assert ticket[1] == "open" and ticket[2] == "queued"


def test_bad_signature_rejected(env: tuple[Path, TestClient]) -> None:
    _, client = env
    source = _create_source(client)
    payload = {"actor": {"id": "alice"}, "text": "/polyopus hi"}
    response = client.post(
        f"/api/v1/webhooks/{source['sourceId']}", json=payload,
        headers={"X-Signature": "deadbeef"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"

    unsigned = client.post(f"/api/v1/webhooks/{source['sourceId']}", json=payload)
    assert unsigned.status_code == 401


def test_gate_filters_by_reason(env: tuple[Path, TestClient]) -> None:
    _, client = env
    source = _create_source(client)
    url = f"/api/v1/webhooks/{source['sourceId']}"

    # actor not on the whitelist
    r1 = _signed_post(client, url, source["secret"], {
        "external_id": "e1", "actor": {"id": "mallory"}, "text": "/polyopus let me in",
    })
    assert r1.json()["disposition"] == "filtered"
    assert r1.json()["ticketId"] is None

    # allowed actor but no explicit marker
    r2 = _signed_post(client, url, source["secret"], {
        "external_id": "e2", "actor": {"id": "alice"}, "text": "随便聊聊",
    })
    body2 = r2.json()
    assert body2["disposition"] == "filtered"

    conn_dispositions: list[str] = []
    # both triggers recorded with disposition=filtered (never silently dropped)
    from polyopus.platform.db.migrator import connect

    conn = connect(Path(env[0]))
    try:
        conn_dispositions = [
            str(r[0]) for r in conn.execute("SELECT disposition FROM triggers").fetchall()
        ]
    finally:
        conn.close()
    assert conn_dispositions.count("filtered") == 2


def test_bot_actor_filtered(env: tuple[Path, TestClient]) -> None:
    _, client = env
    source = _create_source(client, allow_actors=[], explicit_patterns=[])
    body = {
        "external_id": "b1",
        "actor": {"id": "polybot", "kind": "bot"},
        "text": "/polyopus self loop",
    }
    # no allow_actors/patterns configured; add bot list via direct config edit
    conn = sqlite3.connect(str(env[0]))
    cfg = json.loads(
        conn.execute("SELECT config_json FROM sources").fetchone()[0]
    )
    cfg["bot_actors"] = ["polybot"]
    conn.execute(
        "UPDATE sources SET config_json = ? WHERE source_id = ?",
        (json.dumps(cfg), source["sourceId"]),
    )
    conn.commit()
    conn.close()

    response = _signed_post(
        client, f"/api/v1/webhooks/{source['sourceId']}", source["secret"], body
    )
    assert response.status_code == 202
    assert response.json()["disposition"] == "filtered"


def test_events_recorded_on_streams(env: tuple[Path, TestClient]) -> None:
    db, client = env
    source = _create_source(client)
    payload = {
        "external_id": "ev-1",
        "actor": {"id": "alice"},
        "thread_key": "t1",
        "text": "/polyopus 开工",
    }
    _signed_post(client, f"/api/v1/webhooks/{source['sourceId']}",
                 source["secret"], payload)

    conn = sqlite3.connect(str(db))
    try:
        rows = conn.execute(
            "SELECT thread_id, type FROM events ORDER BY seq"
        ).fetchall()
    finally:
        conn.close()
    types = [r[1] for r in rows]
    assert "trigger.received" in types
    assert "ticket.opened" in types
    # trigger events live on the source stream, the ticket event on its thread
    opened = next(r for r in rows if r[1] == "ticket.opened")
    assert opened[0].startswith("th_")
    received = next(r for r in rows if r[1] == "trigger.received")
    assert received[0] == source["sourceId"]
