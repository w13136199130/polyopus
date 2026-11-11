"""Minimal DB lease for runs (M0-17)."""

from __future__ import annotations

import sqlite3
import time


def claim(
    conn: sqlite3.Connection,
    run_id: str,
    owner: str,
    ttl: int = 60,
    now: int | None = None,
) -> bool:
    ts = now or int(time.time())
    cur = conn.execute(
        """
        UPDATE runs
           SET status = 'running', lease_owner = ?, lease_until = ?, heartbeat_at = ?
         WHERE run_id = ?
           AND (status IN ('leased', 'pending', 'waiting') OR lease_until IS NULL
                OR lease_until < ? OR lease_owner = ?)
        """,
        (owner, ts + ttl, ts, run_id, ts, owner),
    )
    conn.commit()
    return cur.rowcount == 1


def heartbeat(
    conn: sqlite3.Connection,
    run_id: str,
    owner: str,
    ttl: int = 60,
    now: int | None = None,
) -> bool:
    ts = now or int(time.time())
    cur = conn.execute(
        """
        UPDATE runs
           SET lease_until = ?, heartbeat_at = ?
         WHERE run_id = ? AND lease_owner = ? AND status = 'running'
        """,
        (ts + ttl, ts, run_id, owner),
    )
    conn.commit()
    return cur.rowcount == 1


def release(conn: sqlite3.Connection, run_id: str, owner: str) -> None:
    conn.execute(
        "UPDATE runs SET lease_owner = NULL, lease_until = NULL "
        "WHERE run_id = ? AND lease_owner = ?",
        (run_id, owner),
    )
    conn.commit()


def expired(
    conn: sqlite3.Connection, now: int | None = None
) -> list[sqlite3.Row]:
    ts = now or int(time.time())
    rows = conn.execute(
        """
        SELECT * FROM runs
         WHERE status IN ('leased', 'running')
           AND lease_until IS NOT NULL AND lease_until < ?
         ORDER BY started_at
        """,
        (ts,),
    ).fetchall()
    return list(rows)
