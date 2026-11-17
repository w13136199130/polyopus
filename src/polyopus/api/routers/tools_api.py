"""Tool registry + per-agent tool settings (V1-12)."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.tools import service

router = APIRouter(tags=["tools"])


class ToolPatchBody(BaseModel):
    enabled_global: bool = Field(
        validation_alias=AliasChoices("enabledGlobal", "enabled_global")
    )


class AgentToolBody(BaseModel):
    tool_key: str = Field(
        validation_alias=AliasChoices("toolKey", "tool_key")
    )
    enabled: bool = True
    config: dict[str, Any] | None = None


class AgentToolsBody(BaseModel):
    items: list[AgentToolBody]


@router.get("/tools")
def list_tools(
    source: str | None = Query(default=None),
    risk: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    _user: User = Depends(require_permission("extension:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.list_tools(
            conn, source=source, risk=risk, q=q, limit=limit
        )
    }


@router.patch("/tools/{tool_key}")
def update_tool(
    tool_key: str,
    body: ToolPatchBody,
    _user: User = Depends(require_permission("extension:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.set_global_enabled(conn, tool_key, body.enabled_global)


@router.get("/agents/{agent_id}/tools")
def list_agent_tools(
    agent_id: str,
    user: User = Depends(require_permission("extension:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.agent_bindings(
        conn, tenant_id=user.tenant_id, agent_id=agent_id
    )


@router.patch("/agents/{agent_id}/tools")
def update_agent_tools(
    agent_id: str,
    body: AgentToolsBody,
    user: User = Depends(require_permission("extension:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.set_agent_bindings(
        conn, tenant_id=user.tenant_id, agent_id=agent_id,
        items=[
            {"toolKey": item.tool_key, "enabled": item.enabled,
             "config": item.config}
            for item in body.items
        ],
    )
