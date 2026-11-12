"""Tickets: assignment, budget gate, report, stop, watchdog (slice ② cards 4-6).

The executor is the builtin engine: a ticket's work lands on its execution
thread as a turn (ADR-012) and only ever influences the ticket through a
Report. The ticket->thread link is recorded as a timeline event (the table
exists exactly for this) instead of a fragile join.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from polyopus.workers.engine import EngineConfig

from polyopus.domains import conversations
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

TENANT = "default"
EXECUTOR = "builtin"
HEARTBEAT_STALE_SECONDS = 120
MAX_REQUEUES = 2


def _now() -> int:
    return int(time.time())


def _ticket(conn: sqlite3.Connection, ticket_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ?", (TENANT, ticket_id)
    ).fetchone()
    if row is None:
        raise AppError("TICKET_NOT_FOUND")
    return row  # type: ignore[no-any-return]


def link_thread(
    conn: sqlite3.Connection, ticket_id: str, thread_id: str
) -> None:
    conn.execute(
        """
        INSERT INTO timeline_events
          (event_id, tenant_id, ticket_id, kind, title, actor, payload_json, created_at)
        VALUES (?, ?, ?, 'execution_thread', '执行线程已关联', 'system', ?, ?)
        """,
        ("tl_" + secrets.token_hex(8), TENANT, ticket_id,
         json.dumps({"thread_id": thread_id}), _now()),
    )
    conn.commit()


def thread_of_ticket(conn: sqlite3.Connection, ticket_id: str) -> str:
    row = conn.execute(
        "SELECT payload_json FROM timeline_events WHERE ticket_id = ? "
        "AND kind = 'execution_thread' ORDER BY id DESC LIMIT 1",
        (ticket_id,),
    ).fetchone()
    if row is None or not row[0]:
        raise AppError("TICKET_NOT_FOUND", details={"missing": "execution_thread"})
    return str(json.loads(row[0])["thread_id"])


@dataclass(frozen=True)
class Budget:
    max_total_tokens: int | None = None

    @staticmethod
    def of(ticket_row: sqlite3.Row) -> Budget:
        raw = ticket_row["budget_json"]
        if not raw:
            return Budget()
        data: dict[str, Any] = json.loads(raw)
        value = data.get("max_total_tokens")
        return Budget(max_total_tokens=int(value) if value else None)


# ---- card 4: assignment + run + report --------------------------------------


def assign(conn: sqlite3.Connection, store: EventStore, ticket_id: str) -> str:
    """Create the next assignment; UNIQUE(ticket, attempt) arbitrates races.

    Two workers claiming the same queued ticket compute the same next
    attempt number; exactly one INSERT succeeds (docs/48 V05-07) — the loser
    sees sqlite3.IntegrityError and skips.
    """
    _ticket(conn, ticket_id)
    thread_id = thread_of_ticket(conn, ticket_id)
    assignment_id = "as_" + secrets.token_hex(8)
    now = _now()
    attempt = int(
        conn.execute(
            "SELECT COALESCE(MAX(attempt), 0) + 1 FROM assignments WHERE ticket_id = ?",
            (ticket_id,),
        ).fetchone()[0]
    )
    conn.execute(
        """
        INSERT INTO assignments
          (tenant_id, assignment_id, ticket_id, executor, state, attempt, started_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
        """,
        (TENANT, assignment_id, ticket_id, EXECUTOR, attempt, now),
    )
    conn.execute(
        "UPDATE tickets SET bucket = 'running', updated_at = ? WHERE ticket_id = ?",
        (now, ticket_id),
    )
    conn.commit()
    store.append(
        thread_id,
        "assignment.started",
        {"assignment_id": assignment_id, "ticket_id": ticket_id,
         "executor_kind": EXECUTOR, "attempt": attempt},
        tenant_id=TENANT,
    )
    return assignment_id


def _default_engine_config() -> EngineConfig:
    """Ticket turns get the same workspace/tool wiring as chat turns."""
    from pathlib import Path

    from polyopus.config import load_settings
    from polyopus.workers.engine import EngineConfig

    path = Path(load_settings().workspace_dir)
    path.mkdir(parents=True, exist_ok=True)
    return EngineConfig(workspace=path)


def _usage_of_thread(conn: sqlite3.Connection, thread_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM usage_ledger "
        "WHERE turn_id IN (SELECT turn_id FROM turns WHERE thread_id = ?)",
        (thread_id,),
    ).fetchone()
    return int(row[0])


def run_assignment(
    conn: sqlite3.Connection,
    store: EventStore,
    ticket_id: str,
    *,
    content: str | None = None,
    engine_config: EngineConfig | None = None,
) -> str:
    """Drive one assignment to a Report. Returns the report state."""
    from polyopus.workers import engine

    ticket = _ticket(conn, ticket_id)
    thread_id = thread_of_ticket(conn, ticket_id)
    budget = Budget.of(ticket)
    assignment_id = assign(conn, store, ticket_id)

    conn.execute(
        "UPDATE assignments SET state = 'running', heartbeat_at = ? "
        "WHERE assignment_id = ?",
        (_now(), assignment_id),
    )
    conn.commit()

    text = content or str(ticket["title"])
    turn_id, _ = conversations.post_turn(
        conn, store,
        tenant_id=TENANT, owner_id="system", thread_id=thread_id, content=text,
    )
    try:
        config = engine_config or _default_engine_config()
        result = asyncio.run(
            engine.run_turn(conn, store, turn_id, owner=f"as:{assignment_id}",
                            config=config)
        )
        status = result if result in ("completed", "waiting_approval") else "failed"
    except AppError as exc:
        if exc.normalized_code() == "THREAD_TURN_ACTIVE":
            status = "waiting_approval"
        else:
            raise

    total_tokens = _usage_of_thread(conn, thread_id)
    exceeded = (
        budget.max_total_tokens is not None
        and total_tokens > budget.max_total_tokens
    )
    if exceeded:
        state = "blocked"
    elif status == "completed":
        state = "ready"
    else:
        state = "waiting" if status == "waiting_approval" else "failed"

    summary = (
        f"预算超限：已用 {total_tokens} tokens > 上限 {budget.max_total_tokens}"
        if exceeded
        else f"执行 {status}（{total_tokens} tokens）"
    )
    _record_report(conn, store, ticket_id, assignment_id, thread_id, state,
                   summary, facts={"total_tokens": total_tokens})

    now = _now()
    conn.execute(
        "UPDATE assignments SET state = 'ended', ended_at = ? WHERE assignment_id = ?",
        (now, assignment_id),
    )
    conn.commit()
    store.append(
        thread_id,
        "assignment.ended",
        {"assignment_id": assignment_id, "state": "ended", "reason": state},
        tenant_id=TENANT,
    )

    if exceeded:
        _block_on_budget(conn, store, ticket_id, thread_id, summary)
    elif state == "ready":
        conn.execute(
            "UPDATE tickets SET state = 'ended', bucket = 'done', ended_at = ?, "
            "updated_at = ? WHERE ticket_id = ?",
            (now, now, ticket_id),
        )
        conn.commit()
        store.append(
            thread_id,
            "ticket.ended",
            {"ticket_id": ticket_id, "reason": "completed", "summary": summary},
            tenant_id=TENANT,
        )
    else:
        conn.execute(
            "UPDATE tickets SET bucket = 'attention', updated_at = ? "
            "WHERE ticket_id = ?",
            (_now(), ticket_id),
        )
        conn.commit()
    return state


def _record_report(
    conn: sqlite3.Connection,
    store: EventStore,
    ticket_id: str,
    assignment_id: str,
    thread_id: str,
    state: str,
    summary: str,
    *,
    facts: dict[str, Any] | None = None,
) -> None:
    report_id = "rp_" + secrets.token_hex(8)
    conn.execute(
        """
        INSERT INTO reports
          (report_id, tenant_id, ticket_id, assignment_id, state, summary,
           progress, facts_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (report_id, TENANT, ticket_id, assignment_id, state, summary,
         1.0 if state == "ready" else 0.0,
         json.dumps(facts or {}, ensure_ascii=False), _now()),
    )
    conn.commit()
    store.append(
        thread_id,
        "assignment.reported",
        {
            "assignment_id": assignment_id,
            "state": state,
            "summary": summary,
            "facts": facts or {},
        },
        tenant_id=TENANT,
    )


def _block_on_budget(
    conn: sqlite3.Connection, store: EventStore, ticket_id: str, thread_id: str,
    summary: str,
) -> None:
    """Card 5: budget overrun -> ticket lands in the attention inbox."""
    attention_id = "at_" + secrets.token_hex(8)
    now = _now()
    expires = now + 24 * 3600
    conn.execute(
        """
        INSERT INTO attentions
          (tenant_id, attention_id, ticket_id, turn_id, kind, source_type,
           source_id, payload_json, status, expires_at, created_at)
        VALUES (?, ?, ?, NULL, 'blocked', 'ticket', ?, ?, 'pending', ?, ?)
        """,
        (TENANT, attention_id, ticket_id, ticket_id,
         json.dumps({"summary": summary}, ensure_ascii=False), expires, now),
    )
    conn.execute(
        "UPDATE tickets SET bucket = 'attention', updated_at = ? WHERE ticket_id = ?",
        (now, ticket_id),
    )
    conn.commit()
    store.append(
        thread_id,
        "attention.requested",
        {
            "attention_id": attention_id,
            "ticket_id": ticket_id,
            "kind": "blocked",
            "question": summary,
            "expires_at": expires,
        },
        tenant_id=TENANT,
    )


# ---- card 6: human stop + watchdog ------------------------------------------


def stop(
    conn: sqlite3.Connection, store: EventStore, ticket_id: str, by: str
) -> None:
    """Human stop (docs/09 §7.1): end the ticket, cancel assignments,
    invalidate the mandate."""
    _ticket(conn, ticket_id)
    thread_id = thread_of_ticket(conn, ticket_id)
    now = _now()

    active = conn.execute(
        "SELECT assignment_id FROM assignments WHERE ticket_id = ? "
        "AND state IN ('pending', 'running')",
        (ticket_id,),
    ).fetchall()
    for row in active:
        conn.execute(
            "UPDATE assignments SET state = 'ended', ended_at = ? "
            "WHERE assignment_id = ?",
            (now, row["assignment_id"]),
        )
        store.append(
            thread_id,
            "assignment.ended",
            {"assignment_id": row["assignment_id"], "state": "ended",
             "reason": "stopped_by_human"},
            tenant_id=TENANT,
        )
    conn.execute(
        "UPDATE mandates SET invalidated_at = ? WHERE ticket_id = ?",
        (now, ticket_id),
    )
    conn.execute(
        "UPDATE tickets SET state = 'ended', bucket = 'done', ended_at = ?, "
        "updated_at = ? WHERE ticket_id = ?",
        (now, now, ticket_id),
    )
    conn.commit()
    store.append(
        thread_id,
        "ticket.ended",
        {"ticket_id": ticket_id, "reason": "stopped_by_human", "by": by},
        tenant_id=TENANT,
    )


def watchdog_scan(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    stale_seconds: int = HEARTBEAT_STALE_SECONDS,
) -> list[dict[str, Any]]:
    """Card 6: stalled assignments get an alert; requeue capped, then dead."""
    now = _now()
    stale_before = now - stale_seconds
    rows = conn.execute(
        "SELECT * FROM assignments WHERE state = 'running' AND "
        "(heartbeat_at IS NULL OR heartbeat_at < ?)",
        (stale_before,),
    ).fetchall()
    alerts: list[dict[str, Any]] = []
    for row in rows:
        assignment_id = str(row["assignment_id"])
        ticket_id = str(row["ticket_id"])
        thread_id = thread_of_ticket(conn, ticket_id)
        prior = conn.execute(
            "SELECT count(*) FROM watchdog_alerts WHERE assignment_id = ?",
            (assignment_id,),
        ).fetchone()[0]
        action = "requeue" if int(prior) < MAX_REQUEUES else "stop"
        detail = f"heartbeat stale > {stale_seconds}s (alert #{int(prior) + 1})"

        conn.execute(
            """
            INSERT INTO watchdog_alerts
              (alert_id, tenant_id, assignment_id, kind, detail, action,
               status, created_at)
            VALUES (?, ?, ?, 'stalled', ?, ?, 'open', ?)
            """,
            ("wa_" + secrets.token_hex(8), TENANT, assignment_id, detail,
             action, now),
        )
        if action == "requeue":
            conn.execute(
                "UPDATE assignments SET state = 'pending' WHERE assignment_id = ?",
                (assignment_id,),
            )
            conn.execute(
                "UPDATE tickets SET bucket = 'queued', updated_at = ? "
                "WHERE ticket_id = ?",
                (now, ticket_id),
            )
        else:
            conn.execute(
                "UPDATE assignments SET state = 'dead', ended_at = ? "
                "WHERE assignment_id = ?",
                (now, assignment_id),
            )
        conn.commit()
        store.append(
            thread_id,
            "watchdog.alert",
            {"assignment_id": assignment_id, "kind": "stalled",
             "detail": detail, "action": action},
            tenant_id=TENANT,
        )
        alerts.append({"assignmentId": assignment_id, "action": action})
    return alerts
