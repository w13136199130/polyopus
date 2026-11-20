"""Turn actions: stop, regenerate, edit-and-resend, message-level branch."""

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


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "turns.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(
        db_path=db,
        secret_key="s",
        access_ttl_seconds=3600,
        session_ttl_seconds=86400,
        embedded_worker=False,
    )
    with TestClient(create_app(settings)) as test_client:
        test_client.post(
            "/api/v1/auth/login", json={"username": "admin", "password": "p"}
        )
        yield test_client


def _thread(client: TestClient) -> str:
    return client.post("/api/v1/threads", json={"title": "t"}).json()["threadId"]


def _turn(client: TestClient, thread_id: str, content: str = "问题") -> str:
    response = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": content}
    )
    assert response.status_code == 202, response.text
    return response.json()["turnId"]


def _complete(thread_id: str, turn_id: str, tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "turns.db")
    conn.execute(
        "UPDATE turns SET status = 'completed' WHERE turn_id = ?", (turn_id,)
    )
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
        " content, status, seq, created_at, updated_at)"
        " VALUES ('default', ?, ?, ?, 'assistant', '旧回答', 'completed', 99, 1, 1)",
        (f"msg_a_{turn_id}", thread_id, turn_id),
    )
    conn.commit()
    conn.close()


def test_stop_queued_turn_is_immediate(client: TestClient) -> None:
    thread_id = _thread(client)
    turn_id = _turn(client, thread_id)
    response = client.post(
        f"/api/v1/threads/{thread_id}/turns/{turn_id}/stop"
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    trace = client.get(f"/api/v1/threads/{thread_id}/trace").json()["items"]
    assert any(
        item["type"] == "turn.finished"
        and item["payload"].get("status") == "cancelled"
        for item in trace
    )


def test_stop_running_turn_requests_cooperative_cancel(client: TestClient, tmp_path: Path) -> None:
    thread_id = _thread(client)
    turn_id = _turn(client, thread_id)
    conn = m.connect(tmp_path / "turns.db")
    conn.execute("UPDATE turns SET status = 'running' WHERE turn_id = ?", (turn_id,))
    conn.commit()
    conn.close()
    response = client.post(f"/api/v1/threads/{thread_id}/turns/{turn_id}/stop")
    assert response.json()["status"] == "cancelling"
    conn = m.connect(tmp_path / "turns.db")
    status = conn.execute(
        "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()[0]
    conn.close()
    assert status == "cancel_requested"


def test_stop_waiting_approval_resolves_attention(client: TestClient, tmp_path: Path) -> None:
    thread_id = _thread(client)
    turn_id = _turn(client, thread_id)
    conn = m.connect(tmp_path / "turns.db")
    conn.execute(
        "UPDATE turns SET status = 'waiting_approval' WHERE turn_id = ?", (turn_id,)
    )
    conn.execute(
        "INSERT INTO approvals (tenant_id, approval_id, turn_id, run_id, step_idx,"
        " request_json, status, created_at) VALUES"
        " ('default','ap_1',?,'run_1',0,'{}','pending',1)",
        (turn_id,),
    )
    conn.execute(
        "INSERT INTO attentions (tenant_id, attention_id, ticket_id, turn_id, kind,"
        " source_type, source_id, payload_json, status, created_at)"
        " VALUES ('default','at_1',NULL,?,'approval','approval','ap_1','{}','pending',1)",
        (turn_id,),
    )
    conn.commit()
    conn.close()

    response = client.post(f"/api/v1/threads/{thread_id}/turns/{turn_id}/stop")
    assert response.json()["status"] == "cancelled"
    conn = m.connect(tmp_path / "turns.db")
    assert conn.execute(
        "SELECT status FROM attentions WHERE attention_id = 'at_1'"
    ).fetchone()[0] == "resolved"
    assert conn.execute(
        "SELECT status FROM approvals WHERE approval_id = 'ap_1'"
    ).fetchone()[0] == "expired"
    conn.close()


def test_regenerate_soft_deletes_old_answer_and_requeues(client: TestClient, tmp_path: Path) -> None:
    thread_id = _thread(client)
    turn_id = _turn(client, thread_id)
    _complete(thread_id, turn_id, tmp_path)
    response = client.post(
        f"/api/v1/threads/{thread_id}/turns/{turn_id}/regenerate"
    )
    assert response.status_code == 202, response.text
    conn = m.connect(tmp_path / "turns.db")
    turn = conn.execute(
        "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()[0]
    old = conn.execute(
        "SELECT deleted_at FROM messages WHERE message_id = ?",
        (f"msg_a_{turn_id}",),
    ).fetchone()[0]
    conn.close()
    assert turn == "queued"
    assert old is not None


def test_edit_latest_user_message_and_requeue(client: TestClient, tmp_path: Path) -> None:
    thread_id = _thread(client)
    turn_id = _turn(client, thread_id, "旧问题")
    _complete(thread_id, turn_id, tmp_path)
    response = client.post(
        f"/api/v1/threads/{thread_id}/turns/{turn_id}/edit",
        json={"content": "新问题"},
    )
    assert response.status_code == 202, response.text
    messages = client.get(f"/api/v1/threads/{thread_id}/messages").json()["items"]
    user = next(item for item in messages if item["role"] == "user")
    assert user["content"] == "新问题"
    trace = client.get(f"/api/v1/threads/{thread_id}/trace").json()["items"]
    assert any(item["type"] == "turn.requeued" for item in trace)


def test_message_branch_copies_only_up_to_that_message(client: TestClient) -> None:
    thread_id = _thread(client)
    first = _turn(client, thread_id, "第一问")
    # a second user turn marks the branch point boundary
    second_turn = _turn(client, thread_id, "第二问")
    messages = client.get(f"/api/v1/threads/{thread_id}/messages").json()["items"]
    first_user = next(m for m in messages if m["turnId"] == first)
    response = client.post(
        f"/api/v1/threads/{thread_id}/branch",
        json={"messageId": first_user["messageId"]},
    )
    assert response.status_code == 201, response.text
    clone = response.json()
    copied = client.get(
        f"/api/v1/threads/{clone['threadId']}/messages"
    ).json()["items"]
    assert [m["content"] for m in copied] == ["第一问"]
    assert second_turn != first
