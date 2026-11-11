"""Attention inbox endpoints (slice ①): list + answer (drives resume)."""

from __future__ import annotations

import json
import sqlite3
from sqlite3 import Connection

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from polyopus.api.deps import current_user, get_db, get_store
from polyopus.domains.attention import service as attention
from polyopus.domains.identity.service import User
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

router = APIRouter(prefix="/attentions", tags=["attentions"])


class AnswerBody(BaseModel):
    decision: str  # approve | approve_session | deny


def _payload(row: sqlite3.Row) -> dict[str, object]:
    return {
        "attentionId": row["attention_id"],
        "kind": row["kind"],
        "sourceType": row["source_type"],
        "sourceId": row["source_id"],
        "payload": json.loads(row["payload_json"]),
        "status": row["status"],
        "turnId": row["turn_id"],
        "ticketId": row["ticket_id"],
        "expiresAt": row["expires_at"],
        "createdAt": row["created_at"],
    }


@router.get("")
def list_attentions(
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    rows = conn.execute(
        "SELECT * FROM attentions WHERE tenant_id = ? AND status = 'pending' "
        "ORDER BY created_at LIMIT 100",
        (user.tenant_id,),
    ).fetchall()
    return {"items": [_payload(r) for r in rows]}


@router.post("/{attention_id}/answer")
def answer(
    attention_id: str,
    body: AnswerBody,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    row = conn.execute(
        "SELECT * FROM attentions WHERE tenant_id = ? AND attention_id = ?",
        (user.tenant_id, attention_id),
    ).fetchone()
    if row is None:
        raise AppError("ATTENTION_NOT_FOUND")
    if row["status"] != "pending":
        raise AppError("ATTENTION_ALREADY_RESOLVED", details={"status": row["status"]})
    if row["source_type"] != "approval":
        raise AppError("DECISION_INVALID", details={"source_type": row["source_type"]})

    decision_map = {
        "approve": "approved",
        "approve_session": "approved_session",
        "deny": "denied",
    }
    decision = decision_map.get(body.decision)
    if decision is None:
        raise AppError("DECISION_INVALID", details={"decision": body.decision})

    approval_id = str(row["source_id"])
    turn_row = conn.execute(
        "SELECT thread_id FROM turns WHERE turn_id = ?", (row["turn_id"],)
    ).fetchone()
    if turn_row is None:
        raise AppError("TURN_NOT_FOUND", details={"turn_id": row["turn_id"]})
    thread_id = str(turn_row["thread_id"])

    attention.resolve(
        conn, store,
        tenant_id=user.tenant_id,
        thread_id=thread_id,
        approval_id=approval_id,
        decision=decision,
        by=user.user_id,
    )
    engine.resume_after_approval(
        conn, store, str(row["turn_id"]), decision=decision
    )
    return {"attentionId": attention_id, "status": "answered", "decision": decision}
