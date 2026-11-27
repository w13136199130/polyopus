"""Agent config files + immutable version snapshots (EXP-004 / EXP-007)."""

from __future__ import annotations

import json
import re
import sqlite3
import time
from typing import Any

from polyopus.domains.agents.service import get_agent
from polyopus.domains.audit import service as audit
from polyopus.platform.errors import AppError

_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def _now() -> int:
    return int(time.time())


def _check_file_name(name: str) -> str:
    clean = name.strip()
    if not _FILE_NAME.match(clean):
        raise AppError("VALIDATION_FAILED", details={"field": "name"})
    return clean


def list_files(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
) -> list[dict[str, Any]]:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    rows = conn.execute(
        "SELECT name, content, updated_at FROM agent_files "
        "WHERE tenant_id = ? AND agent_id = ? ORDER BY name",
        (tenant_id, agent_id),
    ).fetchall()
    return [
        {"name": row["name"], "content": row["content"],
         "updatedAt": int(row["updated_at"])}
        for row in rows
    ]


def get_file(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str, name: str,
) -> dict[str, Any]:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    clean = _check_file_name(name)
    row = conn.execute(
        "SELECT name, content, updated_at FROM agent_files "
        "WHERE tenant_id = ? AND agent_id = ? AND name = ?",
        (tenant_id, agent_id, clean),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"file": clean})
    return {"name": row["name"], "content": row["content"],
            "updatedAt": int(row["updated_at"])}


def put_file(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
    name: str, content: str, by: str,
) -> dict[str, Any]:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    clean = _check_file_name(name)
    now = _now()
    conn.execute(
        """
        INSERT INTO agent_files (tenant_id, agent_id, name, content, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(agent_id, name) DO UPDATE SET
          content = excluded.content, updated_at = excluded.updated_at
        """,
        (tenant_id, agent_id, clean, content, now),
    )
    conn.execute(
        "UPDATE agents SET updated_at = ?, version = version + 1 WHERE agent_id = ?",
        (now, agent_id),
    )
    audit.record(
        conn, tenant_id=tenant_id, action="agent.file.save", result="ok",
        actor_id=by, resource_type="agent", resource_id=agent_id,
        detail={"name": clean},
    )
    conn.commit()
    return get_file(conn, tenant_id=tenant_id, agent_id=agent_id, name=clean)


def delete_file(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str, name: str, by: str,
) -> None:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    clean = _check_file_name(name)
    row = conn.execute(
        "SELECT name FROM agent_files WHERE tenant_id = ? AND agent_id = ? AND name = ?",
        (tenant_id, agent_id, clean),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"file": clean})
    now = _now()
    conn.execute(
        "DELETE FROM agent_files WHERE tenant_id = ? AND agent_id = ? AND name = ?",
        (tenant_id, agent_id, clean),
    )
    conn.execute(
        "UPDATE agents SET updated_at = ?, version = version + 1 WHERE agent_id = ?",
        (now, agent_id),
    )
    audit.record(
        conn, tenant_id=tenant_id, action="agent.file.delete", result="ok",
        actor_id=by, resource_type="agent", resource_id=agent_id,
        detail={"name": clean},
    )
    conn.commit()


def list_versions(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
) -> list[dict[str, Any]]:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    rows = conn.execute(
        "SELECT version, published_by, published_at, is_current FROM agent_versions "
        "WHERE tenant_id = ? AND agent_id = ? AND version > 0 "
        "ORDER BY version DESC",
        (tenant_id, agent_id),
    ).fetchall()
    return [
        {
            "version": int(row["version"]),
            "publishedAt": int(row["published_at"]),
            "publishedBy": row["published_by"],
            "isCurrent": bool(row["is_current"]),
        }
        for row in rows
    ]


def get_version(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str, version: int,
) -> dict[str, Any]:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    row = conn.execute(
        "SELECT version, config_json, files_json, published_by, published_at,"
        " is_current FROM agent_versions WHERE tenant_id = ? AND agent_id = ?"
        " AND version = ?",
        (tenant_id, agent_id, version),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"version": version})
    try:
        config = json.loads(str(row["config_json"] or "{}"))
    except ValueError:
        config = {}
    try:
        files = json.loads(str(row["files_json"] or "{}"))
    except ValueError:
        files = {}
    return {
        "version": int(row["version"]),
        "publishedAt": int(row["published_at"]),
        "publishedBy": row["published_by"],
        "isCurrent": bool(row["is_current"]),
        "config": config if isinstance(config, dict) else {},
        "files": files if isinstance(files, dict) else {},
    }


def rollback_agent(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
    version: int, by: str,
) -> dict[str, Any]:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    snapshot = get_version(
        conn, tenant_id=tenant_id, agent_id=agent_id, version=version,
    )
    now = _now()
    conn.execute(
        "UPDATE agent_versions SET config_json = ?, published_at = ?"
        " WHERE tenant_id = ? AND agent_id = ? AND version = 0",
        (json.dumps(snapshot["config"], ensure_ascii=False), now,
         tenant_id, agent_id),
    )
    conn.execute(
        "DELETE FROM agent_files WHERE tenant_id = ? AND agent_id = ?",
        (tenant_id, agent_id),
    )
    for name, content in (snapshot.get("files") or {}).items():
        conn.execute(
            "INSERT INTO agent_files (tenant_id, agent_id, name, content, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (tenant_id, agent_id, str(name), str(content), now),
        )
    conn.execute(
        "UPDATE agents SET updated_at = ?, version = version + 1 WHERE agent_id = ?",
        (now, agent_id),
    )
    audit.record(
        conn, tenant_id=tenant_id, action="agent.rollback", result="ok",
        actor_id=by, resource_type="agent", resource_id=agent_id,
        detail={"version": version, "draftOnly": True},
    )
    conn.commit()
    return get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
