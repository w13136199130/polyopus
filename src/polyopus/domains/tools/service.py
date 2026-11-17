"""Tool registry and per-agent tool settings (V1-12).

The registry is global (`tools`); per-agent switches live in `tool_settings`.
Settings can only hide a tool that the global registry already allows — they
never override the policy engine's allow/ask/deny decision.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

from polyopus.kernel.tools import GATEWAY_SPECS, POLICY_SPECS
from polyopus.platform.errors import AppError

TENANT = "default"


def _now() -> int:
    return int(time.time())


def _spec_payload(internal: str) -> dict[str, Any]:
    spec = GATEWAY_SPECS[internal]
    policy = POLICY_SPECS[internal]
    return {
        "name": spec.name,
        "description": spec.description,
        "inputSchema": spec.parameters_json_schema,
        "outputSchema": None,
        "renderer": "default",
        "risk": policy.risk,
        "sideEffects": policy.side_effects,
        "idempotent": not policy.side_effects,
        "scopes": [policy.required_scope] if policy.required_scope else [],
    }


def ensure_builtin_tools(conn: sqlite3.Connection) -> None:
    now = _now()
    for internal in GATEWAY_SPECS:
        conn.execute(
            "INSERT INTO tools (tool_key, source, version, spec_json,"
            " enabled_global, created_at, updated_at)"
            " VALUES (?, 'builtin', 'builtin-1', ?, 1, ?, ?)"
            " ON CONFLICT(tool_key) DO NOTHING",
            (internal, json.dumps(_spec_payload(internal), ensure_ascii=False),
             now, now),
        )
    conn.commit()


def _view(row: sqlite3.Row) -> dict[str, Any]:
    spec = json.loads(row["spec_json"] or "{}")
    return {
        "toolKey": row["tool_key"],
        "source": row["source"],
        "version": row["version"],
        "description": spec.get("description") or "",
        "risk": spec.get("risk") or "medium",
        "sideEffects": bool(spec.get("sideEffects")),
        "idempotent": bool(spec.get("idempotent")),
        "scopes": list(spec.get("scopes") or []),
        "enabledGlobal": bool(row["enabled_global"]),
        "inputSchema": spec.get("inputSchema") or {},
        "outputSchema": spec.get("outputSchema"),
        "renderer": spec.get("renderer"),
    }


def list_tools(
    conn: sqlite3.Connection, *,
    source: str | None = None,
    risk: str | None = None,
    q: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    ensure_builtin_tools(conn)
    sql = "SELECT * FROM tools WHERE 1=1"
    params: list[object] = []
    if source:
        sql += " AND source = ?"
        params.append(source)
    sql += " ORDER BY tool_key LIMIT ?"
    params.append(max(1, min(limit, 200)))
    rows = conn.execute(sql, params).fetchall()
    views = [_view(row) for row in rows]
    if risk:
        views = [view for view in views if view["risk"] == risk]
    if q:
        needle = q.lower()
        views = [
            view for view in views
            if needle in str(view["toolKey"]).lower()
            or needle in str(view["description"]).lower()
        ]
    return views


def get_tool(conn: sqlite3.Connection, tool_key: str) -> dict[str, Any]:
    ensure_builtin_tools(conn)
    row = conn.execute(
        "SELECT * FROM tools WHERE tool_key = ?", (tool_key,)
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"toolKey": tool_key})
    return _view(row)


def set_global_enabled(
    conn: sqlite3.Connection, tool_key: str, enabled: bool,
) -> dict[str, Any]:
    get_tool(conn, tool_key)
    conn.execute(
        "UPDATE tools SET enabled_global = ?, updated_at = ? WHERE tool_key = ?",
        (int(enabled), _now(), tool_key),
    )
    conn.commit()
    return get_tool(conn, tool_key)


def agent_bindings(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
) -> dict[str, Any]:
    from polyopus.domains.agents import service as agents

    agents.get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    ensure_builtin_tools(conn)
    rows = conn.execute(
        """
        SELECT t.tool_key, t.enabled_global, t.spec_json, s.enabled, s.config_json
        FROM tools t
        LEFT JOIN tool_settings s
          ON s.tool_key = t.tool_key AND s.tenant_id = ? AND s.agent_id = ?
        ORDER BY t.tool_key
        """,
        (tenant_id, agent_id),
    ).fetchall()
    items = []
    for row in rows:
        config = json.loads(row["config_json"] or "{}")
        enabled = bool(row["enabled"]) if row["enabled"] is not None else bool(
            row["enabled_global"]
        )
        items.append({
            "toolKey": row["tool_key"],
            "enabled": enabled and bool(row["enabled_global"]),
            "config": config,
        })
    return {"agentId": agent_id, "items": items}


def set_agent_bindings(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    agent_id: str,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    from polyopus.domains.agents import service as agents

    agents.get_agent(conn, tenant_id=tenant_id, agent_id=agent_id)
    ensure_builtin_tools(conn)
    keys = {str(item.get("toolKey") or "") for item in items}
    known = {
        str(row[0]) for row in conn.execute(
            "SELECT tool_key FROM tools"
        ).fetchall()
    }
    unknown = sorted(keys - known)
    if unknown:
        raise AppError("VALIDATION_FAILED", details={"toolKey": unknown})
    now = _now()
    conn.execute(
        "DELETE FROM tool_settings WHERE tenant_id = ? AND agent_id = ?",
        (tenant_id, agent_id),
    )
    for item in items:
        conn.execute(
            "INSERT INTO tool_settings (tenant_id, agent_id, tool_key, enabled,"
            " config_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (tenant_id, agent_id, str(item["toolKey"]),
             int(bool(item.get("enabled", True))),
             json.dumps(item.get("config") or {}, ensure_ascii=False), now),
        )
    conn.commit()
    return agent_bindings(conn, tenant_id=tenant_id, agent_id=agent_id)


def effective_enabled(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    agent_id: str | None,
    tool_key: str,
) -> bool:
    """Global registry + per-agent switch; policy is applied separately."""
    row = conn.execute(
        "SELECT enabled_global FROM tools WHERE tool_key = ?", (tool_key,)
    ).fetchone()
    if row is not None and not int(row[0]):
        return False
    if not agent_id:
        return True
    setting = conn.execute(
        "SELECT enabled FROM tool_settings WHERE tenant_id = ? AND agent_id = ?"
        " AND tool_key = ?", (tenant_id, agent_id, tool_key),
    ).fetchone()
    if setting is None:
        return True
    return bool(setting[0])
