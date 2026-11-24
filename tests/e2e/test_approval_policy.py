"""V05-16 approval policy: source whitelist, batch answers, expiry deny.

covers: docs/48 V05-16 验收 — 白名单工具不弹卡；越权工具仍 ask；
批量批准只处理选中项；过期自动 deny。
"""

from __future__ import annotations

import asyncio
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
from polyopus.workers import engine, ticket_loop

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
WRITE_TEXT = "/polyopus 保存结果到 out.txt"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    """No embedded workers: ticket tests drive run_assignment explicitly."""
    db = tmp_path / "approval.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


@pytest.fixture()
def chat_env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    """Embedded turn worker: chat approvals are produced by the real loop."""
    db = tmp_path / "approval_chat.db"
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
        "thread_key": f"ci-{time.time_ns()}",
        "text": WRITE_TEXT,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    sig = hmac.new(source["secret"].encode(), canonical, hashlib.sha256).hexdigest()
    response = client.post(
        f"/api/v1/webhooks/{source['sourceId']}", json=payload,
        headers={"X-Signature": sig},
    )
    ticket_id = response.json()["ticketId"]
    assert ticket_id, response.text
    return str(ticket_id)


def _run_ticket(db: Path, ticket_id: str, workspace: Path) -> str:
    conn = m.connect(db)
    try:
        return tickets.run_assignment(
            conn, EventStore(conn), ticket_id,
            content=WRITE_TEXT,
            engine_config=engine.EngineConfig(workspace=workspace),
        )
    finally:
        conn.close()


def _rows(db: Path, sql: str, *params: object) -> list[sqlite3.Row]:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _wait_status(db: Path, turn_id: str, status: str, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = _rows(db, "SELECT status FROM turns WHERE turn_id = ?", turn_id)
        if rows and rows[0][0] == status:
            return
        time.sleep(0.05)
    raise AssertionError(f"turn did not reach {status}")


def _post_turn(client: TestClient, thread_id: str, content: str) -> str:
    response = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": content}
    )
    assert response.status_code == 202, response.text
    return str(response.json()["turnId"])


def _approval_count(db: Path) -> int:
    return int(_rows(db, "SELECT count(*) FROM attentions "
                          "WHERE source_type = 'approval'")[0][0])


# ---- 验收 1: explicit whitelist -> no card, the tool runs -------------------


def test_whitelisted_tool_skips_the_approval_card(
    env: tuple[Path, TestClient], tmp_path: Path
) -> None:
    db, client = env
    workspace = tmp_path / "ws"
    workspace.mkdir()
    ticket_id = _open_ticket(
        client,
        defaultScope=["workspace:default", "fs:write"],
        autoApproveTools=["fs.write"],
        autoApproveMaxRisk="high",
    )

    assert _run_ticket(db, ticket_id, workspace) == "ready"
    assert _approval_count(db) == 0
    assert (workspace / "out.txt").exists()


def test_tool_outside_the_whitelist_still_asks(
    env: tuple[Path, TestClient], tmp_path: Path
) -> None:
    db, client = env
    workspace = tmp_path / "ws"
    workspace.mkdir()
    ticket_id = _open_ticket(
        client,
        defaultScope=["workspace:default", "fs:write"],
        autoApproveTools=["fs.read"],  # the write tool is NOT listed
    )

    assert _run_ticket(db, ticket_id, workspace) == "waiting"
    assert _approval_count(db) == 1
    payload = json.loads(
        _rows(db, "SELECT payload_json FROM attentions WHERE source_type = 'approval'")[0][0]
    )
    assert payload["actions"][0]["tool"] == "fs.write"


def test_risk_ceiling_keeps_high_risk_tools_asking(
    env: tuple[Path, TestClient], tmp_path: Path
) -> None:
    db, client = env
    workspace = tmp_path / "ws"
    workspace.mkdir()
    ticket_id = _open_ticket(
        client,
        defaultScope=["workspace:default", "fs:write"],
        autoApproveTools=["fs.write"],
        autoApproveMaxRisk="medium",  # fs.write is high -> still a human call
    )

    assert _run_ticket(db, ticket_id, workspace) == "waiting"
    assert _approval_count(db) == 1


