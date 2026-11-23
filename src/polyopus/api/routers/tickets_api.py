"""Ticket endpoints: list, stop (one-click), watchdog run (slice ②)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from sqlite3 import Connection, Row

from fastapi import APIRouter, Depends, Query
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.tickets import service
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

router = APIRouter(prefix="/tickets", tags=["tickets"])


class UpdateTicketBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=4000)


class CreateTicketBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=4000)
    priority: int = Field(default=0, ge=0, le=10)


class AddBudgetBody(BaseModel):
    additional_cost_micros: int = Field(
        default=0, ge=0,
        validation_alias=AliasChoices("additionalCostMicros", "additional_cost_micros"),
    )
    additional_tokens: int = Field(
        default=0, ge=0,
        validation_alias=AliasChoices("additionalTokens", "additional_tokens"),
    )


def _actor_of(raw: object, display_name: object = None) -> dict[str, str] | None:
    try:
        value = json.loads(str(raw)) if raw else {}
    except ValueError:
        return None
    if not isinstance(value, dict):
        return None
    actor_id = str(value.get("id") or "")
    if not actor_id:
        return None
    return {
        "id": actor_id,
        "name": str(value.get("name") or display_name or actor_id),
    }


def _progress(value: object) -> int:
    """assignments.progress is 0..1; stale rows may carry 0..100."""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    percent = number * 100 if number <= 1 else number
    return max(0, min(100, int(round(percent))))


_LIST_SQL = """
SELECT t.ticket_id, t.title, t.state, t.bucket, t.strength, t.source_id,
       t.cost_micros, t.created_at, t.actor_json, t.summary, t.policy_version,
       (SELECT COALESCE(u.display_name, u.username) FROM users u
         WHERE u.user_id = json_extract(t.actor_json, '$.id')) AS actor_name,
       s.name AS source_name, s.kind AS source_kind,
       (SELECT a.executor FROM assignments a
         WHERE a.ticket_id = t.ticket_id ORDER BY a.id DESC LIMIT 1) AS executor,
       (SELECT a.progress FROM assignments a
         WHERE a.ticket_id = t.ticket_id ORDER BY a.id DESC LIMIT 1) AS progress,
       (SELECT r.summary FROM reports r
         WHERE r.ticket_id = t.ticket_id ORDER BY r.id DESC LIMIT 1) AS report_summary,
       (SELECT r.state FROM reports r
         WHERE r.ticket_id = t.ticket_id ORDER BY r.id DESC LIMIT 1) AS report_state
