"""MCP tool discovery + tenant-scoped bindings for the engine."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

from polyopus.domains.connectors import mcp
from polyopus.platform.errors import AppError
from polyopus.platform.security import secretbox


@dataclass(frozen=True)
class ConnectorToolBinding:
    tool_key: str
    wire_name: str
    instance_id: str
    server: str
    tool_name: str
    description: str
    input_schema: dict[str, Any]


def _instance(conn: sqlite3.Connection, tenant_id: str, instance_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM connector_instances WHERE tenant_id = ? AND instance_id = ?",
        (tenant_id, instance_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"instanceId": instance_id})
    return row  # type: ignore[no-any-return]


def _config(conn: sqlite3.Connection, tenant_id: str, instance_id: str,
            secret_key: str) -> tuple[sqlite3.Row, dict[str, Any]]:
    row = _instance(conn, tenant_id, instance_id)
    try:
        config = json.loads(secretbox.decrypt(str(row["config_enc"]), secret_key))
    except (ValueError, TypeError, json.JSONDecodeError):
        config = {}
    return row, config if isinstance(config, dict) else {}


def _tool_key(instance_id: str, server: str, tool: str) -> str:
    return f"mcp.{instance_id}.{server}.{tool}"


def discover_instance(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    instance_id: str,
    secret_key: str,
) -> dict[str, Any]:
    row, config = _config(conn, tenant_id, instance_id, secret_key)
    if str(row["kind"]) != "mcp":
        raise AppError("VALIDATION_FAILED", details={"reason": "not_mcp"})
    servers = mcp.parse_servers(config)
    if not servers:
        raise AppError("VALIDATION_FAILED", details={"reason": "no_servers"})

    now = int(time.time())
    tools: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for server in servers:
        try:
            discovered = mcp.discover(server)
        except (mcp.McpError, OSError) as exc:
            errors.append({"server": server.name, "error": str(exc)})
            continue
        for tool in discovered:
            key = _tool_key(instance_id, server.name, tool.name)
            wire = mcp.wire_name(key, server.name, tool.name)
            conn.execute(
                """
                INSERT INTO connector_tools
                  (tenant_id, instance_id, server, tool_name, wire_name, tool_key,
                   description, input_schema_json, enabled, discovered_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(tenant_id, instance_id, server, tool_name) DO UPDATE SET
                  wire_name = excluded.wire_name,
                  tool_key = excluded.tool_key,
                  description = excluded.description,
                  input_schema_json = excluded.input_schema_json,
                  enabled = 1,
                  updated_at = excluded.updated_at
                """,
                (
                    tenant_id, instance_id, server.name, tool.name, wire, key,
                    tool.description,
                    json.dumps(tool.input_schema, ensure_ascii=False), now, now,
                ),
            )
            tools.append({
                "toolKey": key, "wireName": wire, "server": server.name,
                "toolName": tool.name, "description": tool.description,
                "inputSchema": tool.input_schema,
            })
    keys = {item["toolKey"] for item in tools}
    for stale in conn.execute(
        "SELECT tool_key FROM connector_tools WHERE tenant_id = ? "
        "AND instance_id = ?", (tenant_id, instance_id),
    ).fetchall():
        if str(stale[0]) not in keys:
            conn.execute(
                "DELETE FROM connector_tools WHERE tenant_id = ? AND tool_key = ?",
                (tenant_id, str(stale[0])),
            )
    conn.execute(
        "UPDATE connector_instances SET tools_count = ?, updated_at = ? "
        "WHERE tenant_id = ? AND instance_id = ?",
        (len(tools), now, tenant_id, instance_id),
    )
    conn.commit()
    return {"items": tools, "errors": errors}


def list_instance_tools(
    conn: sqlite3.Connection, *, tenant_id: str, instance_id: str
) -> list[dict[str, Any]]:
    _instance(conn, tenant_id, instance_id)
    return [
        {
            "toolKey": row["tool_key"],
            "wireName": row["wire_name"],
            "server": row["server"],
            "toolName": row["tool_name"],
            "description": row["description"],
            "inputSchema": json.loads(row["input_schema_json"] or "{}"),
            "enabled": bool(row["enabled"]),
        }
        for row in conn.execute(
            "SELECT * FROM connector_tools WHERE tenant_id = ? AND instance_id = ? "
            "ORDER BY server, tool_name", (tenant_id, instance_id),
        ).fetchall()
    ]


def bindings(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    selected_instance_ids: list[str] | None = None,
) -> list[ConnectorToolBinding]:
    """Tools from the session's connectors (or default-open instances).

    Selection in the composer wins; otherwise instances marked default-open;
    if none are default-open, all active instances are available so a newly
    configured MCP works without an extra toggle."""
    rows = conn.execute(
        "SELECT instance_id, default_open, status FROM connector_instances "
        "WHERE tenant_id = ?", (tenant_id,),
    ).fetchall()
    selected = set(selected_instance_ids or [])
    active = [row for row in rows if str(row["status"]) != "expired"]
    if selected:
        ids = {str(row["instance_id"]) for row in active
               if str(row["instance_id"]) in selected}
    else:
        ids = {str(row["instance_id"]) for row in active if row["default_open"]}
        if not ids:
            ids = {str(row["instance_id"]) for row in active}
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    out: list[ConnectorToolBinding] = []
    for row in conn.execute(
        "SELECT * FROM connector_tools WHERE tenant_id = ? AND enabled = 1 "
        f"AND instance_id IN ({placeholders}) ORDER BY id",
        (tenant_id, *ids),
    ).fetchall():
        out.append(ConnectorToolBinding(
            tool_key=str(row["tool_key"]),
            wire_name=str(row["wire_name"]),
            instance_id=str(row["instance_id"]),
            server=str(row["server"]),
            tool_name=str(row["tool_name"]),
            description=str(row["description"] or ""),
            input_schema=json.loads(row["input_schema_json"] or "{}"),
        ))
    return out


def call_tool(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    instance_id: str,
    server: str,
    tool_name: str,
    arguments: dict[str, Any],
    secret_key: str,
) -> dict[str, Any]:
    _row, config = _config(conn, tenant_id, instance_id, secret_key)
    servers = {item.name: item for item in mcp.parse_servers(config)}
    target = servers.get(server)
    if target is None:
        raise AppError("NOT_FOUND", details={
            "reason": "mcp_server_missing", "server": server,
        })
    return mcp.call(target, tool_name, arguments)
