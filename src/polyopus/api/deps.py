"""FastAPI dependencies: per-request DB, EventStore, current user."""

from __future__ import annotations

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
    # Roles are lazily materialized on first use so v0.5 users get a role
    # without a data migration.
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


def current_tenant(user: User = Depends(current_user)) -> TenantContext:
    return TenantContext.of(user.tenant_id)
