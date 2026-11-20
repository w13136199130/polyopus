"""Thread/turn endpoints + SSE replay (slice ①)."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from sqlite3 import Connection
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import AliasChoices, BaseModel, Field, field_validator

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.conversations import service
from polyopus.domains.identity.service import User
from polyopus.platform.db.migrator import connect
from polyopus.platform.events.store import EventStore

router = APIRouter(prefix="/threads", tags=["threads"])

# V05-22: an idle follow stream emits a comment heartbeat so proxies and
# EventSource clients do not consider it dead. Tests patch this value.
SSE_PING_SECONDS = 15.0


class CreateThreadBody(BaseModel):
    title: str = Field(default="新对话", max_length=200)
    agent_id: str | None = Field(
        default=None, validation_alias=AliasChoices("agentId", "agent_id")
    )


class PostTurnBody(BaseModel):
    content: str
    clientMessageId: str | None = None


class PatchThreadBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None
    # Full replacement of the composer state; the UI always sends the whole
    # object so removing the last KB/connector is expressible.
    settings: dict[str, Any] | None = None

    @field_validator("settings")
    @classmethod
    def _validate_settings(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        """Bound the blob and the shapes the engine reads.

        The engine trusts `kbIds`/`model`/`approvalPolicy`; rejecting bad
        shapes here keeps a malformed client from turning into a turn-time
        surprise. Unknown keys pass through (forward compatibility)."""
        if value is None:
            return value
        if len(json.dumps(value, ensure_ascii=False)) > 8_192:
            raise ValueError("settings too large")
        for key in ("kbIds", "connectorIds", "subagentIds"):
            if key not in value:
                continue
            items = value[key]
            if (
                not isinstance(items, list)
                or len(items) > 50
                or not all(isinstance(item, str) for item in items)
            ):
                raise ValueError(f"{key} must be a list of up to 50 ids")
        if "model" in value and not isinstance(value["model"], str):
            raise ValueError("model must be a string")
        if value.get("approvalPolicy") not in (None, "ask", "auto"):
            raise ValueError("approvalPolicy must be ask or auto")
        return value


class BranchThreadBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    message_id: str | None = Field(
        default=None, validation_alias=AliasChoices("messageId", "message_id")
    )


class EditTurnBody(BaseModel):
    content: str = Field(min_length=1, max_length=20_000)


def _thread_payload(thread: service.Thread) -> dict[str, object]:
    return {
        "threadId": thread.thread_id,
        "title": thread.title,
        "status": thread.status,
        "lastMessageAt": thread.last_message_at,
        "unreadCount": thread.unread_count,
        "createdAt": thread.created_at,
        "agentId": thread.agent_id,
        "agentVersionId": thread.agent_version_id,
        "pinned": thread.pinned,
        "branchOf": thread.branch_of,
        "settings": thread.settings,
    }


@router.get("")
def list_threads(
    user: User = Depends(require_permission("chat:read")), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    items = service.list_threads(conn, tenant_id=user.tenant_id, owner_id=user.user_id)
    return {"items": [_thread_payload(t) for t in items]}


@router.post("", status_code=201)
def create_thread(
    body: CreateThreadBody,
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    thread = service.create_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id, title=body.title,
        agent_id=body.agent_id,
    )
    return _thread_payload(thread)


@router.patch("/{thread_id}")
def patch_thread(
    thread_id: str,
    body: PatchThreadBody,
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    """Rename, pin, or replace the composer chips for one session."""
    thread = service.update_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id,
        thread_id=thread_id, title=body.title, pinned=body.pinned,
        settings=body.settings,
    )
    return _thread_payload(thread)


@router.delete("/{thread_id}")
def delete_thread(
    thread_id: str,
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id, thread_id=thread_id
    )
    return {"ok": True, "threadId": thread_id}


@router.post("/{thread_id}/branch", status_code=201)
def branch_thread(
    thread_id: str,
    body: BranchThreadBody,
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    """Fork a session: copies the visible history into a new conversation."""
    thread = service.branch_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id,
        thread_id=thread_id, title=body.title,
        up_to_message_id=body.message_id,
    )
    return _thread_payload(thread)


@router.post("/{thread_id}/turns/{turn_id}/stop")
def stop_turn(
    thread_id: str,
    turn_id: str,
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    status = service.stop_turn(
        conn, store, tenant_id=user.tenant_id, owner_id=user.user_id,
        thread_id=thread_id, turn_id=turn_id,
    )
    return {"turnId": turn_id, "status": status}


@router.post("/{thread_id}/turns/{turn_id}/regenerate", status_code=202)
def regenerate_turn(
    thread_id: str,
    turn_id: str,
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    service.requeue_turn(
        conn, store, tenant_id=user.tenant_id, owner_id=user.user_id,
        thread_id=thread_id, turn_id=turn_id,
    )
    return {"turnId": turn_id, "status": "queued"}


@router.post("/{thread_id}/turns/{turn_id}/edit", status_code=202)
def edit_turn(
    thread_id: str,
    turn_id: str,
    body: EditTurnBody,
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    service.requeue_turn(
        conn, store, tenant_id=user.tenant_id, owner_id=user.user_id,
        thread_id=thread_id, turn_id=turn_id, content=body.content,
    )
    return {"turnId": turn_id, "status": "queued"}


@router.get("/{thread_id}/trace")
def thread_trace(
    thread_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    user: User = Depends(require_permission("chat:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    """Event tail for the Dock (prototype 轨迹/终端); ownership-checked."""
    service.get_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id, thread_id=thread_id
    )
    return {"items": service.list_trace(conn, thread_id=thread_id, limit=limit)}


@router.get("/{thread_id}/messages")
def list_messages(
    thread_id: str,
    user: User = Depends(require_permission("chat:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.get_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id, thread_id=thread_id
    )
    return {"items": service.list_messages(conn, thread_id=thread_id)}


@router.post("/{thread_id}/turns", status_code=202)
def post_turn(
    thread_id: str,
    body: PostTurnBody,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: User = Depends(require_permission("chat:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    turn_id, message_id = service.post_turn(
        conn,
        store,
        tenant_id=user.tenant_id,
        owner_id=user.user_id,
        thread_id=thread_id,
        content=body.content,
        idempotency_key=idempotency_key or body.clientMessageId,
    )
    return {"turnId": turn_id, "messageId": message_id, "status": "queued"}


@router.get("/{thread_id}/events")
def replay_events(
    thread_id: str,
    request: Request,
    after_seq: int = Query(default=0, alias="after_seq", ge=0),
    follow: bool = Query(default=False),
    user: User = Depends(require_permission("chat:read")),
    conn: Connection = Depends(get_db),
) -> StreamingResponse:
    service.get_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id, thread_id=thread_id
    )
    db_path = request.app.state.settings.resolved_db_path()

    async def frames() -> AsyncIterator[str]:
        # The generator runs in a worker thread: open its own connection.
        stream_conn = connect(db_path)
        try:
            stream_store = EventStore(stream_conn)
            cursor = after_seq
            last_ping = time.monotonic()
            while True:
                wrote = False
                for event in stream_store.read(thread_id, after_seq=cursor):
                    cursor = event.seq
                    wrote = True
                    body = {
                        "seq": event.seq,
                        "type": event.type,
                        "ts": event.ts,
                        "turnId": event.turn_id,
                        "payload": event.payload,
                    }
                    data = json.dumps(body, ensure_ascii=False)
                    yield f"id: {event.seq}\ndata: {data}\n\n"
                if not follow:
                    return
                now = time.monotonic()
                if wrote:
                    last_ping = now
                elif now - last_ping >= SSE_PING_SECONDS:
                    # Comment frame: no event row, no cursor advance.
                    yield ": ping\n\n"
                    last_ping = now
                await asyncio.sleep(0.2)
        finally:
            stream_conn.close()

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
