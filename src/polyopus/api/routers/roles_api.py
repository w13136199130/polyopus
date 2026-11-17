"""Role catalog (V1-04): read-only builtin roles with permission points."""

from __future__ import annotations

import json
from sqlite3 import Connection

from fastapi import APIRouter, Depends

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity import rbac
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("")
def list_roles(
    user: User = Depends(require_permission("role:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    rbac.ensure_builtin_roles(conn, user.tenant_id)
    rows = conn.execute(
        "SELECT * FROM roles WHERE tenant_id = ? ORDER BY id", (user.tenant_id,)
    ).fetchall()
    return {
        "items": [
            {
                "id": row["role_id"],
                "name": row["name"],
                "description": row["description"],
                "builtin": bool(row["builtin"]),
                "permissions": json.loads(row["permissions_json"] or "[]"),
            }
            for row in rows
        ]
    }
