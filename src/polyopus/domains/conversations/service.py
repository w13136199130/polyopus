"""Conversations use-cases: threads, turns, event tail (slice ①)."""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import time
from dataclasses import dataclass

from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore


@dataclass(frozen=True)
class Thread:
    thread_id: str
    tenant_id: str
    owner_id: str
    title: str
    status: str
    last_message_at: int | None
    unread_count: int
    created_at: int


def _thread(row: sqlite3.Row) -> Thread:
    return Thread(
        thread_id=str(row["thread_id"]),
        tenant_id=str(row["tenant_id"]),
        owner_id=str(row["owner_id"]),
        title=str(row["title"]),
        status=str(row["status"]),
        last_message_at=row["last_message_at"],
        unread_count=int(row["unread_count"]),
        created_at=int(row["created_at"]),
    )


def create_thread(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    owner_id: str,
    title: str = "新对话",
) -> Thread:
    thread_id = "th_" + secrets.token_hex(12)
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO threads
          (tenant_id, thread_id, owner_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
        """,
        (tenant_id, thread_id, owner_id, title, now, now),
    )
    conn.commit()
    return get_thread(conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id)


def get_thread(
    conn: sqlite3.Connection, *, tenant_id: str, owner_id: str, thread_id: str
) -> Thread:
    row = conn.execute(
        "SELECT * FROM threads WHERE tenant_id = ? AND thread_id = ? "
        "AND owner_id = ? AND deleted_at IS NULL",
        (tenant_id, thread_id, owner_id),
    ).fetchone()
    if row is None:
        # private by default: no existence leak
        raise AppError("NOT_FOUND", details={"reason": "hidden"})
    return _thread(row)


def list_threads(conn: sqlite3.Connection, *, tenant_id: str, owner_id: str) -> list[Thread]:
    rows = conn.execute(
        "SELECT * FROM threads WHERE tenant_id = ? AND owner_id = ? AND deleted_at IS NULL "
        "ORDER BY pinned DESC, COALESCE(last_message_at, created_at) DESC LIMIT 100",
        (tenant_id, owner_id),
    ).fetchall()
    return [_thread(r) for r in rows]


def post_turn(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    owner_id: str,
    thread_id: str,
    content: str,
    idempotency_key: str | None = None,
) -> tuple[str, str]:
    """Append a user message + queued turn. Returns (turn_id, message_id)."""
    get_thread(conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id)
    if not content.strip():
        raise AppError("VALIDATION_FAILED", details={"fields": {"content": "required"}})

    now = int(time.time())
    if idempotency_key:
        message_id = "msg_" + hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:16]
        existing = conn.execute(
            "SELECT turn_id FROM messages WHERE message_id = ?", (message_id,)
        ).fetchone()
        if existing and existing[0]:
            return str(existing[0]), message_id
    else:
        message_id = "msg_" + secrets.token_hex(8)

    turn_id = "tu_" + secrets.token_hex(10)
    msg_seq = int(
        conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = ?", (thread_id,)
        ).fetchone()[0]
    )
    turn_seq = int(
        conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM turns WHERE thread_id = ?", (thread_id,)
        ).fetchone()[0]
    )

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO messages
              (tenant_id, message_id, thread_id, turn_id, role, content, status, seq,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, 'user', ?, 'completed', ?, ?, ?)
            """,
            (tenant_id, message_id, thread_id, turn_id, content, msg_seq, now, now),
        )
        conn.execute(
            """
            INSERT INTO turns
              (tenant_id, turn_id, thread_id, user_message_id, status, mode, seq,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, 'queued', 'act', ?, ?, ?)
            """,
            (tenant_id, turn_id, thread_id, message_id, turn_seq, now, now),
        )
        conn.execute(
            "UPDATE threads SET last_message_at = ?, updated_at = ? WHERE thread_id = ?",
            (now, now, thread_id),
        )
        conn.execute("COMMIT")
    except sqlite3.IntegrityError:
        conn.execute("ROLLBACK")
        row = conn.execute(
            "SELECT turn_id FROM messages WHERE message_id = ?", (message_id,)
        ).fetchone()
        if row and row[0]:
            return str(row[0]), message_id
        raise AppError("CONFLICT") from None

    store.append(
        thread_id,
        "turn.queued",
        {"turn_id": turn_id, "delivery": "auto", "input_ref": message_id},
        tenant_id=tenant_id,
        turn_id=turn_id,
    )
    return turn_id, message_id


def list_messages(
    conn: sqlite3.Connection, *, thread_id: str, limit: int = 100
) -> list[dict[str, object]]:
    rows = conn.execute(
        "SELECT message_id, turn_id, role, content, status, seq, created_at FROM messages "
        "WHERE thread_id = ? AND deleted_at IS NULL ORDER BY seq LIMIT ?",
        (thread_id, limit),
    ).fetchall()
    return [
        {
            "messageId": r["message_id"],
            "turnId": r["turn_id"],
            "role": r["role"],
            "content": r["content"],
            "status": r["status"],
            "seq": r["seq"],
            "createdAt": r["created_at"],
        }
        for r in rows
    ]
