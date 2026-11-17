"""Thread/turn endpoints + SSE replay (slice ①)."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from sqlite3 import Connection

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import AliasChoices, BaseModel, Field

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
