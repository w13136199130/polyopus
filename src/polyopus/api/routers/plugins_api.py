"""Plugin registry endpoints (V1-15)."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.plugins import service

router = APIRouter(prefix="/plugins", tags=["plugins"])


class InstallBody(BaseModel):
    manifest: dict[str, Any]
    signature: str | None = None
    signer: str = "local"


class PluginPatchBody(BaseModel):
    enabled: bool


def _secret(request: Request) -> str:
    return str(request.app.state.settings.secret_key)


@router.get("")
def list_plugins(
    user: User = Depends(require_permission("extension:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": service.list_plugins(conn, tenant_id=user.tenant_id)}


@router.post("/examples/install")
def install_examples(
    request: Request,
    user: User = Depends(require_permission("extension:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.install_examples(
            conn, tenant_id=user.tenant_id, secret_key=_secret(request)
        )
    }


@router.post("/{plugin_id}/install")
def install_plugin(
    plugin_id: str,
    body: InstallBody,
    request: Request,
    user: User = Depends(require_permission("extension:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    manifest = dict(body.manifest)
    if str(manifest.get("id") or "") != plugin_id:
        manifest["id"] = plugin_id
    return service.install_plugin(
        conn, tenant_id=user.tenant_id, manifest=manifest,
        signature=body.signature, secret_key=_secret(request), signer=body.signer,
    )


@router.patch("/{plugin_id}")
def update_plugin(
    plugin_id: str,
    body: PluginPatchBody,
    user: User = Depends(require_permission("extension:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.set_enabled(
        conn, tenant_id=user.tenant_id, plugin_id=plugin_id,
        enabled=body.enabled,
    )


@router.delete("/{plugin_id}")
def uninstall_plugin(
    plugin_id: str,
    user: User = Depends(require_permission("extension:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.uninstall_plugin(
        conn, tenant_id=user.tenant_id, plugin_id=plugin_id
    )
    return {"ok": True, "pluginId": plugin_id}
