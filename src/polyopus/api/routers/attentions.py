"""Attention inbox endpoints (slice ①): list + answer (drives resume)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from sqlite3 import Connection
from typing import cast

from fastapi import APIRouter, Depends, Request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.attention import service as attention
from polyopus.domains.identity.service import User
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

router = APIRouter(prefix="/attentions", tags=["attentions"])


class AnswerBody(BaseModel):
    decision: str  # approve | approve_session | deny


class BatchAnswerBody(BaseModel):
    """V05-16: answer selected approvals of the same action class."""

    model_config = ConfigDict(populate_by_name=True)

    attention_ids: list[str] = Field(
        min_length=1,
        max_length=100,
        validation_alias=AliasChoices("attention_ids", "attentionIds"),
    )
    decision: str  # approve | approve_session | deny


_DECISIONS = {
    "approve": "approved",
    "approve_session": "approved_session",
    "deny": "denied",
}


def _decision_of(raw: str) -> str:
    decision = _DECISIONS.get(raw)
    if decision is None:
        raise AppError("DECISION_INVALID", details={"decision": raw})
    return decision


def _pending_approval(
    conn: sqlite3.Connection, tenant_id: str, attention_id: str
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM attentions WHERE tenant_id = ? AND attention_id = ?",
        (tenant_id, attention_id),
    ).fetchone()
    if row is None:
        raise AppError("ATTENTION_NOT_FOUND", details={"attentionId": attention_id})
    if row["status"] != "pending":
        raise AppError(
            "ATTENTION_ALREADY_RESOLVED",
            details={"attentionId": attention_id, "status": row["status"]},
        )
    if row["source_type"] != "approval":
        raise AppError(
            "DECISION_INVALID",
            details={"attentionId": attention_id,
                     "source_type": row["source_type"]},
        )
    return cast(sqlite3.Row, row)


def _action_class(row: sqlite3.Row) -> tuple[str, str]:
    """Batch grouping key: the same tool at the same risk, never a mix."""
    payload = json.loads(row["payload_json"] or "{}")
    actions = payload.get("actions") or []
    action = actions[0] if actions else {}
    return str(action.get("tool", "")), str(action.get("risk", ""))


def _resolve_and_resume(
    conn: Connection,
    store: EventStore,
    request: Request,
    user: User,
    row: sqlite3.Row,
    decision: str,
) -> tuple[str, str]:
    """Resolve one approval and resume its turn. Returns (decision, status):
    an already-expired approval resolves to denied, and that denied decision
    is what the engine must see (never the caller's approve)."""
    turn_id = str(row["turn_id"])
    turn_row = conn.execute(
        "SELECT thread_id FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()
    if turn_row is None:
        raise AppError("TURN_NOT_FOUND", details={"turn_id": turn_id})
    thread_id = str(turn_row["thread_id"])

    actual = attention.resolve(
        conn, store,
        tenant_id=user.tenant_id,
        thread_id=thread_id,
        approval_id=str(row["source_id"]),
        decision=decision,
        by=user.user_id,
    )
    # resume must write into THIS app instance's workspace (tests isolate
    # it per tmp_path; the engine would otherwise fall back to global settings)
    workspace = Path(request.app.state.settings.workspace_dir)
    workspace.mkdir(parents=True, exist_ok=True)
    engine.resume_after_approval(
        conn, store, turn_id, decision=actual,
        config=engine.EngineConfig(workspace=workspace),
    )
    # 交互还原 (prototype task-q): an approval answered on a TICKET turn must
    # also close the ticket — the resume path never re-enters the assignment
    # tail, so without this the ticket parks in `attention` orphaned.
    if row["ticket_id"]:
        from polyopus.domains.tickets import service as tickets

        try:
            tickets.finish_after_attention(
                conn, store, str(row["ticket_id"]), decision=actual,
            )
        except AppError as exc:
            if exc.normalized_code() != "TICKET_NOT_FOUND":
                raise
    status_row = conn.execute(
        "SELECT status FROM attentions WHERE attention_id = ?",
        (row["attention_id"],),
    ).fetchone()
    status = str(status_row["status"]) if status_row is not None else "answered"
    return actual, status


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
    user: User = Depends(require_permission("attention:read")),
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
    request: Request,
    user: User = Depends(require_permission("attention:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    decision = _decision_of(body.decision)
    row = _pending_approval(conn, user.tenant_id, attention_id)
    actual, status = _resolve_and_resume(conn, store, request, user, row, decision)
    return {"attentionId": attention_id, "status": status, "decision": actual}


@router.post("/answer-batch")
def answer_batch(
    body: BatchAnswerBody,
    request: Request,
    user: User = Depends(require_permission("attention:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    """V05-16: batch confirm/reject selected approvals.

    All selected attentions must be pending approvals of the same action
    class (tool + risk); unselected items are never touched. Validation
    happens before any resolution, so a bad list changes nothing.
    """
    decision = _decision_of(body.decision)
    ids = list(dict.fromkeys(body.attention_ids))
    rows = [_pending_approval(conn, user.tenant_id, aid) for aid in ids]

    classes = {_action_class(row) for row in rows}
    if len(classes) > 1:
        raise AppError(
            "DECISION_INVALID",
            details={"reason": "batch must contain one action class",
                     "classes": sorted(classes)},
        )

    items = []
    for row in rows:
        actual, status = _resolve_and_resume(
            conn, store, request, user, row, decision
        )
        items.append(
            {"attentionId": row["attention_id"],
             "status": status, "decision": actual}
        )
    return {"items": items, "count": len(items)}
