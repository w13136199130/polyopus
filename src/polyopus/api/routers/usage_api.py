"""Usage endpoints (USE-001/USE-002): summary + CSV export."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.usage import service

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/summary")
def usage_summary(
    window: str = Query(default="day"),
    range_days: int | None = Query(default=None, alias="range", ge=1, le=365),
    group_by: str = Query(default="model", alias="groupBy", pattern="^(model|agent|day)$"),
    as_user: str | None = Query(default=None, alias="asUser"),
    agent_id: str | None = Query(default=None, alias="agentId"),
    user: User = Depends(require_permission("usage:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.summary(
        conn, window=window, as_user=as_user, agent_id=agent_id,
        tenant_id=user.tenant_id, group_by=group_by, range_days=range_days,
    )


@router.get("/export", response_class=PlainTextResponse)
def usage_export(
    window: str = Query(default="day"),
    range_days: int | None = Query(default=None, alias="range", ge=1, le=365),
    group_by: str = Query(default="model", alias="groupBy", pattern="^(model|agent|day)$"),
    as_user: str | None = Query(default=None, alias="asUser"),
    agent_id: str | None = Query(default=None, alias="agentId"),
    user: User = Depends(require_permission("usage:read")),
    conn: Connection = Depends(get_db),
) -> PlainTextResponse:
    data = service.summary(
        conn, window=window, as_user=as_user, agent_id=agent_id,
        tenant_id=user.tenant_id, group_by=group_by, range_days=range_days,
    )
    csv = service.export_csv(data["items"], group_by)  # type: ignore[arg-type]
    return PlainTextResponse(csv, media_type="text/csv")
