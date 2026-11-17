"""FastAPI dependencies: per-request DB, EventStore, current user."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from sqlite3 import Connection

from fastapi import Depends, Request

from polyopus.domains.identity import rbac
from polyopus.domains.identity.service import Session, User, load_session
from polyopus.platform.db.migrator import connect
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore
from polyopus.platform.security import tokens
from polyopus.platform.tenant import TenantContext

COOKIE_NAME = "poly_session"
REFRESH_COOKIE = "poly_refresh"


def get_db(request: Request) -> Iterator[Connection]:
    settings = request.app.state.settings
    conn = connect(settings.resolved_db_path())
    try:
        yield conn
    finally:
        conn.close()


def get_store(conn: Connection = Depends(get_db)) -> EventStore:
    return EventStore(conn)


def _token_from(request: Request) -> str:
    # AUTH-014: tokens travel by header or httpOnly cookie only; a token in
    # the query string lands in access logs and browser history - reject it.
    if "access_token" in request.query_params or "token" in request.query_params:
        raise AppError("TOKEN_IN_QUERY")
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    cookie = request.cookies.get(COOKIE_NAME)
    if cookie:
        return cookie
    raise AppError("UNAUTHORIZED")


def current_session(
    request: Request, conn: Connection = Depends(get_db)
) -> Session:
    token = _token_from(request)
    if token.startswith("poly_"):
        from polyopus.domains.identity import apikey

        user = apikey.resolve_key(conn, token)
        if user is None:
            raise AppError("UNAUTHORIZED")
        return Session(
            session_id=f"api:{user.user_id}", user=user,
            expires_at=int(time.time()) + 3600, api_key=True,
        )
    try:
        claims = tokens.verify(request.app.state.settings.secret_key, token)
    except tokens.TokenError as exc:
        code = "TOKEN_EXPIRED" if "expired" in str(exc) else "UNAUTHORIZED"
        raise AppError(code) from exc
    return load_session(conn, str(claims.get("sid", "")))


def current_user(
    session: Session = Depends(current_session),
    conn: Connection = Depends(get_db),
) -> User:
    # API keys carry their own scopes; session users get lazily materialized
    # roles (v0.5 users have no role rows yet).
    if session.api_key:
        return session.user
    return rbac.with_permissions(conn, session.user)


def require_permission(permission: str) -> Callable[..., User]:
    def dependency(user: User = Depends(current_user)) -> User:
        if not rbac.has_permission(user, permission):
            raise AppError(
                "FORBIDDEN",
                details={"permission": permission, "userId": user.user_id},
            )
        return user

    return dependency


def require_step_up(
    session: Session = Depends(current_session),
) -> Session:
    if session.api_key or session.step_up_until < int(time.time()):
        raise AppError("REAUTH_REQUIRED")
    return session


def current_tenant(user: User = Depends(current_user)) -> TenantContext:
    return TenantContext.of(user.tenant_id)
