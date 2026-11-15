"""V05-17 async tools: start returns, worker stays free, result returns.

covers: docs/48 V05-17 验收 — 10s 工具执行中 worker 仍能处理另一 turn；
结果回原 turn；超时/取消可观测。
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.kernel.tools import DEMO_SLEEP_SPEC, GATEWAY_SPECS
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.workers import async_tools
from polyopus.workers.worker_loop import run_worker_loop

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, Path, TestClient]]:
    db = tmp_path / "async.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False,
                        workspace_dir=workspace)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, workspace, client


def _post_turn(client: TestClient, thread_id: str, content: str) -> str:
    response = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": content}
    )
    assert response.status_code == 202, response.text
    return str(response.json()["turnId"])


def _rows(db: Path, sql: str, *params: object) -> list[sqlite3.Row]:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _run_workers(db: Path, max_turns: int) -> int:
    stop = threading.Event()
    try:
        return run_worker_loop(lambda: db, stop=stop, max_turns=max_turns)
    finally:
        stop.set()


def _wait_event(
    db: Path, turn_id: str, event_type: str, timeout: float = 15.0
) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = _rows(
            db,
            "SELECT payload_json FROM events WHERE type = ? "
            "AND turn_id = ? ORDER BY id DESC LIMIT 1",
            event_type, turn_id,
        )
        if rows:
            return json.loads(rows[0]["payload_json"])
        time.sleep(0.05)
    raise AssertionError(f"no {event_type} for {turn_id}")


# ---- acceptance: a 10s async tool does not block the worker -----------------


def test_async_tool_does_not_block_the_worker_and_returns_to_same_turn(
    env: tuple[Path, Path, TestClient]
) -> None:
    db, _workspace, client = env
    thread_a = client.post("/api/v1/threads", json={"title": "a"}).json()["threadId"]
    thread_b = client.post("/api/v1/threads", json={"title": "b"}).json()["threadId"]
    turn_a = _post_turn(client, thread_a, "异步工具 10 秒")
    turn_b = _post_turn(client, thread_b, "hello while the tool runs")

    started = time.monotonic()
    processed = _run_workers(db, max_turns=2)
    elapsed = time.monotonic() - started

    assert processed == 2
    assert elapsed < 5, f"worker blocked for {elapsed:.1f}s by the async tool"
    statuses = {
        str(row["turn_id"]): str(row["status"])
        for row in _rows(db, "SELECT turn_id, status FROM turns")
    }
    assert statuses[turn_a] == "completed"
    assert statuses[turn_b] == "completed"

    # The job was still running when both turns finished; its result lands
    # later on the original turn (turn_id, no continuation turn).
    payload = _wait_event(db, turn_a, "tool.async_completed", timeout=15.0)
    assert payload["output"] == {"slept_seconds": 10.0}
    event = _rows(
        db,
        "SELECT turn_id FROM events WHERE type = 'tool.async_completed' "
        "AND turn_id = ? ORDER BY id DESC LIMIT 1",
        turn_a,
    )[0]
    assert event["turn_id"] == turn_a  # result stays on the original turn
    row = _rows(db, "SELECT status, result_json FROM tool_calls WHERE turn_id = ?",
                turn_a)[0]
    assert row["status"] == "completed"
    assert json.loads(row["result_json"]) == {"slept_seconds": 10.0}


# ---- timeout is observable --------------------------------------------------


def test_async_timeout_is_recorded_and_emitted(
    env: tuple[Path, Path, TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    db, _workspace, client = env
    monkeypatch.setitem(
        GATEWAY_SPECS, "demo.sleep", replace(DEMO_SLEEP_SPEC, timeout_seconds=0.2)
    )
    thread_id = client.post("/api/v1/threads", json={"title": "t"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "异步 2 秒")

    assert _run_workers(db, max_turns=1) == 1
    payload = _wait_event(db, turn_id, "tool.failed", timeout=5.0)
    assert payload["code"] == "timeout"
    row = _rows(db, "SELECT status, error_code FROM tool_calls WHERE turn_id = ?",
                turn_id)[0]
    assert (row["status"], row["error_code"]) == ("failed", "timeout")


# ---- cancellation wins the race and does not get overwritten -----------------


def test_async_cancel_is_observable_and_terminal(
    env: tuple[Path, Path, TestClient]
) -> None:
    db, _workspace, client = env
    thread_id = client.post("/api/v1/threads", json={"title": "c"}).json()["threadId"]
    turn_id = _post_turn(client, thread_id, "异步 1 秒")
    assert _run_workers(db, max_turns=1) == 1

    handle = str(_rows(
        db, "SELECT tool_call_id FROM tool_calls WHERE turn_id = ?", turn_id
    )[0]["tool_call_id"])
    conn = m.connect(db)
    try:
        assert async_tools.cancel_async(conn, EventStore(conn), handle) is True
    finally:
        conn.close()

    payload = _wait_event(db, turn_id, "tool.async_cancelled", timeout=5.0)
    assert payload["reason"] == "cancelled by user"

    # The runner thread wakes up later; the CAS must not overwrite the cancel.
    time.sleep(1.5)
    row = _rows(db, "SELECT status, error_code FROM tool_calls WHERE tool_call_id = ?",
                handle)[0]
    assert (row["status"], row["error_code"]) == ("failed", "cancelled")
    events = _rows(
        db,
        "SELECT type FROM events WHERE turn_id = ? AND type IN "
        "('tool.async_completed', 'tool.failed', 'tool.async_cancelled')",
        turn_id,
    )
    assert [str(e["type"]) for e in events] == ["tool.async_cancelled"]
