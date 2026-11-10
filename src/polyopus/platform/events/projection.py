"""Minimal projection: events -> messages (M0-15).

Payloads follow docs/11: `message.started` carries role/index; text arrives as
blocks on `message.completed`.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from polyopus.platform.events.store import Event, EventStore

MESSAGE_EVENTS = {"message.started", "message.completed", "message.failed"}


def _text_of(blocks: Any) -> str:
    if not isinstance(blocks, list):
        return ""
    parts = [
        str(b.get("text", ""))
        for b in blocks
        if isinstance(b, dict) and b.get("type") == "text"
    ]
    return "".join(parts)


def apply(conn: sqlite3.Connection, event: Event) -> bool:
    """Apply one event; returns True when it touched a projection."""
    if event.type not in MESSAGE_EVENTS:
        return False
    payload: dict[str, Any] = event.payload
    message_id = payload.get("message_id")
    if not message_id:
        return False

    role = payload.get("role")
    if event.type == "message.completed":
        content = _text_of(payload.get("blocks"))
        status = "completed"
    elif event.type == "message.started":
        content = ""
        status = "streaming"
    else:
        content = _text_of(payload.get("blocks"))
        status = "failed"
    now = int(time.time())
    # messages.seq is unique per thread; the event seq already guarantees that.
    seq = event.seq

    conn.execute(
        """
        INSERT INTO messages
          (tenant_id, message_id, thread_id, turn_id, role, content, status, seq,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          content = excluded.content,
          status = excluded.status,
          role = COALESCE(excluded.role, messages.role),
          updated_at = excluded.updated_at
        """,
        (
            event.tenant_id,
            message_id,
            event.thread_id,
            event.turn_id,
            role or "assistant",
            content,
            status,
            seq,
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
