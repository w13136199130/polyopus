"""Slice ① end-to-end: stream -> approval pause -> answer -> resume.

Also proves the restart invariant: the approval survives a fresh connection
(events are the truth, the turn resumes after resolve).
"""

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
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "e2e.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _post_turn(client: TestClient, thread_id: str, content: str) -> str:
    response = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": content}
    )
    assert response.status_code == 202, response.text
    return response.json()["turnId"]


def _wait_status(db: Path, turn_id: str, status: str, timeout: float = 15.0) -> None:
    """The API launches the engine in a background thread; wait for the row."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        conn = sqlite3.connect(str(db), timeout=5)
        try:
            row = conn.execute(
                "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
            ).fetchone()
        finally:
            conn.close()
        if row and row[0] == status:
            return
        time.sleep(0.05)
    raise AssertionError(f"turn did not reach {status}")


def test_stream_to_completion(env: tuple[Path, TestClient]) -> None:
    db, client = env
    thread_id = client.post("/api/v1/threads", json={"title": "t"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "hello world again")
    _wait_status(db, turn_id, "completed")

    types = [
        line.split("data: ", 1)[1]
        for line in client.get(f"/api/v1/threads/{thread_id}/events?after_seq=0").text.splitlines()
        if line.startswith("data: ")
    ]
    seq_types = [json.loads(t)["type"] for t in types]
    assert seq_types[0] == "turn.queued"
    assert "message.delta" in seq_types
    assert seq_types[-1] == "turn.finished"
    deltas = sum(1 for t in seq_types if t == "message.delta")
    assert deltas >= 2  # streamed, not one blob

    messages = client.get(f"/api/v1/threads/{thread_id}/messages").json()["items"]
    assistant = [msg for msg in messages if msg["role"] == "assistant"]
    assert len(assistant) == 1
    assert "echo[hello]" in assistant[0]["content"]


def test_approval_pause_answer_resume(env: tuple[Path, TestClient]) -> None:
    db, client = env
    thread_id = client.post("/api/v1/threads", json={"title": "t2"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "write this file please")
    # "write" routes through the demo policy gate; the engine thread pauses
    _wait_status(db, turn_id, "waiting_approval")

    # turn is paused; the approval shows up in the inbox
    inbox = client.get("/api/v1/attentions").json()["items"]
    assert len(inbox) == 1
    attention_id = inbox[0]["attentionId"]
    assert inbox[0]["kind"] == "approval"

    conn = sqlite3.connect(str(db))
    status = conn.execute("SELECT status FROM turns WHERE turn_id=?", (turn_id,)).fetchone()[0]
    conn.close()
    assert status == "waiting_approval"

    # approve -> resume -> completed
    answer = client.post(f"/api/v1/attentions/{attention_id}/answer",
                         json={"decision": "approve"})
    assert answer.status_code == 200, answer.text

    conn = sqlite3.connect(str(db))
    final = conn.execute("SELECT status FROM turns WHERE turn_id=?", (turn_id,)).fetchone()[0]
    conn.close()
    assert final == "completed"

    stream = client.get(f"/api/v1/threads/{thread_id}/events?after_seq=0").text
    seq_types = [
        json.loads(line.split("data: ", 1)[1])["type"]
        for line in stream.splitlines()
        if line.startswith("data: ")
    ]
    assert "approval.requested" in seq_types
    assert "approval.resolved" in seq_types
    assert seq_types[-1] == "turn.finished"

    # answering twice is rejected
    again = client.post(f"/api/v1/attentions/{attention_id}/answer",
                        json={"decision": "deny"})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "ATTENTION_ALREADY_RESOLVED"


def test_denied_still_completes_the_turn(env: tuple[Path, TestClient]) -> None:
    db, client = env
    thread_id = client.post("/api/v1/threads", json={"title": "t3"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "dangerous write")
    _wait_status(db, turn_id, "waiting_approval")
    attention_id = client.get("/api/v1/attentions").json()["items"][0]["attentionId"]

    answer = client.post(f"/api/v1/attentions/{attention_id}/answer",
                         json={"decision": "deny"})
    assert answer.status_code == 200
    assert answer.json()["decision"] == "denied"

    conn = sqlite3.connect(str(db))
    final = conn.execute("SELECT status FROM turns WHERE turn_id=?", (turn_id,)).fetchone()[0]
    conn.close()
    assert final == "completed"
