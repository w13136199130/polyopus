"""User, role-assignment and invite management (V1-04)."""

from __future__ import annotations

import secrets
import sqlite3
import time
from typing import Any, cast

from polyopus.domains.audit import service as audit
from polyopus.domains.identity import rbac
from polyopus.platform.db.seed import hash_password
from polyopus.platform.errors import AppError
from polyopus.platform.security import tokens

TENANT = "default"


def _audit(conn: sqlite3.Connection, *, action: str, tenant_id: str,
           actor: str, resource_id: str, ticket_id: str | None = None,
           detail: dict[str, Any] | None = None) -> None:
    audit.record(
        conn, tenant_id=tenant_id, action=action, result="ok",
        actor_id=actor, resource_type="user", resource_id=resource_id,
        ticket_id=ticket_id, detail=detail or {},
    )


def _user_view(row: sqlite3.Row) -> dict[str, Any]:
    roles = [r for r in str(row["roles"] or "").split(",") if r]
    return {
        "id": row["user_id"],
        "userId": row["user_id"],
        "username": row["username"],
        "displayName": row["display_name"] or row["username"],
        "tenantId": row["tenant_id"],
        "status": row["status"],
        "isOwner": bool(row["is_owner"]),
        "roles": roles,
        "role": roles[0] if roles else "member",
        "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
    }


