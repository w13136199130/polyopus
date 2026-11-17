"""Invitations API (V1-04)."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import (
    COOKIE_NAME,
    REFRESH_COOKIE,
    get_db,
    require_permission,
)
from polyopus.domains.identity import admin, rbac
from polyopus.domains.identity.service import User, create_session
from polyopus.platform.security import tokens

router = APIRouter(prefix="/invites", tags=["invites"])


class CreateInviteBody(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    role: str = Field(default="member")
    expires_in_hours: int = Field(
        default=72, gt=0, le=720,
        validation_alias=AliasChoices("expires_in_hours", "expiresInHours"),
    )


class AcceptInviteBody(BaseModel):
    token: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=200)
    display_name: str | None = Field(
        default=None, max_length=100,
        validation_alias=AliasChoices("display_name", "displayName"),
    )


@router.get("")
def list_invites(
    status: Literal["pending", "accepted", "expired", "revoked"] | None = Query(
        default=None
    ),
    user: User = Depends(require_permission("invite:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": admin.list_invites(conn, user.tenant_id, status)}


@router.post("", status_code=201)
def create_invite(
    body: CreateInviteBody,
    user: User = Depends(require_permission("invite:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return admin.create_invite(
        conn, tenant_id=user.tenant_id, email=body.email, role=body.role,
        invited_by=user.user_id, expires_in_hours=body.expires_in_hours,
    )


@router.delete("/{invite_id}")
def revoke_invite(
    invite_id: str,
    user: User = Depends(require_permission("invite:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    admin.revoke_invite(conn, user.tenant_id, invite_id)
    return {"inviteId": invite_id, "revoked": True}


@router.get("/{token}")
def preview_invite(
    token: str, conn: Connection = Depends(get_db)
) -> dict[str, object]:
    return admin.preview_invite(conn, token)


@router.post("/accept")
def accept_invite(
    body: AcceptInviteBody,
    request: Request,
    response: Response,
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    user_view, _invite = admin.accept_invite(
        conn, body.token, body.password, body.display_name
    )
    user = rbac.with_permissions(
        conn,
        User(
            user_id=str(user_view["userId"]),
            tenant_id=str(user_view["tenantId"]),
            username=str(user_view["username"]),
            display_name=user_view["displayName"],
            is_owner=False,
        ),
    )
    settings = request.app.state.settings
    session_id, refresh = create_session(
        conn, user, ttl_seconds=settings.session_ttl_seconds,
        user_agent=request.headers.get("User-Agent"),
        ip=request.client.host if request.client else None,
    )
    access = tokens.issue(
        settings.secret_key,
        {"sid": session_id, "uid": user.user_id, "tid": user.tenant_id},
        settings.access_ttl_seconds,
    )
    response.set_cookie(
        COOKIE_NAME, access, httponly=True, samesite="lax",
        max_age=settings.access_ttl_seconds,
    )
    response.set_cookie(
        REFRESH_COOKIE, refresh, httponly=True, samesite="lax",
        max_age=30 * 86400, path="/api/v1/auth",
    )
    return {
        "accessToken": access,
        "refreshToken": refresh,
        "expiresIn": settings.access_ttl_seconds,
        "user": user_view,
    }
