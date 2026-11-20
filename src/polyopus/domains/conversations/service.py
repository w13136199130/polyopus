"""Conversations use-cases: threads, turns, event tail (slice ①)."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, cast

from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore


def parse_settings(raw: object) -> dict[str, Any]:
    """Decode `threads.settings_json`, failing open to an empty object.

    A corrupt row must not make the thread list unreadable; the next PATCH
    overwrites it with a valid object."""
    if not raw:
        return {}
    try:
        value = json.loads(str(raw))
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


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
    agent_id: str | None = None
    agent_version_id: str | None = None
    # Chat parity fields (prototype session list/header): pinning sorts first,
    # branch_of points at the source conversation, settings carries the
    # composer chips (model/KB/connector/sub-agent/approval policy).
    pinned: bool = False
    branch_of: str | None = None
    settings: dict[str, Any] = field(default_factory=dict)


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
        agent_id=row["agent_id"],
        agent_version_id=row["agent_version_id"],
        pinned=bool(row["pinned"]),
        branch_of=row["branch_of"],
        settings=parse_settings(row["settings_json"]),
    )


def create_thread(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    owner_id: str,
    title: str = "新对话",
    agent_id: str | None = None,
    settings: dict[str, Any] | None = None,
    branch_of: str | None = None,
) -> Thread:
    thread_id = "th_" + secrets.token_hex(12)
    now = int(time.time())
    version_id = None
    if agent_id:
        from polyopus.domains.agents import service as agent_svc

        agent_svc.get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
        version_id = agent_svc.pin_version(
            conn, tenant_id=tenant_id, agent_id=agent_id
        )
    conn.execute(
        """
        INSERT INTO threads
          (tenant_id, thread_id, owner_id, agent_id, agent_version_id, title,
           status, pinned, branch_of, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?)
        """,
        (
            tenant_id, thread_id, owner_id, agent_id, version_id, title,
            branch_of, json.dumps(settings or {}, ensure_ascii=False), now, now,
        ),
    )
    conn.commit()
    return get_thread(conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id)


def update_thread(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    owner_id: str,
    thread_id: str,
    title: str | None = None,
    pinned: bool | None = None,
    settings: dict[str, Any] | None = None,
) -> Thread:
    """Rename / pin / replace composer settings for one session.

    Only fields present in the request change; `settings` is a full
    replacement, which is what the composer's toggle handlers send (they
    always hold the whole object)."""
    current = get_thread(
        conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id
    )
    updates: list[str] = []
    params: list[object] = []
    if title is not None:
        clean = title.strip()
        if not clean:
            raise AppError(
                "VALIDATION_FAILED", details={"fields": {"title": "required"}}
            )
        updates.append("title = ?")
        params.append(clean[:200])
    if pinned is not None:
        updates.append("pinned = ?")
        params.append(1 if pinned else 0)
    if settings is not None:
        merged = {**current.settings, **settings}
        updates.append("settings_json = ?")
        params.append(json.dumps(merged, ensure_ascii=False))
    if updates:
        updates.append("updated_at = ?")
        params.append(int(time.time()))
        params.append(thread_id)
        conn.execute(
            f"UPDATE threads SET {', '.join(updates)} WHERE thread_id = ?", params
        )
        conn.commit()
    return get_thread(
        conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id
    )


def delete_thread(
    conn: sqlite3.Connection, *, tenant_id: str, owner_id: str, thread_id: str
) -> None:
    """Soft-delete: the row and its events stay for audit/replay; list and
    get both filter `deleted_at`."""
    get_thread(conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id)
    now = int(time.time())
    conn.execute(
        "UPDATE threads SET status = 'deleted', deleted_at = ?, updated_at = ? "
        "WHERE thread_id = ?",
        (now, now, thread_id),
    )
    conn.commit()


def branch_thread(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    owner_id: str,
    thread_id: str,
    title: str | None = None,
    up_to_message_id: str | None = None,
) -> Thread:
    """Fork a conversation: same expert/version/settings, copied messages.

    The copy keeps message order and roles but drops `turn_id` (turns belong
    to the original execution); a branch is a fresh start that still shows
    the context it forked from."""
    source = get_thread(
        conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id
    )
    suffix = "（分支）"
    base = (title or source.title or "新对话").strip()
    clone = create_thread(
        conn,
        tenant_id=tenant_id,
        owner_id=owner_id,
        title=(base if base.endswith(suffix) else base + suffix)[:200],
        agent_id=source.agent_id,
        settings=source.settings,
        branch_of=source.thread_id,
    )
    limit_seq: int | None = None
    if up_to_message_id:
        anchor = conn.execute(
            "SELECT seq FROM messages WHERE thread_id = ? AND message_id = ? "
            "AND deleted_at IS NULL",
            (source.thread_id, up_to_message_id),
        ).fetchone()
        if anchor is None:
            raise AppError("MESSAGE_NOT_FOUND", details={
                "messageId": up_to_message_id
            })
        limit_seq = int(anchor["seq"])
    rows = conn.execute(
        "SELECT role, content, status, seq, created_at FROM messages "
        "WHERE thread_id = ? AND deleted_at IS NULL "
        "AND (? IS NULL OR seq <= ?) ORDER BY seq",
        (source.thread_id, limit_seq, limit_seq),
    ).fetchall()
    if rows:
        now = int(time.time())
        for row in rows:
            conn.execute(
                """
                INSERT INTO messages
                  (tenant_id, message_id, thread_id, turn_id, role, content,
                   status, seq, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id, "msg_" + secrets.token_hex(8), clone.thread_id,
                    row["role"], row["content"], row["status"], row["seq"],
                    row["created_at"], now,
                ),
            )
        conn.execute(
            "UPDATE threads SET last_message_at = ?, updated_at = ? WHERE thread_id = ?",
            (now, now, clone.thread_id),
        )
        conn.commit()
    return get_thread(
        conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=clone.thread_id
    )


