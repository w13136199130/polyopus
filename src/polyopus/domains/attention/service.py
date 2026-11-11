"""Approval lifecycle owned by the attention domain (ADR-001).

The kernel never writes `approvals` itself: it calls `request()` here,
which opens an approval row + an attention row + two events in one
transaction, then releases the run lease. Resuming is triggered by
`attention.resolved`, never by polling.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from dataclasses import dataclass

from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

DEFAULT_TTL_SECONDS = 30 * 60


@dataclass(frozen=True)
class ApprovalRequest:
    tool: str
    args_preview: str
    risk: str = "high"
    summary: str = ""
    args_json: str = ""  # full arguments; resume executes from these
    # thinking-model reasoning for this tool call; must be replayed on resume
    reasoning: str = ""
    allowed_decisions: tuple[str, ...] = ("approve", "approve_session", "deny")


def request(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    thread_id: str,
    turn_id: str,
    run_id: str,
    step_idx: int,
    req: ApprovalRequest,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    now: int | None = None,
) -> tuple[str, str]:
    """Create approval + attention rows and emit events. Returns (approval_id, attention_id)."""
    ts = now or int(time.time())
    approval_id = "ap_" + secrets.token_hex(8)
    attention_id = "at_" + secrets.token_hex(8)
    request_json = json.dumps(
        {
            "actions": [
                {
                    "tool": req.tool,
                    "args_preview": req.args_preview[:500],
                    "risk": req.risk,
                    "args_json": req.args_json,
                }
            ],
            "allowed_decisions": list(req.allowed_decisions),
            "reasoning_content": req.reasoning,
        },
        ensure_ascii=False,
    )

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            """
            INSERT INTO approvals
              (tenant_id, approval_id, turn_id, run_id, step_idx, request_json,
               status, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (tenant_id, approval_id, turn_id, run_id, step_idx, request_json,
             ts + ttl_seconds, ts),
        )
        conn.execute(
            """
            INSERT INTO attentions
              (tenant_id, attention_id, ticket_id, turn_id, kind, source_type,
               source_id, payload_json, status, expires_at, created_at)
            VALUES (?, ?, NULL, ?, 'approval', 'approval', ?, ?, 'pending', ?, ?)
            """,
            (tenant_id, attention_id, turn_id, approval_id,
             json.dumps({"summary": req.summary or req.tool}, ensure_ascii=False),
             ts + ttl_seconds, ts),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.execute("ROLLBACK")
        existing = conn.execute(
            "SELECT approval_id FROM approvals WHERE run_id = ? AND step_idx = ?",
            (run_id, step_idx),
        ).fetchone()
        if existing:
            return str(existing[0]), ""
        raise AppError("CONFLICT") from None

    store.append(
        thread_id,
        "approval.requested",
        {
            "approval_id": approval_id,
            "actions": [
                {"tool": req.tool, "args_preview": req.args_preview[:500], "risk": req.risk}
            ],
            "allowed_decisions": list(req.allowed_decisions),
            "expires_at": ts + ttl_seconds,
            "summary": req.summary or req.tool,
        },
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )
    return approval_id, attention_id


def resolve(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    thread_id: str,
    approval_id: str,
    decision: str,
    by: str,
    now: int | None = None,
) -> str:
    """CAS pending -> terminal; emits approval.resolved + attention.resolved."""
    if decision not in ("approved", "approved_session", "denied"):
        raise AppError("DECISION_INVALID", details={"decision": decision})
    ts = now or int(time.time())

    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT status, turn_id, run_id, expires_at FROM approvals "
            "WHERE tenant_id = ? AND approval_id = ?",
            (tenant_id, approval_id),
        ).fetchone()
        if row is None:
            raise AppError("ATTENTION_NOT_FOUND")
        status = str(row["status"])
        if status != "pending":
            raise AppError("ATTENTION_ALREADY_RESOLVED", details={"status": status})
        if row["expires_at"] and int(row["expires_at"]) < ts:
            conn.execute("ROLLBACK")
            return _expire(conn, store, tenant_id=tenant_id, thread_id=thread_id,
                           approval_id=approval_id, turn_id=str(row["turn_id"]))
        conn.execute(
            "UPDATE approvals SET status = ?, resolved_at = ?, decisions_json = ? "
            "WHERE approval_id = ? AND status = 'pending'",
            (decision, ts, json.dumps({"by": by, "decision": decision}), approval_id),
        )
        conn.execute(
            "UPDATE attentions SET status = 'answered', resolved_at = ? "
            "WHERE source_type = 'approval' AND source_id = ? AND status = 'pending'",
            (ts, approval_id),
        )
        conn.commit()
    except AppError:
        conn.execute("ROLLBACK")
        raise

    store.append(
        thread_id,
        "approval.resolved",
        {"approval_id": approval_id, "decision": decision, "by": by},
        tenant_id=tenant_id,
        turn_id=str(row["turn_id"]),
        run_id=str(row["run_id"]),
    )
    return decision


def _expire(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    thread_id: str,
    approval_id: str,
    turn_id: str,
) -> str:
    ts = int(time.time())
    conn.execute(
        "UPDATE approvals SET status = 'expired', resolved_at = ? "
        "WHERE approval_id = ? AND status = 'pending'",
        (ts, approval_id),
    )
    conn.execute(
        "UPDATE attentions SET status = 'expired', resolved_at = ? "
        "WHERE source_type = 'approval' AND source_id = ? AND status = 'pending'",
        (ts, approval_id),
    )
    conn.commit()
    store.append(
        thread_id,
        "approval.resolved",
        {"approval_id": approval_id, "decision": "expired"},
        tenant_id=tenant_id,
        turn_id=turn_id,
    )
    return "denied"


def pending_for_run(conn: sqlite3.Connection, run_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM approvals WHERE run_id = ? AND status = 'pending'", (run_id,)
        ).fetchall()
    )
