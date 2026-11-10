"""M0-18: expired-lease recovery produces a new attempt and resumes."""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import turn_worker
from polyopus.workers.recovery import recover_and_resume, recover_expired

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
STEPS = 6


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = m.connect(tmp_path / "t.db")
    m.apply(c, m.discover(MIGRATIONS))
    yield c
    c.close()


def _crash_after(conn: sqlite3.Connection, done: int) -> tuple[str, str]:
    store = EventStore(conn)
    thread, turn = "t1", "tu1"
    run_id = turn_worker.start_run(
        conn, store, thread, turn, STEPS, owner="w1", lease_ttl=60
    )
    for idx in range(done):
        store.append(
            thread, "step.completed", {"idx": idx}, turn_id=turn, run_id=run_id
        )
    conn.execute(
        "UPDATE runs SET last_step_idx = ?, lease_until = ? WHERE run_id = ?",
        (done - 1, int(time.time()) - 10, run_id),
    )
    conn.commit()
    return thread, turn


def test_nothing_to_recover(conn: sqlite3.Connection) -> None:
    assert recover_expired(conn, EventStore(conn), owner="w2") == []


def test_recover_creates_next_attempt(conn: sqlite3.Connection) -> None:
    thread, turn = _crash_after(conn, done=2)
    recovered = recover_expired(conn, EventStore(conn), owner="w2")

    assert len(recovered) == 1
    item = recovered[0]
    assert (item.turn_id, item.attempt, item.from_step) == (turn, 2, 2)

    runs = conn.execute(
        "SELECT run_id, attempt, status, last_step_idx FROM runs ORDER BY attempt"
    ).fetchall()
    assert [r["attempt"] for r in runs] == [1, 2]
    assert runs[0]["status"] == "failed"
    assert runs[1]["status"] == "running"
    assert runs[1]["last_step_idx"] == 1


def test_resume_finishes_without_duplicating_steps(conn: sqlite3.Connection) -> None:
    thread, turn = _crash_after(conn, done=2)
    recover_and_resume(conn, EventStore(conn), owner="w2", delay=0)

    status = conn.execute("SELECT status FROM turns WHERE turn_id = ?", (turn,)).fetchone()[0]
    assert status == "completed"

    store = EventStore(conn)
    steps = [e.payload["idx"] for e in store.read(thread) if e.type == "step.completed"]
    assert steps == list(range(STEPS))

    types = [e.type for e in store.read(thread)]
    assert types.count("turn.resumed") == 1
    assert types.count("turn.completed") == 1
    assert types[-1] == "turn.completed"

    messages = conn.execute("SELECT count(*) FROM messages WHERE thread_id = ?", (thread,)).fetchone()
    assert messages[0] == 1
