"""Slice ② cards 4-6: assignment runs, budget blocks, watchdog stops."""

# covers: T-INTAKE-06 T-TASK-03 T-TASK-02

from __future__ import annotations

import hashlib
import hmac
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


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "tk.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _open_ticket(client: TestClient, **source_overrides: object) -> str:
    body: dict[str, object] = {
        "name": "ci",
        "allow_actors": ["alice"],
        "explicit_patterns": ["/polyopus"],
    }
    body.update(source_overrides)
    source = client.post("/api/v1/sources", json=body).json()
    payload = {
        "external_id": f"e-{time.time_ns()}",
        "actor": {"id": "alice"},
        "thread_key": "ci",
        "text": "/polyopus 修复构建",
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    sig = hmac.new(source["secret"].encode(), canonical, hashlib.sha256).hexdigest()
    response = client.post(
        f"/api/v1/webhooks/{source['sourceId']}", json=payload,
        headers={"X-Signature": sig},
    )
    ticket_id = response.json()["ticketId"]
    assert ticket_id, response.text
    return ticket_id


def test_assignment_runs_ticket_to_ready_report(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    ticket_id = _open_ticket(client)

    conn = m.connect(db)
    store = EventStore(conn)
    state = tickets.run_assignment(conn, store, ticket_id)
    conn.close()

    assert state == "ready"
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["state"] == "ended"
    assert detail["bucket"] == "done"
    assert detail["report"]["state"] == "ready"

    conn = sqlite3.connect(str(db))
    types = [r[0] for r in conn.execute(
        "SELECT type FROM events WHERE thread_id = ("
        "SELECT json_extract(payload_json,'$.thread_id') FROM timeline_events "
        "WHERE ticket_id = ? ORDER BY id DESC LIMIT 1)", (ticket_id,)
    ).fetchall()]
    conn.close()
    for expected in ("assignment.started", "assignment.reported",
                     "assignment.ended", "ticket.ended"):
        assert expected in types, types


def test_budget_overrun_blocks_and_raises_attention(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    ticket_id = _open_ticket(client, max_total_tokens=1)  # any turn exceeds 1

    conn = m.connect(db)
    store = EventStore(conn)
    state = tickets.run_assignment(conn, store, ticket_id)
    conn.close()

    assert state == "blocked"
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["bucket"] == "attention"
    assert detail["report"]["state"] == "blocked"

    inbox = client.get("/api/v1/attentions").json()["items"]
    blocked = [i for i in inbox if i["kind"] == "blocked"]
    assert len(blocked) == 1
    assert blocked[0]["ticketId"] == ticket_id
    assert "预算超限" in blocked[0]["payload"]["summary"]


def test_human_stop_ends_ticket_and_cancels_assignment(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    ticket_id = _open_ticket(client)
    conn = m.connect(db)
    assignment_id = tickets.assign(conn, EventStore(conn), ticket_id)
    conn.execute(
        "UPDATE assignments SET state='running' WHERE assignment_id = ?",
        (assignment_id,),
    )
    conn.commit()
    conn.close()

    response = client.post(f"/api/v1/tickets/{ticket_id}/stop")
    assert response.status_code == 200

    conn = sqlite3.connect(str(db))
    row = conn.execute(
        "SELECT state, bucket FROM tickets WHERE ticket_id = ?", (ticket_id,)
    ).fetchone()
    assignments = conn.execute(
        "SELECT state FROM assignments WHERE assignment_id = ?", (assignment_id,)
    ).fetchone()
    mandate = conn.execute(
        "SELECT invalidated_at FROM mandates WHERE ticket_id = ?", (ticket_id,)
    ).fetchone()
    types = [r[0] for r in conn.execute(
        "SELECT type FROM events WHERE type IN ('ticket.ended','assignment.ended')"
    ).fetchall()]
    conn.close()

    assert row[0] == "ended" and row[1] == "done"
    assert assignments[0] == "ended"
    assert mandate[0] is not None
    assert types.count("ticket.ended") == 1


def test_watchdog_requeues_stalled_then_deads_after_cap(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    ticket_id = _open_ticket(client)
    conn = m.connect(db)
    store = EventStore(conn)
    assignment_id = tickets.assign(conn, store, ticket_id)
    conn.execute(
        "UPDATE assignments SET state='running', heartbeat_at = ? "
        "WHERE assignment_id = ?",
        (int(time.time()) - 9999, assignment_id),
    )
    conn.commit()

    first = tickets.watchdog_scan(conn, store, stale_seconds=60)
    assert len(first) == 1 and first[0]["action"] == "requeue"
    state = conn.execute(
        "SELECT state FROM assignments WHERE assignment_id = ?", (assignment_id,)
    ).fetchone()[0]
    assert state == "pending"

    # re-stall twice more: second alert requeues, third stops (cap = 2 requeues)
    for _ in range(2):
        conn.execute(
            "UPDATE assignments SET state='running', heartbeat_at = ? "
            "WHERE assignment_id = ?",
            (int(time.time()) - 9999, assignment_id),
        )
        conn.commit()
        tickets.watchdog_scan(conn, store, stale_seconds=60)

    state = conn.execute(
        "SELECT state FROM assignments WHERE assignment_id = ?", (assignment_id,)
    ).fetchone()[0]
    alerts = conn.execute(
        "SELECT action, count(*) FROM watchdog_alerts GROUP BY action"
    ).fetchall()
    alert_events = conn.execute(
        "SELECT count(*) FROM events WHERE type = 'watchdog.alert'"
    ).fetchone()[0]
    conn.close()

    assert state == "dead"
    assert dict(alerts).get("requeue") == 2
    assert dict(alerts).get("stop") == 1
    assert alert_events == 3


def test_watchdog_endpoint_scans(
    env: tuple[Path, TestClient]
) -> None:
    _, client = env
    response = client.post("/api/v1/tickets/watchdog/run")
    assert response.status_code == 200
    assert response.json() == {"alerts": []}
