"""Admin provider/model endpoints (model config page)."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Request
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.models import service

router = APIRouter(prefix="/admin/providers", tags=["admin"])


class ProviderBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_url: str = Field(
        min_length=1, max_length=500,
        validation_alias=AliasChoices("baseUrl", "base_url"),
    )
    api_key: str = Field(
        default="", max_length=500,
        validation_alias=AliasChoices("apiKey", "api_key"),
    )
    models: list[str] = Field(default_factory=list)


class ProviderPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = Field(
        default=None, min_length=1, max_length=500,
        validation_alias=AliasChoices("baseUrl", "base_url"),
    )
    api_key: str | None = Field(
        default=None, max_length=500,
        validation_alias=AliasChoices("apiKey", "api_key"),
    )
    models: list[str] | None = None
    status: str | None = None


def _secret(request: Request) -> str:
    return str(request.app.state.settings.secret_key)


@router.get("")
def list_providers(
    request: Request,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    settings = request.app.state.settings
    env_configured = bool(settings.model_base_url)
    return {
        "env": {
            "configured": env_configured,
            "modelName": settings.model_name or None,
            "baseUrl": settings.model_base_url or None,
            "note": (
                "环境变量 provider 优先于数据库配置；接入 env 后这里的模型会被忽略"
                if env_configured
                else "未设置环境变量 provider，数据库 provider 生效"
            ),
        },
        "items": service.list_providers(conn, user.tenant_id),
    }


@router.post("", status_code=201)
def create_provider(
    body: ProviderBody,
    request: Request,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_provider(
        conn, tenant_id=user.tenant_id, name=body.name,
        base_url=body.base_url, api_key=body.api_key, models=body.models,
        secret_key=_secret(request),
    )


@router.patch("/{provider_id}")
def update_provider(
    provider_id: str,
    body: ProviderPatchBody,
    request: Request,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.update_provider(
        conn, tenant_id=user.tenant_id, provider_id=provider_id,
        name=body.name, base_url=body.base_url, api_key=body.api_key,
        models=body.models, status=body.status, secret_key=_secret(request),
    )


@router.delete("/{provider_id}")
def delete_provider(
    provider_id: str,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_provider(
        conn, tenant_id=user.tenant_id, provider_id=provider_id
    )
    return {"ok": True, "providerId": provider_id}


@router.post("/{provider_id}/probe")
def probe_provider(
    provider_id: str,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.probe_provider(
        conn, tenant_id=user.tenant_id, provider_id=provider_id
    )
