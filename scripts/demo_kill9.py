"""End-to-end crash demo (M0-21).

Runs a fake turn in a child process, kills it, waits for the lease to expire,
then recovers and prints the event chain.

    uv run python scripts/demo_kill9.py
"""

from __future__ import annotations

import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from polyopus.platform.db import migrator as m  # noqa: E402
from polyopus.platform.events.store import EventStore  # noqa: E402
from polyopus.platform.queue import lease  # noqa: E402
from polyopus.platform.telemetry import log as tlog  # noqa: E402
from polyopus.workers.recovery import recover_and_resume  # noqa: E402

STEPS = 12
DELAY = 0.3
LEASE = 2
KILL_AFTER = 3


def _count(db: Path) -> int:
    conn = sqlite3.connect(str(db), timeout=5)
    try:
        return int(conn.execute("SELECT count(*) FROM events").fetchone()[0])
    finally:
        conn.close()


def _wait_expired(db: Path, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        conn = sqlite3.connect(str(db), timeout=5)
        try:
            if lease.expired(conn):
                return
        finally:
            conn.close()
        time.sleep(0.1)
    raise SystemExit("lease did not expire")


def main() -> int:
    tlog.configure()
    tlog.set_trace_id(tlog.new_trace_id())
    with tempfile.TemporaryDirectory(prefix="poly-m0-") as tmp:
        db = Path(tmp) / "demo.db"
        conn = m.connect(db)
        m.apply(conn, m.discover(ROOT / "migrations"))
        conn.close()

        print(f"[1/4] db ready: {db}")
        proc = subprocess.Popen(
            [
                sys.executable, "-m", "polyopus.workers.turn_worker",
                "--db", str(db), "--thread", "t1", "--turn", "tu1",
                "--steps", str(STEPS), "--delay", str(DELAY), "--lease", str(LEASE),
            ],
            cwd=ROOT,
        )
        try:
            deadline = time.time() + 20
            while time.time() < deadline and _count(db) < KILL_AFTER:
                time.sleep(0.05)
            print(f"[2/4] events before kill: {_count(db)} — killing pid {proc.pid}")
        finally:
            proc.kill()
            proc.wait(timeout=10)

        _wait_expired(db)
        print("[3/4] lease expired")

        conn = m.connect(db)
        try:
            recovered = recover_and_resume(
                conn, EventStore(conn), owner="demo-recovery", delay=0
            )
        finally:
            conn.close()

        conn = sqlite3.connect(str(db))
        try:
            rows = conn.execute(
                "SELECT seq, type FROM events WHERE thread_id='t1' ORDER BY seq"
            ).fetchall()
            status = conn.execute(
                "SELECT status FROM turns WHERE turn_id='tu1'"
            ).fetchone()[0]
            attempts = [
                r[0] for r in conn.execute("SELECT attempt FROM runs ORDER BY attempt")
            ]
        finally:
            conn.close()

        print(f"[4/4] recovered={len(recovered)} attempts={attempts} turn={status}")
        for seq, type_ in rows:
            print(f"  {seq:>3}  {type_}")

        steps = [r for r in rows if r[1] == "step.completed"]
        assert len(recovered) == 1
        assert len(steps) == STEPS
        assert status == "completed"
        print(f"\nOK: {STEPS} steps, no gaps, one turn.completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
