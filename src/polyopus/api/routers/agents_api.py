"""Expert/agent endpoints (V1-11): CRUD, publish, draft test."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query, Request
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.agents import files as files_service
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


class AgentSubagentsBody(BaseModel):
    subagent_ids: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("subagentIds", "subagent_ids"),
    )


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
    request: Request,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_agent(
        conn, tenant_id=user.tenant_id, created_by=user.user_id,
        name=body.name, description=body.description, model=body.model,
        system_prompt=body.system_prompt,
        workspace_root=request.app.state.settings.workspace_dir,
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
    request: Request,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_agent(
        conn, tenant_id=user.tenant_id, agent_id=agent_id,
        workspace_root=request.app.state.settings.workspace_dir,
    )
    return {"ok": True, "agentId": agent_id}


@router.get("/{agent_id}/subagents")
def list_subagents(
    agent_id: str,
    user: User = Depends(require_permission("agent:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.list_subagents(
            conn, tenant_id=user.tenant_id, agent_id=agent_id
        )
    }


@router.put("/{agent_id}/subagents")
def set_subagents(
    agent_id: str,
    body: AgentSubagentsBody,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.set_subagents(
            conn, tenant_id=user.tenant_id, agent_id=agent_id,
            subagent_ids=body.subagent_ids, by=user.user_id,
        )
    }


@router.post("/{agent_id}/publish")
def publish_agent(
    agent_id: str,
    request: Request,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.publish_agent(
        conn, tenant_id=user.tenant_id, agent_id=agent_id, by=user.user_id,
        workspace_root=request.app.state.settings.workspace_dir,
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


class AgentFileWriteBody(BaseModel):
    content: str = Field(max_length=200_000)


class AgentRollbackBody(BaseModel):
    version: int = Field(ge=1)


@router.get("/{agent_id}/files")
def list_agent_files(
    agent_id: str,
    user: User = Depends(require_permission("agent:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"agentId": agent_id, "items": files_service.list_files(
        conn, tenant_id=user.tenant_id, agent_id=agent_id,
    )}


@router.get("/{agent_id}/files/{name}")
def get_agent_file(
    agent_id: str,
    name: str,
    user: User = Depends(require_permission("agent:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return files_service.get_file(
        conn, tenant_id=user.tenant_id, agent_id=agent_id, name=name,
    )


@router.put("/{agent_id}/files/{name}")
def put_agent_file(
    agent_id: str,
    name: str,
    body: AgentFileWriteBody,
    request: Request,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return files_service.put_file(
        conn, tenant_id=user.tenant_id, agent_id=agent_id,
        name=name, content=body.content, by=user.user_id,
        workspace_root=request.app.state.settings.workspace_dir,
    )


@router.delete("/{agent_id}/files/{name}")
def delete_agent_file(
    agent_id: str,
    name: str,
    request: Request,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    files_service.delete_file(
        conn, tenant_id=user.tenant_id, agent_id=agent_id,
        name=name, by=user.user_id,
        workspace_root=request.app.state.settings.workspace_dir,
    )
    return {"ok": True, "name": name}


@router.get("/{agent_id}/versions")
def list_agent_versions(
    agent_id: str,
    user: User = Depends(require_permission("agent:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": files_service.list_versions(
        conn, tenant_id=user.tenant_id, agent_id=agent_id,
    )}


@router.get("/{agent_id}/versions/{version}")
def get_agent_version(
    agent_id: str,
    version: int,
    user: User = Depends(require_permission("agent:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return files_service.get_version(
        conn, tenant_id=user.tenant_id, agent_id=agent_id, version=version,
    )


@router.post("/{agent_id}/rollback")
def rollback_agent(
    agent_id: str,
    body: AgentRollbackBody,
    request: Request,
    user: User = Depends(require_permission("agent:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return files_service.rollback_agent(
        conn, tenant_id=user.tenant_id, agent_id=agent_id,
        version=body.version, by=user.user_id,
        workspace_root=request.app.state.settings.workspace_dir,
    )
