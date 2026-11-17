"""V1-09: stalled/drifting detection, dedupe, requeue cap and audit."""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.tickets import service as tickets
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "p"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "watchdog.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    now = int(time.time())
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default', 'th_wd', 'system', 'wd',"
        " 'active', ?, ?)", (now, now),
    )
    conn.execute(
        "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
        " actor_json, strength, policy_version, scope_json, created_at,"
        " updated_at) VALUES ('default', 'tk_wd', 'wd', 'open', 'queued',"
        " '{\"id\": \"us_wd\"}', 'explicit', 1, '[]', ?, ?)", (now, now),
    )
    conn.execute(
        "INSERT INTO timeline_events (event_id, tenant_id, ticket_id, kind,"
        " title, actor, payload_json, created_at) VALUES ('tl_wd', 'default',"
        " 'tk_wd', 'execution_thread', 'thread', 'system', ?, ?)",
        (json.dumps({"thread_id": "th_wd"}), now),
    )
    conn.commit()
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        yield db, client


def _assignment(conn: sqlite3.Connection) -> str:
    return tickets.assign(conn, EventStore(conn), "tk_wd")


def test_stalled_alert_requeues_and_writes_audit(
    env: tuple[Path, TestClient]
) -> None:
    db, _client = env
    conn = m.connect(db)
    try:
        assignment_id = _assignment(conn)
        conn.execute(
            "UPDATE assignments SET state = 'running', heartbeat_at = ?"
            " WHERE assignment_id = ?",
            (int(time.time()) - 400, assignment_id),
        )
        conn.commit()
        alerts = tickets.watchdog_scan(
            conn, EventStore(conn), stale_seconds=120
        )
        row = conn.execute(
            "SELECT kind, action, status FROM watchdog_alerts WHERE assignment_id = ?",
            (assignment_id,),
        ).fetchone()
        event = conn.execute(
            "SELECT payload_json FROM events WHERE type = 'watchdog.alert'"
            " ORDER BY id DESC LIMIT 1"
        ).fetchone()
        audit_row = conn.execute(
            "SELECT action FROM audit_log WHERE action LIKE 'watchdog.%'"
            " ORDER BY id DESC LIMIT 1"
        ).fetchone()
        state = conn.execute(
            "SELECT state FROM assignments WHERE assignment_id = ?",
            (assignment_id,),
        ).fetchone()[0]
        bucket = conn.execute(
            "SELECT bucket FROM tickets WHERE ticket_id = 'tk_wd'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert alerts == [{"assignmentId": assignment_id, "kind": "stalled",
                       "action": "requeue"}]
    assert row is not None
    assert row[0] == "stalled" and row[1] == "requeue" and row[2] == "resolved"
    assert event is not None
    assert json.loads(event[0])["kind"] == "stalled"
    assert audit_row is not None and audit_row[0] == "watchdog.requeue"
    assert state == "pending" and bucket == "queued"


def test_requeue_cap_stops_after_two(env: tuple[Path, TestClient]) -> None:
    db, _client = env
    conn = m.connect(db)
    try:
        assignment_id = _assignment(conn)
        for _ in range(3):
            conn.execute(
                "UPDATE assignments SET state = 'running', heartbeat_at = ?"
                " WHERE assignment_id = ?",
                (int(time.time()) - 400, assignment_id),
            )
            conn.commit()
            tickets.watchdog_scan(conn, EventStore(conn), stale_seconds=120)
        state = conn.execute(
            "SELECT state FROM assignments WHERE assignment_id = ?",
            (assignment_id,),
        ).fetchone()[0]
        counts = dict(conn.execute(
            "SELECT action, count(*) FROM watchdog_alerts GROUP BY action"
        ).fetchall())
    finally:
        conn.close()
    assert state == "dead"
    assert counts["requeue"] == 2 and counts["stop"] == 1


def test_drifting_alerts_once_per_assignment(env: tuple[Path, TestClient]) -> None:
    db, _client = env
    conn = m.connect(db)
    try:
        assignment_id = _assignment(conn)
        now = int(time.time())
        conn.execute(
            "UPDATE assignments SET state = 'running', started_at = ?,"
            " heartbeat_at = ? WHERE assignment_id = ?",
            (now - 3600, now, assignment_id),
        )
        conn.commit()
        first = tickets.watchdog_scan(
            conn, EventStore(conn), stale_seconds=120, drift_seconds=60
        )
        second = tickets.watchdog_scan(
            conn, EventStore(conn), stale_seconds=120, drift_seconds=60
        )
        count = conn.execute(
            "SELECT count(*) FROM watchdog_alerts WHERE assignment_id = ?"
            " AND kind = 'drifting'", (assignment_id,),
        ).fetchone()[0]
        row = conn.execute(
            "SELECT action, status FROM watchdog_alerts WHERE assignment_id = ?"
            " AND kind = 'drifting'", (assignment_id,),
        ).fetchone()
        bucket = conn.execute(
            "SELECT bucket FROM tickets WHERE ticket_id = 'tk_wd'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert [item["kind"] for item in first] == ["drifting"]
    assert second == []
    assert count == 1
    assert row is not None and row[0] == "notify" and row[1] == "open"
    assert bucket == "running"
