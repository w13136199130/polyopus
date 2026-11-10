"""Fake turn runner (M0-16).

No model, no tools: it only exercises the durable path
(event append -> run lease -> step cursor -> completion) so crash recovery can
be demonstrated without an API key.
"""

from __future__ import annotations

import json
import logging
import secrets
import sqlite3
import time
from typing import cast

from polyopus.platform.events import projection
from polyopus.platform.events.store import EventStore
from polyopus.platform.queue import lease
from polyopus.platform.telemetry import log as tlog

DEFAULT_TENANT = "default"
logger = tlog.get_logger("polyopus.turn")


def _now() -> int:
    return int(time.time())


def ensure_turn(conn: sqlite3.Connection, thread_id: str, turn_id: str,
                tenant_id: str = DEFAULT_TENANT) -> None:
    now = _now()
    conn.execute(
        """
        INSERT INTO turns
          (tenant_id, turn_id, thread_id, status, seq, created_at, updated_at)
        VALUES (?, ?, ?, 'running', 1, ?, ?)
        ON CONFLICT(turn_id) DO NOTHING
        """,
        (tenant_id, turn_id, thread_id, now, now),
    )
    conn.commit()


def start_run(
    conn: sqlite3.Connection,
    store: EventStore,
    thread_id: str,
    turn_id: str,
    steps: int,
    owner: str,
    lease_ttl: int = 60,
    tenant_id: str = DEFAULT_TENANT,
) -> str:
    ensure_turn(conn, thread_id, turn_id, tenant_id)
    run_id = "run_" + secrets.token_hex(8)
    now = _now()
    conn.execute(
        """
        INSERT INTO runs
          (tenant_id, run_id, turn_id, attempt, status, lease_owner, lease_until,
           heartbeat_at, last_step_idx, started_at)
        VALUES (?, ?, ?, 1, 'leased', ?, ?, ?, -1, ?)
        """,
        (tenant_id, run_id, turn_id, owner, now + lease_ttl, now, now),
    )
    conn.commit()
    lease.claim(conn, run_id, owner, lease_ttl)
    tlog.log(logger, logging.INFO, "turn.started", thread_id=thread_id,
             turn_id=turn_id, run_id=run_id, steps=steps)
    store.append(
        thread_id,
        "turn.started",
        {"turn_id": turn_id, "run_id": run_id, "steps": steps},
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )
    return run_id


def _latest_run(conn: sqlite3.Connection, turn_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM runs WHERE turn_id = ? ORDER BY attempt DESC LIMIT 1", (turn_id,)
    ).fetchone()
    if row is None:
        raise LookupError(f"no run for turn {turn_id}")
    return cast(sqlite3.Row, row)


def _steps_from_thread(conn: sqlite3.Connection, thread_id: str) -> int:
    row = conn.execute(
        "SELECT payload_json FROM events WHERE thread_id = ? AND type = 'turn.started' "
        "ORDER BY seq LIMIT 1",
        (thread_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"thread {thread_id} has no turn.started event")
    return int(json.loads(row[0]).get("steps", 0))


def execute(
    conn: sqlite3.Connection,
    store: EventStore,
    thread_id: str,
    turn_id: str,
    run_id: str,
    steps: int,
    from_idx: int,
    delay: float,
    owner: str,
    lease_ttl: int = 60,
    tenant_id: str = DEFAULT_TENANT,
) -> None:
    for idx in range(from_idx, steps):
        if delay:
            time.sleep(delay)
        lease.heartbeat(conn, run_id, owner, lease_ttl)
        conn.execute(
            "UPDATE runs SET last_step_idx = ? WHERE run_id = ?", (idx, run_id)
        )
        conn.commit()
        tlog.log(logger, logging.INFO, "step.completed", turn_id=turn_id, idx=idx)
        store.append(
            thread_id,
            "step.completed",
            {"idx": idx, "kind": "model"},
            tenant_id=tenant_id,
            turn_id=turn_id,
            run_id=run_id,
        )

    event = store.append(
        thread_id,
        "message.completed",
        {
            "message_id": "msg_" + secrets.token_hex(8),
            "role": "assistant",
            "content": f"fake answer for {turn_id} ({steps} steps)",
        },
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )
    projection.apply(conn, event)
    conn.commit()

    now = _now()
    conn.execute(
        "UPDATE runs SET status = 'completed', finished_at = ?, lease_owner = NULL, "
        "lease_until = NULL WHERE run_id = ?",
        (now, run_id),
    )
    conn.execute(
        "UPDATE turns SET status = 'completed', finished_at = ?, updated_at = ? "
        "WHERE turn_id = ?",
        (now, now, turn_id),
    )
    conn.commit()
    tlog.log(logger, logging.INFO, "turn.completed", turn_id=turn_id, steps=steps)
    store.append(
        thread_id,
        "turn.completed",
        {"turn_id": turn_id, "run_id": run_id, "steps": steps},
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )


def resume_turn(
    conn: sqlite3.Connection,
    store: EventStore,
    thread_id: str,
    turn_id: str,
    owner: str,
    delay: float = 0.0,
    lease_ttl: int = 60,
) -> str:
    """Continue the latest run from last_step_idx + 1."""
    run = _latest_run(conn, turn_id)
    run_id = str(run["run_id"])
    if not lease.claim(conn, run_id, owner, lease_ttl):
        raise RuntimeError(f"cannot claim run {run_id}")
    steps = _steps_from_thread(conn, thread_id)
    from_idx = int(run["last_step_idx"]) + 1
    execute(
        conn, store, thread_id, turn_id, run_id, steps, from_idx, delay,
        owner, lease_ttl,
    )
    return run_id


def main(argv: list[str] | None = None) -> int:
    import argparse
    from pathlib import Path

    from polyopus.platform.db.migrator import connect

    parser = argparse.ArgumentParser(prog="turn_worker", description="fake turn runner (M0)")
    parser.add_argument("--db", default="data/polyopus.db")
    parser.add_argument("--thread", required=True)
    parser.add_argument("--turn", required=True)
    parser.add_argument("--steps", type=int, default=5)
    parser.add_argument("--delay", type=float, default=0.2)
    parser.add_argument("--lease", type=int, default=5)
    parser.add_argument("--owner", default="fake-worker")
    args = parser.parse_args(argv)

    tlog.configure()
    tlog.set_trace_id(tlog.new_trace_id())
    conn = connect(Path(args.db))
    try:
        store = EventStore(conn)
        run_id = start_run(
            conn, store, args.thread, args.turn, args.steps, args.owner, args.lease
        )
        execute(
            conn, store, args.thread, args.turn, run_id, args.steps, 0,
            args.delay, args.owner, args.lease,
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
