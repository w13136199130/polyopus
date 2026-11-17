"""Ticket endpoints: list, stop (one-click), watchdog run (slice ②)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.tickets import service
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.get("")
def list_tickets(
    user: User = Depends(require_permission("ticket:read")), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    rows = conn.execute(
        "SELECT ticket_id, title, state, bucket, strength, source_id, "
        "cost_micros, created_at "
        "FROM tickets WHERE tenant_id = ? ORDER BY id DESC LIMIT 100",
        (user.tenant_id,),
    ).fetchall()
    return {
        "items": [
            {
                "ticketId": r["ticket_id"],
                "title": r["title"],
                "state": r["state"],
                "bucket": r["bucket"],
                "strength": r["strength"],
                "sourceId": r["source_id"],
                "costMicros": int(r["cost_micros"] or 0),
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    }


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

    for row in conn.execute(
        "SELECT * FROM timeline_events WHERE ticket_id = ? ORDER BY id",
        (ticket_id,),
    ).fetchall():
        kind = _TIMELINE_KIND.get(str(row["kind"]))
        if kind is None:
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

    items.sort(key=lambda item: (str(item["at"]), str(item["id"])))
    return {"items": items[:limit]}


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: str,
    user: User = Depends(require_permission("ticket:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    row = conn.execute(
        "SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ?",
        (user.tenant_id, ticket_id),
    ).fetchone()
    if row is None:
        raise AppError("TICKET_NOT_FOUND")
    report = conn.execute(
        "SELECT state, summary, facts_json, created_at FROM reports "
        "WHERE ticket_id = ? ORDER BY id DESC LIMIT 1",
        (ticket_id,),
    ).fetchone()
    return {
        "ticketId": row["ticket_id"],
        "title": row["title"],
        "state": row["state"],
        "bucket": row["bucket"],
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
