"""In-app notification endpoints (V1-10)."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query

from polyopus.api.deps import current_user, get_db
from polyopus.domains.identity.service import User
from polyopus.domains.notifications import service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    unread_only: int = Query(default=0, alias="unreadOnly"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.list_notifications(
        conn, tenant_id=user.tenant_id, user_id=user.user_id,
        unread_only=bool(unread_only), cursor=cursor, limit=limit,
    )


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: str,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.mark_read(
        conn, tenant_id=user.tenant_id, user_id=user.user_id,
        notification_id=notification_id,
    )


@router.post("/read-all")
def mark_all_read(
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    updated = service.mark_all_read(
        conn, tenant_id=user.tenant_id, user_id=user.user_id
    )
    return {"ok": True, "updated": updated}
