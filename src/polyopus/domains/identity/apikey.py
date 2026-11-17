"""API keys (V1-03): hashed-at-rest bearer credentials with scopes/expiry."""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from dataclasses import replace

from polyopus.domains.identity.service import User
from polyopus.platform.errors import AppError
from polyopus.platform.security import tokens

KEY_PREFIX = "poly_"


def _token(prefix: str, secret: str) -> str:
    return f"{KEY_PREFIX}{prefix}_{secret}"


def create_key(
    conn: sqlite3.Connection,
    user: User,
    *,
    name: str,
    scopes: list[str],
    ttl_seconds: int | None = None,
) -> dict[str, object]:
    now = int(time.time())
    prefix = secrets.token_hex(6)
    secret = secrets.token_urlsafe(24)
    plaintext = _token(prefix, secret)
    key_id = "ak_" + secrets.token_hex(8)
    expires_at = now + ttl_seconds if ttl_seconds else None
    conn.execute(
        """
        INSERT INTO api_keys
          (api_key_id, tenant_id, user_id, name, prefix, key_hash,
           scopes_json, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (key_id, user.tenant_id, user.user_id, name, prefix,
         tokens.hash_token(plaintext), json.dumps(scopes), expires_at, now),
    )
    conn.commit()
    return {
        "key": {
            "id": key_id,
            "name": name,
            "prefix": prefix,
            "scopes": scopes,
            "expiresAt": expires_at,
            "createdAt": now,
        },
        "secret": plaintext,
    }


def list_keys(
    conn: sqlite3.Connection, user: User, *, include_revoked: bool = False
) -> list[dict[str, object]]:
    where = "tenant_id = ? AND user_id = ?"
    if not include_revoked:
        where += " AND revoked_at IS NULL"
    rows = conn.execute(
        f"SELECT * FROM api_keys WHERE {where} ORDER BY id DESC",
        (user.tenant_id, user.user_id),
    ).fetchall()
    return [
        {
            "id": row["api_key_id"],
            "name": row["name"],
            "prefix": row["prefix"],
            "scopes": json.loads(row["scopes_json"] or "[]"),
            "lastUsedAt": row["last_used_at"],
            "expiresAt": row["expires_at"],
            "revokedAt": row["revoked_at"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def revoke_key(conn: sqlite3.Connection, user: User, api_key_id: str) -> None:
    cur = conn.execute(
        "UPDATE api_keys SET revoked_at = ? "
        "WHERE tenant_id = ? AND user_id = ? AND api_key_id = ? "
        "AND revoked_at IS NULL",
        (int(time.time()), user.tenant_id, user.user_id, api_key_id),
    )
    conn.commit()
    if not cur.rowcount:
        raise AppError("NOT_FOUND", details={"apiKeyId": api_key_id})


def resolve_key(conn: sqlite3.Connection, token: str) -> User | None:
    """Bearer token -> scoped User, or None for unknown/expired/revoked."""
    if not token.startswith(KEY_PREFIX):
        return None
    parts = token.split("_", 2)
    if len(parts) != 3:
        return None
    _, prefix, _secret = parts
    row = conn.execute(
        "SELECT * FROM api_keys WHERE prefix = ?", (prefix,)
    ).fetchone()
    if row is None:
        return None
    if str(row["key_hash"]) != tokens.hash_token(token):
        return None
    now = int(time.time())
    if row["revoked_at"] is not None:
        return None
    if row["expires_at"] is not None and int(row["expires_at"]) < now:
        return None
    user_row = conn.execute(
        "SELECT * FROM users WHERE user_id = ? AND deleted_at IS NULL",
        (row["user_id"],),
    ).fetchone()
    if user_row is None or str(user_row["status"]) != "active":
        return None
    conn.execute(
        "UPDATE api_keys SET last_used_at = ? WHERE api_key_id = ?",
        (now, row["api_key_id"]),
    )
    conn.commit()
    scopes = tuple(str(s) for s in json.loads(row["scopes_json"] or "[]"))
    base = User(
        user_id=str(user_row["user_id"]),
        tenant_id=str(user_row["tenant_id"]),
        username=str(user_row["username"]),
        display_name=user_row["display_name"],
        is_owner=bool(user_row["is_owner"]),
    )
    return replace(base, roles=("api_key",), permissions=scopes)


__all__ = ["create_key", "list_keys", "resolve_key", "revoke_key"]
