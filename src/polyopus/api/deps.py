"""FastAPI dependencies: per-request DB, EventStore, current user."""

from __future__ import annotations

from collections.abc import Iterator
from sqlite3 import Connection

from fastapi import Depends, Request

from polyopus.domains.identity.service import Session, User, load_session
from polyopus.platform.db.migrator import connect
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore
from polyopus.platform.security import tokens

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


def current_user(session: Session = Depends(current_session)) -> User:
    return session.user
