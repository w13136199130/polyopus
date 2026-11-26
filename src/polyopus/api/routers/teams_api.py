"""Team endpoints (v1.1 orchestration slice 1): CRUD + member roster."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.orchestration import service
from polyopus.platform.events.store import EventStore

router = APIRouter(prefix="/teams", tags=["teams"])


class TeamCreateBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    lead_id: str | None = Field(
        default=None, validation_alias=AliasChoices("leadId", "lead_id"),
    )
    member_ids: list[str] | None = Field(
        default=None, validation_alias=AliasChoices("memberIds", "member_ids"),
    )


class TeamPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None


class TeamMemberBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_id: str = Field(
        min_length=1, validation_alias=AliasChoices("agentId", "agent_id"),
    )
    role: str = "member"


class TeamRunBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task: str = Field(min_length=1, max_length=4000)
    member_ids: list[str] | None = Field(
        default=None, validation_alias=AliasChoices("memberIds", "member_ids"),
    )
    # Coordinator split: [{memberAgentId, task}]. Omitted -> same task to all.
    plan: list[dict[str, str]] | None = None


class TeamStopBody(BaseModel):
    scope: str = "room"


@router.get("")
def list_teams(
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(require_permission("team:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.list_teams(
            conn, tenant_id=user.tenant_id, q=q, limit=limit,
        ),
    }


@router.post("", status_code=201)
def create_team(
    body: TeamCreateBody,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_team(
        conn, tenant_id=user.tenant_id, created_by=user.user_id,
        name=body.name, description=body.description,
        lead_id=body.lead_id, member_ids=body.member_ids,
    )


@router.get("/{team_id}")
def get_team(
    team_id: str,
    user: User = Depends(require_permission("team:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.get_team(conn, tenant_id=user.tenant_id, team_id=team_id)


@router.patch("/{team_id}")
def update_team(
    team_id: str,
    body: TeamPatchBody,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.update_team(
        conn, tenant_id=user.tenant_id, team_id=team_id,
        name=body.name, description=body.description, by=user.user_id,
    )


@router.delete("/{team_id}")
def delete_team(
    team_id: str,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_team(
        conn, tenant_id=user.tenant_id, team_id=team_id, by=user.user_id,
    )
    return {"ok": True, "teamId": team_id}


@router.post("/{team_id}/members")
def add_member(
    team_id: str,
    body: TeamMemberBody,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.add_member(
        conn, tenant_id=user.tenant_id, team_id=team_id,
        agent_id=body.agent_id, role=body.role, by=user.user_id,
    )


@router.delete("/{team_id}/members/{agent_id}")
def remove_member(
    team_id: str,
    agent_id: str,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.remove_member(
        conn, tenant_id=user.tenant_id, team_id=team_id,
        agent_id=agent_id, by=user.user_id,
    )


@router.post("/{team_id}/runs", status_code=201)
def start_team_run(
    team_id: str,
    body: TeamRunBody,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    return service.start_team_run(
        conn, store, tenant_id=user.tenant_id, team_id=team_id,
        task=body.task, by=user.user_id, member_ids=body.member_ids,
        plan=body.plan,
    )


@router.post("/{team_id}/stop")
def stop_team(
    team_id: str,
    body: TeamStopBody,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    return service.stop_team(
        conn, store, tenant_id=user.tenant_id, team_id=team_id,
        scope=body.scope, by=user.user_id,
    )
