"""Admin storage snapshot: local paths and sizes (remote backends are v1.1)."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, Request

from polyopus.api.deps import require_permission
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/admin/storage", tags=["admin"])

MAX_FILES = 50_000


def _tree_size(path: Path) -> tuple[int, int]:
    """(bytes, files) with a hard file-count cap; symlinks are not followed."""
    total = 0
    files = 0
    if not path.exists():
        return 0, 0
    for root, dirs, names in os.walk(path, followlinks=False):
        if files >= MAX_FILES:
            break
        dirs[:] = [name for name in dirs if not name.startswith(".")]
        for name in names:
            if files >= MAX_FILES:
                break
            target = Path(root) / name
            try:
                if target.is_symlink():
                    continue
                total += target.stat().st_size
                files += 1
            except OSError:
                continue
    return total, files


@router.get("")
def storage_snapshot(
    request: Request,
    _user: User = Depends(require_permission("admin:write")),
) -> dict[str, object]:
    settings = request.app.state.settings
    db_path = settings.resolved_db_path()
    data_dir = Path(settings.data_dir)
    workspace = Path(settings.workspace_dir)
    db_bytes = 0
    try:
        db_bytes = db_path.stat().st_size
        # WAL/shared-memory files are part of the live footprint
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(db_path) + suffix)
            if sidecar.exists():
                db_bytes += sidecar.stat().st_size
    except OSError:
        pass
    data_bytes, data_files = _tree_size(data_dir)
    workspace_bytes, workspace_files = _tree_size(workspace)
    backup_dir = data_dir / "backups"
    backup_bytes, backup_files = _tree_size(backup_dir)
    return {
        "db": {"path": str(db_path), "bytes": db_bytes},
        "data": {"path": str(data_dir), "bytes": data_bytes, "files": data_files},
        "workspace": {
            "path": str(workspace), "bytes": workspace_bytes,
            "files": workspace_files,
        },
        "backups": {
            "path": str(backup_dir), "bytes": backup_bytes,
            "files": backup_files,
        },
        "backend": "local",
        "remoteBackends": [
            {"kind": "s3", "label": "S3", "status": "v1.1"},
            {"kind": "cos", "label": "腾讯云 COS", "status": "v1.1"},
            {"kind": "postgres", "label": "PostgreSQL", "status": "v1.1"},
        ],
        "note": "v1.0 固定本地存储；远端对象存储/数据库后端随 v1.1 接入。",
    }