def list_users(conn: sqlite3.Connection, tenant_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT u.*, group_concat(r.name, ',') AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.user_id
        LEFT JOIN roles r ON r.role_id = ur.role_id
        WHERE u.tenant_id = ? AND u.deleted_at IS NULL
        GROUP BY u.id ORDER BY u.id
        """,
        (tenant_id,),
    ).fetchall()
    return [_user_view(row) for row in rows]


def _get_user(conn: sqlite3.Connection, tenant_id: str, user_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT u.*, group_concat(r.name, ',') AS roles FROM users u "
        "LEFT JOIN user_roles ur ON ur.user_id = u.user_id "
        "LEFT JOIN roles r ON r.role_id = ur.role_id "
        "WHERE u.tenant_id = ? AND u.user_id = ? AND u.deleted_at IS NULL "
        "GROUP BY u.id",
        (tenant_id, user_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"userId": user_id})
    return cast(sqlite3.Row, row)


def create_user(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    username: str,
    display_name: str | None,
    password: str,
    roles: list[str],
    by: str = "system",
) -> dict[str, Any]:
    now = int(time.time())
    user_id = "us_" + secrets.token_hex(8)
    try:
        conn.execute(
            "INSERT INTO users (tenant_id, user_id, username, display_name,"
            " password_hash, status, is_owner, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)",
            (tenant_id, user_id, username, display_name or username,
             hash_password(password), now, now),
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "username_taken"}) from exc
    conn.commit()
    rbac.set_roles(conn, tenant_id=tenant_id, user_id=user_id,
                   role_names=roles, by=by)
    _audit(conn, action="user.create", tenant_id=tenant_id, actor=by,
           resource_id=user_id, detail={"username": username, "roles": roles})
    return _user_view(_get_user(conn, tenant_id, user_id))


def update_user(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    user_id: str,
    display_name: str | None = None,
    status: str | None = None,
    roles: list[str] | None = None,
    by: str = "system",
) -> dict[str, Any]:
    _get_user(conn, tenant_id, user_id)
    now = int(time.time())
    if display_name is not None:
        conn.execute("UPDATE users SET display_name = ? WHERE user_id = ?",
                     (display_name, user_id))
    if status is not None:
        if status not in ("active", "disabled"):
            raise AppError("VALIDATION_FAILED", details={"status": status})
        conn.execute("UPDATE users SET status = ? WHERE user_id = ?",
                     (status, user_id))
        if status == "disabled":
            conn.execute(
                "UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? "
                "AND user_id = ? AND revoked_at IS NULL",
                (now, tenant_id, user_id),
            )
    if roles is not None:
        rbac.set_roles(conn, tenant_id=tenant_id, user_id=user_id,
                       role_names=roles, by=by)
    conn.commit()
    _audit(conn, action="user.update", tenant_id=tenant_id, actor=by,
           resource_id=user_id,
           detail={"displayName": display_name, "status": status, "roles": roles})
    return _user_view(_get_user(conn, tenant_id, user_id))


def delete_user(
    conn: sqlite3.Connection, *, tenant_id: str, user_id: str, actor_id: str,
) -> None:
    if user_id == actor_id:
        raise AppError("CONFLICT", details={"reason": "cannot_delete_self"})
    row = _get_user(conn, tenant_id, user_id)
    role_rows = conn.execute(
        "SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.role_id "
        "WHERE ur.user_id = ?", (user_id,),
    ).fetchall()
    if any(str(r[0]) == "admin" for r in role_rows):
        admins = conn.execute(
            "SELECT count(DISTINCT ur.user_id) FROM user_roles ur "
            "JOIN roles r ON r.role_id = ur.role_id JOIN users u ON u.user_id = ur.user_id "
            "WHERE r.tenant_id = ? AND r.name = 'admin' AND u.deleted_at IS NULL "
            "AND u.status = 'active'", (tenant_id,),
        ).fetchone()
        if int(admins[0]) <= 1:
            raise AppError("CONFLICT", details={"reason": "last_admin"})
    now = int(time.time())
    conn.execute(
        "UPDATE users SET deleted_at = ?, status = 'disabled', updated_at = ? "
        "WHERE user_id = ?", (now, now, user_id),
    )
    conn.execute(
        "UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? "
        "AND revoked_at IS NULL", (now, tenant_id, user_id),
    )
    conn.commit()
    _audit(conn, action="user.delete", tenant_id=tenant_id, actor=actor_id,
           resource_id=user_id, detail={"username": str(row["username"])})


# ---- invites ----------------------------------------------------------------


def _invite_view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["invite_id"],
        "inviteId": row["invite_id"],
        "email": row["email"],
        "role": row["role_name"],
        "status": row["status"],
        "expiresAt": row["expires_at"],
        "createdAt": row["created_at"],
    }


def create_invite(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    email: str,
    role: str,
    invited_by: str,
    expires_in_hours: int = 72,
) -> dict[str, Any]:
    rbac.ensure_builtin_roles(conn, tenant_id)
    role_row = conn.execute(
        "SELECT role_id FROM roles WHERE tenant_id = ? AND name = ?",
        (tenant_id, role),
    ).fetchone()
    if role_row is None:
        raise AppError("VALIDATION_FAILED", details={"role": role})
    token = "inv_" + secrets.token_urlsafe(24)
    invite_id = "iv_" + secrets.token_hex(8)
    now = int(time.time())
    try:
        conn.execute(
            "INSERT INTO invites (tenant_id, invite_id, email, role_id,"
            " token_hash, invited_by, status, expires_at, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            (tenant_id, invite_id, email.strip().lower(), str(role_row[0]),
             tokens.hash_token(token), invited_by, now + expires_in_hours * 3600,
             now),
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "pending_invite"}) from exc
    conn.commit()
    _audit(conn, action="invite.create", tenant_id=tenant_id, actor=invited_by,
           resource_id=invite_id, detail={"email": email, "role": role})
    view = get_invite_row(conn, tenant_id, invite_id)
    return {**view, "token": token}


def list_invites(
    conn: sqlite3.Connection, tenant_id: str, status: str | None = None,
) -> list[dict[str, Any]]:
    where = "i.tenant_id = ?"
    params: list[object] = [tenant_id]
    if status:
        where += " AND i.status = ?"
        params.append(status)
    rows = conn.execute(
        "SELECT i.*, r.name AS role_name FROM invites i "
        "JOIN roles r ON r.role_id = i.role_id "
        f"WHERE {where} ORDER BY i.id DESC", params,
    ).fetchall()
    return [_invite_view(row) for row in rows]


def get_invite_row(
    conn: sqlite3.Connection, tenant_id: str, invite_id: str
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT i.*, r.name AS role_name FROM invites i "
        "JOIN roles r ON r.role_id = i.role_id "
        "WHERE i.tenant_id = ? AND i.invite_id = ?",
        (tenant_id, invite_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"inviteId": invite_id})
    return _invite_view(row)


def preview_invite(conn: sqlite3.Connection, token: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT i.*, r.name AS role_name, t.name AS tenant_name,"
        " t.tenant_id AS tenant_id FROM invites i "
        "JOIN roles r ON r.role_id = i.role_id "
        "JOIN tenants t ON t.tenant_id = i.tenant_id WHERE i.token_hash = ?",
        (tokens.hash_token(token),),
    ).fetchone()
    if row is None:
        raise AppError("INVITE_INVALID")
    if row["status"] == "accepted":
        raise AppError("INVITE_USED")
    if row["status"] == "revoked":
        raise AppError("INVITE_INVALID")
    if str(row["status"]) == "expired" or int(row["expires_at"]) < int(time.time()):
        raise AppError("INVITE_EXPIRED")
    return {
        "email": row["email"],
        "role": row["role_name"],
        "tenantId": row["tenant_id"],
        "tenantName": row["tenant_name"],
        "expiresAt": row["expires_at"],
    }


def accept_invite(
    conn: sqlite3.Connection, token: str, password: str,
    display_name: str | None = None,
) -> list[dict[str, Any]]:
    """Create the invited user; returns [user view, invite view]."""
    preview = preview_invite(conn, token)
    row = conn.execute(
        "SELECT * FROM invites WHERE token_hash = ?", (tokens.hash_token(token),)
    ).fetchone()
    assert row is not None
    email = str(row["email"])
    username = email.split("@", 1)[0]
    now = int(time.time())
    user_id = "us_" + secrets.token_hex(8)
    try:
        conn.execute(
            "INSERT INTO users (tenant_id, user_id, username, display_name,"
            " email, password_hash, status, is_owner, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)",
            (row["tenant_id"], user_id, username, display_name or username,
             email, hash_password(password), now, now),
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "username_taken"}) from exc
    conn.execute(
        "UPDATE invites SET status = 'accepted', accepted_at = ? "
        "WHERE invite_id = ?", (now, row["invite_id"]),
    )
    conn.commit()
    role = conn.execute(
        "SELECT name FROM roles WHERE role_id = ?", (row["role_id"],)
    ).fetchone()
    rbac.set_roles(
        conn, tenant_id=str(row["tenant_id"]), user_id=user_id,
        role_names=[str(role[0]) if role else "member"],
        by=f"invite:{row['invite_id']}",
    )
    _audit(conn, action="invite.accept", tenant_id=str(row["tenant_id"]),
           actor=user_id, resource_id=str(row["invite_id"]),
           detail={"email": email})
    user_row = _get_user(conn, str(row["tenant_id"]), user_id)
    invite_row = conn.execute(
        "SELECT i.*, r.name AS role_name FROM invites i "
        "JOIN roles r ON r.role_id = i.role_id WHERE i.invite_id = ?",
        (row["invite_id"],),
    ).fetchone()
    assert invite_row is not None
    _ = preview  # validated before mutation
    return [_user_view(user_row), _invite_view(invite_row)]


def revoke_invite(
    conn: sqlite3.Connection, tenant_id: str, invite_id: str
) -> None:
    cur = conn.execute(
        "UPDATE invites SET status = 'revoked' WHERE tenant_id = ? "
        "AND invite_id = ? AND status = 'pending'", (tenant_id, invite_id),
    )
    conn.commit()
    if not cur.rowcount:
        raise AppError("NOT_FOUND", details={"inviteId": invite_id})
    _audit(conn, action="invite.revoke", tenant_id=tenant_id,
           actor="system", resource_id=invite_id, detail={})


__all__ = [
    "accept_invite", "create_invite", "create_user", "delete_user",
    "get_invite_row", "list_invites", "list_users", "preview_invite",
    "revoke_invite", "update_user",
]
