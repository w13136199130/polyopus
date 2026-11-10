"""Startup recovery for expired run leases (M0-18)."""

from __future__ import annotations

import logging
import secrets
import sqlite3
import time
from dataclasses import dataclass

from polyopus.platform.events.store import EventStore
from polyopus.platform.queue import lease
from polyopus.platform.telemetry import log as tlog
from polyopus.workers import turn_worker

logger = tlog.get_logger("polyopus.recovery")


@dataclass(frozen=True)
class Recovered:
    turn_id: str
    thread_id: str
    old_run_id: str
    new_run_id: str
    attempt: int
    from_step: int


def _thread_of(conn: sqlite3.Connection, turn_id: str) -> str:
    row = conn.execute("SELECT thread_id FROM turns WHERE turn_id = ?", (turn_id,)).fetchone()
    if row is None:
        raise LookupError(f"turn {turn_id} not found")
    return str(row[0])


def recover_expired(
    conn: sqlite3.Connection,
    store: EventStore,
    owner: str,
    lease_ttl: int = 60,
    now: int | None = None,
) -> list[Recovered]:
    ts = now or int(time.time())
    out: list[Recovered] = []

    for run in lease.expired(conn, ts):
        turn_id = str(run["turn_id"])
        thread_id = _thread_of(conn, turn_id)
        attempt = int(run["attempt"]) + 1
        new_run_id = "run_" + secrets.token_hex(8)

        conn.execute(
            "UPDATE runs SET status = 'failed', finished_at = ? WHERE run_id = ?",
            (ts, str(run["run_id"])),
        )
        conn.execute(
            """
            INSERT INTO runs
              (tenant_id, run_id, turn_id, attempt, status, lease_owner, lease_until,
               heartbeat_at, last_step_idx, started_at)
            VALUES (?, ?, ?, ?, 'leased', ?, ?, ?, ?, ?)
            """,
            (
                str(run["tenant_id"]),
                new_run_id,
                turn_id,
                attempt,
                owner,
                ts + lease_ttl,
                ts,
                int(run["last_step_idx"]),
                ts,
            ),
        )
        conn.commit()
        lease.claim(conn, new_run_id, owner, lease_ttl, now=ts)

        tlog.log(logger, logging.WARNING, "run.recovered", turn_id=turn_id,
                 old_run_id=str(run["run_id"]), new_run_id=new_run_id,
                 attempt=attempt, from_step=int(run["last_step_idx"]) + 1)
        store.append(
            thread_id,
            "turn.resumed",
            {
                "turn_id": turn_id,
                "run_id": new_run_id,
                "attempt": attempt,
                "from_step": int(run["last_step_idx"]) + 1,
            },
            tenant_id=str(run["tenant_id"]),
            turn_id=turn_id,
            run_id=new_run_id,
        )
        out.append(
            Recovered(
                turn_id=turn_id,
                thread_id=thread_id,
                old_run_id=str(run["run_id"]),
                new_run_id=new_run_id,
                attempt=attempt,
                from_step=int(run["last_step_idx"]) + 1,
            )
        )
    return out


def recover_and_resume(
    conn: sqlite3.Connection,
    store: EventStore,
    owner: str,
    delay: float = 0.0,
    lease_ttl: int = 60,
    now: int | None = None,
) -> list[Recovered]:
    recovered = recover_expired(conn, store, owner, lease_ttl, now)
    for item in recovered:
        turn_worker.resume_turn(
            conn, store, item.thread_id, item.turn_id, owner, delay=delay,
            lease_ttl=lease_ttl,
        )
    return recovered
