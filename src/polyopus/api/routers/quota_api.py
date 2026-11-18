"""Admin quota limits (V1-05)."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.usage import quota

router = APIRouter(prefix="/admin/quotas", tags=["admin"])


class UpdateQuotaBody(BaseModel):
    limit: int = Field(ge=0)


class CreateQuotaBody(BaseModel):
    scope: str = Field(pattern="^(tenant|user|model)$")
    scope_id: str = Field(
        min_length=1, max_length=128,
        validation_alias=AliasChoices("scopeId", "scope_id"),
    )
    metric: str = Field(pattern="^(tokens|cost|requests)$")
    limit: int = Field(ge=0)
    window: str = Field(pattern="^(day|month|absolute)$")


@router.get("")
def list_quotas(
    user: User = Depends(require_permission("usage:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": quota.list_limits(conn, user.tenant_id)}


@router.post("", status_code=201)
def create_quota(
    body: CreateQuotaBody,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    """P2-7: create/replace a limit from the admin console (upsert by
    scope+scope_id+metric+window, matching the table's unique key)."""
    quota.set_limit(
        conn, tenant_id=user.tenant_id, scope=body.scope,
        scope_id=body.scope_id, metric=body.metric,
        limit_value=body.limit, window=body.window,
    )
    limits = [
        row for row in quota.list_limits(conn, user.tenant_id)
        if row["scope"] == body.scope and row["scopeId"] == body.scope_id
        and row["metric"] == body.metric and row["window"] == body.window
    ]
    assert limits, "upserted limit not listed"
    return limits[0]


@router.patch("/{quota_id}")
def update_quota(
    quota_id: str,
    body: UpdateQuotaBody,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return quota.update_limit(conn, user.tenant_id, quota_id, body.limit)
