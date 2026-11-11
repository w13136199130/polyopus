"""Ticket endpoints: list, stop (one-click), watchdog run (slice ②)."""

from __future__ import annotations

import json
from sqlite3 import Connection

from fastapi import APIRouter, Depends

from polyopus.api.deps import current_user, get_db, get_store
from polyopus.domains.identity.service import User
from polyopus.domains.tickets import service
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.get("")
def list_tickets(
    user: User = Depends(current_user), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    rows = conn.execute(
        "SELECT ticket_id, title, state, bucket, strength, source_id, created_at "
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
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    }


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: str,
    user: User = Depends(current_user),
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
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    service.stop(conn, store, ticket_id, by=user.user_id)
    return {"ticketId": ticket_id, "state": "ended", "reason": "stopped_by_human"}


@router.post("/watchdog/run")
def run_watchdog(
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    alerts = service.watchdog_scan(conn, store)
    return {"alerts": alerts}
