"""V05-19 audit & replay: gate/assessment/reply/stop are queryable by ticket.

covers: docs/48 V05-19 验收 — 每条 filtered/assessment/reply/stop 都能按
ticket 查到；导出 CSV 行数一致；审计失败不阻塞业务。
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.audit import service as audit
from polyopus.domains.intake import assessment
from polyopus.domains.intake import service as intake
from polyopus.domains.outbound.port import DeliveryResult
from polyopus.domains.tickets import service as tickets
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.platform.queue.outbox import Outbox
from polyopus.workers import outbox_loop

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = m.connect(tmp_path / "audit.db")
    m.apply(c, m.discover(MIGRATIONS))
    yield c
    c.close()


def _source(
    conn: sqlite3.Connection,
    source_id: str = "src_a",
    **config: Any,
) -> sqlite3.Row:
    cfg = {
        "secret": "",
        "allow_actors": ["alice"],
        "explicit_patterns": ["/polyopus"],
        **config,
    }
    now = int(time.time())
    conn.execute(
        "INSERT INTO sources (tenant_id, source_id, kind, name, config_json,"
        " status, created_at, updated_at)"
        " VALUES ('default', ?, 'webhook', ?, ?, 'active', ?, ?)",
        (source_id, source_id, json.dumps(cfg), now, now),
    )
    conn.commit()
    return conn.execute(
        "SELECT * FROM sources WHERE source_id = ?", (source_id,)
    ).fetchone()


def _fire(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    *,
    actor: str = "alice",
    text: str = "/polyopus 修复构建",
    external: str | None = None,
) -> tuple[str, str | None]:
    trigger_id, _, _ = intake.receive(
        conn, store, source,
        {"external_id": external or f"e-{time.time_ns()}",
         "thread_key": f"t-{time.time_ns()}", "actor": {"id": actor},
         "text": text},
        None,
    )
    return trigger_id, intake.process(conn, store, source, trigger_id)


def _seed_ticket(
    conn: sqlite3.Connection,
    *,
    ticket_id: str = "tk_a",
    source_id: str = "src_a",
    thread_id: str = "th_a",
) -> None:
    now = int(time.time())
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at)"
        " VALUES ('default', ?, 'system', 'a', 'active', ?, ?)",
        (thread_id, now, now),
    )
    conn.execute(
        "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
        " source_id, strength, policy_version, scope_json, cost_micros,"
        " created_at, updated_at)"
        " VALUES ('default', ?, 'audit', 'open', 'running', ?, 'explicit', 1,"
        " '[\"workspace:default\"]', 0, ?, ?)",
        (ticket_id, source_id, now, now),
    )
    conn.execute(
        "INSERT INTO timeline_events (event_id, tenant_id, ticket_id, kind,"
        " title, actor, payload_json, created_at)"
        " VALUES (?, 'default', ?, 'execution_thread', 'thread', 'system', ?, ?)",
        (f"tl_{ticket_id}", ticket_id, json.dumps({"thread_id": thread_id}), now),
    )
    conn.commit()


# ---- append-only service: redaction, filtering, failure isolation -----------


def test_record_redacts_and_filters(conn: sqlite3.Connection) -> None:
    audit_id = audit.record(
        conn,
        action="gate.filtered",
        result="denied",
        actor_id="u_alice",
        resource_type="trigger",
        resource_id="tr_1",
        ticket_id="tk_1",
        detail={
            "secret": "s3cr3t",
            "apiKey": "k-123",
            "path": "E:\\secret\\file.txt",
            "nested": {"password": "p", "thread": "t-1"},
        },
    )
    assert audit_id is not None
    items = audit.query(conn, actor_id="u_alice", action="gate.filtered")
    assert len(items) == 1
    detail = items[0]["detail"]
    assert detail["secret"] == "[redacted]"
    assert detail["apiKey"] == "[redacted]"
    assert detail["nested"]["password"] == "[redacted]"
    assert detail["path"] == "[path]"
    assert items[0]["ticketId"] == "tk_1"


def test_audit_failure_never_raises(conn: sqlite3.Connection) -> None:
    conn.execute("DROP TABLE audit_log")
    conn.commit()
    assert audit.record(conn, action="x", result="ok") is None  # logged, no raise


# ---- gate (filtered + accepted) is reachable from the ticket ---------------


def test_gate_filtered_writes_audit(conn: sqlite3.Connection) -> None:
    source = _source(conn)
    trigger_id, ticket = _fire(conn, EventStore(conn), source, actor="bob")
    assert ticket is None
    items = audit.query(conn, action="gate.filtered", actor_id="bob")
    assert len(items) == 1
    assert items[0]["resourceId"] == trigger_id
    assert items[0]["detail"]["reason"] == "actor_not_allowed"


def test_gate_and_assessment_are_reachable_by_ticket(
    conn: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_assess(conn: sqlite3.Connection, store: EventStore,
                    source: sqlite3.Row, trigger: sqlite3.Row,
                    **_kwargs: object) -> assessment.AssessResult:
        return assessment.AssessResult(
            status="decided", decision="accept", strength="inferred",
            scope=("workspace:default",), eval_id="ev_1", confidence=0.9,
        )

    monkeypatch.setattr(assessment, "run_for_trigger", fake_assess)
    source2 = _source(conn, source_id="src_b", assessment="auto")
    _trigger2, ticket_id = _fire(conn, EventStore(conn), source2)
    assert ticket_id
    items = audit.query(conn, ticket_id=ticket_id, order="asc")
    actions = [item["action"] for item in items]
    assert "gate.accepted" in actions
    assert "assessment.decided" in actions
    assert {item["ticketId"] for item in items if item["ticketId"]} == {ticket_id}


# ---- reply delivery outcome -------------------------------------------------


class _OkTransport:
    def post(self, url: str, body: bytes, headers: dict[str, str], *,
             timeout: float) -> DeliveryResult:
        return DeliveryResult(status_code=200, ok=True)


def test_reply_outcome_is_audited_by_ticket(conn: sqlite3.Connection) -> None:
    _source(conn, callback_url="http://127.0.0.1:9/hook")
    _seed_ticket(conn)
    payload = {
        "kind": "reply",
        "sourceId": "src_a",
        "ticketId": "tk_a",
        "reportId": "rp_a",
        "title": "t",
        "summary": "done",
        "link": "http://127.0.0.1:8000/tasks?ticketId=tk_a",
        "idemKey": "reply:tk_a:rp_a",
    }
    Outbox(conn).enqueue("default", "reply", payload, event_id="reply:tk_a:rp_a")
    stats = outbox_loop.dispatch_once(conn, _OkTransport())

    assert stats["sent"] == 1
    items = audit.query(conn, ticket_id="tk_a", action="reply.sent")
    assert len(items) == 1
    assert items[0]["ticketId"] == "tk_a"
    assert items[0]["detail"]["reportId"] == "rp_a"


# ---- human stop -------------------------------------------------------------


def test_stop_is_audited_by_ticket(conn: sqlite3.Connection) -> None:
    _source(conn)
    _seed_ticket(conn)
    store = EventStore(conn)
    tickets.stop(conn, store, "tk_a", by="us_admin")

    items = audit.query(conn, ticket_id="tk_a", action="ticket.stop")
    assert len(items) == 1
    assert items[0]["actorId"] == "us_admin"
    assert items[0]["result"] == "ok"


# ---- read-only API + CSV row count -----------------------------------------


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "audit_api.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    for i in range(3):
        audit.record(
            conn, action="ticket.stop", result="ok", actor_id="us_admin",
            resource_type="ticket", resource_id=f"tk_{i}", ticket_id=f"tk_{i}",
            detail={"index": i},
        )
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as c:
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, c


def test_audit_api_filters_and_csv_row_count(
    client: tuple[Path, TestClient]
) -> None:
    _db, c = client
    listed = c.get("/api/v1/admin/audit", params={"action": "ticket.stop"})
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert len(items) == 3

    csv_response = c.get("/api/v1/admin/audit/export",
                         params={"action": "ticket.stop", "format": "csv"})
    assert csv_response.status_code == 200
    assert csv_response.headers["content-type"].startswith("text/csv")
    lines = csv_response.text.strip().splitlines()
    assert len(lines) == len(items) + 1  # header + one row per audit item

    as_json = c.get("/api/v1/admin/audit/export",
                    params={"action": "ticket.stop", "format": "json"})
    assert as_json.status_code == 200
    assert len(as_json.json()["items"]) == 3
