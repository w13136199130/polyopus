"""Auth endpoints: login / me / logout (slice ①)."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from polyopus.api.deps import COOKIE_NAME, current_session, current_user, get_db
from polyopus.domains.identity.service import (
    Session,
    User,
    authenticate,
    create_session,
    revoke_session,
)
from polyopus.platform.security import tokens

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


def _user_payload(user: User) -> dict[str, object]:
    return {
        "userId": user.user_id,
        "tenantId": user.tenant_id,
        "username": user.username,
        "displayName": user.display_name,
        "isOwner": user.is_owner,
    }


@router.post("/login")
def login(
    body: LoginBody,
    request: Request,
    response: Response,
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    settings = request.app.state.settings
    user = authenticate(conn, body.username, body.password)
    session_id = create_session(
        conn,
        user,
        ttl_seconds=settings.session_ttl_seconds,
        user_agent=request.headers.get("User-Agent"),
        ip=request.client.host if request.client else None,
    )
    access = tokens.issue(
        settings.secret_key,
        {"sid": session_id, "uid": user.user_id, "tid": user.tenant_id},
        settings.access_ttl_seconds,
    )
    response.set_cookie(
        COOKIE_NAME,
        access,
        httponly=True,
        samesite="lax",
        max_age=settings.access_ttl_seconds,
    )
    return {
        "accessToken": access,
        "expiresIn": settings.access_ttl_seconds,
        "user": _user_payload(user),
    }


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict[str, object]:
    return {"user": _user_payload(user)}


@router.post("/logout")
def logout(
    response: Response,
    session: Session = Depends(current_session),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    revoke_session(conn, session.session_id)
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}
