"""V05-11 人工消息恢复 Ticket (S8): a human message on a parked ticket's
execution thread resumes it (same Mandate, next assignment); an ended
ticket never resurrects; human turns never fan out.

covers: docs/48 V05-11 验收 — 暂停的 ticket 收到人消息 → 恢复；已 ended
的 → 新单。The TestClient lifespan runs the embedded workers (FakeModel).
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
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "resume.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _make_source(client: TestClient) -> tuple[dict, str]:
    response = client.post("/api/v1/sources", json={
        "name": "resume", "allow_actors": ["alice"],
        "explicit_patterns": ["/polyopus"],
        # V05-16: ticket turns now carry their ticket, so the V05-12 scope
        # gate is live for the write-intent approval flows.
        "default_scope": ["workspace:default", "fs:write"],
    })
    assert response.status_code == 201, response.text
    source = response.json()
    return source, str(source["secret"])


def _fire(client: TestClient, source: dict, secret: str, *,
          external: str, thread: str, text: str) -> dict:
    payload = {
        "external_id": external, "thread_key": thread,
        "actor": {"id": "alice"}, "text": text,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    sig = hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
    response = client.post(f"/api/v1/webhooks/{source['sourceId']}",
                           json=payload, headers={"X-Signature": sig})
    assert response.status_code == 202, response.text
    return response.json()


def _wait_bucket(db: Path, ticket_id: str, bucket: str,
                 timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = sqlite3.connect(str(db)).execute(
            "SELECT bucket FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
        if row is not None and row[0] == bucket:
            return
        time.sleep(0.15)
    raise AssertionError(f"ticket never reached bucket={bucket}")


# ---- 验收 1: 暂停的 ticket 收到人消息 → 恢复 -------------------------------


def test_parked_ticket_resumes_via_human_message_and_finishes(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    source, secret = _make_source(client)
    accepted = _fire(client, source, secret,
                     external="r1", thread="resume-1",
                     text="/polyopus 保存结果到 out.txt")
    ticket_id = str(accepted["ticketId"])
    _wait_bucket(db, ticket_id, "attention")  # write intent paused the turn

    response = client.post(f"/api/v1/tickets/{ticket_id}/messages", json={
        # wording matters: the FakeModel write-intent regex matches 写/保存/
        # write/save — this content must NOT re-trigger the approval pause
        "content": "/polyopus 请直接继续，不要落盘",
    })
    assert response.status_code == 202, response.text
    assert response.json()["resumed"] == "pending"

    # human turn completes (echo, no write intent) -> wake -> attempt 2 runs
    # WITH the human instruction -> ready -> done
    _wait_bucket(db, ticket_id, "done")

    conn = sqlite3.connect(str(db))
    try:
        assignments = conn.execute(
            "SELECT count(*) FROM assignments WHERE ticket_id = ?",
            (ticket_id,),
        ).fetchone()[0]
        mandate = conn.execute(
            "SELECT invalidated_at FROM mandates WHERE ticket_id = ?",
            (ticket_id,),
        ).fetchone()[0]
        report = conn.execute(
            "SELECT state FROM reports WHERE ticket_id = ? "
            "ORDER BY id DESC LIMIT 1", (ticket_id,),
        ).fetchone()[0]
        resumed = conn.execute(
            "SELECT payload_json FROM events WHERE type = 'ticket.resumed'"
        ).fetchall()
    finally:
        conn.close()
    assert assignments >= 2  # resumed with a NEW assignment (same Mandate)
    assert mandate is None
    assert report == "ready"
    assert len(resumed) == 1
    payload = json.loads(resumed[0][0])
    assert payload["ticket_id"] == ticket_id
    assert str(payload["by"]).startswith("us_")  # docs/11: id(u_)
    assert str(payload["input_id"]).startswith("msg_")


# ---- 验收 2: 已 ended 的 → 只记录，不复活；同 thread 新消息 → 新单 ------------


def test_ended_ticket_records_message_but_never_resumes(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    source, secret = _make_source(client)
    accepted = _fire(client, source, secret,
                     external="r2", thread="resume-2",
                     text="/polyopus 普通任务一次跑完")
    ticket_id = str(accepted["ticketId"])
    _wait_bucket(db, ticket_id, "done")

    response = client.post(f"/api/v1/tickets/{ticket_id}/messages", json={
        "content": "/polyopus 事后补充说明",
    })
    assert response.status_code == 202, response.text
    assert response.json()["resumed"] is False

    conn = sqlite3.connect(str(db))
    try:
        ticket = conn.execute(
            "SELECT state, bucket FROM tickets WHERE ticket_id = ?",
            (ticket_id,),
        ).fetchone()
        assignments = conn.execute(
            "SELECT count(*) FROM assignments WHERE ticket_id = ?",
            (ticket_id,),
        ).fetchone()[0]
        resumed = conn.execute(
            "SELECT count(*) FROM events WHERE type = 'ticket.resumed'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert ticket[0] == "ended" and ticket[1] == "done"
    assert assignments == 1  # no new assignment, no resurrection
    assert resumed == 0

    # same event thread, NEW message -> a NEW ticket (V05-10 release holds)
    follow = _fire(client, source, secret,
                   external="r2-follow", thread="resume-2",
                   text="/polyopus 跟进一个新任务")
    new_ticket = str(follow["ticketId"])
    assert new_ticket and new_ticket != ticket_id
    assert follow["disposition"] == "accepted"


# ---- 人类消息不经 intake：零扇出 ----------------------------------------------


def test_human_message_never_fans_out(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    source, secret = _make_source(client)
    accepted = _fire(client, source, secret,
                     external="r3", thread="resume-3",
                     text="/polyopus 保存结果到 out.txt")
    ticket_id = str(accepted["ticketId"])
    _wait_bucket(db, ticket_id, "attention")

    before = sqlite3.connect(str(db)).execute(
        "SELECT count(*) FROM triggers"
    ).fetchone()[0]
    response = client.post(f"/api/v1/tickets/{ticket_id}/messages", json={
        "content": "/polyopus 请直接继续",
    })
    assert response.status_code == 202
    _wait_bucket(db, ticket_id, "done")

    after = sqlite3.connect(str(db)).execute(
        "SELECT count(*) FROM triggers"
    ).fetchone()[0]
    assert after == before  # chat path structurally bypasses intake/fan-out


# ---- 门控钉住: 自动/审批 turn 完成不唤醒（防审批恢复死循环） -------------------


def test_approval_resume_turn_does_not_wake_the_ticket(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    source, secret = _make_source(client)
    accepted = _fire(client, source, secret,
                     external="r4", thread="resume-4",
                     text="/polyopus 保存结果到 out.txt")
    ticket_id = str(accepted["ticketId"])
    _wait_bucket(db, ticket_id, "attention")

    # approval attentions carry the paused turn, not the ticket id
    turn_id = sqlite3.connect(str(db)).execute(
        "SELECT turn_id FROM turns WHERE thread_id = ("
        "SELECT json_extract(payload_json,'$.thread_id') FROM timeline_events "
        "WHERE ticket_id = ? AND kind = 'execution_thread' ORDER BY id DESC LIMIT 1"
        ") ORDER BY id DESC LIMIT 1", (ticket_id,)
    ).fetchone()[0]
    inbox = client.get("/api/v1/attentions").json()["items"]
    approval = next(a for a in inbox if a["turnId"] == turn_id)
    response = client.post(f"/api/v1/attentions/{approval['attentionId']}/answer",
                           json={"decision": "approve"})
    assert response.status_code == 200, response.text  # resume ran to completion

    conn = sqlite3.connect(str(db))
    try:
        ticket = conn.execute(
            "SELECT bucket FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
        resumed = conn.execute(
            "SELECT count(*) FROM events WHERE type = 'ticket.resumed'"
        ).fetchone()[0]
    finally:
        conn.close()
    # known gap (documented in docs/48): approval completes the turn but does
    # not un-park the ticket; the human-message path owns the resume. The
    # assertion pins the gate so an auto turn can never loop the ticket.
    assert ticket[0] == "attention"
    assert resumed == 0
