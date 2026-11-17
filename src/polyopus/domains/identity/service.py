"""Identity use-cases: password login, session lifecycle (M1 slice ①)."""

from __future__ import annotations

import secrets
import sqlite3
import time
from dataclasses import dataclass

from polyopus.platform.db.seed import verify_password
from polyopus.platform.errors import AppError
from polyopus.platform.security import tokens

DEFAULT_TENANT = "default"


@dataclass(frozen=True)
class User:
    user_id: str
    tenant_id: str
    username: str
    display_name: str | None
    is_owner: bool
    roles: tuple[str, ...] = ()
    permissions: tuple[str, ...] = ()


@dataclass(frozen=True)
class Session:
    session_id: str
    user: User
    expires_at: int
    step_up_until: int = 0
    api_key: bool = False


def _row_to_user(row: sqlite3.Row) -> User:
    return User(
        user_id=str(row["user_id"]),
        tenant_id=str(row["tenant_id"]),
        username=str(row["username"]),
        display_name=row["display_name"],
        is_owner=bool(row["is_owner"]),
    )


def find_user(conn: sqlite3.Connection, tenant_id: str, username: str) -> tuple[sqlite3.Row, User]:
    row = conn.execute(
        "SELECT * FROM users WHERE tenant_id = ? AND username = ? AND deleted_at IS NULL",
        (tenant_id, username),
    ).fetchone()
    if row is None:
        raise AppError("AUTH_FAILED")
    return row, _row_to_user(row)


def authenticate(
    conn: sqlite3.Connection, username: str, password: str,
    tenant_id: str = DEFAULT_TENANT,
) -> User:
    row, user = find_user(conn, tenant_id, username)
    if str(row["status"]) != "active":
        raise AppError("USER_DISABLED")
    if not row["password_hash"] or not verify_password(str(row["password_hash"]), password):
        raise AppError("AUTH_FAILED")
    return user


def create_session(
    conn: sqlite3.Connection,
    user: User,
    *,
    ttl_seconds: int,
    user_agent: str | None = None,
    ip: str | None = None,
    family_id: str | None = None,
) -> tuple[str, str]:
    session_id = "se_" + secrets.token_hex(12)
    refresh = tokens.new_refresh_token()
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO sessions
          (session_id, tenant_id, user_id, refresh_hash, user_agent, ip,
           expires_at, created_at, family_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            user.tenant_id,
            user.user_id,
            tokens.hash_token(refresh),
            user_agent,
            ip,
            now + ttl_seconds,
            now,
            family_id or session_id,
        ),
    )
    conn.commit()
    return session_id, refresh


def rotate_session(
    conn: sqlite3.Connection,
    refresh_token: str,
    *,
    ttl_seconds: int,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[str, str, User]:
    """Rotate a refresh token; reuse of a rotated token revokes the family."""
    now = int(time.time())
    row = conn.execute(
        "SELECT * FROM sessions WHERE refresh_hash = ?",
        (tokens.hash_token(refresh_token),),
    ).fetchone()
    if row is None:
        raise AppError("AUTH_FAILED")
    family = str(row["family_id"] or row["session_id"])
    if row["revoked_at"] is not None:
        # Replay of a used refresh token: burn every descendant session.
        conn.execute(
            "UPDATE sessions SET revoked_at = ? WHERE family_id = ? "
            "AND revoked_at IS NULL",
            (now, family),
        )
        conn.commit()
        raise AppError("UNAUTHORIZED", details={"reason": "refresh_reuse"})
    if int(row["expires_at"]) < now:
        raise AppError("TOKEN_EXPIRED")
    user_row = conn.execute(
        "SELECT * FROM users WHERE user_id = ? AND deleted_at IS NULL",
        (row["user_id"],),
    ).fetchone()
    if user_row is None:
        raise AppError("UNAUTHORIZED")
    conn.execute(
        "UPDATE sessions SET revoked_at = ?, used_at = ? WHERE session_id = ?",
        (now, now, row["session_id"]),
    )
    conn.commit()
    user = _row_to_user(user_row)
    session_id, refresh = create_session(
        conn, user, ttl_seconds=ttl_seconds,
        user_agent=user_agent, ip=ip, family_id=family,
    )
    return session_id, refresh, user


def mark_step_up(
    conn: sqlite3.Connection, session_id: str, *, seconds: int = 300
) -> int:
    until = int(time.time()) + seconds
    conn.execute(
        "UPDATE sessions SET step_up_until = ? WHERE session_id = ?",
        (until, session_id),
    )
    conn.commit()
    return until


def load_session(conn: sqlite3.Connection, session_id: str) -> Session:
    row = conn.execute(
        "SELECT * FROM sessions WHERE session_id = ? AND revoked_at IS NULL", (session_id,)
    ).fetchone()
    if row is None:
        raise AppError("UNAUTHORIZED")
    if int(row["expires_at"]) < int(time.time()):
        raise AppError("TOKEN_EXPIRED")
    user_row = conn.execute(
        "SELECT * FROM users WHERE user_id = ? AND deleted_at IS NULL", (row["user_id"],)
    ).fetchone()
    if user_row is None:
        raise AppError("UNAUTHORIZED")
    return Session(
        session_id=session_id,
        user=_row_to_user(user_row),
        expires_at=int(row["expires_at"]),
        step_up_until=int(row["step_up_until"] or 0),
    )


def revoke_session(conn: sqlite3.Connection, session_id: str) -> None:
    conn.execute(
        "UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL",
        (int(time.time()), session_id),
    )
    conn.commit()
