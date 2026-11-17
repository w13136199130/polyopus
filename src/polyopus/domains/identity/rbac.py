"""Role-based access control (V1-02).

Three builtin roles per tenant:

- admin   -> ``*`` (all permission points)
- member  -> day-to-day work: chat, tickets, sources, cron, usage
- auditor -> read-only tickets/chat/usage + audit

Roles are materialized lazily per tenant (existing tenants get them on the
next login). `set_roles` refuses to remove the last active admin.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from dataclasses import replace

from polyopus.domains.identity.service import User
from polyopus.platform.errors import AppError

MEMBER_PERMISSIONS = (
    "chat:read", "chat:write",
    "ticket:read", "ticket:write",
    "attention:read", "attention:write",
    "source:read", "source:write",
    "cron:read", "cron:write",
    "usage:read",
    "agent:read", "agent:write",
    "knowledge:read", "knowledge:write",
    "extension:read", "extension:write",
    "connector:read", "connector:write",
    "settings:read",
)
AUDITOR_PERMISSIONS = (
    "chat:read", "ticket:read", "attention:read", "usage:read",
    "audit:read", "settings:read", "user:read", "invite:read", "role:read",
    "knowledge:read",
)
BUILTIN: dict[str, tuple[str, ...]] = {
    "admin": ("*",),
    "member": MEMBER_PERMISSIONS,
    "auditor": AUDITOR_PERMISSIONS,
}


def role_id_for(tenant_id: str, name: str) -> str:
    return f"rl_{tenant_id}_{name}"


def ensure_builtin_roles(conn: sqlite3.Connection, tenant_id: str) -> None:
    now = int(time.time())
    for name, permissions in BUILTIN.items():
        row = conn.execute(
            "SELECT role_id FROM roles WHERE tenant_id = ? AND name = ?",
            (tenant_id, name),
        ).fetchone()
        if row is not None:
            current = conn.execute(
                "SELECT permissions_json FROM roles WHERE role_id = ?",
                (str(row[0]),),
            ).fetchone()
            wanted = json.dumps(list(permissions))
            if current is None or current[0] != wanted:
                conn.execute(
                    "UPDATE roles SET permissions_json = ?, updated_at = ?"
                    " WHERE role_id = ?", (wanted, now, str(row[0])),
                )
            continue
        conn.execute(
            """
            INSERT INTO roles
              (role_id, tenant_id, name, description, builtin,
               permissions_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)
            """,
            (role_id_for(tenant_id, name), tenant_id, name,
             f"builtin {name}", json.dumps(list(permissions)), now, now),
        )
    conn.commit()


def ensure_user_role(conn: sqlite3.Connection, user: User) -> None:
    """Existing users without an assignment get the least surprising role:
    owners -> admin, everyone else -> member."""
    ensure_builtin_roles(conn, user.tenant_id)
    row = conn.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? LIMIT 1", (user.user_id,)
    ).fetchone()
    if row is not None:
        return
    name = "admin" if user.is_owner else "member"
    role = conn.execute(
        "SELECT role_id FROM roles WHERE tenant_id = ? AND name = ?",
        (user.tenant_id, name),
    ).fetchone()
    if role is None:
        return
    conn.execute(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
        (user.user_id, str(role[0]), int(time.time())),
    )
    conn.commit()


def roles_for_user(conn: sqlite3.Connection, user: User) -> tuple[str, ...]:
    rows = conn.execute(
        "SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.role_id "
        "WHERE r.tenant_id = ? AND ur.user_id = ? ORDER BY r.name",
        (user.tenant_id, user.user_id),
    ).fetchall()
    return tuple(str(row[0]) for row in rows)


def permissions_for_user(conn: sqlite3.Connection, user: User) -> tuple[str, ...]:
    rows = conn.execute(
        "SELECT r.permissions_json FROM roles r "
        "JOIN user_roles ur ON ur.role_id = r.role_id "
        "WHERE r.tenant_id = ? AND ur.user_id = ?",
        (user.tenant_id, user.user_id),
    ).fetchall()
    permissions: set[str] = set()
    for row in rows:
        try:
            permissions.update(str(p) for p in json.loads(row[0] or "[]"))
        except (ValueError, TypeError):
            continue
    return tuple(sorted(permissions))


def with_permissions(conn: sqlite3.Connection, user: User) -> User:
    ensure_user_role(conn, user)
    return replace(
        user,
        roles=roles_for_user(conn, user),
        permissions=permissions_for_user(conn, user),
    )


def has_permission(user: User, permission: str) -> bool:
    return "*" in user.permissions or permission in user.permissions


def set_roles(
    conn: sqlite3.Connection, *, tenant_id: str, user_id: str,
    role_names: list[str], by: str = "system",
) -> tuple[str, ...]:
    """Replace a user's builtin role set, refusing to remove the last admin."""
    ensure_builtin_roles(conn, tenant_id)
    target = conn.execute(
        "SELECT tenant_id FROM users WHERE user_id = ? AND deleted_at IS NULL",
        (user_id,),
    ).fetchone()
    if target is None or str(target[0]) != tenant_id:
        raise AppError("NOT_FOUND", details={"userId": user_id})
    known = conn.execute(
        "SELECT name, role_id FROM roles WHERE tenant_id = ?", (tenant_id,)
    ).fetchall()
    by_name = {str(row[0]): str(row[1]) for row in known}
    unknown = [name for name in role_names if name not in by_name]
    if unknown:
        raise AppError("VALIDATION_FAILED", details={"roles": unknown})
    if not role_names:
        raise AppError("VALIDATION_FAILED", details={"roles": "at least one"})

    current = conn.execute(
        "SELECT role_id FROM user_roles WHERE user_id = ?", (user_id,)
    ).fetchall()
    current_ids = {str(row[0]) for row in current}
    admin_id = by_name["admin"]
    losing_admin = admin_id in current_ids and admin_id not in {
        by_name[name] for name in role_names
    }
    if losing_admin:
        admins = conn.execute(
            "SELECT count(DISTINCT ur.user_id) FROM user_roles ur "
            "JOIN roles r ON r.role_id = ur.role_id "
            "JOIN users u ON u.user_id = ur.user_id "
            "WHERE r.tenant_id = ? AND r.name = 'admin' "
            "AND u.deleted_at IS NULL AND u.status = 'active'",
            (tenant_id,),
        ).fetchone()
        if int(admins[0]) <= 1:
            raise AppError(
                "CONFLICT",
                details={"reason": "last_admin", "userId": user_id},
            )

    now = int(time.time())
    conn.execute("DELETE FROM user_roles WHERE user_id = ?", (user_id,))
    for name in role_names:
        conn.execute(
            "INSERT OR IGNORE INTO user_roles (user_id, role_id, created_at) "
            "VALUES (?, ?, ?)",
            (user_id, by_name[name], now),
        )
    conn.commit()
    return tuple(sorted(role_names))


def new_role_id() -> str:
    return "rl_" + secrets.token_hex(8)


__all__ = [
    "AUDITOR_PERMISSIONS",
    "BUILTIN",
    "MEMBER_PERMISSIONS",
    "ensure_builtin_roles",
    "ensure_user_role",
    "has_permission",
    "new_role_id",
    "permissions_for_user",
    "role_id_for",
    "roles_for_user",
    "set_roles",
    "with_permissions",
]
