"""Admin data jobs: export progress + tenant purge (V1-06)."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.data_jobs import service
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/admin", tags=["admin"])


class TenantPurgeBody(BaseModel):
    confirm_name: str = Field(
        validation_alias=AliasChoices("confirmName", "confirm_name")
    )
    reason: str = Field(min_length=1)


@router.get("/data-jobs")
def list_data_jobs(
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    """P2-7: recent export/purge jobs for the console table."""
    return {"items": service.list_jobs(conn, tenant_id=user.tenant_id)}


@router.get("/data-jobs/{job_id}")
def get_data_job(
    job_id: str,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.get_job(conn, tenant_id=user.tenant_id, job_id=job_id)


@router.delete("/tenants/{tenant_id}", status_code=202)
def purge_tenant(
    tenant_id: str,
    body: TenantPurgeBody,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_tenant_purge(
        conn, tenant_id=user.tenant_id, target_tenant_id=tenant_id,
        user_id=user.user_id, confirm_name=body.confirm_name, reason=body.reason,
    )
