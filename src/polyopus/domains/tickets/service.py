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


def _latest_human_message(conn: sqlite3.Connection, ticket_id: str) -> str:
    """The ticket's newest human instruction (V05-11), '' when none."""
    row = conn.execute(
        "SELECT payload_json FROM timeline_events "
        "WHERE ticket_id = ? AND kind = 'human_message' ORDER BY id DESC LIMIT 1",
        (ticket_id,),
    ).fetchone()
    if row is None:
        return ""
    return str(json.loads(row[0]).get("content", "")).strip()


def _ticket(
    conn: sqlite3.Connection, ticket_id: str, tenant_id: str | None = None
) -> sqlite3.Row:
    if tenant_id is None:
        row = conn.execute(
            "SELECT * FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ?",
            (tenant_id, ticket_id),
        ).fetchone()
    if row is None:
        raise AppError("TICKET_NOT_FOUND")
    return row  # type: ignore[no-any-return]


def _tenant_of_ticket(conn: sqlite3.Connection, ticket_id: str) -> str:
    row = conn.execute(
        "SELECT tenant_id FROM tickets WHERE ticket_id = ?", (ticket_id,)
    ).fetchone()
    return str(row[0]) if row is not None and row[0] else TENANT


def link_thread(
    conn: sqlite3.Connection, ticket_id: str, thread_id: str
) -> None:
    tenant = _tenant_of_ticket(conn, ticket_id)
    conn.execute(
        """
        INSERT INTO timeline_events
          (event_id, tenant_id, ticket_id, kind, title, actor, payload_json, created_at)
        VALUES (?, ?, ?, 'execution_thread', '执行线程已关联', 'system', ?, ?)
        """,
        ("tl_" + secrets.token_hex(8), tenant, ticket_id,
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


def ticket_of_thread(conn: sqlite3.Connection, thread_id: str) -> str | None:
    """Reverse lookup: the ticket whose execution thread this is, or None
    for a plain chat thread (V05-11 wake hook)."""
    row = conn.execute(
        "SELECT ticket_id FROM timeline_events WHERE kind = 'execution_thread' "
        "AND json_extract(payload_json, '$.thread_id') = ? "
        "ORDER BY id DESC LIMIT 1",
        (thread_id,),
    ).fetchone()
    return str(row[0]) if row is not None else None


# ---- V05-11: human message resume (S8) ----------------------------------------


def post_human_message(
    conn: sqlite3.Connection,
    store: EventStore,
    ticket_id: str,
    *,
    user_id: str,
    content: str,
    tenant_id: str | None = None,
) -> dict[str, object]:
    """A human message on the ticket's execution thread. A parked OPEN
    ticket resumes once this turn completes (wake_thread_ticket); an ENDED
    ticket just records the message — never resurrected (new work on the
    event thread opens a NEW ticket via intake, V05-10 release)."""
    ticket = _ticket(conn, ticket_id, tenant_id)
    tenant = str(ticket["tenant_id"] or TENANT)
    thread_id = thread_of_ticket(conn, ticket_id)
    from polyopus.domains import conversations

    turn_id, message_id = conversations.post_turn(
        conn, store, tenant_id=tenant, owner_id=user_id,
        thread_id=thread_id, content=content, system_thread_ok=True,
    )
    conn.execute(
        """
        INSERT INTO timeline_events
          (event_id, tenant_id, ticket_id, kind, title, actor, payload_json,
           created_at)
        VALUES (?, ?, ?, 'human_message', '人工消息', ?, ?, ?)
        """,
        ("tl_" + secrets.token_hex(8), tenant, ticket_id, user_id,
         json.dumps({"turn_id": turn_id, "message_id": message_id,
                     "content": content[:120]}, ensure_ascii=False), _now()),
    )
    conn.commit()
    return {
        "turnId": turn_id,
        "messageId": message_id,
        "resumed": False if str(ticket["state"]) != "open" else "pending",
    }


def finish_after_attention(
    conn: sqlite3.Connection, store: EventStore, ticket_id: str, *,
    decision: str,
    expired: bool = False,
) -> str:
    """Close a ticket whose approval was answered inline (P2 交互还原).

    The approval-resume turn never re-enters run_assignment's tail, so the
    parked ticket would sit in `attention` with nothing pending. This writes
    the closing Report, ends the ticket and releases subscriptions — the
    same effects the assignment path produces, minus a re-run."""
    ticket = _ticket(conn, ticket_id)
    if str(ticket["state"]) != "open":
        return "already_ended"
    tenant = str(ticket["tenant_id"] or TENANT)
    thread_id = thread_of_ticket(conn, ticket_id)
    summary = (
        "审批已过期，自动拒绝，工单收尾" if expired
        else f"审批已处理（{ '允许' if decision.startswith('approved') else '拒绝' }），"
             "工单收尾"
    )
    assignment = conn.execute(
        "SELECT assignment_id FROM assignments WHERE ticket_id = ? "
        "ORDER BY id DESC LIMIT 1", (ticket_id,),
    ).fetchone()
    _record_report(
        conn, store, ticket_id,
        str(assignment["assignment_id"]) if assignment else "as_inline",
        thread_id, "ready", summary, facts={},
    )
    try:
        from polyopus.domains.channels import service as channels

        channels.enqueue_ticket_reply(
            conn, ticket_id=ticket_id,
            state=(
                "expired" if expired
                else "ready" if decision.startswith("approved") else "denied"
            ),
            summary=summary,
        )
    except Exception:  # noqa: BLE001 - IM delivery is advisory
        pass
    now = _now()
    conn.execute(
        "UPDATE assignments SET state = 'ended', ended_at = ? "
        "WHERE ticket_id = ? AND state IN ('pending', 'running')", (now, ticket_id),
    )
    conn.execute(
        "UPDATE tickets SET state = 'ended', bucket = 'done', ended_at = ?, "
        "updated_at = ? WHERE ticket_id = ? AND state = 'open'",
        (now, now, ticket_id),
    )
    conn.commit()
    _release_subscriptions(conn, ticket_id)
    store.append(
        thread_id, "ticket.ended",
        {"ticket_id": ticket_id, "reason": "attention_resolved",
         "decision": decision, "summary": summary},
        tenant_id=tenant,
    )
    return "ended"


def wake_thread_ticket(
    conn: sqlite3.Connection, store: EventStore, thread_id: str, turn_id: str
) -> bool:
    """Called when a turn COMPLETES on a thread: re-queue the parked open
    ticket this thread belongs to — but ONLY when the completing turn is the
    ticket's latest human message (S8 人消息恢复). Auto/approval-resume turns
    must not wake the ticket: re-running would re-send the old prompt and
    loop straight back into the same pause. Best-effort, never raises."""
    try:
        ticket_id = ticket_of_thread(conn, thread_id)
        if ticket_id is None:
            return False
        tenant = _tenant_of_ticket(conn, ticket_id)
        actor_row = conn.execute(
            "SELECT actor, payload_json FROM timeline_events "
            "WHERE ticket_id = ? AND kind = 'human_message' ORDER BY id DESC LIMIT 1",
            (ticket_id,),
        ).fetchone()
        if actor_row is None:
            return False  # no human message: auto/approval turn — leave the park
        payload = json.loads(actor_row[1])
        if str(payload.get("turn_id", "")) != turn_id:
            return False
        cur = conn.execute(
            "UPDATE tickets SET bucket = 'queued', updated_at = ? "
            "WHERE tenant_id = ? AND ticket_id = ? AND state = 'open' "
            "AND bucket = 'attention'",
            (_now(), tenant, ticket_id),
        )
        conn.commit()
        if not cur.rowcount:
            return False
        store.append(
            thread_id,
            "ticket.resumed",
            {
                "ticket_id": ticket_id,
                "by": str(actor_row[0]),
                "input_id": str(payload.get("message_id", "")),
            },
            tenant_id=tenant,
        )
        return True
    except Exception:  # noqa: BLE001 - the turn already finished; wake is extra
        return False


@dataclass(frozen=True)
class Budget:
    max_total_tokens: int | None = None
    max_cost_micros: int | None = None

    @staticmethod
    def of(ticket_row: sqlite3.Row) -> Budget:
        raw = ticket_row["budget_json"]
        if not raw:
            return Budget()
        data: dict[str, Any] = json.loads(raw)
        tokens = data.get("max_total_tokens")
        cost = data.get("max_cost_micros")
        return Budget(
            max_total_tokens=int(tokens) if tokens else None,
            max_cost_micros=int(cost) if cost else None,
        )


def _budget_exceeded(
    conn: sqlite3.Connection, ticket: sqlite3.Row, budget: Budget
) -> tuple[bool, str]:
    """V05-18 three-layer budget check: ticket (tokens/cost), source/day,
    instance/day. Returns (exceeded, reason)."""
    from polyopus.config import load_settings
    from polyopus.domains.intake import service as intake
    from polyopus.domains.usage import service as usage_svc

    ticket_id = str(ticket["ticket_id"])
    tenant = str(ticket["tenant_id"] or TENANT)
    thread_id = thread_of_ticket(conn, ticket_id)
    total_tokens = _usage_of_thread(conn, thread_id)
    if (
        budget.max_total_tokens is not None
        and total_tokens > budget.max_total_tokens
    ):
        return True, "ticket_tokens"

    cost = usage_svc.ticket_cost_micros(conn, ticket_id, tenant_id=tenant)
    if budget.max_cost_micros is not None and cost > budget.max_cost_micros:
        return True, "ticket_cost"

    source_id = ticket["source_id"]
    if source_id:
        source = conn.execute(
            "SELECT * FROM sources WHERE tenant_id = ? AND source_id = ?",
            (tenant, str(source_id)),
        ).fetchone()
        if source is not None:
            cfg = intake.config_of(source)
            if cfg.max_cost_micros_per_day is not None:
                daily = usage_svc.source_day_cost_micros(conn, str(source_id), tenant_id=tenant)
                if daily > cfg.max_cost_micros_per_day:
                    return True, "source_daily_cost"

    instance_daily = int(load_settings().daily_cost_budget_micros)
    if instance_daily > 0:
        daily = usage_svc.tenant_day_cost_micros(conn, tenant_id=tenant)
        if daily > instance_daily:
            return True, "tenant_daily_cost"
    return False, ""


def _budget_summary(
    conn: sqlite3.Connection,
    ticket: sqlite3.Row,
    budget: Budget,
    reason: str,
    total_tokens: int,
) -> str:
    from polyopus.domains.usage import service as usage_svc

    ticket_id = str(ticket["ticket_id"])
    tenant = str(ticket["tenant_id"] or TENANT)
    if reason == "ticket_tokens":
        return f"预算超限：已用 {total_tokens} tokens > 上限 {budget.max_total_tokens}"
    if reason == "ticket_cost":
        cost = usage_svc.ticket_cost_micros(conn, ticket_id, tenant_id=tenant)
        return f"预算超限：ticket 已用 {cost} micros > 上限 {budget.max_cost_micros} micros"
    if reason == "source_daily_cost":
        cost = usage_svc.source_day_cost_micros(conn, str(ticket["source_id"]), tenant_id=tenant)
        return f"预算超限：source 今日已用 {cost} micros > 每日上限"
    if reason == "tenant_daily_cost":
        cost = usage_svc.tenant_day_cost_micros(conn, tenant_id=tenant)
        return f"预算超限：实例今日已用 {cost} micros > 每日上限"
    return f"预算超限：{reason or 'unknown'}"


# ---- card 4: assignment + run + report --------------------------------------


def assign(conn: sqlite3.Connection, store: EventStore, ticket_id: str) -> str:
    """Create the next assignment; UNIQUE(ticket, attempt) arbitrates races.

    Two workers claiming the same queued ticket compute the same next
    attempt number; exactly one INSERT succeeds (docs/48 V05-07) — the loser
    sees sqlite3.IntegrityError and skips.
    """
    ticket = _ticket(conn, ticket_id)
    tenant = str(ticket["tenant_id"] or TENANT)
    if str(ticket["state"]) != "open":
        # stop() may win the race after the loop claimed the ticket; never
        # move an ended ticket back to running.
        raise AppError("CONFLICT", details={
            "reason": "ticket_ended", "ticketId": ticket_id,
        })
    thread_id = thread_of_ticket(conn, ticket_id)
    assignment_id = "as_" + secrets.token_hex(8)
    now = _now()
    conn.execute("BEGIN IMMEDIATE")
    try:
        claimed = conn.execute(
            "UPDATE tickets SET bucket = 'running', updated_at = ? "
            "WHERE ticket_id = ? AND state = 'open'",
            (now, ticket_id),
        )
        if claimed.rowcount != 1:
            conn.execute("ROLLBACK")
            raise AppError("CONFLICT", details={
                "reason": "ticket_ended", "ticketId": ticket_id,
            })
        attempt = int(
            conn.execute(
                "SELECT COALESCE(MAX(attempt), 0) + 1 FROM assignments "
                "WHERE ticket_id = ?", (ticket_id,),
            ).fetchone()[0]
        )
        conn.execute(
            """
            INSERT INTO assignments
              (tenant_id, assignment_id, ticket_id, executor, state, attempt,
               started_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)
            """,
            (tenant, assignment_id, ticket_id, EXECUTOR, attempt, now),
        )
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    store.append(
        thread_id,
        "assignment.started",
        {"assignment_id": assignment_id, "ticket_id": ticket_id,
         "executor_kind": EXECUTOR, "attempt": attempt},
        tenant_id=tenant,
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
    tenant = str(ticket["tenant_id"] or TENANT)
    thread_id = thread_of_ticket(conn, ticket_id)
    budget = Budget.of(ticket)
    assignment_id = assign(conn, store, ticket_id)

    conn.execute(
        "UPDATE assignments SET state = 'running', heartbeat_at = ? "
        "WHERE assignment_id = ?",
        (_now(), assignment_id),
    )
    conn.commit()

    # V05-18 source/day + V1-05 tenant/user/model quotas are pre-checked
    # before this assignment starts; then no turn is launched at all.
    status = "blocked"
    from polyopus.domains.usage import quota as quota_svc

    actor = json.loads(ticket["actor_json"] or "{}").get("id")
    quota_violation = quota_svc.check(
        conn, tenant_id=tenant, user_id=str(actor) if actor else None,
        model=quota_svc.default_model(conn),
    )
    if quota_violation is not None:
        pre_exceeded, pre_reason = True, "quota_exceeded"
    else:
        pre_exceeded, pre_reason = _budget_exceeded(conn, ticket, budget)
    if not pre_exceeded:
        # S8 人消息优先：a resumed ticket is driven by the latest human
        # instruction, not the original webhook title (which may just loop back
        # into the same approval pause)
        text = content or _latest_human_message(conn, ticket_id) or str(ticket["title"])
        turn_id, _ = conversations.post_turn(
            conn, store,
            tenant_id=tenant, owner_id="system", thread_id=thread_id,
            content=text, status="running",
            quota_user_id=str(actor) if actor else None,
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
    if pre_exceeded:
        exceeded, budget_reason = True, pre_reason
    else:
        exceeded, budget_reason = _budget_exceeded(conn, ticket, budget)
    if exceeded:
        state = "blocked"
    elif status == "completed":
        state = "ready"
    else:
        state = "waiting" if status == "waiting_approval" else "failed"

    from polyopus.domains.usage import service as usage_svc

    ticket_cost = usage_svc.ticket_cost_micros(conn, ticket_id, tenant_id=tenant)
    if quota_violation is not None:
        summary = (
            f"配额超限：{quota_violation.metric} 已用 {quota_violation.used} "
            f">= 上限 {quota_violation.limit}"
            f"（{quota_violation.scope}/{quota_violation.window}）"
        )
    elif exceeded:
        summary = _budget_summary(conn, ticket, budget, budget_reason, total_tokens)
    else:
        summary = f"执行 {status}（{total_tokens} tokens / {ticket_cost} micros）"
    report_id = _record_report(conn, store, ticket_id, assignment_id, thread_id,
                               state, summary,
                               facts={"total_tokens": total_tokens,
                                      "cost_micros": ticket_cost})
    from polyopus.domains.notifications import service as notifications

    notify_title = {
        "ready": "任务完成", "blocked": "任务阻塞", "failed": "任务失败",
    }.get(state)
    if notify_title:
        notifications.notify_ticket(
            conn, ticket_id=ticket_id, kind="task", title=notify_title,
            body=summary[:500], dedupe_key=f"ticket:{ticket_id}:{state}",
        )

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
        tenant_id=tenant,
    )

    # V05-09 停止后不再接新事件: when a human stop already ended the ticket,
    # the Report still lands (audit) but nothing else may mutate the ticket —
    # no bucket change, no attention, no outbound reply.
    effects = True
    if exceeded:
        effects = _open_attention(
            conn, store, ticket_id=ticket_id, thread_id=thread_id, kind="blocked",
            reason=("quota_exceeded" if quota_violation is not None
                    else "budget_exceeded"),
            next_action="调整配额/预算后重派，或停止工单",
            summary=summary, report_id=report_id,
        )
    elif state == "ready":
        ended = conn.execute(
            "UPDATE tickets SET state = 'ended', bucket = 'done', ended_at = ?, "
            "updated_at = ? WHERE ticket_id = ? AND state = 'open'",
            (now, now, ticket_id),
        ).rowcount
        if ended:
            conn.commit()
            _release_subscriptions(conn, ticket_id)
            store.append(
                thread_id,
                "ticket.ended",
                {"ticket_id": ticket_id, "reason": "completed", "summary": summary},
                tenant_id=tenant,
            )
        else:
            effects = False
    elif state == "failed":
        effects = _open_attention(
            conn, store, ticket_id=ticket_id, thread_id=thread_id, kind="failed",
            reason="report_failed", next_action="查看报告后重派，或停止工单",
            summary=summary, report_id=report_id,
        )
    else:  # waiting: the approval attention already owns the inbox (P0-1)
        conn.execute(
            "UPDATE tickets SET bucket = 'attention', updated_at = ? "
            "WHERE ticket_id = ? AND state = 'open'",
            (_now(), ticket_id),
        )
        conn.commit()
        try:
            from polyopus.domains.channels import service as channels

            channels.enqueue_approval_request(conn, ticket_id=ticket_id)
        except Exception:  # noqa: BLE001 - IM delivery is advisory
            pass

    if effects and state in ("ready", "blocked", "failed"):
        _enqueue_reply(conn, ticket_id, report_id, state, summary)
    return state


def _enqueue_reply(
    conn: sqlite3.Connection,
    ticket_id: str,
    report_id: str,
    state: str,
    summary: str,
) -> None:
    """Queue the outbound reply after all ticket state is committed. A broken
    outbound must never fail the turn that produced the report (V05-08 risk
    note: outbox 异步，绝不阻塞 turn)."""
    from polyopus.platform.telemetry import log as tlog

    try:
        from polyopus.domains.outbound import service as outbound

        outbound.on_report(conn, ticket_id, report_id, state, summary)
    except Exception as exc:  # noqa: BLE001 - log and move on
        tlog.log(tlog.get_logger("polyopus.tickets"), 30, "outbound.enqueue_failed",
                 ticket_id=ticket_id, report_id=report_id, error=str(exc))
    try:
        from polyopus.domains.channels import service as channels

        channels.enqueue_ticket_reply(
            conn, ticket_id=ticket_id, state=state, summary=summary,
        )
    except Exception as exc:  # noqa: BLE001 - IM delivery is advisory
        tlog.log(tlog.get_logger("polyopus.tickets"), 30, "channel.reply_failed",
                 ticket_id=ticket_id, error=str(exc))


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
) -> str:
    report_id = "rp_" + secrets.token_hex(8)
    tenant = _tenant_of_ticket(conn, ticket_id)
    conn.execute(
        """
        INSERT INTO reports
          (report_id, tenant_id, ticket_id, assignment_id, state, summary,
           progress, facts_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (report_id, tenant, ticket_id, assignment_id, state, summary,
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
        tenant_id=tenant,
    )
    return report_id


def _open_attention(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    ticket_id: str,
    thread_id: str,
    kind: str,  # blocked | failed
    reason: str,
    next_action: str,
    summary: str,
    report_id: str,
) -> bool:
    """V05-09: structured Attention for blocked/failed Reports.

    Payload carries only structured fields — reason/next_action/report_id —
    per docs/46 P0-1 (attention is never inferred from free text; `summary`
    stays as the human rendering the inbox already shows). Returns False
    when the ticket is no longer open (human stop won the race): 停止后
    不再接新事件.
    """
    row = conn.execute(
        "SELECT state FROM tickets WHERE ticket_id = ?", (ticket_id,)
    ).fetchone()
    if row is None or str(row["state"]) != "open":
        return False
    tenant = _tenant_of_ticket(conn, ticket_id)
    attention_id = "at_" + secrets.token_hex(8)
    now = _now()
    expires = now + 24 * 3600
    conn.execute(
        """
        INSERT INTO attentions
          (tenant_id, attention_id, ticket_id, turn_id, kind, source_type,
           source_id, payload_json, status, expires_at, created_at)
        VALUES (?, ?, ?, NULL, ?, 'ticket', ?, ?, 'pending', ?, ?)
        """,
        (tenant, attention_id, ticket_id, kind, ticket_id,
         json.dumps({"reason": reason, "next_action": next_action,
                     "summary": summary, "report_id": report_id},
                    ensure_ascii=False),
         expires, now),
    )
    conn.execute(
        "UPDATE tickets SET bucket = 'attention', updated_at = ? "
        "WHERE ticket_id = ? AND state = 'open'",
        (now, ticket_id),
    )
    conn.commit()
    store.append(
        thread_id,
        "attention.requested",
        {
            "attention_id": attention_id,
            "ticket_id": ticket_id,
            "kind": kind,
            "reason": reason,
            "question": summary,
            "expires_at": expires,
        },
        tenant_id=tenant,
    )
    return True


# ---- card 6: human stop + watchdog ------------------------------------------


def stop(
    conn: sqlite3.Connection, store: EventStore, ticket_id: str, by: str,
    *, tenant_id: str | None = None,
) -> None:
    """Human stop (docs/09 §7.1): end the ticket, cancel assignments,
    invalidate the mandate."""
    ticket = _ticket(conn, ticket_id, tenant_id)
    tenant = str(ticket["tenant_id"] or TENANT)
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
            tenant_id=tenant,
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
    # V05-19: human stop is an auditable, ticket-scoped action.
    from polyopus.domains.audit import service as audit

    audit.record(
        conn,
        tenant_id=tenant,
        action="ticket.stop",
        result="ok",
        actor_id=by,
        resource_type="ticket",
        resource_id=ticket_id,
        ticket_id=ticket_id,
        detail={"reason": "stopped_by_human"},
    )
    # V05-17: a stopped ticket also cancels its running async tools; each
    # cancel emits tool.async_cancelled on the original turn.
    from polyopus.workers import async_tools

    async_tools.cancel_for_thread(conn, store, thread_id)
    _release_subscriptions(conn, ticket_id)
    store.append(
        thread_id,
        "ticket.ended",
        {"ticket_id": ticket_id, "reason": "stopped_by_human", "by": by},
        tenant_id=tenant,
    )


def update_ticket(
    conn: sqlite3.Connection,
    *,
    ticket_id: str,
    title: str | None,
    content: str | None,
    by: str,
    tenant_id: str | None = None,
) -> None:
    """Edit a stopped/failed ticket's title and instruction.

    Running/open tickets must be cancelled first. The edited instruction is
    appended as a human_message so a later rerun uses it.
    """
    ticket = _ticket(conn, ticket_id, tenant_id)
    tenant = str(ticket["tenant_id"] or TENANT)
    if str(ticket["state"]) != "ended":
        raise AppError(
            "CONFLICT", details={"reason": "ticket_active", "ticketId": ticket_id}
        )
    now = _now()
    clean_title = title.strip() if title is not None else None
    if title is not None and not clean_title:
        raise AppError("VALIDATION_FAILED", details={"field": "title"})
    if clean_title:
        conn.execute(
            "UPDATE tickets SET title = ?, updated_at = ? WHERE tenant_id = ?"
            " AND ticket_id = ?",
            (clean_title[:200], now, tenant, ticket_id),
        )
    if content is not None and content.strip():
        conn.execute(
            """
            INSERT INTO timeline_events
              (event_id, tenant_id, ticket_id, kind, title, actor, payload_json,
               created_at)
            VALUES (?, ?, ?, 'human_message', '任务说明已更新', ?, ?, ?)
            """,
            ("tl_" + secrets.token_hex(8), tenant, ticket_id, by,
             json.dumps({"content": content[:4000]}, ensure_ascii=False), now),
        )
    conn.commit()
    from polyopus.domains.audit import service as audit

    audit.record(
        conn, tenant_id=tenant, action="ticket.update", result="ok",
        actor_id=by, resource_type="ticket", resource_id=ticket_id,
        detail={"title": clean_title, "contentChanged": content is not None},
    )


def rerun(
    conn: sqlite3.Connection,
    store: EventStore,
    ticket_id: str,
    *,
    by: str,
    tenant_id: str | None = None,
) -> None:
    """Reopen an ended ticket and put it back in the executor queue."""
    ticket = _ticket(conn, ticket_id, tenant_id)
    tenant = str(ticket["tenant_id"] or TENANT)
    if str(ticket["state"]) != "ended":
        raise AppError(
            "CONFLICT", details={"reason": "ticket_not_ended", "ticketId": ticket_id}
        )
    pending = conn.execute(
        "SELECT 1 FROM attentions WHERE tenant_id = ? AND ticket_id = ? "
        "AND status = 'pending' LIMIT 1",
        (tenant, ticket_id),
    ).fetchone()
    if pending is not None:
        raise AppError(
            "CONFLICT",
            details={"reason": "pending_attention", "ticketId": ticket_id},
        )
    now = _now()
    conn.execute(
        "UPDATE tickets SET state = 'open', bucket = 'queued', ended_at = NULL,"
        " summary = ?, updated_at = ? WHERE tenant_id = ? AND ticket_id = ?",
        ("等待重新执行", now, tenant, ticket_id),
    )
    conn.execute(
        """
        INSERT INTO timeline_events
          (event_id, tenant_id, ticket_id, kind, title, actor, payload_json,
           created_at)
        VALUES (?, ?, ?, 'rerun', '再次运行', ?, ?, ?)
        """,
        ("tl_" + secrets.token_hex(8), tenant, ticket_id, by,
         json.dumps({"by": by}, ensure_ascii=False), now),
    )
    conn.commit()


def delete_ticket(
    conn: sqlite3.Connection,
    *,
    ticket_id: str,
    by: str,
    tenant_id: str | None = None,
) -> None:
    """Delete an ended ticket and its execution bookkeeping.

    Events/usage/artifacts stay in the thread for audit and exports; the
    ticket row, assignments, reports, attentions and timeline are removed.
    """
    ticket = _ticket(conn, ticket_id, tenant_id)
    tenant = str(ticket["tenant_id"] or TENANT)
    if str(ticket["state"]) != "ended":
        raise AppError(
            "CONFLICT", details={"reason": "ticket_not_ended", "ticketId": ticket_id}
        )
    conn.execute("DELETE FROM attentions WHERE tenant_id = ? AND ticket_id = ?",
                 (tenant, ticket_id))
    conn.execute("DELETE FROM assignments WHERE ticket_id = ?", (ticket_id,))
    conn.execute("DELETE FROM reports WHERE ticket_id = ?", (ticket_id,))
    conn.execute("DELETE FROM timeline_events WHERE ticket_id = ?", (ticket_id,))
    deleted = conn.execute(
        "DELETE FROM tickets WHERE tenant_id = ? AND ticket_id = ?",
        (tenant, ticket_id),
    )
    if deleted.rowcount != 1:
        conn.rollback()
        raise AppError("TICKET_NOT_FOUND")
    conn.commit()
    from polyopus.domains.audit import service as audit

    audit.record(
        conn, tenant_id=tenant, action="ticket.delete", result="ok",
        actor_id=by, resource_type="ticket", resource_id=ticket_id,
    )


def reassign(
    conn: sqlite3.Connection,
    store: EventStore,
    ticket_id: str,
    *,
    by: str,
    tenant_id: str | None = None,
) -> None:
    """Human "重新派工": end current assignments and put the ticket back in
    the queue. The ticket worker claims it again (same builtin executor).

    Refused while an attention is pending: re-running then duplicates the
    waiting turn instead of making progress."""
    ticket = _ticket(conn, ticket_id, tenant_id)
    tenant = str(ticket["tenant_id"] or TENANT)
    if str(ticket["state"]) != "open":
        raise AppError(
            "CONFLICT", details={"reason": "ticket_ended", "ticketId": ticket_id}
        )
    pending = conn.execute(
        "SELECT 1 FROM attentions WHERE tenant_id = ? AND ticket_id = ? "
        "AND status = 'pending' LIMIT 1",
        (tenant, ticket_id),
    ).fetchone()
    if pending is not None:
        raise AppError(
            "CONFLICT",
            details={"reason": "pending_attention", "ticketId": ticket_id},
        )
    thread_id = thread_of_ticket(conn, ticket_id)
    now = _now()
    for row in conn.execute(
        "SELECT assignment_id FROM assignments WHERE ticket_id = ? "
        "AND state IN ('pending', 'running')",
        (ticket_id,),
    ).fetchall():
        conn.execute(
            "UPDATE assignments SET state = 'ended', ended_at = ? "
            "WHERE assignment_id = ?",
            (now, row["assignment_id"]),
        )
    conn.execute(
        "UPDATE tickets SET bucket = 'queued', updated_at = ? WHERE ticket_id = ?",
        (now, ticket_id),
    )
    conn.execute(
        """
        INSERT INTO timeline_events
          (event_id, tenant_id, ticket_id, kind, title, actor, payload_json,
           created_at)
        VALUES (?, ?, ?, 'reassigned', '重新派工', ?, ?, ?)
        """,
        ("tl_" + secrets.token_hex(8), tenant, ticket_id, by,
         json.dumps({"by": by}, ensure_ascii=False), now),
    )
    conn.commit()
    store.append(
        thread_id,
        "ticket.reassigned",
        {"ticket_id": ticket_id, "by": by},
        tenant_id=tenant,
    )
    from polyopus.domains.audit import service as audit

    audit.record(
        conn, tenant_id=tenant, action="ticket.reassign", result="ok",
        actor_id=by, resource_type="ticket", resource_id=ticket_id,
        ticket_id=ticket_id, detail={},
    )


def add_budget(
    conn: sqlite3.Connection,
    store: EventStore,
    ticket_id: str,
    *,
    by: str,
    additional_cost_micros: int = 0,
    additional_tokens: int = 0,
    tenant_id: str | None = None,
) -> dict[str, int | None]:
    """Human "追加预算": raise the ticket ceiling by an increment.

    The mandate itself stays immutable; only the ticket budget changes, and
    the adjustment is written to the timeline + event log."""
    if additional_cost_micros <= 0 and additional_tokens <= 0:
        raise AppError(
            "VALIDATION_FAILED",
            details={"fields": {"amount": "must be positive"}},
        )
    ticket = _ticket(conn, ticket_id, tenant_id)
    tenant = str(ticket["tenant_id"] or TENANT)
    if str(ticket["state"]) != "open":
        raise AppError(
            "CONFLICT", details={"reason": "ticket_ended", "ticketId": ticket_id}
        )
    budget = Budget.of(ticket)
    max_cost = (budget.max_cost_micros or 0) + additional_cost_micros
    max_tokens = (budget.max_total_tokens or 0) + additional_tokens
    payload: dict[str, int] = {}
    if max_cost > 0:
        payload["max_cost_micros"] = max_cost
    if max_tokens > 0:
        payload["max_total_tokens"] = max_tokens
    thread_id = thread_of_ticket(conn, ticket_id)
    now = _now()
    conn.execute(
        "UPDATE tickets SET budget_json = ?, updated_at = ? WHERE ticket_id = ?",
        (json.dumps(payload), now, ticket_id),
    )
    conn.execute(
        """
        INSERT INTO timeline_events
          (event_id, tenant_id, ticket_id, kind, title, actor, payload_json,
           created_at)
        VALUES (?, ?, ?, 'budget_adjusted', '追加预算', ?, ?, ?)
        """,
        (
            "tl_" + secrets.token_hex(8), tenant, ticket_id, by,
            json.dumps(
                {"additional_cost_micros": additional_cost_micros,
                 "additional_tokens": additional_tokens,
                 "max_cost_micros": max_cost or None,
                 "max_total_tokens": max_tokens or None},
                ensure_ascii=False,
            ),
            now,
        ),
    )
    conn.commit()
    store.append(
        thread_id,
        "ticket.budget_adjusted",
        {"ticket_id": ticket_id, "by": by,
         "additional_cost_micros": additional_cost_micros,
         "additional_tokens": additional_tokens},
        tenant_id=tenant,
    )
    from polyopus.domains.audit import service as audit

    audit.record(
        conn, tenant_id=tenant, action="ticket.add_budget", result="ok",
        actor_id=by, resource_type="ticket", resource_id=ticket_id,
        ticket_id=ticket_id,
        detail={"additional_cost_micros": additional_cost_micros,
                "additional_tokens": additional_tokens},
    )
    return {
        "maxCostMicros": max_cost or None,
        "maxTotalTokens": max_tokens or None,
    }


def create_manual(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    created_by: str,
    title: str,
    content: str | None = None,
    priority: int = 0,
    scope: list[str] | None = None,
) -> str:
    """Manual ticket (P0-3): same execution basis as intake tickets — mandate
    + system execution thread + ticket.opened — just no source/trigger."""
    from polyopus.domains.policy import service as policy

    tenant = tenant_id or TENANT
    title = title.strip() or "手动任务"
    now = _now()
    ticket_id = "tk_" + secrets.token_hex(8)
    mandate_id = "md_" + secrets.token_hex(8)
    thread_id = "th_" + secrets.token_hex(12)
    policy_version = policy.active_version_or_bootstrap(conn, tenant)
    # Manual tickets are explicit user requests; allow the write tool so the
    # policy gate can ask, instead of denying at the mandate scope layer.
    scope = list(scope) if scope else ["workspace:default", "fs:write"]

    conn.execute(
        """
        INSERT INTO tickets
          (tenant_id, ticket_id, title, state, bucket, priority,
           actor_json, strength, policy_version, scope_json,
           created_at, updated_at)
        VALUES (?, ?, ?, 'open', 'queued', ?, ?, 'explicit', ?, ?, ?, ?)
        """,
        (tenant, ticket_id, title, priority,
         json.dumps({"id": created_by, "kind": "user"}),
         policy_version, json.dumps(scope), now, now),
    )
    conn.execute(
        """
        INSERT INTO mandates
          (tenant_id, mandate_id, ticket_id, policy_version, scope_json,
           strength, matched_rules_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tenant, mandate_id, ticket_id, policy_version, json.dumps(scope),
         "explicit", json.dumps(["manual"]), now),
    )
    conn.execute(
        """
        INSERT INTO threads
          (tenant_id, thread_id, owner_id, title, status, created_at, updated_at)
        VALUES (?, ?, 'system', ?, 'active', ?, ?)
        """,
        (tenant, thread_id, title, now, now),
    )
    conn.commit()
    link_thread(conn, ticket_id, thread_id)
    if content and content.strip():
        conn.execute(
            """
            INSERT INTO timeline_events
              (event_id, tenant_id, ticket_id, kind, title, actor, payload_json,
               created_at)
            VALUES (?, ?, ?, 'human_message', '人工消息', ?, ?, ?)
            """,
            ("tl_" + secrets.token_hex(8), tenant, ticket_id, created_by,
             json.dumps({"content": content[:4000]}, ensure_ascii=False), now),
        )
        conn.commit()
    store.append(
        thread_id,
        "ticket.opened",
        {
            "ticket_id": ticket_id, "title": title, "source_id": None,
            "mandate": {
                "policy_version": policy_version, "scope": scope,
                "strength": "explicit", "matched_rules": ["manual"],
                "actor": {"kind": "user", "id": created_by},
                "granted_at": now,
            },
            "event_thread_id": thread_id,
        },
        tenant_id=tenant,
    )
    return ticket_id


def _release_subscriptions(conn: sqlite3.Connection, ticket_id: str) -> None:
    """V05-10: an ended ticket releases its event-thread subscription so the
    thread can open new tickets. Best-effort — the fan-out lookup re-checks
    tickets.state, so a failure here can never leak forever."""
    from polyopus.domains.intake import service as intake

    intake.release_ticket_subscriptions(conn, ticket_id)


def watchdog_scan(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    stale_seconds: int = HEARTBEAT_STALE_SECONDS,
    drift_seconds: int = 1800,
    tenant_id: str | None = None,
) -> list[dict[str, Any]]:
    """V1-09: stalled assignments are requeued/stopped; long-running but
    alive assignments are flagged as drifting (notify only).

    Dedupe is per assignment+kind while an alert is open. A stalled action
    resolves its own alert immediately, so a later stall is a new incident
    and the requeue cap still works across cycles.
    """
    from polyopus.domains.audit import service as audit

    now = _now()
    stale_before = now - stale_seconds
    scope = ""
    params: list[object] = [stale_before]
    if tenant_id is not None:
        scope = " AND ticket_id IN (SELECT ticket_id FROM tickets WHERE tenant_id = ?)"
        params.append(tenant_id)
    rows = conn.execute(
        "SELECT * FROM assignments WHERE state = 'running' AND "
        "(heartbeat_at IS NULL OR heartbeat_at < ?)" + scope,
        params,
    ).fetchall()
    alerts: list[dict[str, Any]] = []
    for row in rows:
        assignment_id = str(row["assignment_id"])
        if _open_watchdog_alert(conn, assignment_id, "stalled"):
            continue
        ticket_id = str(row["ticket_id"])
        tenant = _tenant_of_ticket(conn, ticket_id)
        thread_id = thread_of_ticket(conn, ticket_id)
        prior = conn.execute(
            "SELECT count(*) FROM watchdog_alerts WHERE assignment_id = ? "
            "AND kind = 'stalled'", (assignment_id,),
        ).fetchone()[0]
        action = "requeue" if int(prior) < MAX_REQUEUES else "stop"
        detail = f"heartbeat stale > {stale_seconds}s (alert #{int(prior) + 1})"

        alert_id = _insert_watchdog_alert(
            conn, tenant=tenant, assignment_id=assignment_id, kind="stalled",
            detail=detail, action=action, now=now,
        )
        if alert_id is None:
            continue
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
        # The requeue/stop itself resolves this alert; the next stall on the
        # assignment is a fresh incident and must re-trigger the cap logic.
        conn.execute(
            "UPDATE watchdog_alerts SET status = 'resolved' WHERE alert_id = ?",
            (alert_id,),
        )
        conn.commit()
        store.append(
            thread_id,
            "watchdog.alert",
            {"assignment_id": assignment_id, "kind": "stalled",
             "detail": detail, "action": action},
            tenant_id=tenant,
        )
        audit.record(
            conn, tenant_id=tenant, action=f"watchdog.{action}", result="ok",
            actor_id="watchdog", resource_type="assignment",
            resource_id=assignment_id, ticket_id=ticket_id,
            detail={"kind": "stalled", "detail": detail},
        )
        alerts.append({"assignmentId": assignment_id, "kind": "stalled",
                       "action": action})

    drift_scope = ""
    drift_params: list[object] = [now - drift_seconds, stale_before]
    if tenant_id is not None:
        drift_scope = " AND ticket_id IN (SELECT ticket_id FROM tickets WHERE tenant_id = ?)"
        drift_params.append(tenant_id)
    drift_rows = conn.execute(
        "SELECT * FROM assignments WHERE state = 'running' "
        "AND started_at < ? AND COALESCE(heartbeat_at, started_at) >= ?"
        + drift_scope,
        drift_params,
    ).fetchall()
    for row in drift_rows:
        assignment_id = str(row["assignment_id"])
        if _open_watchdog_alert(conn, assignment_id, "drifting"):
            continue
        ticket_id = str(row["ticket_id"])
        tenant = _tenant_of_ticket(conn, ticket_id)
        thread_id = thread_of_ticket(conn, ticket_id)
        detail = f"running > {drift_seconds}s with a live heartbeat"
        alert_id = _insert_watchdog_alert(
            conn, tenant=tenant, assignment_id=assignment_id, kind="drifting",
            detail=detail, action="notify", now=now,
        )
        if alert_id is None:
            continue
        conn.commit()
        store.append(
            thread_id,
            "watchdog.alert",
            {"assignment_id": assignment_id, "kind": "drifting",
             "detail": detail, "action": "notify"},
            tenant_id=tenant,
        )
        audit.record(
            conn, tenant_id=tenant, action="watchdog.notify", result="ok",
            actor_id="watchdog", resource_type="assignment",
            resource_id=assignment_id, ticket_id=ticket_id,
            detail={"kind": "drifting", "detail": detail},
        )
        alerts.append({"assignmentId": assignment_id, "kind": "drifting",
                       "action": "notify"})
    return alerts


def _open_watchdog_alert(
    conn: sqlite3.Connection, assignment_id: str, kind: str,
) -> bool:
    row = conn.execute(
        "SELECT 1 FROM watchdog_alerts WHERE assignment_id = ? AND kind = ? "
        "AND status = 'open' LIMIT 1", (assignment_id, kind),
    ).fetchone()
    return row is not None


def _insert_watchdog_alert(
    conn: sqlite3.Connection, *,
    tenant: str,
    assignment_id: str,
    kind: str,
    detail: str,
    action: str,
    now: int,
) -> str | None:
    alert_id = "wa_" + secrets.token_hex(8)
    try:
        conn.execute(
            """
            INSERT INTO watchdog_alerts
              (alert_id, tenant_id, assignment_id, kind, detail, action,
               status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
            """,
            (alert_id, tenant, assignment_id, kind, detail, action, now),
        )
    except sqlite3.IntegrityError:
        return None  # concurrent scan won the same assignment+kind alert
    return alert_id
