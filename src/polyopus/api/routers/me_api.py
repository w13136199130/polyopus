"""Personal API keys (V1-03): create/list/revoke."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from polyopus.api.deps import current_user, get_db, require_step_up
from polyopus.domains.identity import apikey
from polyopus.domains.identity.service import Session, User

router = APIRouter(prefix="/me", tags=["auth"])

KNOWN_SCOPES = {
    "chat:read", "chat:write", "ticket:read", "ticket:write",
    "attention:read", "attention:write", "source:read", "source:write",
    "cron:read", "cron:write", "usage:read", "audit:read",
    "agent:read", "knowledge:read", "knowledge:write", "extension:read",
    "settings:read",
}


class CreateKeyBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[str] = Field(default_factory=lambda: ["chat:read"])
    expires_in_seconds: int | None = Field(default=None, gt=0)


@router.get("/api-keys")
def list_keys(
    user: User = Depends(current_user), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    return {"items": apikey.list_keys(conn, user)}


@router.post("/api-keys", status_code=201)
def create_key(
    body: CreateKeyBody,
    session: Session = Depends(require_step_up),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    unknown = [scope for scope in body.scopes if scope not in KNOWN_SCOPES]
    if unknown:
        from polyopus.platform.errors import AppError

        raise AppError("VALIDATION_FAILED", details={"scopes": unknown})
    return apikey.create_key(
        conn, user, name=body.name, scopes=body.scopes,
        ttl_seconds=body.expires_in_seconds,
    )


@router.delete("/api-keys/{api_key_id}")
def revoke_key(
    api_key_id: str,
    session: Session = Depends(require_step_up),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    apikey.revoke_key(conn, user, api_key_id)
    return {"apiKeyId": api_key_id, "revoked": True}
