"""Minimal projection: events -> messages (M0-15).

Only message events are projected in M0. Rebuild is idempotent: delete the
thread's messages, replay all events.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from polyopus.platform.events.store import Event, EventStore

MESSAGE_EVENTS = {"message.started", "message.completed", "message.failed"}


def apply(conn: sqlite3.Connection, event: Event) -> bool:
    """Apply one event; returns True when it touched a projection."""
    if event.type not in MESSAGE_EVENTS:
        return False
    payload: dict[str, Any] = event.payload
    message_id = payload.get("message_id")
    if not message_id:
        return False

    role = str(payload.get("role", "assistant"))
    content = str(payload.get("content", ""))
    status = {
        "message.started": "streaming",
        "message.completed": "completed",
        "message.failed": "failed",
    }[event.type]
    now = int(time.time())

    conn.execute(
        """
        INSERT INTO messages
          (tenant_id, message_id, thread_id, turn_id, role, content, status, seq,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          content = excluded.content,
          status = excluded.status,
          updated_at = excluded.updated_at
        """,
        (
            event.tenant_id,
            message_id,
            event.thread_id,
            event.turn_id,
            role,
            content,
            status,
            event.seq,
            now,
            now,
        ),
    )
    return True


def rebuild(conn: sqlite3.Connection, store: EventStore, thread_id: str) -> int:
    conn.execute("DELETE FROM messages WHERE thread_id = ?", (thread_id,))
    applied = 0
    for event in store.read(thread_id):
        applied += 1 if apply(conn, event) else 0
    return applied