def test_chat_turns_never_auto_approve(
    env: tuple[Path, TestClient], tmp_path: Path
) -> None:
    """The whitelist is source-scoped; a chat turn has no source and asks."""
    db, client = env
    workspace = tmp_path / "ws"
    workspace.mkdir()
    thread_id = client.post("/api/v1/threads", json={"title": "chat"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "write out.txt")

    conn = m.connect(db)
    try:
        state = asyncio.run(engine.run_turn(
            conn, EventStore(conn), turn_id,
            config=engine.EngineConfig(workspace=workspace),
        ))
    finally:
        conn.close()
    assert state == "waiting_approval"
    assert _approval_count(db) == 1


# ---- 验收 2: batch only answers the selected, same-class items --------------


def test_batch_answers_only_selected_approvals(
    chat_env: tuple[Path, TestClient]
) -> None:
    db, client = chat_env
    turn_ids = []
    for i in range(3):
        thread_id = client.post(
            "/api/v1/threads", json={"title": f"b{i}"}
        ).json()["threadId"]
        turn_ids.append(_post_turn(client, thread_id, f"write out{i}.txt"))
    for turn_id in turn_ids:
        _wait_status(db, turn_id, "waiting_approval")

    inbox = client.get("/api/v1/attentions").json()["items"]
    approval_ids = [item["attentionId"] for item in inbox if item["kind"] == "approval"]
    assert len(approval_ids) == 3

    response = client.post(
        "/api/v1/attentions/answer-batch",
        json={"attentionIds": approval_ids[:2], "decision": "approve"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 2
    assert {item["decision"] for item in body["items"]} == {"approved"}

    for turn_id in turn_ids[:2]:
        _wait_status(db, turn_id, "completed")
    _wait_status(db, turn_ids[2], "waiting_approval")
    pending = client.get("/api/v1/attentions").json()["items"]
    assert [item["attentionId"] for item in pending] == [approval_ids[2]]


def test_batch_rejects_mixed_action_classes(
    chat_env: tuple[Path, TestClient]
) -> None:
    db, client = chat_env
    thread_id = client.post("/api/v1/threads", json={"title": "mix"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "write mix.txt")
    _wait_status(db, turn_id, "waiting_approval")
    approval = client.get("/api/v1/attentions").json()["items"][0]

    # A non-approval attention of the same tenant must not join an approval batch.
    conn = m.connect(db)
    try:
        now = int(time.time())
        conn.execute(
            "INSERT INTO attentions (tenant_id, attention_id, ticket_id, turn_id,"
            " kind, source_type, source_id, payload_json, status, expires_at,"
            " created_at) VALUES ('default', 'at_blocked', 'tk_x', NULL,"
            " 'blocked', 'ticket', 'tk_x', '{}', 'pending', ?, ?)",
            (now + 600, now),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.post(
        "/api/v1/attentions/answer-batch",
        json={"attentionIds": [approval["attentionId"], "at_blocked"],
              "decision": "approve"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "DECISION_INVALID"
    # validation ran before mutation: the approval is still pending
    still = client.get("/api/v1/attentions").json()["items"]
    assert approval["attentionId"] in [item["attentionId"] for item in still]


# ---- 验收 3: expiry auto-denies and finishes the turn ----------------------


def test_expired_approval_auto_denies_and_resumes(
    env: tuple[Path, TestClient], tmp_path: Path
) -> None:
    db, client = env
    workspace = tmp_path / "ws"
    workspace.mkdir()
    thread_id = client.post("/api/v1/threads", json={"title": "exp"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "write exp.txt")

    conn = m.connect(db)
    try:
        state = asyncio.run(engine.run_turn(
            conn, EventStore(conn), turn_id,
            config=engine.EngineConfig(workspace=workspace),
        ))
        assert state == "waiting_approval"
        conn.execute(
            "UPDATE approvals SET expires_at = ? WHERE status = 'pending'",
            (int(time.time()) - 1,),
        )
        conn.commit()
        resumed = ticket_loop.expire_pending_approvals(conn)
    finally:
        conn.close()

    assert resumed == 1
    assert _rows(db, "SELECT status FROM approvals")[0][0] == "expired"
    attention = _rows(db, "SELECT status FROM attentions WHERE source_type='approval'")
    assert attention[0][0] == "expired"
    assert _rows(db, "SELECT status FROM turns WHERE turn_id = ?", turn_id)[0][0] == "completed"
    events = _rows(
        db, "SELECT payload_json FROM events WHERE type = 'approval.resolved'"
    )
    assert json.loads(events[-1][0])["decision"] == "expired"


def test_expired_ticket_approval_also_closes_the_ticket(
    env: tuple[Path, TestClient], tmp_path: Path
) -> None:
    """A ticket must not outlive its approval: expiry denies the turn AND
    ends the ticket, otherwise it waits forever with no decision to make."""
    db, client = env
    workspace = tmp_path / "ws"
    workspace.mkdir()
    ticket_id = _open_ticket(client, defaultScope=["workspace:default", "fs:write"])
    assert _run_ticket(db, ticket_id, workspace) == "waiting"

    conn = m.connect(db)
    try:
        conn.execute(
            "UPDATE approvals SET expires_at = ? WHERE status = 'pending'",
            (int(time.time()) - 1,),
        )
        conn.commit()
        resumed = ticket_loop.expire_pending_approvals(conn)
    finally:
        conn.close()

    assert resumed == 1
    row = _rows(db, "SELECT state, bucket FROM tickets WHERE ticket_id = ?", ticket_id)[0]
    assert (row["state"], row["bucket"]) == ("ended", "done")
    report = _rows(db, "SELECT summary FROM reports WHERE ticket_id = ?", ticket_id)[-1]
    assert "过期" in report["summary"]
