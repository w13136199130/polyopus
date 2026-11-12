"""Queue-driven ticket worker (v0.5 card V05-07).

`tickets.bucket='queued'` (state open) IS the ticket queue — mirrors how
`turns.status='queued'` drives the turn worker. The loop picks the oldest
queued ticket and drives `run_assignment` to a Report; double-claims lose
to UNIQUE(tenant, ticket, attempt) inside assign(). One crash-window is
accepted and documented: requeueing a ticket whose turn was still in flight
may execute a second turn (worst case a duplicated reply, never lost work).
"""

from __future__ import annotations

import sqlite3
import threading
import time
from collections.abc import Callable
from pathlib import Path

from polyopus.domains.tickets import service as tickets
from polyopus.platform.events.store import EventStore
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.ticketworker")

POLL_SECONDS = 0.5
# one ticket executes per PROCESS: the two embedded threads share SQLite and
# contention inside one engine run caused spurious "database is locked"
# crashes; cross-PROCESS double-claims are still arbitrated by the
# UNIQUE(tenant, ticket, attempt) index in assign()
_CLAIM_LOCK = threading.Lock()
STALE_HEARTBEAT_SECONDS = 30
SWEEP_SECONDS = 5.0


def _workspace() -> Path:
    from polyopus.config import load_settings

    path = load_settings().workspace_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def next_queued_ticket(conn: sqlite3.Connection) -> str | None:
    """Oldest fully-opened ticket. The EXISTS guard skips the (tiny) window
    where open_ticket() has committed the queued row but link_thread() has
    not landed yet — claiming there would raise TICKET_NOT_FOUND and park
    the ticket forever."""
    row = conn.execute(
        """
        SELECT t.ticket_id FROM tickets t
        WHERE t.state = 'open' AND t.bucket = 'queued'
          AND EXISTS (
            SELECT 1 FROM timeline_events e
            WHERE e.ticket_id = t.ticket_id AND e.kind = 'execution_thread'
          )
        ORDER BY t.id LIMIT 1
        """
    ).fetchone()
    return str(row[0]) if row else None


def process_next(
    conn: sqlite3.Connection, store: EventStore, *, _lock: threading.Lock | None = None
) -> str | None:
    """Claim and run one queued ticket. Returns its report state, or None
    when the queue is empty / the claim was lost to another worker."""
    from polyopus.workers import engine

    lock = _lock or _CLAIM_LOCK
    if not lock.acquire(timeout=0.2):
        return None  # the sibling thread already owns this process's slot
    try:
        ticket_id = next_queued_ticket(conn)
        if ticket_id is None:
            return None
        try:
            state = tickets.run_assignment(
                conn, store, ticket_id,
                engine_config=engine.EngineConfig(workspace=_workspace()),
            )
            tlog.log(logger, 20, "ticket.processed", ticket_id=ticket_id, state=state)
            return state
        except sqlite3.IntegrityError:
            return None  # another PROCESS won UNIQUE(ticket, attempt)
        except sqlite3.OperationalError as exc:
            # transient (busy/locked): do NOT park the ticket, just yield
            tlog.log(logger, 30, "ticket.deferred", ticket_id=ticket_id,
                     error=str(exc))
            return None
        except Exception as exc:  # noqa: BLE001 - park visibly, never spin
            tlog.log(logger, 30, "ticket.parked", ticket_id=ticket_id,
                     error=str(exc))
            conn.execute(
                "UPDATE tickets SET bucket = 'attention', updated_at = ? "
                "WHERE ticket_id = ? AND bucket IN ('queued', 'running')",
                (int(time.time()), ticket_id),
            )
            conn.commit()
            return None
    finally:
        lock.release()


def recover_stale_running(
    conn: sqlite3.Connection, *, stale_seconds: int = STALE_HEARTBEAT_SECONDS
) -> int:
    """Sweep: tickets stuck in `running` whose assignment heartbeat died go
    back to `queued` — unless their turn waits on a human
    (waiting_approval), where re-running would duplicate work (V05-11 owns
    the resume path)."""
    now = int(time.time())
    rows = conn.execute(
        """
        SELECT t.ticket_id,
               (SELECT status FROM turns WHERE thread_id =
                  (SELECT json_extract(payload_json,'$.thread_id') FROM timeline_events
                   WHERE ticket_id = t.ticket_id AND kind = 'execution_thread'
                   ORDER BY id DESC LIMIT 1)
                ORDER BY id DESC LIMIT 1) AS turn_status
        FROM tickets t
        WHERE t.state = 'open' AND t.bucket = 'running'
          AND NOT EXISTS (
                SELECT 1 FROM assignments a
                WHERE a.ticket_id = t.ticket_id AND a.state = 'running'
                  AND COALESCE(a.heartbeat_at, a.started_at, 0) > ?
          )
        """,
        (now - stale_seconds,),
    ).fetchall()
    requeued = 0
    for row in rows:
        if row["turn_status"] in ("queued", "running", "waiting_approval"):
            continue  # turn machinery or a human still owns the outcome
        # CAS: only requeue if the ticket is STILL open+running — the SELECT
        # above races with a sibling worker finishing the same ticket
        cur = conn.execute(
            "UPDATE tickets SET bucket = 'queued', updated_at = ? "
            "WHERE ticket_id = ? AND state = 'open' AND bucket = 'running'",
            (now, row["ticket_id"]),
        )
        requeued += cur.rowcount
    if requeued:
        conn.commit()
        tlog.log(logger, 30, "tickets.requeued_after_crash", count=requeued)
    return requeued


def run_ticket_loop(
    db_path_factory: Callable[[], Path],
    *,
    stop: threading.Event,
    poll_seconds: float = POLL_SECONDS,
    max_tickets: int | None = None,
) -> int:
    """Process queued tickets until stopped; returns how many were driven."""
    from polyopus.platform.db.migrator import connect

    processed = 0
    conn: sqlite3.Connection | None = None
    last_sweep = 0.0
    while not stop.is_set() and (max_tickets is None or processed < max_tickets):
        try:
            if conn is None:
                conn = connect(db_path_factory())
            now = time.monotonic()
            if now - last_sweep > SWEEP_SECONDS:
                # boot + periodic sweep: heals tickets left `running` by a
                # transient error mid-run (the final bucket update is the
                # only non-transactional tail of run_assignment)
                recover_stale_running(conn)
                last_sweep = now
            state = process_next(conn, EventStore(conn))
            if state is None:
                stop.wait(poll_seconds)
                continue
            processed += 1
        except Exception as exc:  # noqa: BLE001 - the loop must survive
            tlog.log(logger, 40, "ticket_worker_error", error=str(exc))
            conn = None  # connection may be poisoned
            stop.wait(poll_seconds)
    if conn is not None:
        conn.close()
    return processed


def start_embedded(db_path_factory: Callable[[], Path]) -> threading.Event:
    stop = threading.Event()
    thread = threading.Thread(
        target=run_ticket_loop,
        args=(db_path_factory,),
        kwargs={"stop": stop},
        name="ticket-worker",
        daemon=True,
    )
    thread.start()
    return stop
