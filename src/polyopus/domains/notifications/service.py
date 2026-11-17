"""In-app notifications (V1-10).

Notifications are a delivery convenience, never business truth: inserts are
best-effort, `dedupe_key` makes them idempotent, and the unread count is
derived from `read_at IS NULL`.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from typing import Any

from polyopus.platform.telemetry import log as tlog

TENANT = "default"
KINDS = ("task", "cloud", "export", "system")
DEDUPE_WINDOW_SECONDS = 300
logger = tlog.get_logger("polyopus.notifications")


def _view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["notification_id"],
        "notificationId": row["notification_id"],
        "kind": row["kind"],
        "title": row["title"],
        "body": row["body"],
        "link": row["link"],
        "readAt": row["read_at"],
        "createdAt": row["created_at"],
    }


def _window_key(base: str, now: int, window_seconds: int) -> str:
    return f"{base}:{now // max(1, window_seconds)}"


def notify(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    user_id: str,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    dedupe_key: str | None = None,
    window_seconds: int = DEDUPE_WINDOW_SECONDS,
    now: int | None = None,
) -> str | None:
    """Insert one notification; duplicate dedupe keys are silently ignored."""
    if kind not in KINDS or not user_id:
        return None
    ts = now or int(time.time())
    key = dedupe_key or _window_key(f"{kind}:{title}", ts, window_seconds)
    notification_id = "nt_" + secrets.token_hex(8)
    try:
        conn.execute(
            "INSERT INTO notifications (notification_id, tenant_id, user_id,"
            " kind, title, body, link, dedupe_key, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(tenant_id, user_id, dedupe_key) DO NOTHING",
            (notification_id, tenant_id, user_id, kind, title, body, link, key, ts),
        )
        conn.commit()
        row = conn.execute(
            "SELECT notification_id FROM notifications WHERE tenant_id = ?"
            " AND user_id = ? AND dedupe_key = ?", (tenant_id, user_id, key),
        ).fetchone()
        return str(row[0]) if row is not None else None
    except sqlite3.Error as exc:
        tlog.log(logger, 30, "notification.write_failed", error=str(exc))
        return None


def list_notifications(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    user_id: str,
    unread_only: bool = False,
    limit: int = 30,
    cursor: str | None = None,
) -> dict[str, Any]:
    where = "tenant_id = ? AND user_id = ?"
    params: list[object] = [tenant_id, user_id]
    if unread_only:
        where += " AND read_at IS NULL"
    if cursor:
        where += " AND id < (SELECT id FROM notifications WHERE notification_id = ?)"
        params.append(cursor)
    rows = conn.execute(
        f"SELECT * FROM notifications WHERE {where} ORDER BY id DESC LIMIT ?",
        [*params, max(1, min(limit, 100))],
    ).fetchall()
    unread = conn.execute(
        "SELECT count(*) FROM notifications WHERE tenant_id = ? AND user_id = ?"
        " AND read_at IS NULL", (tenant_id, user_id),
    ).fetchone()[0]
    next_cursor = rows[-1]["notification_id"] if len(rows) == limit else None
    return {
        "items": [_view(row) for row in rows],
        "unreadCount": int(unread),
        "nextCursor": next_cursor,
    }


def mark_read(
    conn: sqlite3.Connection, *, tenant_id: str, user_id: str, notification_id: str,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM notifications WHERE tenant_id = ? AND user_id = ?"
        " AND notification_id = ?", (tenant_id, user_id, notification_id),
    ).fetchone()
    if row is None:
        from polyopus.platform.errors import AppError

        raise AppError("NOT_FOUND", details={"notificationId": notification_id})
    if row["read_at"] is None:
        conn.execute(
            "UPDATE notifications SET read_at = ? WHERE notification_id = ?",
            (int(time.time()), notification_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM notifications WHERE notification_id = ?",
            (notification_id,),
        ).fetchone()
    assert row is not None
    return _view(row)


def mark_all_read(
    conn: sqlite3.Connection, *, tenant_id: str, user_id: str,
) -> int:
    cur = conn.execute(
        "UPDATE notifications SET read_at = ? WHERE tenant_id = ? AND user_id = ?"
        " AND read_at IS NULL", (int(time.time()), tenant_id, user_id),
    )
    conn.commit()
    return int(cur.rowcount)


def notify_ticket(
    conn: sqlite3.Connection,
    *,
    ticket_id: str,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    dedupe_key: str | None = None,
) -> str | None:
    """Notify the ticket's actor; system-created tickets fall back to none."""
    row = conn.execute(
        "SELECT tenant_id, actor_json FROM tickets WHERE ticket_id = ?",
        (ticket_id,),
    ).fetchone()
    if row is None:
        return None
    actor = json.loads(row["actor_json"] or "{}").get("id")
    if not actor:
        return None
    return notify(
        conn, tenant_id=str(row["tenant_id"] or TENANT), user_id=str(actor),
        kind=kind, title=title, body=body, link=link or f"/tasks?ticketId={ticket_id}",
        dedupe_key=dedupe_key,
    )


def notify_thread(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    thread_id: str,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    dedupe_key: str | None = None,
) -> str | None:
    """Notify a chat thread owner; a ticket execution thread has no owner,
    so resolve its ticket actor instead."""
    row = conn.execute(
        "SELECT owner_id FROM threads WHERE tenant_id = ? AND thread_id = ?",
        (tenant_id, thread_id),
    ).fetchone()
    owner = str(row[0]) if row is not None and row[0] else ""
    if owner and owner != "system":
        return notify(
            conn, tenant_id=tenant_id, user_id=owner, kind=kind, title=title,
            body=body, link=link, dedupe_key=dedupe_key,
        )
    ticket = conn.execute(
        "SELECT ticket_id FROM timeline_events WHERE kind = 'execution_thread'"
        " AND json_extract(payload_json, '$.thread_id') = ?"
        " ORDER BY id DESC LIMIT 1", (thread_id,),
    ).fetchone()
    if ticket is None:
        return None
    return notify_ticket(
        conn, ticket_id=str(ticket[0]), kind=kind, title=title, body=body,
        link=link, dedupe_key=dedupe_key,
    )
