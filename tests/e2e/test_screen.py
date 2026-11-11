"""Slice ① through the real API: post turn -> engine thread -> approval -> finish."""

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
def client(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "screen.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as c:
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, c


def _wait_status(db: Path, turn_id: str, status: str, timeout: float = 15.0) -> None:
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
        time.sleep(0.1)
    raise AssertionError(f"turn did not reach {status}")


def _events(client: TestClient, thread_id: str, after: int) -> tuple[list[dict], int]:
    text = client.get(f"/api/v1/threads/{thread_id}/events?after_seq={after}").text
    out = []
    last = after
    for line in text.splitlines():
        if line.startswith("id: "):
            last = int(line[4:])
        if line.startswith("data: "):
            out.append(json.loads(line[6:]))
    return out, last


def test_index_serves_screen(client: tuple[Path, TestClient]) -> None:
    _, c = client
    # "/" serves the SPA build; the pre-SPA single-file UI lives at /legacy
    spa = c.get("/")
    assert spa.status_code == 200
    assert "id=\"root\"" in spa.text
    assert "/assets/" in spa.text
    assert spa.headers["cache-control"] == "no-store"

    response = c.get("/legacy")
    assert response.status_code == 200
    assert "PolyOpus" in response.text
    assert "approval" in response.text


def test_turn_runs_in_background_without_approval(client: tuple[Path, TestClient]) -> None:
    db, c = client
    thread_id = c.post("/api/v1/threads", json={"title": "t"}).json()["threadId"]
    turn_id = c.post(f"/api/v1/threads/{thread_id}/turns",
                     json={"content": "你好世界"}).json()["turnId"]
    _wait_status(db, turn_id, "completed")

    events, _ = _events(c, thread_id, 0)
    types = [e["type"] for e in events]
    assert "message.delta" in types
    assert types[-1] == "turn.finished"


def test_turn_with_risk_keyword_goes_through_approval(client: tuple[Path, TestClient]) -> None:
    db, c = client
    thread_id = c.post("/api/v1/threads", json={"title": "t"}).json()["threadId"]
    turn_id = c.post(f"/api/v1/threads/{thread_id}/turns",
                     json={"content": "帮我写配置文件"}).json()["turnId"]
    _wait_status(db, turn_id, "waiting_approval")

    inbox = c.get("/api/v1/attentions").json()["items"]
    assert len(inbox) == 1
    attention_id = inbox[0]["attentionId"]

    answer = c.post(f"/api/v1/attentions/{attention_id}/answer",
                    json={"decision": "approve"})
    assert answer.status_code == 200
    _wait_status(db, turn_id, "completed")

    events, _ = _events(c, thread_id, 0)
    types = [e["type"] for e in events]
    assert "approval.requested" in types
    assert "approval.resolved" in types
    assert types[-1] == "turn.finished"
