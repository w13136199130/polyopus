"""Agent workspace draft projection (docs/03 "文件即配置", phase 1).

The database (``agent_files`` + ``agent_versions``) stays authoritative for
now. Every expert file is mirrored into a per-tenant draft directory:

    <workspace>/.polyopus/tenants/<tenant>/agents/<agent>/draft/<FILE>

Why mirror at all: the workspace gets the stable, inspectable structure the
prototype shows (AGENTS.md / SOUL.md / … per expert) without changing runtime
behaviour. Publishing snapshots and runtime prompt assembly arrive in the next
batch; until then ``sync_agent_files`` is a best-effort projection.

Mirror failures never fail an API call: the DB write already committed.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

from polyopus.platform.errors import AppError

logger = logging.getLogger(__name__)

SYSTEM_DIR = ".polyopus"
MAX_FILE_BYTES = 1_000_000
_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def check_file_name(name: str) -> str:
    clean = name.strip()
    if not _FILE_NAME.match(clean):
        raise AppError("VALIDATION_FAILED", details={"field": "name"})
    return clean


def _segment(value: str, field: str) -> str:
    if not _SEGMENT.match(value or ""):
        raise AppError("VALIDATION_FAILED", details={"field": field})
    return value


def agent_dir(
    workspace_root: Path, *, tenant_id: str, agent_id: str,
) -> Path:
    return (
        Path(workspace_root).resolve()
        / SYSTEM_DIR
        / "tenants"
        / _segment(tenant_id, "tenant_id")
        / "agents"
        / _segment(agent_id, "agent_id")
    )


def draft_dir(workspace_root: Path, *, tenant_id: str, agent_id: str) -> Path:
    return agent_dir(workspace_root, tenant_id=tenant_id, agent_id=agent_id) / "draft"


def ensure_agent_dir(
    workspace_root: Path, *, tenant_id: str, agent_id: str,
) -> Path:
    path = draft_dir(workspace_root, tenant_id=tenant_id, agent_id=agent_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_file(
    workspace_root: Path, *, tenant_id: str, agent_id: str,
    name: str, content: str,
) -> Path:
    """Atomically write one draft file; rejects traversal and oversized content."""
    clean = check_file_name(name)
    data = content.encode("utf-8")
    if len(data) > MAX_FILE_BYTES:
        raise AppError("VALIDATION_FAILED", details={"field": "content", "reason": "too_large"})
    directory = ensure_agent_dir(workspace_root, tenant_id=tenant_id, agent_id=agent_id)
    target = directory / clean
    handle, temp_name = tempfile.mkstemp(dir=directory, prefix=".tmp-")
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return target


def delete_file(
    workspace_root: Path, *, tenant_id: str, agent_id: str, name: str,
) -> None:
    clean = check_file_name(name)
    target = draft_dir(workspace_root, tenant_id=tenant_id, agent_id=agent_id) / clean
    target.unlink(missing_ok=True)


def purge_agent(workspace_root: Path, *, tenant_id: str, agent_id: str) -> None:
    shutil.rmtree(
        agent_dir(workspace_root, tenant_id=tenant_id, agent_id=agent_id),
        ignore_errors=True,
    )


def sync_agent_files(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    agent_id: str,
    workspace_root: Path,
) -> int:
    """Mirror the DB rows into the draft directory and drop stale files."""
    directory = ensure_agent_dir(
        workspace_root, tenant_id=tenant_id, agent_id=agent_id,
    )
    rows = conn.execute(
        "SELECT name, content FROM agent_files WHERE tenant_id = ? AND agent_id = ?",
        (tenant_id, agent_id),
    ).fetchall()
    wanted: set[str] = set()
    for row in rows:
        name = str(row["name"])
        write_file(
            workspace_root, tenant_id=tenant_id, agent_id=agent_id,
            name=name, content=str(row["content"]),
        )
        wanted.add(name)
    for path in directory.iterdir():
        if path.is_file() and path.name not in wanted:
            path.unlink(missing_ok=True)
    return len(wanted)


def sync_best_effort(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    agent_id: str,
    workspace_root: Path | None,
) -> None:
    """Projection failures must not break the DB-authoritative API."""
    if workspace_root is None:
        return
    try:
        sync_agent_files(
            conn, tenant_id=tenant_id, agent_id=agent_id,
            workspace_root=workspace_root,
        )
    except (OSError, AppError):
        logger.warning(
            "agent workspace sync failed tenant=%s agent=%s", tenant_id, agent_id,
            exc_info=True,
        )


def purge_best_effort(
    workspace_root: Path | None, *, tenant_id: str, agent_id: str,
) -> None:
    if workspace_root is None:
        return
    try:
        purge_agent(workspace_root, tenant_id=tenant_id, agent_id=agent_id)
    except AppError:
        logger.warning(
            "agent workspace purge skipped tenant=%s agent=%s", tenant_id, agent_id,
            exc_info=True,
        )


def version_dir(
    workspace_root: Path, *, tenant_id: str, agent_id: str, version: int,
) -> Path:
    return (
        agent_dir(workspace_root, tenant_id=tenant_id, agent_id=agent_id)
        / "versions"
        / f"v{int(version)}"
    )


def publish_version(
    workspace_root: Path, *,
    tenant_id: str, agent_id: str, version: int, files: dict[str, str],
) -> Path | None:
    """Materialise one immutable version directory from the DB snapshot."""
    target = version_dir(
        workspace_root, tenant_id=tenant_id, agent_id=agent_id, version=version,
    )
    if target.exists():
        return target
    parent = target.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=parent, prefix=f".tmp-v{version}-"))
    try:
        for name, content in files.items():
            clean = check_file_name(name)
            data = str(content).encode("utf-8")
            if len(data) > MAX_FILE_BYTES:
                continue
            (staging / clean).write_bytes(data)
        os.replace(staging, target)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return target


def read_version_files(
    workspace_root: Path, *, tenant_id: str, agent_id: str, version: int,
) -> dict[str, str]:
    """Files of one published version; empty when the snapshot is not on disk."""
    directory = version_dir(
        workspace_root, tenant_id=tenant_id, agent_id=agent_id, version=version,
    )
    if not directory.is_dir():
        return {}
    files: dict[str, str] = {}
    for path in directory.iterdir():
        if not path.is_file() or not _FILE_NAME.match(path.name):
            continue
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            files[path.name] = path.read_text(encoding="utf-8")
        except OSError:
            continue
    return files


def publish_version_best_effort(
    workspace_root: Path | None, *,
    tenant_id: str, agent_id: str, version: int, files: dict[str, str],
) -> None:
    if workspace_root is None:
        return
    try:
        publish_version(
            workspace_root, tenant_id=tenant_id, agent_id=agent_id,
            version=version, files=files,
        )
    except (OSError, AppError):
        logger.warning(
            "agent version snapshot failed tenant=%s agent=%s version=%s",
            tenant_id, agent_id, version, exc_info=True,
        )
