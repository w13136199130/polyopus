"""Read-only audit API (V05-19): filter + CSV/JSON export."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse, PlainTextResponse

from polyopus.api.deps import current_user, get_db
from polyopus.domains.audit import service
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/admin/audit", tags=["audit"])


def _items(
    conn: Connection,
    user: User,
    *,
    actor_id: str | None,
    action: str | None,
    result: str | None,
    ticket_id: str | None,
    resource_type: str | None,
    resource_id: str | None,
    limit: int,
    offset: int,
    order: str,
) -> list[dict[str, Any]]:
    return service.query(
        conn, tenant_id=user.tenant_id, actor_id=actor_id, action=action,
        result=result, ticket_id=ticket_id, resource_type=resource_type,
        resource_id=resource_id, limit=limit, offset=offset, order=order,
    )


@router.get("")
def list_audit(
    actor_id: str | None = Query(default=None, alias="actorId"),
    action: str | None = Query(default=None),
    result: str | None = Query(default=None),
    ticket_id: str | None = Query(default=None, alias="ticketId"),
    resource_type: str | None = Query(default=None, alias="resourceType"),
    resource_id: str | None = Query(default=None, alias="resourceId"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    order: Literal["asc", "desc"] = Query(default="desc"),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    items = _items(
        conn, user, actor_id=actor_id, action=action, result=result,
        ticket_id=ticket_id, resource_type=resource_type,
        resource_id=resource_id, limit=limit, offset=offset, order=order,
    )
    return {"items": items, "count": len(items)}


@router.get("/export")
def export_audit(
    fmt: Literal["csv", "json"] = Query(default="csv", alias="format"),
    actor_id: str | None = Query(default=None, alias="actorId"),
    action: str | None = Query(default=None),
    result: str | None = Query(default=None),
    ticket_id: str | None = Query(default=None, alias="ticketId"),
    resource_type: str | None = Query(default=None, alias="resourceType"),
    resource_id: str | None = Query(default=None, alias="resourceId"),
    order: Literal["asc", "desc"] = Query(default="desc"),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> Response:
    items = _items(
        conn, user, actor_id=actor_id, action=action, result=result,
        ticket_id=ticket_id, resource_type=resource_type,
        resource_id=resource_id, limit=500, offset=0, order=order,
    )
    if fmt == "json":
        return JSONResponse({"items": items, "count": len(items)})
    return PlainTextResponse(
        service.export_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit.csv"'},
    )
