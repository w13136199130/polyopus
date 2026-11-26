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
    # Human-readable name for the approval card (MCP tools are stored under a
    # machine key like `mcp.ci_x.server.weather`; the label is `天气 · Fake MCP`).
    tool_label: str = ""
    source: str = "builtin"
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
    ticket_id: str | None = None,
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
                    "tool_label": req.tool_label or req.tool,
                    "source": req.source,
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
            VALUES (?, ?, ?, ?, 'approval', 'approval', ?, ?, 'pending', ?, ?)
            """,
            (tenant_id, attention_id, ticket_id, turn_id, approval_id,
             json.dumps(
                 {
                     "summary": req.summary or req.tool,
                     # the inbox must answer "what exactly needs approval"
                     # without a second round-trip to the approval row
                     "actions": [
                         {
                             "tool": req.tool,
                             "tool_label": req.tool_label or req.tool,
                             "source": req.source,
                             "args_preview": req.args_preview[:200],
                             "risk": req.risk,
                         }
                     ],
                 },
                 ensure_ascii=False,
             ),
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
                {
                    "tool": req.tool,
                    "tool_label": req.tool_label or req.tool,
                    "source": req.source,
                    "args_preview": req.args_preview[:500],
                    "risk": req.risk,
                }
            ],
            "allowed_decisions": list(req.allowed_decisions),
            "expires_at": ts + ttl_seconds,
            "summary": req.summary or req.tool,
        },
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )
    from polyopus.domains.notifications import service as notifications

    notifications.notify_thread(
        conn, tenant_id=tenant_id, thread_id=thread_id, kind="task",
        title=f"需要审批：{req.summary or req.tool_label or req.tool}",
        body=f"{req.tool_label or req.tool} · 风险 {req.risk}",
        link="/chat", dedupe_key=f"approval:{approval_id}",
    )
    return approval_id, attention_id


def _remember_session_approval(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    thread_id: str,
    request_json: str,
    now: int,
) -> None:
    """Persist one tool key into the thread's session approval list.

    The composer sends the whole settings object, so this must read-modify-write
    instead of replacing it. Malformed JSON degrades to `{}` (old threads keep
    working) and duplicate approvals are idempotent."""
    try:
        payload = json.loads(request_json)
        action = (payload.get("actions") or [{}])[0]
        tool = str(action.get("tool") or "")
    except (ValueError, TypeError, IndexError, AttributeError):
        return
    if not tool:
        return
    row = conn.execute(
        "SELECT settings_json FROM threads WHERE tenant_id = ? AND thread_id = ?",
        (tenant_id, thread_id),
    ).fetchone()
    if row is None:
        return
    try:
        settings = json.loads(str(row["settings_json"] or "{}"))
    except (ValueError, TypeError):
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    approved = settings.get("approvedTools")
    tools = [str(item) for item in approved] if isinstance(approved, list) else []
    if tool not in tools:
        tools.append(tool)
    settings["approvedTools"] = tools
    conn.execute(
        "UPDATE threads SET settings_json = ?, updated_at = ?, version = version + 1 "
        "WHERE tenant_id = ? AND thread_id = ?",
        (json.dumps(settings, ensure_ascii=False), now, tenant_id, thread_id),
    )


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
            "SELECT status, turn_id, run_id, expires_at, request_json FROM approvals "
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
        attention = conn.execute(
            "SELECT ticket_id FROM attentions WHERE source_type = 'approval'"
            " AND source_id = ? AND status = 'pending' LIMIT 1",
            (approval_id,),
        ).fetchone()
        conn.execute(
            "UPDATE attentions SET status = 'answered', resolved_at = ? "
            "WHERE source_type = 'approval' AND source_id = ? AND status = 'pending'",
            (ts, approval_id),
        )
        if attention is not None and attention["ticket_id"]:
            # The task is no longer waiting for a human decision; resume runs
            # behind the scenes, so flip the task card immediately.
            conn.execute(
                "UPDATE tickets SET bucket = 'running', updated_at = ?"
                " WHERE tenant_id = ? AND ticket_id = ? AND state = 'open'"
                " AND bucket = 'attention'",
                (ts, tenant_id, str(attention["ticket_id"])),
            )
        if decision == "approved_session":
            _remember_session_approval(
                conn, tenant_id=tenant_id, thread_id=thread_id,
                request_json=str(row["request_json"]), now=ts,
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


def expire_due(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    now: int | None = None,
    tenant_id: str | None = None,
) -> list[dict[str, str]]:
    """V05-16 sweep: pending approvals past `expires_at` become `expired`.

    Returns the approvals that flipped so the caller can resume their turns
    with a denied decision (docs/09 §9: 拒绝并记 expired). The CAS on
    `status='pending'` makes concurrent sweeps harmless.
    """
    ts = now or int(time.time())
    where = ("a.status = 'pending' AND a.expires_at IS NOT NULL "
             "AND a.expires_at < ?")
    params: list[object] = [ts]
    if tenant_id is not None:
        where += " AND a.tenant_id = ?"
        params.append(tenant_id)
    rows = conn.execute(
        "SELECT a.approval_id, a.tenant_id, a.turn_id, t.thread_id,"
        " (SELECT at.ticket_id FROM attentions at"
        "  WHERE at.source_type = 'approval' AND at.source_id = a.approval_id"
        "  LIMIT 1) AS ticket_id "
        "FROM approvals a LEFT JOIN turns t ON t.turn_id = a.turn_id "
        f"WHERE {where}",
        params,
    ).fetchall()

    expired: list[dict[str, str]] = []
    for row in rows:
        conn.execute("BEGIN IMMEDIATE")
        try:
            changed = conn.execute(
                "UPDATE approvals SET status = 'expired', resolved_at = ? "
                "WHERE approval_id = ? AND status = 'pending'",
                (ts, row["approval_id"]),
            ).rowcount
            if not changed:
                conn.execute("ROLLBACK")
                continue
            conn.execute(
                "UPDATE attentions SET status = 'expired', resolved_at = ? "
                "WHERE source_type = 'approval' AND source_id = ? "
                "AND status = 'pending'",
                (ts, row["approval_id"]),
            )
            conn.commit()
        except Exception:
            conn.execute("ROLLBACK")
            raise

        approval_id = str(row["approval_id"])
        turn_id = str(row["turn_id"])
        thread_id = str(row["thread_id"] or "")
        if thread_id:
            store.append(
                thread_id,
                "approval.resolved",
                {"approval_id": approval_id, "decision": "expired"},
                tenant_id=str(row["tenant_id"]),
                turn_id=turn_id,
            )
        expired.append(
            {"approvalId": approval_id, "turnId": turn_id,
             "threadId": thread_id, "ticketId": str(row["ticket_id"] or "")}
        )
    return expired


def dismiss_for_ticket(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    thread_id: str,
    ticket_id: str,
    kinds: tuple[str, ...] | None = None,
    by: str = "system",
) -> list[str]:
    """Close pending attentions a terminal ticket action made moot.

    Pending approvals are invalidated as `expired` first, so neither the TTL
    sweep nor a late card/text answer can resume a stopped ticket. The
    attention rows end as `dismissed` (docs/32 attention state machine).
    """
    clauses = ["tenant_id = ?", "ticket_id = ?", "status = 'pending'"]
    params: list[object] = [tenant_id, ticket_id]
    if kinds:
        clauses.append("kind IN (" + ",".join("?" for _ in kinds) + ")")
        params.extend(kinds)
    where = " AND ".join(clauses)
    rows = conn.execute(
        "SELECT attention_id, source_type, source_id, turn_id FROM attentions"
        f" WHERE {where}",
        params,
    ).fetchall()
    if not rows:
        return []

    ts = int(time.time())
    conn.execute(
        f"UPDATE attentions SET status = 'dismissed', resolved_at = ? WHERE {where}",
        [ts, *params],
    )
    for row in rows:
        if str(row["source_type"]) != "approval":
            continue
        conn.execute(
            "UPDATE approvals SET status = 'expired', resolved_at = ?"
            " WHERE tenant_id = ? AND approval_id = ? AND status = 'pending'",
            (ts, tenant_id, str(row["source_id"])),
        )
    conn.commit()

    dismissed: list[str] = []
    for row in rows:
        attention_id = str(row["attention_id"])
        dismissed.append(attention_id)
        turn_id = str(row["turn_id"] or "")
        store.append(
            thread_id,
            "attention.resolved",
            {"attention_id": attention_id, "status": "dismissed", "by": by},
            tenant_id=tenant_id,
            turn_id=turn_id or None,
        )
    return dismissed


def pending_for_run(conn: sqlite3.Connection, run_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM approvals WHERE run_id = ? AND status = 'pending'", (run_id,)
        ).fetchall()
    )
