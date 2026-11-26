"""Delegation endpoints (v1.1 orchestration slice 2): list + retry."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.orchestration import service

router = APIRouter(prefix="/delegations", tags=["delegations"])


@router.get("")
def list_delegations(
    team_id: str | None = Query(default=None),
    state: str | None = Query(default=None),
    parent_run_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(require_permission("team:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.list_delegations(
            conn, tenant_id=user.tenant_id, team_id=team_id, state=state,
            parent_run_id=parent_run_id, limit=limit,
        ),
    }


@router.post("/{delegation_id}/retry")
def retry_delegation(
    delegation_id: str,
    user: User = Depends(require_permission("team:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.retry_delegation(
        conn, tenant_id=user.tenant_id, delegation_id=delegation_id,
        by=user.user_id,
    )
