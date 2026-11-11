"""Queue-driven turn worker (v0.1 card 2, retires L-3).

`turns.status='queued'` IS the queue. The loop claims one turn at a time
(parallelism lives across tickets/threads, not within one turn — docs/09
§8.1); double-claims lose to UNIQUE(turn_id, attempt) -> THREAD_TURN_ACTIVE.
Runs as an embedded thread behind `poly serve` (default) or standalone
`poly worker` for a separate process.
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Callable
from pathlib import Path
from sqlite3 import Connection

from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.worker")

POLL_SECONDS = 0.2


def _workspace() -> Path:
    from polyopus.config import load_settings

    path = load_settings().workspace_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def claim_next(conn: Connection) -> str | None:
    """CAS-pick the oldest queued turn; returns turn_id or None."""
    row = conn.execute(
        "SELECT turn_id FROM turns WHERE status = 'queued' ORDER BY id LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    turn_id = str(row[0])
    cur = conn.execute(
        "UPDATE turns SET status = 'picking', updated_at = ? "
        "WHERE turn_id = ? AND status = 'queued'",
        (int(time.time()), turn_id),
    )
    conn.commit()
    return turn_id if cur.rowcount == 1 else None


def process_one(conn: Connection, turn_id: str) -> str:
    from polyopus.workers import engine

    conn.execute(
        "UPDATE turns SET status = 'queued' WHERE turn_id = ? AND status = 'picking'",
        (turn_id,),
    )
    conn.commit()  # run_turn re-marks running; keep queue semantics simple
    return asyncio.run(
        engine.run_turn(
            conn, EventStore(conn), turn_id,
            owner="worker",
            config=engine.EngineConfig(chunk_words=2, workspace=_workspace()),
        )
    )


def run_worker_loop(
    db_path_factory: Callable[[], Path],
    *,
    stop: threading.Event,
    poll_seconds: float = POLL_SECONDS,
    max_turns: int | None = None,
) -> int:
    """Process queued turns until stopped (or max_turns reached).

    Returns how many turns were driven. Failures on one turn are logged and
    skipped (its status stays visible), never kill the loop.
    """
    from polyopus.platform.db.migrator import connect

    processed = 0
    conn: Connection | None = None
    while not stop.is_set() and (max_turns is None or processed < max_turns):
        try:
            if conn is None:
                conn = connect(db_path_factory())
            turn_id = claim_next(conn)
            if turn_id is None:
                stop.wait(poll_seconds)
                continue
            result = process_one(conn, turn_id)
            processed += 1
            tlog.log(logger, 20, "turn.processed", turn_id=turn_id, result=result)
        except AppError as exc:
            if exc.normalized_code() == "THREAD_TURN_ACTIVE":
                continue  # lost the race; another worker owns it
            tlog.log(logger, 30, "turn.skipped", error=exc.normalized_code(),
                     message=exc.message)
            stop.wait(poll_seconds)
        except Exception as exc:  # noqa: BLE001 - the loop must survive
            tlog.log(logger, 40, "worker_error", error=str(exc))
            conn = None  # connection may be poisoned
            stop.wait(poll_seconds)
    if conn is not None:
        conn.close()
    return processed


def start_embedded(db_path_factory: Callable[[], Path]) -> threading.Event:
    """Serve's dual role: one worker thread next to the API process."""
    stop = threading.Event()
    thread = threading.Thread(
        target=run_worker_loop,
        args=(db_path_factory,),
        kwargs={"stop": stop},
        name="turn-worker",
        daemon=True,
    )
    thread.start()
    return stop