FROM tickets t
LEFT JOIN sources s ON s.source_id = t.source_id AND s.tenant_id = t.tenant_id
WHERE t.tenant_id = ?
ORDER BY t.id DESC LIMIT 100
"""


def _ticket_row(row: Row) -> dict[str, object]:
    return {
        "ticketId": row["ticket_id"],
        "title": row["title"],
        "state": row["state"],
        "bucket": row["bucket"],
        "strength": row["strength"],
        "policyVersion": int(row["policy_version"] or 1),
        "sourceId": row["source_id"],
        "sourceName": row["source_name"],
        "sourceKind": row["source_kind"],
        "actor": _actor_of(row["actor_json"], row["actor_name"]),
        "executor": row["executor"],
        "progress": _progress(row["progress"]),
        "summary": row["summary"] or row["report_summary"] or "",
        "reportState": row["report_state"],
        "costMicros": int(row["cost_micros"] or 0),
        "createdAt": row["created_at"],
    }


@router.post("", status_code=201)
def create_ticket(
    body: CreateTicketBody,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    """Manual ticket (P0-3): same mandate/thread basis as intake tickets."""
    ticket_id = service.create_manual(
        conn, store, tenant_id=user.tenant_id, created_by=user.user_id,
        title=body.title, content=body.content, priority=body.priority,
    )
    return {"ticketId": ticket_id, "bucket": "queued", "state": "open"}


@router.get("")
def list_tickets(
    user: User = Depends(require_permission("ticket:read")), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    rows = conn.execute(_LIST_SQL, (user.tenant_id,)).fetchall()
    return {"items": [_ticket_row(row) for row in rows]}


@router.get("/counts")
def ticket_counts(
    user: User = Depends(require_permission("ticket:read")), conn: Connection = Depends(get_db)
) -> dict[str, int]:
    rows = conn.execute(
        "SELECT bucket, count(*) AS n FROM tickets WHERE tenant_id = ? "
        "GROUP BY bucket",
        (user.tenant_id,),
    ).fetchall()
    counts = {"attention": 0, "running": 0, "queued": 0, "done": 0}
    for row in rows:
        if str(row["bucket"]) in counts:
            counts[str(row["bucket"])] = int(row["n"])
    return counts


_EVENT_KIND = {
    "ticket.opened": "ticket",
    "ticket.ended": "ticket",
    "assignment.started": "assignment",
    "assignment.ended": "assignment",
    "assignment.reported": "report",
    "attention.requested": "attention",
    "attention.resolved": "attention",
    "channel.sent": "channel",
    "channel.failed": "channel",
}
_EVENT_TITLE = {
    "ticket.opened": "工单已创建",
    "ticket.ended": "工单结束",
    "assignment.started": "执行开始",
    "assignment.ended": "执行结束",
    "assignment.reported": "报告已生成",
    "attention.requested": "等待人工处理",
    "attention.resolved": "人工已处理",
    "channel.sent": "回复已送达",
    "channel.failed": "回复发送失败",
}
_TIMELINE_KIND = {
    "execution_thread": "ticket",
    "human_message": "ticket",
    "trigger_fanned_out": "trigger",
    "reassigned": "assignment",
    "budget_adjusted": "report",
    "rerun": "ticket",
}


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=UTC).isoformat().replace("+00:00", "Z")


def _tone(kind: str, title: str) -> str:
    if kind in ("report", "channel"):
        return "danger" if "失败" in title else "success"
    if kind == "attention":
        return "warn"
    if kind == "ticket" and "结束" in title:
        return "success"
    return "info"


@router.get("/{ticket_id}/timeline")
def ticket_timeline(
    ticket_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None),
    user: User = Depends(require_permission("ticket:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    """Whitelisted, ascending ticket history (docs/48 V05-22)."""
    ticket = conn.execute(
        "SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ?",
        (user.tenant_id, ticket_id),
    ).fetchone()
    if ticket is None:
        raise AppError("TICKET_NOT_FOUND")

    items: list[dict[str, object]] = []
    trigger = None
    if ticket["trigger_id"]:
        trigger = conn.execute(
            "SELECT * FROM triggers WHERE trigger_id = ? LIMIT 1",
            (str(ticket["trigger_id"]),),
        ).fetchone()
    rerun_row = conn.execute(
        "SELECT MAX(created_at) FROM timeline_events WHERE ticket_id = ?"
        " AND kind = 'rerun'",
        (ticket_id,),
    ).fetchone()
    cutoff = int(rerun_row[0]) if rerun_row is not None and rerun_row[0] else 0

    actor = json.loads(ticket["actor_json"] or "{}")
    actor_id = str(actor.get("id") or "system")
    actor_name = str(actor.get("name") or "手动创建")
    if trigger is not None:
        payload = json.loads(trigger["payload_json"] or "{}")
        text = str(payload.get("text", ""))[:120]
        items.append({
            "id": f"trigger:{trigger['trigger_id']}",
            "at": _iso(int(ticket["created_at"])),
            "kind": "trigger",
            "title": "触发接单",
            "description": text,
            "actor": {"id": str(trigger["actor_id"] or "system"), "name": "actor"},
            "tone": "neutral",
        })
    else:
        items.append({
            "id": "trigger:manual",
            "at": _iso(int(ticket["created_at"])),
            "kind": "trigger",
            "title": "手动创建",
            "description": str(ticket["title"]),
            "actor": {"id": actor_id, "name": actor_name},
            "tone": "neutral",
        })
    # Deterministic Gate/Eval stages for both manual and source tickets; the
    # detailed timeline rows below start at Ticket/Assignment/Report.
    items.append({
        "id": "gate:synthetic",
        "at": _iso(int(ticket["created_at"])),
        "kind": "gate",
        "title": "准入通过",
        "description": f"actor allowed · strength={ticket['strength']}",
        "actor": {"id": "system", "name": "gate"},
        "tone": "success",
    })
    items.append({
        "id": "eval:synthetic",
        "at": _iso(int(ticket["created_at"])),
        "kind": "eval",
        "title": "显式请求",
        "description": f"accept · strength={ticket['strength']} · confidence 1.00",
        "actor": {"id": "system", "name": "eval"},
        "tone": "info",
    })

    for row in conn.execute(
        "SELECT * FROM timeline_events WHERE ticket_id = ? ORDER BY id",
        (ticket_id,),
    ).fetchall():
        kind = _TIMELINE_KIND.get(str(row["kind"]))
        if kind is None:
            continue
        if cutoff and int(row["created_at"]) < cutoff and str(row["kind"]) != "rerun":
            continue
        items.append({
            "id": str(row["event_id"]),
            "at": _iso(int(row["created_at"])),
            "kind": kind,
            "title": str(row["title"]),
            "description": str(row["description"] or ""),
            "actor": {"id": str(row["actor"] or "system"), "name": "actor"},
            "tone": _tone(kind, str(row["title"])),
        })

    thread = conn.execute(
        "SELECT json_extract(payload_json, '$.thread_id') FROM timeline_events "
        "WHERE ticket_id = ? AND kind = 'execution_thread' "
        "ORDER BY id DESC LIMIT 1",
        (ticket_id,),
    ).fetchone()
    if thread is not None and thread[0]:
        for row in conn.execute(
            "SELECT * FROM events WHERE thread_id = ? ORDER BY seq",
            (str(thread[0]),),
        ).fetchall():
            kind = _EVENT_KIND.get(str(row["type"]))
            if kind is None:
                continue
            if cutoff and int(row["ts"]) < cutoff:
                continue
            items.append({
                "id": f"ev_{row['id']}",
                "at": _iso(int(row["ts"])),
                "kind": kind,
                "title": _EVENT_TITLE.get(str(row["type"]), str(row["type"])),
                "actor": {"id": "system", "name": "system"},
                "tone": _tone(kind, _EVENT_TITLE.get(str(row["type"]), "")),
                "link": (
                    {"turnId": row["turn_id"]} if row["turn_id"] else {}
                ),
            })

    # Duplicate producers (approval resume + assignment tail) can emit the
    # same report/assignment event twice in one second. Collapse exact
    # same-time duplicates while keeping genuine reruns (different times).
    deduped: list[dict[str, object]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in items:
        key = (
            str(item.get("at", "")), str(item.get("kind", "")),
            str(item.get("title", "")), str(item.get("description", "")),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    items = deduped

    # Same-second rows: keep the stage order the prototype teaches
    # (Trigger → Ticket → Assignment → Report → Attention), not id strings.
    kind_order = {
        "trigger": 0, "gate": 1, "eval": 2, "ticket": 3,
        "assignment": 4, "report": 5, "attention": 6, "channel": 7,
    }
    for index, item in enumerate(items):
        item["_seq"] = index
    items.sort(
        key=lambda item: (
            str(item["at"]),
            kind_order.get(str(item["kind"]), 99),
            int(str(item["_seq"])),
        )
    )
    for item in items:
        item.pop("_seq", None)
    return {"items": items[:limit]}


def _instruction_of(conn: Connection, ticket: Row) -> str:
    meta = conn.execute(
        "SELECT trigger_id, title FROM tickets WHERE ticket_id = ?",
        (str(ticket["ticket_id"]),),
    ).fetchone()
    if meta is None:
        return ""
    row = conn.execute(
        "SELECT payload_json FROM timeline_events WHERE ticket_id = ?"
        " AND kind = 'human_message' ORDER BY id DESC LIMIT 1",
        (str(ticket["ticket_id"]),),
    ).fetchone()
    if row is not None:
        try:
            text = str(json.loads(str(row[0])).get("content") or "").strip()
            if text:
                return text
        except ValueError:
            pass
    if meta["trigger_id"]:
        trigger = conn.execute(
            "SELECT payload_json FROM triggers WHERE trigger_id = ? LIMIT 1",
            (str(meta["trigger_id"]),),
        ).fetchone()
        if trigger is not None:
            try:
                text = str(json.loads(str(trigger[0])).get("text") or "").strip()
                if text:
                    return text
            except ValueError:
                pass
    return str(meta["title"])


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: str,
    user: User = Depends(require_permission("ticket:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    row = conn.execute(
        """
        SELECT t.ticket_id, t.title, t.state, t.bucket, t.strength, t.source_id,
               t.cost_micros, t.created_at, t.actor_json, t.summary,
               t.policy_version, t.scope_json, t.budget_json,
               (SELECT COALESCE(u.display_name, u.username) FROM users u
                 WHERE u.user_id = json_extract(t.actor_json, '$.id')) AS actor_name,
               s.name AS source_name, s.kind AS source_kind,
               (SELECT a.executor FROM assignments a
                 WHERE a.ticket_id = t.ticket_id ORDER BY a.id DESC LIMIT 1) AS executor,
               (SELECT a.progress FROM assignments a
                 WHERE a.ticket_id = t.ticket_id ORDER BY a.id DESC LIMIT 1) AS progress,
               (SELECT r.summary FROM reports r
                 WHERE r.ticket_id = t.ticket_id ORDER BY r.id DESC LIMIT 1) AS report_summary,
               (SELECT r.state FROM reports r
                 WHERE r.ticket_id = t.ticket_id ORDER BY r.id DESC LIMIT 1) AS report_state
        FROM tickets t
        LEFT JOIN sources s ON s.source_id = t.source_id AND s.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? AND t.ticket_id = ?
        """,
        (user.tenant_id, ticket_id),
    ).fetchone()
    if row is None:
        raise AppError("TICKET_NOT_FOUND")
    report = conn.execute(
        "SELECT state, summary, facts_json, created_at FROM reports "
        "WHERE ticket_id = ? ORDER BY id DESC LIMIT 1",
        (ticket_id,),
    ).fetchone()
    artifacts: list[dict[str, object]] = []
    try:
        thread_id = service.thread_of_ticket(conn, ticket_id)
    except AppError:
        thread_id = None
    if thread_id:
        artifacts = [
            {
                "artifactId": item["artifact_id"],
                "kind": item["kind"],
                "ref": item["ref"],
                "mime": item["mime"],
                "size": int(item["size"] or 0),
                "createdAt": item["created_at"],
            }
            for item in conn.execute(
                "SELECT artifact_id, kind, ref, mime, size, created_at "
                "FROM artifacts WHERE tenant_id = ? AND thread_id = ? "
                "ORDER BY id DESC LIMIT 20",
                (user.tenant_id, thread_id),
            ).fetchall()
        ]
    return {
        **_ticket_row(row),
        "scope": json.loads(row["scope_json"] or "[]"),
        "budget": json.loads(row["budget_json"]) if row["budget_json"] else None,
        "costMicros": int(row["cost_micros"] or 0),
        "report": (
            {
                "state": report["state"],
                "summary": report["summary"],
                "facts": json.loads(report["facts_json"] or "{}"),
            }
            if report
            else None
        ),
        "artifacts": artifacts,
        "instruction": _instruction_of(conn, row),
    }


@router.post("/{ticket_id}/stop")
def stop_ticket(
    ticket_id: str,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    service.stop(conn, store, ticket_id, by=user.user_id,
                 tenant_id=user.tenant_id)
    return {"ticketId": ticket_id, "state": "ended", "reason": "stopped_by_human"}


@router.post("/{ticket_id}/reassign")
def reassign_ticket(
    ticket_id: str,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    service.reassign(
        conn, store, ticket_id, by=user.user_id, tenant_id=user.tenant_id
    )
    return {"ticketId": ticket_id, "bucket": "queued", "state": "open"}


@router.patch("/{ticket_id}")
def update_ticket(
    ticket_id: str,
    body: UpdateTicketBody,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.update_ticket(
        conn, ticket_id=ticket_id, title=body.title, content=body.content,
        by=user.user_id, tenant_id=user.tenant_id,
    )
    return {"ticketId": ticket_id, "updated": True}


@router.post("/{ticket_id}/rerun")
def rerun_ticket(
    ticket_id: str,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    service.rerun(
        conn, store, ticket_id, by=user.user_id, tenant_id=user.tenant_id
    )
    return {"ticketId": ticket_id, "bucket": "queued", "state": "open"}


@router.delete("/{ticket_id}")
def delete_ticket(
    ticket_id: str,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_ticket(
        conn, ticket_id=ticket_id, by=user.user_id, tenant_id=user.tenant_id
    )
    return {"ticketId": ticket_id, "deleted": True}


@router.post("/{ticket_id}/budget")
def add_ticket_budget(
    ticket_id: str,
    body: AddBudgetBody,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    budget = service.add_budget(
        conn, store, ticket_id, by=user.user_id,
        additional_cost_micros=body.additional_cost_micros,
        additional_tokens=body.additional_tokens,
        tenant_id=user.tenant_id,
    )
    return {"ticketId": ticket_id, **budget}


class HumanMessageBody(BaseModel):
    content: str = Field(min_length=1)


@router.post("/{ticket_id}/messages", status_code=202)
def post_human_message(
    ticket_id: str,
    body: HumanMessageBody,
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    """V05-11 (S8): a human message on the ticket's execution thread. A
    parked open ticket resumes when this turn completes; an ended ticket
    just records the message (never resurrected)."""
    out = service.post_human_message(
        conn, store, ticket_id, user_id=user.user_id, content=body.content,
        tenant_id=user.tenant_id,
    )
    return {"ticketId": ticket_id, **out}


@router.post("/watchdog/run")
def run_watchdog(
    user: User = Depends(require_permission("ticket:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    alerts = service.watchdog_scan(conn, store, tenant_id=user.tenant_id)
    return {"alerts": alerts}
