"""M0-19: real crash — kill the worker process, then recover from events."""

from __future__ import annotations

import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers.recovery import recover_and_resume

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
STEPS = 12


def _event_count(db: Path) -> int:
    for _ in range(20):
        try:
            conn = sqlite3.connect(str(db), timeout=5)
            try:
                return int(conn.execute("SELECT count(*) FROM events").fetchone()[0])
            finally:
                conn.close()
        except sqlite3.OperationalError:
            time.sleep(0.05)
    raise RuntimeError("database stayed locked")


def _wait_lease_expired(db: Path, timeout: float = 15.0) -> None:
    from polyopus.platform.queue import lease

    deadline = time.time() + timeout
    while time.time() < deadline:
        conn = sqlite3.connect(str(db), timeout=5)
        try:
            if lease.expired(conn):
                return
        finally:
            conn.close()
        time.sleep(0.1)
    raise AssertionError("lease did not expire in time")


def test_kill9_then_recover(tmp_path: Path) -> None:
    db = tmp_path / "kill9.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    conn.close()

    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "polyopus.workers.turn_worker",
            "--db",
            str(db),
            "--thread",
            "t1",
            "--turn",
            "tu1",
            "--steps",
            str(STEPS),
            "--delay",
            "0.3",
            "--lease",
            "2",
        ],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        deadline = time.time() + 20
        while time.time() < deadline and _event_count(db) < 3:
            time.sleep(0.05)
        assert _event_count(db) >= 3, "worker did not emit events"
        assert _event_count(db) < 1 + STEPS, "worker finished before the kill"
    finally:
        proc.kill()
        proc.wait(timeout=10)

    _wait_lease_expired(db)

    conn = m.connect(db)
    try:
        recovered = recover_and_resume(conn, EventStore(conn), owner="recovery", delay=0)
        assert len(recovered) == 1

        store = EventStore(conn)
        steps = [e.payload["idx"] for e in store.read("t1") if e.type == "step.completed"]
        assert steps == list(range(STEPS))

        types = [e.type for e in store.read("t1")]
        assert types.count("turn.completed") == 1
        assert types[-1] == "turn.completed"

        assert conn.execute("SELECT status FROM turns WHERE turn_id='tu1'").fetchone()[0] == (
            "completed"
        )
        attempts = [
            r[0] for r in conn.execute("SELECT attempt FROM runs ORDER BY attempt").fetchall()
        ]
        assert attempts == [1, 2]
    finally:
        conn.close()
