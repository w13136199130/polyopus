"""Channel management (v1.1) + the public Feishu event callback."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Body, Depends
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.channels import service
from polyopus.domains.identity.service import User
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

router = APIRouter(prefix="/channels", tags=["channels"])


class ChannelCreateBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: str = "feishu"
    display_name: str = Field(
        min_length=1, max_length=100,
        validation_alias=AliasChoices("displayName", "display_name"),
    )
    app_id: str = Field(
        min_length=1, validation_alias=AliasChoices("appId", "app_id"),
    )
    app_secret: str = Field(
        min_length=1, validation_alias=AliasChoices("appSecret", "app_secret"),
    )
    verification_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("verificationToken", "verification_token"),
    )
    encrypt_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("encryptKey", "encrypt_key"),
    )
    approvers: list[str] | None = None


class ChannelPatchBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    display_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("displayName", "display_name"),
    )
    app_id: str | None = Field(
        default=None, validation_alias=AliasChoices("appId", "app_id"),
    )
    app_secret: str | None = Field(
        default=None, validation_alias=AliasChoices("appSecret", "app_secret"),
    )
    verification_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("verificationToken", "verification_token"),
    )
    encrypt_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("encryptKey", "encrypt_key"),
    )
    approvers: list[str] | None = None
    status: str | None = None


@router.get("")
def list_channels(
    user: User = Depends(require_permission("source:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.list_channels(conn, tenant_id=user.tenant_id),
        "supported": list(service.SUPPORTED_KINDS),
    }


@router.post("", status_code=201)
def create_channel(
    body: ChannelCreateBody,
    user: User = Depends(require_permission("source:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_channel(
        conn, tenant_id=user.tenant_id, kind=body.kind,
        display_name=body.display_name, app_id=body.app_id,
        app_secret=body.app_secret,
        verification_token=body.verification_token,
        encrypt_key=body.encrypt_key, approvers=body.approvers, by=user.user_id,
    )


@router.patch("/{channel_id}")
def update_channel(
    channel_id: str,
    body: ChannelPatchBody,
    user: User = Depends(require_permission("source:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    credentials: dict[str, Any] = {}
    if body.app_secret is not None:
        credentials["app_secret"] = body.app_secret
    if body.verification_token is not None:
        credentials["verification_token"] = body.verification_token
    if body.encrypt_key is not None:
        credentials["encrypt_key"] = body.encrypt_key
    config = {"app_id": body.app_id} if body.app_id is not None else None
    return service.update_channel(
        conn, tenant_id=user.tenant_id, channel_id=channel_id,
        display_name=body.display_name, config=config,
        credentials=credentials or None, approvers=body.approvers,
        status=body.status, by=user.user_id,
    )


@router.delete("/{channel_id}")
def delete_channel(
    channel_id: str,
    user: User = Depends(require_permission("source:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_channel(
        conn, tenant_id=user.tenant_id, channel_id=channel_id,
        by=user.user_id,
    )
    return {"ok": True, "channelId": channel_id}


@router.post("/{channel_id}/probe")
def probe_channel(
    channel_id: str,
    user: User = Depends(require_permission("source:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.probe(
        conn, tenant_id=user.tenant_id, channel_id=channel_id,
    )


@router.post("/{kind}/{channel_id}/events")
def feishu_events(
    kind: str,
    channel_id: str,
    background: BackgroundTasks,
    body: dict[str, Any] = Body(default_factory=dict),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    """Public callback. Feishu verifies via the channel's verification token."""
    if kind not in service.SUPPORTED_KINDS:
        raise AppError("CHANNEL_NOT_FOUND", details={"kind": kind})
    row = conn.execute(
        "SELECT tenant_id FROM channels WHERE channel_id = ? AND kind = ?",
        (channel_id, kind),
    ).fetchone()
    if row is None:
        raise AppError("CHANNEL_NOT_FOUND", details={"channelId": channel_id})
    return service.handle_event(
        conn, store, tenant_id=str(row[0]), channel_id=channel_id, body=body,
        schedule=background.add_task,
    )
