"""Experts (agents) with draft/publish versioning (V1-11).

`agent_versions.version = 0` is the mutable draft. Publishing copies the
draft into the next immutable version and flips `is_current`; a thread pins
the `agent_versions.id` at creation, so later publishes never move old turns.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from typing import Any, cast

from polyopus.domains.audit import service as audit
from polyopus.platform.errors import AppError

TENANT = "default"

BUILTIN_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "id": "general",
        "name": "通用助手",
        "description": "日常问答、写作与整理。",
        "systemPrompt": "你是一个严谨、简洁的中文助手。",
        "model": "",
    },
    {
        "id": "engineer",
        "name": "工程助手",
        "description": "读代码、改文件、跑测试。",
        "systemPrompt": "你是资深工程师；先读代码再改动，保持变更最小。",
        "model": "",
    },
    {
        "id": "analyst",
        "name": "数据分析",
        "description": "指标拆解、用量与成本分析。",
        "systemPrompt": "你是数据分析师；给结论前先列出数据口径。",
        "model": "",
    },
)


def _now() -> int:
    return int(time.time())


def _status(row: sqlite3.Row) -> str:
    if str(row["status"]) == "disabled":
        return "disabled"
    return "draft" if row["published_version"] is None else "published"


def _draft_config(conn: sqlite3.Connection, agent_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT config_json FROM agent_versions WHERE agent_id = ? AND version = 0",
        (agent_id,),
    ).fetchone()
    return cast(dict[str, Any], json.loads(row[0])) if row is not None and row[0] else {}


def _current_config(conn: sqlite3.Connection, agent_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT config_json FROM agent_versions WHERE agent_id = ? "
        "AND is_current = 1 ORDER BY version DESC LIMIT 1", (agent_id,),
    ).fetchone()
    if row is not None:
        return cast(dict[str, Any], json.loads(row[0] or "{}"))
    return _draft_config(conn, agent_id)


def _view(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    config = _current_config(conn, str(row["agent_id"]))
    draft = _draft_config(conn, str(row["agent_id"]))
    return {
        "id": row["agent_id"],
        "agentId": row["agent_id"],
        "name": row["name"],
        "description": row["description"],
        "status": _status(row),
        "version": int(row["published_version"] or 0),
        "model": row["model"] or config.get("model"),
        "tools": list(config.get("tools") or []),
        "systemPrompt": config.get("systemPrompt") or "",
        "draftSystemPrompt": draft.get("systemPrompt") or "",
        "draftModel": draft.get("model") or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_agent(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM agents WHERE tenant_id = ? AND agent_id = ?"
        " AND deleted_at IS NULL", (tenant_id, agent_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"agentId": agent_id})
    return _view(conn, row)


def list_agents(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    status: str | None = None,
    q: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM agents WHERE tenant_id = ? AND deleted_at IS NULL"
    params: list[object] = [tenant_id]
    if q:
        sql += " AND (name LIKE ? OR COALESCE(description, '') LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
    sql += " ORDER BY updated_at DESC, id DESC LIMIT ?"
    params.append(max(1, min(limit, 200)))
    rows = conn.execute(sql, params).fetchall()
    views = [_view(conn, row) for row in rows]
    if status:
        views = [view for view in views if view["status"] == status]
    return views


def create_agent(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    created_by: str,
    name: str,
    description: str | None = None,
    model: str | None = None,
    system_prompt: str | None = None,
) -> dict[str, Any]:
    name = name.strip()
    if not name:
        raise AppError("VALIDATION_FAILED", details={"name": "required"})
    agent_id = "ag_" + secrets.token_hex(8)
    now = _now()
    config = {
        "systemPrompt": system_prompt or "",
        "model": model or "",
        "tools": [],
        "knowledge": [],
    }
    try:
        conn.execute(
            "INSERT INTO agents (tenant_id, agent_id, name, description, model,"
            " backend, status, visibility, draft_version, created_by,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'builtin', 'draft',"
            " 'private', 0, ?, ?, ?)",
            (tenant_id, agent_id, name, description, model, created_by, now, now),
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "agent_name_taken"}) from exc
    conn.execute(
        "INSERT INTO agent_versions (tenant_id, agent_id, version, config_json,"
        " published_at, is_current) VALUES (?, ?, 0, ?, ?, 0)",
        (tenant_id, agent_id, json.dumps(config, ensure_ascii=False), now),
    )
    conn.commit()
    return get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)


def update_agent(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    agent_id: str,
    name: str | None = None,
    description: str | None = None,
    model: str | None = None,
    system_prompt: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    updates: list[str] = []
    params: list[object] = []
    if name is not None:
        updates.append("name = ?")
        params.append(name.strip())
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if model is not None:
        updates.append("model = ?")
        params.append(model)
    if status is not None:
        if status not in ("draft", "published", "disabled"):
            raise AppError("VALIDATION_FAILED", details={"status": status})
        if status == "published":
            row = conn.execute(
                "SELECT published_version FROM agents WHERE agent_id = ?",
                (agent_id,),
            ).fetchone()
            if row is None or row[0] is None:
                raise AppError("CONFLICT", details={"reason": "publish_first"})
        updates.append("status = ?")
        params.append(status)
    if name is not None or model is not None or system_prompt is not None:
        config = _draft_config(conn, agent_id)
        if model is not None:
            config["model"] = model
        if system_prompt is not None:
            config["systemPrompt"] = system_prompt
        conn.execute(
            "UPDATE agent_versions SET config_json = ? WHERE agent_id = ?"
            " AND version = 0",
            (json.dumps(config, ensure_ascii=False), agent_id),
        )
    if updates or system_prompt is not None:
        updates.append("updated_at = ?")
        params.append(_now())
        updates.append("version = version + 1")
        params.append(agent_id)
        try:
            conn.execute(
                f"UPDATE agents SET {', '.join(updates)} WHERE agent_id = ?",
                params,
            )
        except sqlite3.IntegrityError as exc:
            raise AppError("CONFLICT", details={"reason": "agent_name_taken"}) from exc
    conn.commit()
    return get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)


def publish_agent(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str, by: str,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM agents WHERE tenant_id = ? AND agent_id = ?"
        " AND deleted_at IS NULL", (tenant_id, agent_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"agentId": agent_id})
    config = _draft_config(conn, agent_id)
    files = {str(item["name"]): str(item["content"])
             for item in conn.execute(
                 "SELECT name, content FROM agent_files WHERE tenant_id = ? "
                 "AND agent_id = ? ORDER BY name", (tenant_id, agent_id),
             ).fetchall()}
    next_version = int(row["published_version"] or 0) + 1
    now = _now()
    conn.execute(
        "UPDATE agent_versions SET is_current = 0 WHERE agent_id = ? AND is_current = 1",
        (agent_id,),
    )
    conn.execute(
        "INSERT INTO agent_versions (tenant_id, agent_id, version, config_json,"
        " files_json, published_by, published_at, is_current)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
        (tenant_id, agent_id, next_version,
         json.dumps(config, ensure_ascii=False),
         json.dumps(files, ensure_ascii=False), by, now),
    )
    conn.execute(
        "UPDATE agents SET published_version = ?, draft_version = ?,"
        " status = 'published', updated_at = ?, version = version + 1"
        " WHERE agent_id = ?",
        (next_version, next_version, now, agent_id),
    )
    conn.commit()
    return get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)


def delete_agent(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
) -> None:
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    conn.execute(
        "UPDATE agents SET deleted_at = ?, updated_at = ?, version = version + 1"
        " WHERE tenant_id = ? AND agent_id = ?",
        (_now(), _now(), tenant_id, agent_id),
    )
    conn.commit()


def pin_version(conn: sqlite3.Connection, *, tenant_id: str, agent_id: str) -> str:
    """The agent_versions.id a new thread must pin; published wins over draft."""
    row = conn.execute(
        "SELECT id FROM agent_versions WHERE tenant_id = ? AND agent_id = ?"
        " AND is_current = 1 ORDER BY version DESC LIMIT 1",
        (tenant_id, agent_id),
    ).fetchone()
    if row is None:
        row = conn.execute(
            "SELECT id FROM agent_versions WHERE tenant_id = ? AND agent_id = ?"
            " AND version = 0", (tenant_id, agent_id),
        ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"agentId": agent_id})
    return str(row[0])

# ---- v1.1 agent-level default subagents (single level) --------------------

MAX_SUBAGENTS = 8


def list_subagents(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
) -> list[dict[str, Any]]:
    """Enabled subagents configured on one expert, newest published first."""
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    rows = conn.execute(
        """
        SELECT a.agent_id, a.name, a.description, a.model, a.status,
               a.published_version
        FROM agent_subagents s
        JOIN agents a
          ON a.tenant_id = s.tenant_id AND a.agent_id = s.subagent_id
        WHERE s.tenant_id = ? AND s.agent_id = ? AND s.enabled = 1
          AND a.deleted_at IS NULL
        ORDER BY a.name, a.id
        """,
        (tenant_id, agent_id),
    ).fetchall()
    return [
        {
            "agentId": row["agent_id"],
            "name": row["name"],
            "description": row["description"],
            "status": _status(row),
            "model": row["model"],
        }
        for row in rows
    ]


def _graph(conn: sqlite3.Connection, tenant_id: str) -> dict[str, set[str]]:
    rows = conn.execute(
        "SELECT agent_id, subagent_id FROM agent_subagents"
        " WHERE tenant_id = ? AND enabled = 1", (tenant_id,),
    ).fetchall()
    graph: dict[str, set[str]] = {}
    for row in rows:
        graph.setdefault(str(row["agent_id"]), set()).add(str(row["subagent_id"]))
    return graph


def _reaches(graph: dict[str, set[str]], start: str, target: str) -> bool:
    stack = [start]
    seen: set[str] = set()
    while stack:
        node = stack.pop()
        if node == target:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(graph.get(node, ()))
    return False


def set_subagents(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    agent_id: str,
    subagent_ids: list[str],
    by: str = "system",
) -> list[dict[str, Any]]:
    """Replace an expert's default subagents; single level, no cycles."""
    get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    wanted: list[str] = []
    for raw in subagent_ids:
        item = str(raw).strip()
        if item and item not in wanted:
            wanted.append(item)
    if len(wanted) > MAX_SUBAGENTS:
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "subagentIds", "reason": f"max {MAX_SUBAGENTS}"},
        )
    graph = _graph(conn, tenant_id)
    graph[agent_id] = set(wanted)
    for subagent_id in wanted:
        if subagent_id == agent_id:
            raise AppError(
                "VALIDATION_FAILED",
                details={"field": "subagentIds", "reason": "cannot_delegate_to_self"},
            )
        target = get_agent(conn, tenant_id=tenant_id, agent_id=subagent_id)
        if target.get("status") != "published":
            raise AppError(
                "VALIDATION_FAILED",
                details={"field": "subagentIds", "reason": "subagent_not_published",
                         "agentId": subagent_id},
            )
        if _reaches(graph, subagent_id, agent_id):
            raise AppError(
                "CONFLICT",
                details={"reason": "subagent_cycle", "agentId": subagent_id},
            )

    now = _now()
    conn.execute(
        "DELETE FROM agent_subagents WHERE tenant_id = ? AND agent_id = ?",
        (tenant_id, agent_id),
    )
    for subagent_id in wanted:
        conn.execute(
            "INSERT INTO agent_subagents"
            " (tenant_id, agent_id, subagent_id, enabled, config_json,"
            "  created_at, updated_at)"
            " VALUES (?, ?, ?, 1, NULL, ?, ?)",
            (tenant_id, agent_id, subagent_id, now, now),
        )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="agent.subagents_update",
        result="ok", actor_id=by, resource_type="agent",
        resource_id=agent_id, detail={"subagentIds": wanted},
    )
    return list_subagents(conn, tenant_id=tenant_id, agent_id=agent_id)
