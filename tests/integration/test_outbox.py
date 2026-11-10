"""M1-03: outbox leasing, per-topic caps, retry/dead-letter, no duplicates."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from polyopus.platform.db import migrator as m
from polyopus.platform.queue.outbox import Outbox, OutboxItem

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = m.connect(tmp_path / "t.db")
    m.apply(c, m.discover(MIGRATIONS))
    yield c
    c.close()


def test_enqueue_is_idempotent_on_event_id(conn: sqlite3.Connection) -> None:
    box = Outbox(conn)
    first = box.enqueue("default", "notify", {"a": 1}, event_id="ev_1")
    second = box.enqueue("default", "notify", {"a": 2}, event_id="ev_1")
    assert first == second
    assert conn.execute("SELECT count(*) FROM outbox").fetchone()[0] == 1


def test_lease_respects_per_topic_cap(conn: sqlite3.Connection) -> None:
    box = Outbox(conn)
    for i in range(5):
        box.enqueue("default", "assessment", {"i": i})
    for i in range(3):
        box.enqueue("default", "delivery", {"i": i})

    batch = box.lease_batch(limits={"assessment": 2, "delivery": 1}, default_limit=4)
    topics = sorted(item.topic for item in batch)
    assert topics == ["assessment", "assessment", "delivery"]

    second = box.lease_batch(limits={"assessment": 2, "delivery": 1})
    assert second == []  # both topics at cap while leases are active


def test_lease_expires_and_attempt_increments(conn: sqlite3.Connection) -> None:
    box = Outbox(conn)
    box.enqueue("default", "notify", {"x": 1})
    first = box.lease_batch(now=1000, lease_seconds=10)
    assert first[0].attempts == 1
    assert box.lease_batch(now=1005) == []

    again = box.lease_batch(now=1011, lease_seconds=10)
    assert again[0].attempts == 2


def test_dispatch_marks_sent_and_retries(conn: sqlite3.Connection) -> None:
    box = Outbox(conn)
    box.enqueue("default", "ok", {"x": 1}, event_id="e_ok")
    box.enqueue("default", "bad", {"x": 2}, event_id="e_bad")

    def handler(item: OutboxItem) -> None:
        if item.topic == "bad":
            raise RuntimeError("boom")

    stats = box.dispatch(handler, max_batches=1)
    assert stats["sent"] == 1
    assert stats["retried"] == 1
    assert conn.execute("SELECT status FROM outbox WHERE event_id='e_ok'").fetchone()[0] == "sent"
    assert conn.execute("SELECT status FROM outbox WHERE event_id='e_bad'").fetchone()[0] == (
        "pending"
    )


def test_dead_letter_after_max_attempts(conn: sqlite3.Connection) -> None:
    box = Outbox(conn)
    box.enqueue("default", "bad", {}, event_id="e_dead")

    def handler(_: OutboxItem) -> None:
        raise RuntimeError("always")

    for _ in range(6):
        conn.execute("UPDATE outbox SET next_retry_at = 0 WHERE status='pending'")
        conn.commit()
        box.dispatch(handler, max_batches=1, default_limit=1)

    assert conn.execute("SELECT status FROM outbox WHERE event_id='e_dead'").fetchone()[0] == (
        "failed"
    )


def test_concurrent_lease_has_no_duplicates(tmp_path: Path) -> None:
    db = tmp_path / "c.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    box = Outbox(conn)
    for i in range(10):
        box.enqueue("default", "work", {"i": i}, event_id=f"e_{i}")
    conn.close()

    leased: list[int] = []
    lock = threading.Lock()

    def worker() -> None:
        c = m.connect(db)
        try:
            b = Outbox(c)
            for item in b.lease_batch(default_limit=10, lease_seconds=60):
                with lock:
                    leased.append(item.id)
        finally:
            c.close()

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(leased) == 10
    assert len(set(leased)) == 10
