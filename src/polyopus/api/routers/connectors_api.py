"""Connector catalog/instance/OAuth API (V1-14)."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.connectors import service, tool_catalog
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/connectors", tags=["connectors"])


class InstanceCreateBody(BaseModel):
    kind: str = Field(min_length=1)
    display_name: str = Field(
        min_length=1, max_length=120,
        validation_alias=AliasChoices("displayName", "display_name"),
    )
    config: dict[str, Any] = Field(default_factory=dict)
    auth_kind: str | None = Field(
        default=None, validation_alias=AliasChoices("authKind", "auth_kind")
    )
    shared: bool = False
    default_open: bool = Field(
        default=False, validation_alias=AliasChoices("defaultOpen", "default_open")
    )


class InstancePatchBody(BaseModel):
    display_name: str | None = Field(
        default=None, validation_alias=AliasChoices("displayName", "display_name")
    )
    config: dict[str, Any] | None = None
    shared: bool | None = None
    default_open: bool | None = Field(
        default=None, validation_alias=AliasChoices("defaultOpen", "default_open")
    )
    status: str | None = None


class OAuthStartBody(BaseModel):
    kind: str = Field(min_length=1)


def _secret(request: Request) -> str:
    return str(request.app.state.settings.secret_key)


@router.get("/catalog")
def list_catalog(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    _user: User = Depends(require_permission("connector:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": service.list_catalog(conn, q=q, category=category)}


@router.get("/instances")
def list_instances(
    user: User = Depends(require_permission("connector:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": service.list_instances(conn, tenant_id=user.tenant_id)}


@router.post("/instances", status_code=201)
def create_instance(
    body: InstanceCreateBody,
    request: Request,
    user: User = Depends(require_permission("connector:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_instance(
        conn, tenant_id=user.tenant_id, owner_id=user.user_id, kind=body.kind,
        display_name=body.display_name, config=body.config,
        auth_kind=body.auth_kind, shared=body.shared,
        default_open=body.default_open, secret_key=_secret(request),
    )


@router.post("/instances/{instance_id}/discover")
def discover_instance_tools(
    instance_id: str,
    request: Request,
    user: User = Depends(require_permission("connector:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return tool_catalog.discover_instance(
        conn, tenant_id=user.tenant_id, instance_id=instance_id,
        secret_key=_secret(request),
    )


@router.get("/instances/{instance_id}/tools")
def instance_tools(
    instance_id: str,
    user: User = Depends(require_permission("connector:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": tool_catalog.list_instance_tools(
            conn, tenant_id=user.tenant_id, instance_id=instance_id
        )
    }


@router.patch("/instances/{instance_id}")
def update_instance(
    instance_id: str,
    body: InstancePatchBody,
    request: Request,
    user: User = Depends(require_permission("connector:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.update_instance(
        conn, tenant_id=user.tenant_id, instance_id=instance_id,
        display_name=body.display_name, config=body.config, shared=body.shared,
        default_open=body.default_open, status=body.status,
        secret_key=_secret(request),
    )


@router.delete("/instances/{instance_id}")
def delete_instance(
    instance_id: str,
    user: User = Depends(require_permission("connector:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_instance(
        conn, tenant_id=user.tenant_id, instance_id=instance_id
    )
    return {"ok": True, "instanceId": instance_id}


@router.post("/instances/{instance_id}/probe")
def probe_instance(
    instance_id: str,
    request: Request,
    user: User = Depends(require_permission("connector:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.probe(
        conn, tenant_id=user.tenant_id, instance_id=instance_id,
        secret_key=_secret(request),
    )


@router.post("/oauth/start")
def oauth_start(
    body: OAuthStartBody,
    request: Request,
    user: User = Depends(require_permission("connector:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.oauth_start(
        conn, tenant_id=user.tenant_id, kind=body.kind,
        secret_key=_secret(request),
    )


@router.get("/oauth/pending/{state_id}")
def oauth_pending(
    state_id: str,
    user: User = Depends(require_permission("connector:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.oauth_pending(
        conn, tenant_id=user.tenant_id, state_id=state_id
    )


@router.get("/oauth/callback")
def oauth_callback(
    state: str = Query(min_length=1),
    code: str = Query(min_length=1),
    user: User = Depends(require_permission("connector:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.oauth_callback(
        conn, tenant_id=user.tenant_id, state_id=state, code=code
    )
