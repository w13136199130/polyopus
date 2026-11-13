"""Scheduler loop (V05-14): the fourth embedded worker.

Polls `cron_jobs` on DB time and fires due jobs through intake (ADR-004).
All timing decisions live in `domains/intake/schedule.py::run_due` — this
loop only owns the poll cadence and survival, exactly like ticket_loop.
DB time + the CAS claim inside run_due make a second scheduler harmless.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable
from pathlib import Path

from polyopus.domains.intake import schedule
from polyopus.platform.events.store import EventStore
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.scheduler")

POLL_SECONDS = 1.0


def scheduler_once(conn: sqlite3.Connection) -> int:
    return schedule.run_due(conn, EventStore(conn))


def run_scheduler_loop(
    db_path_factory: Callable[[], Path], *, stop: threading.Event,
    poll_seconds: float = POLL_SECONDS,
) -> int:
    from polyopus.platform.db.migrator import connect

    fired = 0
    conn: sqlite3.Connection | None = None
    while not stop.is_set():
        try:
            if conn is None:
                conn = connect(db_path_factory())
            if scheduler_once(conn):
                fired += 1
                stop.wait(0)  # fire again immediately if more are due
                continue
            stop.wait(poll_seconds)
        except Exception as exc:  # noqa: BLE001 - the loop must survive
            tlog.log(logger, 40, "scheduler_error", error=str(exc))
            conn = None  # connection may be poisoned
            stop.wait(poll_seconds)
    if conn is not None:
        conn.close()
    return fired


def start_embedded(db_path_factory: Callable[[], Path]) -> threading.Event:
    stop = threading.Event()
    thread = threading.Thread(
        target=run_scheduler_loop,
        args=(db_path_factory,),
        kwargs={"stop": stop},
        name="scheduler-worker",
        daemon=True,
    )
    thread.start()
    return stop
