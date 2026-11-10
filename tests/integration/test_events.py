"""M0-13/14/15: event append, replay, projection rebuild."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from polyopus.platform.db import migrator as m
from polyopus.platform.events import projection
from polyopus.platform.events.store import EventStore

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = m.connect(tmp_path / "t.db")
    m.apply(c, m.discover(MIGRATIONS))
    yield c
    c.close()


def test_append_assigns_contiguous_seq(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    for i in range(50):
        event = store.append("t1", "step.completed", {"idx": i})
        assert event.seq == i + 1
    assert store.last_seq("t1") == 50
    assert store.count("t1") == 50


def test_seq_is_per_thread(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    assert store.append("t1", "turn.started", {}).seq == 1
    assert store.append("t2", "turn.started", {}).seq == 1
    assert store.append("t1", "turn.completed", {}).seq == 2


def test_read_after_seq_and_to_seq(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    for i in range(10):
        store.append("t1", "step.completed", {"idx": i})

    seqs = [e.seq for e in store.read("t1", after_seq=5)]
    assert seqs == [6, 7, 8, 9, 10]

    bounded = [e.seq for e in store.read("t1", after_seq=2, to_seq=5)]
    assert bounded == [3, 4, 5]

    batched = [e.seq for e in store.read("t1", batch=3)]
    assert batched == list(range(1, 11))


def test_payload_roundtrip(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    store.append("t1", "tool.completed", {"name": "读文件", "ok": True, "n": 3})
    event = next(store.read("t1"))
    assert event.payload == {"name": "读文件", "ok": True, "n": 3}


def test_projection_upsert_and_rebuild(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    store.append(
        "t1", "message.started", {"message_id": "m1", "role": "assistant", "content": ""}
    )
    store.append(
        "t1", "message.completed", {"message_id": "m1", "role": "assistant", "content": "hi"}
    )
    assert projection.rebuild(conn, store, "t1") == 2

    row = conn.execute("SELECT content, status FROM messages WHERE message_id = 'm1'").fetchone()
    assert row["content"] == "hi"
    assert row["status"] == "completed"

    # rebuild is idempotent
    projection.rebuild(conn, store, "t1")
    count = conn.execute("SELECT count(*) FROM messages WHERE thread_id = 't1'").fetchone()[0]
    assert count == 1


def test_rebuild_ignores_other_events(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    store.append("t1", "turn.started", {})
    store.append("t1", "step.completed", {"idx": 0})
    assert projection.rebuild(conn, store, "t1") == 0
    assert conn.execute("SELECT count(*) FROM messages").fetchone()[0] == 0
