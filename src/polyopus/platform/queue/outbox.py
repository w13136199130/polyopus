"""Transactional outbox with per-topic concurrency caps (M1-03).

`docs/31` has no lease columns on `outbox`, so the lease is expressed with
`next_retry_at` (a visibility timeout): while a row is leased, other workers
skip it; when it expires, the row becomes visible again with attempts+1.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class OutboxItem:
    id: int
    tenant_id: str
    event_id: str
    topic: str
    payload: dict[str, Any]
    attempts: int


class Outbox:
    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self._conn = conn
        self._clock = clock

    def _now(self) -> int:
        return int(self._clock())

    def enqueue(
        self,
        tenant_id: str,
        topic: str,
        payload: Mapping[str, Any],
        *,
        event_id: str | None = None,
    ) -> int:
        body = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
        eid = event_id or f"ob_{topic}_{self._now()}_{abs(hash(body)) & 0xFFFFFFFF:x}"
        self._conn.execute(
            """
            INSERT INTO outbox (tenant_id, event_id, topic, payload_json, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)
            ON CONFLICT(event_id) DO NOTHING
            """,
            (tenant_id, eid, topic, body, self._now()),
        )
        self._conn.commit()
        row = self._conn.execute("SELECT id FROM outbox WHERE event_id = ?", (eid,)).fetchone()
        return int(row[0])

    def lease_batch(
        self,
        *,
        lease_seconds: int = 60,
        limits: Mapping[str, int] | None = None,
        default_limit: int = 4,
        now: int | None = None,
    ) -> list[OutboxItem]:
        ts = now or self._now()
        caps: Mapping[str, int] = limits or {}
        leased: list[OutboxItem] = []

        self._conn.execute("BEGIN IMMEDIATE")
        try:
            in_flight = {
                str(r[0]): int(r[1])
                for r in self._conn.execute(
                    "SELECT topic, count(*) FROM outbox "
                    "WHERE status = 'pending' AND next_retry_at IS NOT NULL AND next_retry_at > ? "
                    "GROUP BY topic",
                    (ts,),
                )
            }
            topics = [
                str(r[0])
                for r in self._conn.execute(
                    "SELECT DISTINCT topic FROM outbox "
                    "WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)",
                    (ts,),
                )
            ]
            for topic in topics:
                free = caps.get(topic, default_limit) - in_flight.get(topic, 0)
                if free <= 0:
                    continue
                rows = self._conn.execute(
                    "SELECT id, tenant_id, event_id, topic, payload_json, attempts FROM outbox "
                    "WHERE status = 'pending' AND topic = ? "
                    "AND (next_retry_at IS NULL OR next_retry_at <= ?) "
                    "ORDER BY id LIMIT ?",
                    (topic, ts, free),
                ).fetchall()
                if not rows:
                    continue
                ids = [int(r[0]) for r in rows]
                placeholders = ",".join("?" * len(ids))
                self._conn.execute(
                    f"UPDATE outbox SET next_retry_at = ?, attempts = attempts + 1 "
                    f"WHERE id IN ({placeholders})",
                    (ts + lease_seconds, *ids),
                )
                for r in rows:
                    leased.append(
                        OutboxItem(
                            id=int(r[0]),
                            tenant_id=str(r[1]),
                            event_id=str(r[2]),
                            topic=str(r[3]),
                            payload=json.loads(r[4]),
                            attempts=int(r[5]) + 1,
                        )
                    )
            self._conn.execute("COMMIT")
        except sqlite3.Error:
            self._conn.execute("ROLLBACK")
            raise

        return leased

    def mark_sent(self, item: OutboxItem) -> None:
        self._conn.execute(
            "UPDATE outbox SET status = 'sent', next_retry_at = NULL WHERE id = ?",
            (item.id,),
        )
        self._conn.commit()

    def mark_failed(self, item: OutboxItem, *, max_attempts: int = 5) -> str:
        ts = self._now()
        if item.attempts >= max_attempts:
            self._conn.execute(
                "UPDATE outbox SET status = 'failed', next_retry_at = NULL WHERE id = ?",
                (item.id,),
            )
            self._conn.commit()
            return "failed"
        backoff = min(2**item.attempts, 300)
        self._conn.execute(
            "UPDATE outbox SET next_retry_at = ? WHERE id = ?", (ts + backoff, item.id)
        )
        self._conn.commit()
        return "pending"

    def dispatch(
        self,
        handler: Callable[[OutboxItem], None],
        *,
        lease_seconds: int = 60,
        limits: Mapping[str, int] | None = None,
        default_limit: int = 4,
        max_batches: int = 10,
    ) -> dict[str, int]:
        stats = {"sent": 0, "failed": 0, "retried": 0}
        for _ in range(max_batches):
            batch = self.lease_batch(
                lease_seconds=lease_seconds, limits=limits, default_limit=default_limit
            )
            if not batch:
                break
            for item in batch:
                try:
                    handler(item)
                except Exception:
                    if self.mark_failed(item) == "failed":
                        stats["failed"] += 1
                    else:
                        stats["retried"] += 1
                else:
                    self.mark_sent(item)
                    stats["sent"] += 1
        return stats
