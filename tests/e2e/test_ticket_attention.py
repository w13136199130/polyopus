"""V05-09 失败/预算/停止 → Attention: structured payload + stop isolation.

covers: docs/48 V05-09 验收 — 预算 1 token → blocked + Attention；
人 stop → assignment ended / ticket ended；停止后不再接新事件。
Drives run_assignment directly (embedded_worker off) like test_ticket_flow.
"""

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
    db = tmp_path / "att.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _open_ticket(client: TestClient, **source_overrides: object) -> str:
    body: dict[str, object] = {
        "name": "ci",
        "allow_actors": ["alice"],
        "explicit_patterns": ["/polyopus"],
        # V05-16: turns now carry their ticket, so V05-12's scope gate is
        # live — the write-intent flows need fs:write in the mandate scope.
        "default_scope": ["workspace:default", "fs:write"],
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


def _attention_of(client: TestClient, ticket_id: str, kind: str) -> dict:
    inbox = client.get("/api/v1/attentions").json()["items"]
    hits = [i for i in inbox if i["ticketId"] == ticket_id and i["kind"] == kind]
    assert len(hits) == 1, hits
    return hits[0]


def _events_of(db: Path, ticket_id: str) -> list[str]:
    conn = sqlite3.connect(str(db))
    try:
        return [str(r[0]) for r in conn.execute(
            "SELECT type FROM events WHERE thread_id = ("
            "SELECT json_extract(payload_json,'$.thread_id') FROM timeline_events "
            "WHERE ticket_id = ? ORDER BY id DESC LIMIT 1)", (ticket_id,)
        ).fetchall()]
    finally:
        conn.close()


# ---- 验收 1: 预算 1 token → blocked + 结构化 Attention -------------------------


def test_budget_blocked_opens_structured_attention(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    ticket_id = _open_ticket(client, max_total_tokens=1)  # any turn exceeds 1

    conn = m.connect(db)
    state = tickets.run_assignment(conn, EventStore(conn), ticket_id)
    report_id = conn.execute(
        "SELECT report_id FROM reports WHERE ticket_id = ? "
        "ORDER BY id DESC LIMIT 1", (ticket_id,)
    ).fetchone()[0]
    conn.close()

    assert state == "blocked"
    attention = _attention_of(client, ticket_id, "blocked")
    payload = attention["payload"]
    assert payload["reason"] == "budget_exceeded"
    assert payload["next_action"]
    assert payload["report_id"] == report_id  # P0-1: structured source only
    assert "预算超限" in payload["summary"]
    assert attention["status"] == "pending"

    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["bucket"] == "attention"
    assert "attention.requested" in _events_of(db, ticket_id)


# ---- 验收 2: 人 stop → assignment ended / ticket ended ------------------------


def test_human_stop_ends_assignment_and_ticket(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    # write intent parks the turn at the policy gate: deterministic waiting
    ticket_id = _open_ticket(client)
    conn = m.connect(db)
    state = tickets.run_assignment(conn, EventStore(conn), ticket_id,
                                   content="/polyopus 保存结果到 out.txt")
    conn.close()
    assert state == "waiting"

    response = client.post(f"/api/v1/tickets/{ticket_id}/stop")
    assert response.status_code == 200

    conn = sqlite3.connect(str(db))
    try:
        ticket = conn.execute(
            "SELECT state, bucket FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
        assignment_states = {str(r[0]) for r in conn.execute(
            "SELECT state FROM assignments WHERE ticket_id = ?", (ticket_id,)
        ).fetchall()}
        mandate = conn.execute(
            "SELECT invalidated_at FROM mandates WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()[0]
        ended_events = conn.execute(
            "SELECT payload_json FROM events WHERE type = 'ticket.ended'"
        ).fetchall()
    finally:
        conn.close()

    assert ticket[0] == "ended" and ticket[1] == "done"
    assert assignment_states == {"ended"}
    assert mandate is not None
    assert len(ended_events) == 1
    assert json.loads(ended_events[0][0])["reason"] == "stopped_by_human"


# ---- 停止后不再接新事件 (stop wins the race vs the report tail) ----------------


def test_report_after_stop_does_not_resurrect_ticket(
    env: tuple[Path, TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    db, client = env
    # callback_url set: the tail must NOT enqueue an outbound reply either
    ticket_id = _open_ticket(client, callback_url="http://127.0.0.1:9/hook")

    # replay the real race: the worker has claimed the ticket and is mid-turn
    # when the human hits stop; the engine then finishes and the report tail
    # lands on an already-ended ticket.
    from polyopus.workers import engine

    async def _run_turn_stopped_midway(
        conn: object, store: object, turn_id: str, **kwargs: object
    ) -> str:
        response = client.post(f"/api/v1/tickets/{ticket_id}/stop")
        assert response.status_code == 200
        return "completed"

    monkeypatch.setattr(engine, "run_turn", _run_turn_stopped_midway)

    conn = m.connect(db)
    state = tickets.run_assignment(conn, EventStore(conn), ticket_id)
    conn.close()

    assert state == "ready"  # the engine itself still succeeded
    conn = sqlite3.connect(str(db))
    try:
        ticket = conn.execute(
            "SELECT state, bucket FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
        reports = conn.execute(
            "SELECT count(*) FROM reports WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()[0]
        attentions = conn.execute(
            "SELECT count(*) FROM attentions WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()[0]
        outbox = conn.execute(
            "SELECT count(*) FROM outbox WHERE topic = 'reply'"
        ).fetchone()[0]
        ended_events = conn.execute(
            "SELECT count(*) FROM events WHERE type = 'ticket.ended'"
        ).fetchone()[0]
    finally:
        conn.close()

    # audit kept; every ticket-facing effect suppressed
    assert ticket[0] == "ended" and ticket[1] == "done"
    assert reports == 1
    assert attentions == 0
    assert outbox == 0
    assert ended_events == 1  # only the stop's, none from the ready tail


# ---- failed Report → Attention(kind=failed) ------------------------------------


def test_failed_report_opens_failed_attention(
    env: tuple[Path, TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    db, client = env
    ticket_id = _open_ticket(client, callback_url="http://127.0.0.1:9/hook")

    # FakeModel never fails on its own; force the engine outcome
    from polyopus.workers import engine

    async def _failing_run_turn(*args: object, **kwargs: object) -> str:
        return "failed"

    monkeypatch.setattr(engine, "run_turn", _failing_run_turn)

    conn = m.connect(db)
    state = tickets.run_assignment(conn, EventStore(conn), ticket_id)
    conn.close()

    assert state == "failed"
    attention = _attention_of(client, ticket_id, "failed")
    payload = attention["payload"]
    assert payload["reason"] == "report_failed"
    assert payload["next_action"]
    assert payload["report_id"]

    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["bucket"] == "attention"
    assert detail["report"]["state"] == "failed"

    conn = sqlite3.connect(str(db))
    try:
        requested = conn.execute(
            "SELECT payload_json FROM events WHERE type = 'attention.requested'"
        ).fetchall()
        outbox = conn.execute(
            "SELECT count(*) FROM outbox WHERE topic = 'reply'"
        ).fetchone()[0]
    finally:
        conn.close()
    kinds = [json.loads(r[0])["kind"] for r in requested]
    assert "failed" in kinds
    assert outbox == 1  # V05-08: failed reports still reply to the source
