"""Append-only event store (M0-13 / M0-14).

Truth is the `events` table; projections are derived. `(thread_id, seq)` is the
identity: seq is allocated inside the same transaction as the insert.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Event:
    seq: int
    thread_id: str
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    ts: int = 0
    tenant_id: str = "default"
    turn_id: str | None = None
    run_id: str | None = None
    trace_id: str | None = None


class EventStore:
    def __init__(self, conn: sqlite3.Connection, clock: Any = time.time) -> None:
        self._conn = conn
        self._clock = clock

    def last_seq(self, thread_id: str) -> int:
        row = self._conn.execute(
            "SELECT COALESCE(MAX(seq), 0) FROM events WHERE thread_id = ?", (thread_id,)
        ).fetchone()
        return int(row[0])

    def append(
        self,
        thread_id: str,
        type_: str,
        payload: dict[str, Any] | None = None,
        *,
        tenant_id: str = "default",
        turn_id: str | None = None,
        run_id: str | None = None,
        trace_id: str | None = None,
    ) -> Event:
        if not type_:
            raise ValueError("event type must not be empty")
        body = json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":"))
        ts = int(self._clock())

        self._conn.execute("BEGIN IMMEDIATE")
        try:
            seq = self.last_seq(thread_id) + 1
            self._conn.execute(
                """
                INSERT INTO events
                  (tenant_id, thread_id, seq, turn_id, run_id, type, payload_json, ts, trace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, thread_id, seq, turn_id, run_id, type_, body, ts, trace_id),
            )
            self._conn.execute("COMMIT")
        except sqlite3.Error:
            self._conn.execute("ROLLBACK")
            raise

        return Event(
            seq=seq,
            thread_id=thread_id,
            type=type_,
            payload=json.loads(body),
            ts=ts,
            tenant_id=tenant_id,
            turn_id=turn_id,
            run_id=run_id,
            trace_id=trace_id,
        )

    def read(
        self,
        thread_id: str,
        after_seq: int = 0,
        to_seq: int | None = None,
        batch: int = 500,
    ) -> Iterator[Event]:
        cursor = after_seq
        while True:
            if to_seq is None:
                rows = self._conn.execute(
                    "SELECT * FROM events WHERE thread_id = ? AND seq > ? ORDER BY seq LIMIT ?",
                    (thread_id, cursor, batch),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM events WHERE thread_id = ? AND seq > ? AND seq <= ? "
                    "ORDER BY seq LIMIT ?",
                    (thread_id, cursor, to_seq, batch),
                ).fetchall()
            if not rows:
                return
            for row in rows:
                yield self._row_to_event(row)
            cursor = int(rows[-1]["seq"])

    def count(self, thread_id: str) -> int:
        row = self._conn.execute(
            "SELECT count(*) FROM events WHERE thread_id = ?", (thread_id,)
        ).fetchone()
        return int(row[0])

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> Event:
        return Event(
            seq=int(row["seq"]),
            thread_id=str(row["thread_id"]),
            type=str(row["type"]),
            payload=json.loads(row["payload_json"]),
            ts=int(row["ts"]),
            tenant_id=str(row["tenant_id"]),
            turn_id=row["turn_id"],
            run_id=row["run_id"],
            trace_id=row["trace_id"],
        )
