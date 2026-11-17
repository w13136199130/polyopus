"""Admin quota limits (V1-05)."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.usage import quota

router = APIRouter(prefix="/admin/quotas", tags=["admin"])


class UpdateQuotaBody(BaseModel):
    limit: int = Field(ge=0)


@router.get("")
def list_quotas(
    user: User = Depends(require_permission("usage:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": quota.list_limits(conn, user.tenant_id)}


@router.patch("/{quota_id}")
def update_quota(
    quota_id: str,
    body: UpdateQuotaBody,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return quota.update_limit(conn, user.tenant_id, quota_id, body.limit)
