"""Delegation worker: start member child turns and finalize finished ones.

The orchestration service owns the state machine; this loop only claims due
`pending` rows (one child thread/turn per member) and closes `running` rows
whose child turn reached a terminal status. The turn itself is executed by
the existing turn worker, so approvals/cancel semantics stay in one place.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable
from pathlib import Path

from polyopus.domains.orchestration import service as orchestration
from polyopus.platform.events.store import EventStore
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.orchestration")

POLL_SECONDS = 1.0


def process_once(conn: sqlite3.Connection) -> dict[str, int]:
    store = EventStore(conn)
    claimed = orchestration.claim_pending(conn, limit=5)
    started = 0
    for row in claimed:
        try:
            orchestration.start_claimed(conn, store, row)
            started += 1
        except Exception as exc:  # noqa: BLE001 - one dispatch must not wedge
            tlog.log(
                logger, 40, "delegation.start_failed",
                delegation_id=str(row["delegation_id"]), error=str(exc),
            )
    finished = orchestration.observe_running(conn, store)
    return {"started": started, "finished": finished}


def run_delegations_loop(
    db_path_factory: Callable[[], Path],
    *,
    stop: threading.Event,
    poll_seconds: float = POLL_SECONDS,
    max_batches: int | None = None,
) -> int:
    from polyopus.platform.db.migrator import connect

    batches = 0
    conn = None
    try:
        while not stop.is_set() and (max_batches is None or batches < max_batches):
            try:
                if conn is None:
                    conn = connect(db_path_factory())
                process_once(conn)
                batches += 1
            except Exception as exc:  # noqa: BLE001 - the loop must survive
                tlog.log(logger, 40, "delegation.worker_error", error=str(exc))
                conn = None
            stop.wait(poll_seconds)
    finally:
        if conn is not None:
            conn.close()
    return batches


def start_embedded(db_path_factory: Callable[[], Path]) -> threading.Event:
    stop = threading.Event()
    thread = threading.Thread(
        target=run_delegations_loop,
        args=(db_path_factory,),
        kwargs={"stop": stop},
        name="delegations-worker",
        daemon=True,
    )
    thread.start()
    return stop
