"""User management API (V1-04)."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity import admin
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/users", tags=["users"])


class CreateUserBody(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    display_name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    roles: list[str] = Field(default_factory=lambda: ["member"])


class UpdateUserBody(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    status: Literal["active", "disabled"] | None = None
    roles: list[str] | None = None


@router.get("")
def list_users(
    user: User = Depends(require_permission("user:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": admin.list_users(conn, user.tenant_id)}


@router.post("", status_code=201)
def create_user(
    body: CreateUserBody,
    user: User = Depends(require_permission("user:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return admin.create_user(
        conn, tenant_id=user.tenant_id, username=body.username,
        display_name=body.display_name, email=body.email,
        password=body.password, roles=body.roles, by=user.user_id,
    )


@router.patch("/{user_id}")
def update_user(
    user_id: str,
    body: UpdateUserBody,
    actor: User = Depends(require_permission("user:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return admin.update_user(
        conn, tenant_id=actor.tenant_id, user_id=user_id,
        display_name=body.display_name, status=body.status,
        roles=body.roles, by=actor.user_id,
    )


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    actor: User = Depends(require_permission("user:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    admin.delete_user(
        conn, tenant_id=actor.tenant_id, user_id=user_id, actor_id=actor.user_id
    )
    return {"userId": user_id, "deleted": True}
