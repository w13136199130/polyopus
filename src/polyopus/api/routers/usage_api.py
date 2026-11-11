"""Usage endpoints (USE-001/USE-002): summary + CSV export."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from polyopus.api.deps import current_user, get_db
from polyopus.domains.identity.service import User
from polyopus.domains.usage import service

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/summary")
def usage_summary(
    window: str = Query(default="day"),
    as_user: str | None = Query(default=None, alias="asUser"),
    agent_id: str | None = Query(default=None, alias="agentId"),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.summary(
        conn, window=window, as_user=as_user, agent_id=agent_id
    )


@router.get("/export", response_class=PlainTextResponse)
def usage_export(
    window: str = Query(default="day"),
    as_user: str | None = Query(default=None, alias="asUser"),
    agent_id: str | None = Query(default=None, alias="agentId"),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> PlainTextResponse:
    data = service.summary(
        conn, window=window, as_user=as_user, agent_id=agent_id
    )
    csv = service.export_csv(data["items"])  # type: ignore[arg-type]
    return PlainTextResponse(csv, media_type="text/csv")
