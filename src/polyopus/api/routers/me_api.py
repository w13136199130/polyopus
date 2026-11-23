"""Personal API keys (V1-03): create/list/revoke."""

from __future__ import annotations

from pathlib import Path
from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import current_user, get_db, require_step_up
from polyopus.domains.data_jobs import service as data_jobs
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


class ExportBody(BaseModel):
    fmt: Literal["jsonl", "json"] = Field(
        default="jsonl", validation_alias=AliasChoices("format", "fmt")
    )
    include_artifacts: bool = Field(
        default=True, validation_alias=AliasChoices("includeArtifacts", "include_artifacts")
    )


@router.post("/export", status_code=202)
def create_export(
    body: ExportBody,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return data_jobs.create_export(
        conn, tenant_id=user.tenant_id, user_id=user.user_id,
        fmt=body.fmt, include_artifacts=body.include_artifacts,
    )


@router.get("/export/{job_id}")
def get_export(
    job_id: str,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return data_jobs.get_job(
        conn, tenant_id=user.tenant_id, job_id=job_id, user_id=user.user_id
    )


@router.get("/export/{job_id}/download")
def download_export(
    job_id: str,
    request: Request,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> FileResponse:
    data_dir = Path(str(request.app.state.settings.data_dir))
    path = data_jobs.download_path(
        conn, tenant_id=user.tenant_id, job_id=job_id,
        user_id=user.user_id, data_dir=data_dir,
    )
    return FileResponse(
        path, media_type="application/x-ndjson",
        filename=f"polyopus-export-{job_id}.jsonl",
    )


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