def list_trace(
    conn: sqlite3.Connection, *, thread_id: str, limit: int = 200
) -> list[dict[str, object]]:
    """Recent event log for the chat Dock's 轨迹/终端 tabs.

    Returns raw rows (payload decoded) so the UI can label tool starts,
    approvals and turn boundaries without a second projection."""
    rows = conn.execute(
        "SELECT seq, type, ts, turn_id, run_id, payload_json FROM events "
        "WHERE thread_id = ? ORDER BY seq DESC LIMIT ?",
        (thread_id, max(1, min(limit, 500))),
    ).fetchall()
    out: list[dict[str, object]] = []
    for row in reversed(rows):
        try:
            payload = json.loads(str(row["payload_json"]))
        except ValueError:
            payload = {}
        out.append(
            {
                "seq": int(row["seq"]),
                "type": str(row["type"]),
                "ts": int(row["ts"]),
                "turnId": row["turn_id"],
                "runId": row["run_id"],
                "payload": payload if isinstance(payload, dict) else {},
            }
        )
    return out


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
    system_thread_ok: bool = False,
    status: str = "queued",
    quota_user_id: str | None = None,
) -> tuple[str, str]:
    """Append a user message + queued turn. Returns (turn_id, message_id).

    `system_thread_ok` lets a human write into a system-owned thread (a
    ticket execution thread — V05-11 human resume); everything else keeps
    the private-by-default ownership check."""
    if system_thread_ok:
        row = conn.execute(
            "SELECT thread_id FROM threads WHERE tenant_id = ? AND thread_id = ? "
            "AND owner_id = 'system' AND deleted_at IS NULL",
            (tenant_id, thread_id),
        ).fetchone()
        if row is None:
            raise AppError("NOT_FOUND", details={"reason": "hidden"})
    else:
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
    # ADR-012: a turn on a ticket execution thread carries the back-reference.
    # Without it the engine cannot see the mandate/source (V05-12 scope gate,
    # V05-16 source-scoped auto-approve).
    ticket_row = conn.execute(
        "SELECT ticket_id FROM timeline_events WHERE kind = 'execution_thread' "
        "AND json_extract(payload_json, '$.thread_id') = ? "
        "ORDER BY id DESC LIMIT 1",
        (thread_id,),
    ).fetchone()
    ticket_id = str(ticket_row[0]) if ticket_row is not None and ticket_row[0] else None

    conn.execute("BEGIN IMMEDIATE")
    try:
        from polyopus.domains.usage import quota as quota_svc

        violation = quota_svc.check(
            conn, tenant_id=tenant_id, user_id=quota_user_id or owner_id,
            model=quota_svc.default_model(conn),
        )
        if violation is not None:
            conn.execute("ROLLBACK")
            from polyopus.domains.notifications import service as notifications

            notifications.notify(
                conn, tenant_id=tenant_id, user_id=quota_user_id or owner_id,
                kind="system", title="配额已超限",
                body=(f"{violation.scope}/{violation.metric} 已用 "
                      f"{violation.used} >= 上限 {violation.limit}"),
                link="/usage",
                dedupe_key=(f"quota:{violation.scope}:{violation.metric}:"
                            f"{violation.window}:{violation.limit}"),
            )
            raise AppError("QUOTA_EXCEEDED", details=violation.details())
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
               ticket_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'act', ?, ?, ?, ?)
            """,
            (tenant_id, turn_id, thread_id, message_id, status, turn_seq,
             ticket_id, now, now),
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


def _turn_for_owner(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    owner_id: str,
    thread_id: str,
    turn_id: str,
) -> sqlite3.Row:
    get_thread(
        conn, tenant_id=tenant_id, owner_id=owner_id, thread_id=thread_id
    )
    row = conn.execute(
        "SELECT * FROM turns WHERE thread_id = ? AND turn_id = ?",
        (thread_id, turn_id),
    ).fetchone()
    if row is None:
        raise AppError("TURN_NOT_FOUND", details={"turnId": turn_id})
    return cast(sqlite3.Row, row)


def stop_turn(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    owner_id: str,
    thread_id: str,
    turn_id: str,
) -> str:
    """Human stop for one turn.

    Queued turns cancel immediately; a streaming turn is flagged and the
    engine aborts on its next delta check; a turn parked on approval is
    cancelled here (no worker is running to observe the flag)."""
    row = _turn_for_owner(
        conn, tenant_id=tenant_id, owner_id=owner_id,
        thread_id=thread_id, turn_id=turn_id,
    )
    status = str(row["status"])
    now = int(time.time())
    if status in ("queued", "picking"):
        conn.execute(
            "UPDATE turns SET status = 'cancelled', updated_at = ? WHERE turn_id = ?",
            (now, turn_id),
        )
        conn.commit()
        store.append(
            thread_id, "turn.finished",
            {"turn_id": turn_id, "status": "cancelled", "duration_ms": 0,
             "finish_reason": "cancelled"},
            tenant_id=tenant_id, turn_id=turn_id,
        )
        return "cancelled"
    if status == "running":
        conn.execute(
            "UPDATE turns SET status = 'cancel_requested', updated_at = ? "
            "WHERE turn_id = ?",
            (now, turn_id),
        )
        conn.commit()
        store.append(
            thread_id, "turn.cancel_requested",
            {"turn_id": turn_id, "by": owner_id},
            tenant_id=tenant_id, turn_id=turn_id,
        )
        return "cancelling"
    if status == "waiting_approval":
        conn.execute(
            "UPDATE turns SET status = 'cancelled', updated_at = ? WHERE turn_id = ?",
            (now, turn_id),
        )
        conn.execute(
            "UPDATE runs SET status = 'cancelled', finished_at = ?, "
            "lease_owner = NULL, lease_until = NULL WHERE turn_id = ? "
            "AND status IN ('leased', 'running', 'waiting')",
            (now, turn_id),
        )
        conn.execute(
            "UPDATE approvals SET status = 'expired', resolved_at = ? "
            "WHERE turn_id = ? AND status = 'pending'",
            (now, turn_id),
        )
        pending = conn.execute(
            "SELECT attention_id FROM attentions WHERE turn_id = ? "
            "AND status = 'pending'",
            (turn_id,),
        ).fetchall()
        for attention in pending:
            conn.execute(
                "UPDATE attentions SET status = 'resolved', resolved_at = ? "
                "WHERE attention_id = ?",
                (now, attention["attention_id"]),
            )
            store.append(
                thread_id, "approval.resolved",
                {"attention_id": attention["attention_id"],
                 "decision": "cancelled"},
                tenant_id=tenant_id, turn_id=turn_id,
            )
        conn.commit()
        store.append(
            thread_id, "turn.finished",
            {"turn_id": turn_id, "status": "cancelled", "duration_ms": 0,
             "finish_reason": "cancelled"},
            tenant_id=tenant_id, turn_id=turn_id,
        )
        return "cancelled"
    return status


def requeue_turn(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    owner_id: str,
    thread_id: str,
    turn_id: str,
    content: str | None = None,
) -> str:
    """Regenerate / edit-and-resend the latest turn.

    The user message is updated in place (edit) or kept (regenerate); the old
    assistant rows are soft-deleted so the next run reconstructs history
    without the answer being replaced. The turn goes back to `queued` and the
    worker picks it up as attempt 2."""
    row = _turn_for_owner(
        conn, tenant_id=tenant_id, owner_id=owner_id,
        thread_id=thread_id, turn_id=turn_id,
    )
    if str(row["status"]) in ("queued", "picking", "running", "waiting_approval"):
        raise AppError(
            "CONFLICT", details={"reason": "turn_active", "turnId": turn_id}
        )
    latest = conn.execute(
        "SELECT turn_id FROM turns WHERE thread_id = ? ORDER BY seq DESC LIMIT 1",
        (thread_id,),
    ).fetchone()
    if latest is None or str(latest[0]) != turn_id:
        raise AppError(
            "CONFLICT", details={"reason": "not_latest_turn", "turnId": turn_id}
        )
    active_run = conn.execute(
        "SELECT 1 FROM runs WHERE turn_id = ? AND status IN "
        "('leased', 'running', 'waiting') LIMIT 1",
        (turn_id,),
    ).fetchone()
    if active_run is not None:
        raise AppError(
            "CONFLICT", details={"reason": "run_active", "turnId": turn_id}
        )
    now = int(time.time())
    if content is not None:
        clean = content.strip()
        if not clean:
            raise AppError(
                "VALIDATION_FAILED", details={"fields": {"content": "required"}}
            )
        cur = conn.execute(
            "UPDATE messages SET content = ?, updated_at = ? "
            "WHERE turn_id = ? AND role = 'user' AND deleted_at IS NULL",
            (clean, now, turn_id),
        )
        if cur.rowcount == 0:
            raise AppError("MESSAGE_NOT_FOUND", details={"turnId": turn_id})
    conn.execute(
        "UPDATE messages SET deleted_at = ?, updated_at = ? "
        "WHERE turn_id = ? AND role = 'assistant' AND deleted_at IS NULL",
        (now, now, turn_id),
    )
    conn.execute(
        "UPDATE turns SET status = 'queued', updated_at = ? WHERE turn_id = ?",
        (now, turn_id),
    )
    conn.commit()
    store.append(
        thread_id,
        "turn.requeued",
        {"turn_id": turn_id, "by": owner_id,
         "reason": "edit" if content is not None else "regenerate"},
        tenant_id=tenant_id, turn_id=turn_id,
    )
    return turn_id


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
