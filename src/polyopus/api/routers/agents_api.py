"""Expert/agent endpoints (V1-11): CRUD, publish, draft test."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.agents import service
from polyopus.domains.conversations import service as conversations
from polyopus.domains.identity.service import User
from polyopus.platform.events.store import EventStore

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    model: str | None = None
    system_prompt: str | None = Field(
        default=None,
        validation_alias=AliasChoices("systemPrompt", "system_prompt"),
    )


class AgentPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    model: str | None = None
    system_prompt: str | None = Field(
        default=None,
        validation_alias=AliasChoices("systemPrompt", "system_prompt"),
    )
    status: str | None = None


class AgentTestBody(BaseModel):
    message: str = Field(min_length=1)


@router.get("")
def list_agents(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(require_permission("agent:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.list_agents(
            conn, tenant_id=user.tenant_id, status=status, q=q, limit=limit
        ),
        "templates": list(service.BUILTIN_TEMPLATES),
    }


@router.post("", status_code=201)
def create_agent(
    body: AgentCreateBody,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_agent(
        conn, tenant_id=user.tenant_id, created_by=user.user_id,
        name=body.name, description=body.description, model=body.model,
        system_prompt=body.system_prompt,
    )


@router.get("/{agent_id}")
def get_agent(
    agent_id: str,
    user: User = Depends(require_permission("agent:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.get_agent(conn, tenant_id=user.tenant_id, agent_id=agent_id)


@router.patch("/{agent_id}")
def update_agent(
    agent_id: str,
    body: AgentPatchBody,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.update_agent(
        conn, tenant_id=user.tenant_id, agent_id=agent_id, name=body.name,
        description=body.description, model=body.model,
        system_prompt=body.system_prompt, status=body.status,
    )


@router.delete("/{agent_id}")
def delete_agent(
    agent_id: str,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_agent(conn, tenant_id=user.tenant_id, agent_id=agent_id)
    return {"ok": True, "agentId": agent_id}


@router.post("/{agent_id}/publish")
def publish_agent(
    agent_id: str,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.publish_agent(
        conn, tenant_id=user.tenant_id, agent_id=agent_id, by=user.user_id
    )


@router.post("/{agent_id}/test")
def test_agent(
    agent_id: str,
    body: AgentTestBody,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    service.get_agent(conn, tenant_id=user.tenant_id, agent_id=agent_id)
    thread = conversations.create_thread(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id,
        title=f"测试 {agent_id}", agent_id=agent_id,
    )
    turn_id, message_id = conversations.post_turn(
        conn, store, tenant_id=user.tenant_id, owner_id=user.user_id,
        thread_id=thread.thread_id, content=body.message,
    )
    return {
        "id": turn_id, "turnId": turn_id, "threadId": thread.thread_id,
        "messageId": message_id, "status": "queued",
        "input": {"content": body.message},
    }
