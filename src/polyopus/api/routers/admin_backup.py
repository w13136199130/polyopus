"""Backup/restore API (V1-07), docs/29 admin backup endpoints."""

from __future__ import annotations

from pathlib import Path
from sqlite3 import Connection
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.backup import service
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/admin/backup", tags=["admin"])


class BackupCreateBody(BaseModel):
    includes: dict[str, Any] | None = None


class BackupAutoBody(BaseModel):
    auto_enabled: bool | None = Field(
        default=None, validation_alias=AliasChoices("autoEnabled", "auto_enabled")
    )
    interval_hours: int | None = Field(
        default=None, validation_alias=AliasChoices("intervalHours", "interval_hours")
    )
    retention_count: int | None = Field(
        default=None,
        validation_alias=AliasChoices("retentionCount", "retention_count"),
    )
    includes: dict[str, Any] | None = None


class BackupImportBody(BaseModel):
    content_base64: str = Field(
        validation_alias=AliasChoices("contentBase64", "content_base64")
    )


def _paths(request: Request) -> tuple[Path, Path, Path]:
    settings = request.app.state.settings
    return (
        settings.resolved_db_path(),
        Path(settings.data_dir),
        Path(settings.workspace_dir),
    )


@router.get("")
def list_backups(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.list_backups(conn, limit=limit, cursor=cursor)


@router.get("/status")
def backup_status(
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.get_status(conn)


@router.get("/auto")
def get_auto(
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.get_auto(conn)


@router.put("/auto")
def update_auto(
    body: BackupAutoBody,
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.update_auto(
        conn, auto_enabled=body.auto_enabled, interval_hours=body.interval_hours,
        retention_count=body.retention_count, includes=body.includes,
    )


@router.post("/auto/run")
def run_auto(
    request: Request,
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    db, data_dir, workspace = _paths(request)
    return service.run_auto(
        conn, db_path=db, data_dir=data_dir, workspace_dir=workspace
    )


@router.post("", status_code=201)
def create_backup(
    body: BackupCreateBody,
    request: Request,
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    db, data_dir, workspace = _paths(request)
    return service.create_backup(
        conn, db_path=db, data_dir=data_dir, workspace_dir=workspace,
        includes=body.includes,
    )


@router.post("/import", status_code=201)
def import_backup(
    body: BackupImportBody,
    request: Request,
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    _db, data_dir, _workspace = _paths(request)
    return service.import_backup(
        conn, content_base64=body.content_base64, data_dir=data_dir
    )


@router.delete("/{backup_id}")
def delete_backup(
    backup_id: str,
    request: Request,
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    _db, data_dir, _workspace = _paths(request)
    service.delete_backup(conn, backup_id, data_dir=data_dir)
    return {"ok": True, "backupId": backup_id}


@router.post("/{backup_id}/restore")
def restore_backup(
    backup_id: str,
    request: Request,
    _user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    _db, data_dir, workspace = _paths(request)
    return service.restore_backup(
        conn, backup_id, workspace_dir=workspace, data_dir=data_dir
    )
