"""Connectors v1 (V1-14): catalog, encrypted instances, probe, OAuth state."""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from typing import Any, cast

from polyopus.platform.errors import AppError
from polyopus.platform.security import secretbox

TENANT = "default"
CATALOG: tuple[dict[str, Any], ...] = (
    {"catalogId": "github", "kind": "github", "name": "GitHub",
     "authKind": "oauth", "category": "dev"},
    {"catalogId": "feishu", "kind": "feishu", "name": "飞书",
     "authKind": "oauth", "category": "im"},
    {"catalogId": "webhook", "kind": "webhook", "name": "Webhook",
     "authKind": "token", "category": "automation"},
    {"catalogId": "imap", "kind": "imap", "name": "IMAP 邮箱",
     "authKind": "imap", "category": "mail"},
    {"catalogId": "mcp", "kind": "mcp", "name": "自定义 MCP",
     "authKind": "token", "category": "mcp"},
)


def _now() -> int:
    return int(time.time())


def ensure_catalog(conn: sqlite3.Connection) -> None:
    for item in CATALOG:
        conn.execute(
            "INSERT INTO connector_catalog (catalog_id, kind, name, auth_kind,"
            " config_json) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(catalog_id) DO NOTHING",
            (item["catalogId"], item["kind"], item["name"], item["authKind"],
             json.dumps({"category": item["category"]}, ensure_ascii=False)),
        )
    conn.commit()


def list_catalog(
    conn: sqlite3.Connection, *, q: str | None = None,
    category: str | None = None,
) -> list[dict[str, Any]]:
    ensure_catalog(conn)
    rows = conn.execute("SELECT * FROM connector_catalog ORDER BY kind").fetchall()
    items = []
    for row in rows:
        config = json.loads(row["config_json"] or "{}")
        item = {
            "catalogId": row["catalog_id"],
            "kind": row["kind"],
            "name": row["name"],
            "authKind": row["auth_kind"],
            "category": config.get("category"),
        }
        if category and item["category"] != category:
            continue
        if q and q.lower() not in f"{item['name']} {item['kind']}".lower():
            continue
        items.append(item)
    return items


def _catalog(conn: sqlite3.Connection, kind: str) -> sqlite3.Row:
    ensure_catalog(conn)
    row = conn.execute(
        "SELECT * FROM connector_catalog WHERE kind = ?", (kind,)
    ).fetchone()
    if row is None:
        raise AppError("VALIDATION_FAILED", details={"kind": kind})
    return cast(sqlite3.Row, row)


def _view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["instance_id"],
        "instanceId": row["instance_id"],
        "kind": row["kind"],
        "displayName": row["display_name"],
        "authKind": row["auth_kind"],
        "status": row["status"],
        "ownerId": row["owner_id"],
        "shared": bool(row["shared"]),
        "defaultOpen": bool(row["default_open"]),
        "toolsCount": int(row["tools_count"]),
        "lastProbeAt": row["last_probe_at"],
        "configured": bool(row["config_enc"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_instances(
    conn: sqlite3.Connection, *, tenant_id: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM connector_instances WHERE tenant_id = ?"
        " ORDER BY updated_at DESC", (tenant_id,),
    ).fetchall()
    return [_view(row) for row in rows]


def _instance(
    conn: sqlite3.Connection, tenant_id: str, instance_id: str,
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM connector_instances WHERE tenant_id = ? AND instance_id = ?",
        (tenant_id, instance_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"instanceId": instance_id})
    return row  # type: ignore[no-any-return]


def create_instance(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    owner_id: str,
    kind: str,
    display_name: str,
    config: dict[str, Any] | None,
    auth_kind: str | None = None,
    shared: bool = False,
    default_open: bool = False,
    secret_key: str,
) -> dict[str, Any]:
    catalog = _catalog(conn, kind)
    instance_id = "ci_" + secrets.token_hex(8)
    now = _now()
    encrypted = secretbox.encrypt(
        json.dumps(config or {}, ensure_ascii=False), secret_key
    )
    try:
        conn.execute(
            "INSERT INTO connector_instances (tenant_id, instance_id, kind,"
            " display_name, config_enc, auth_kind, status, owner_id, shared,"
            " default_open, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?,"
            " 'active', ?, ?, ?, ?, ?)",
            (tenant_id, instance_id, kind, display_name.strip(), encrypted,
             auth_kind or str(catalog["auth_kind"]), owner_id,
             int(shared), int(default_open), now, now),
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "connector_name_taken"}) from exc
    conn.commit()
    return _view(_instance(conn, tenant_id, instance_id))


def update_instance(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    instance_id: str,
    display_name: str | None = None,
    config: dict[str, Any] | None = None,
    shared: bool | None = None,
    default_open: bool | None = None,
    status: str | None = None,
    secret_key: str,
) -> dict[str, Any]:
    _instance(conn, tenant_id, instance_id)
    updates: list[str] = []
    params: list[object] = []
    if display_name is not None:
        updates.append("display_name = ?")
        params.append(display_name.strip())
    if config is not None:
        updates.append("config_enc = ?")
        params.append(secretbox.encrypt(
            json.dumps(config, ensure_ascii=False), secret_key
        ))
        # discovered tools belong to the old config; force a rediscovery
        conn.execute(
            "DELETE FROM connector_tools WHERE tenant_id = ? AND instance_id = ?",
            (tenant_id, instance_id),
        )
        updates.append("tools_count = 0")
    if shared is not None:
        updates.append("shared = ?")
        params.append(int(shared))
    if default_open is not None:
        updates.append("default_open = ?")
        params.append(int(default_open))
    if status is not None:
        if status not in ("active", "expired", "disabled", "error"):
            raise AppError("VALIDATION_FAILED", details={"status": status})
        updates.append("status = ?")
        params.append(status)
    if updates:
        updates.extend(["updated_at = ?", "version = version + 1"])
        params.extend([_now(), tenant_id, instance_id])
        try:
            conn.execute(
                f"UPDATE connector_instances SET {', '.join(updates)}"
                " WHERE tenant_id = ? AND instance_id = ?", params,
            )
        except sqlite3.IntegrityError as exc:
            raise AppError("CONFLICT", details={"reason": "connector_name_taken"}) from exc
    conn.commit()
    return _view(_instance(conn, tenant_id, instance_id))


def delete_instance(
    conn: sqlite3.Connection, *, tenant_id: str, instance_id: str,
) -> None:
    _instance(conn, tenant_id, instance_id)
    conn.execute(
        "DELETE FROM connector_bindings WHERE tenant_id = ?"
        " AND connector_instance_id = ?", (tenant_id, instance_id),
    )
    conn.execute(
        "DELETE FROM connector_tools WHERE tenant_id = ? AND instance_id = ?",
        (tenant_id, instance_id),
    )
    conn.execute(
        "DELETE FROM connector_instances WHERE tenant_id = ? AND instance_id = ?",
        (tenant_id, instance_id),
    )
    conn.commit()


def _required_fields(kind: str) -> tuple[str, ...]:
    return {
        "webhook": ("url",),
        "github": ("client_id", "client_secret"),
        "feishu": ("app_id", "app_secret"),
        "imap": ("host", "username", "password"),
    }.get(kind, ())


def _mcp_errors(config: dict[str, Any]) -> list[str]:
    """Validate the server map without exposing credentials.

    Accepted shape: {"servers": {"name": {...}}} or a bare name->server map.
    HTTP servers need a URL; stdio servers need a command."""
    servers = config.get("servers", config)
    if not isinstance(servers, dict) or not servers:
        return ["missing MCP server"]
    errors: list[str] = []
    for name, raw in servers.items():
        if name in ("auth", "headers"):
            continue
        if not isinstance(raw, dict):
            errors.append(f"{name}: server must be an object")
            continue
        transport = str(raw.get("type") or raw.get("transport") or "http")
        if transport == "http":
            if not str(raw.get("url") or "").strip():
                errors.append(f"{name}: url required")
        elif transport == "stdio":
            if not str(raw.get("command") or "").strip():
                errors.append(f"{name}: command required")
        else:
            errors.append(f"{name}: unsupported transport {transport}")
    return errors


def probe(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    instance_id: str,
    secret_key: str,
    timeout_seconds: float = 5.0,
) -> dict[str, Any]:
    """Validate the encrypted config locally; no credentials leave the box."""
    row = _instance(conn, tenant_id, instance_id)
    try:
        config = json.loads(secretbox.decrypt(str(row["config_enc"]), secret_key))
    except (ValueError, TypeError):
        config = {}
    if str(row["kind"]) == "mcp":
        missing = _mcp_errors(config)
    else:
        missing = [key for key in _required_fields(str(row["kind"]))
                   if not config.get(key)]
    ok = not missing
    status = "active" if ok else "error"
    conn.execute(
        "UPDATE connector_instances SET status = ?, last_probe_at = ?,"
        " updated_at = ? WHERE tenant_id = ? AND instance_id = ?",
        (status, _now(), _now(), tenant_id, instance_id),
    )
    conn.commit()
    result = _view(_instance(conn, tenant_id, instance_id))
    result["ok"] = ok
    if missing:
        result["error"] = f"missing config: {', '.join(missing)}"
    assert timeout_seconds > 0
    return result


def oauth_start(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    kind: str,
    secret_key: str,
    ttl_seconds: int = 600,
) -> dict[str, Any]:
    _catalog(conn, kind)
    state_id = "os_" + secrets.token_hex(10)
    now = _now()
    authorize_url = (
        f"https://connect.invalid/oauth/{kind}?state={state_id}"
    )
    conn.execute(
        "INSERT INTO connector_oauth_states (tenant_id, state_id,"
        " connector_kind, status, authorize_url, verifier_enc, expires_at,"
        " created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
        (tenant_id, state_id, kind, authorize_url,
         secretbox.encrypt(state_id, secret_key), now + ttl_seconds, now),
    )
    conn.commit()
    return {
        "stateId": state_id, "authorizeUrl": authorize_url,
        "status": "pending", "expiresAt": now + ttl_seconds,
    }


def oauth_pending(
    conn: sqlite3.Connection, *, tenant_id: str, state_id: str,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM connector_oauth_states WHERE tenant_id = ? AND state_id = ?",
        (tenant_id, state_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"stateId": state_id})
    status = str(row["status"])
    if status == "pending" and int(row["expires_at"]) < _now():
        status = "expired"
    return {
        "stateId": row["state_id"], "kind": row["connector_kind"],
        "status": status, "expiresAt": row["expires_at"],
    }


def oauth_callback(
    conn: sqlite3.Connection, *, tenant_id: str, state_id: str, code: str,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM connector_oauth_states WHERE tenant_id = ? AND state_id = ?",
        (tenant_id, state_id),
    ).fetchone()
    if row is None:
        raise AppError("VALIDATION_FAILED", details={"reason": "unknown_state"})
    if str(row["status"]) != "pending" or int(row["expires_at"]) < _now():
        raise AppError("CONFLICT", details={"reason": "state_not_pending"})
    if not code.strip():
        raise AppError("VALIDATION_FAILED", details={"reason": "code"})
    conn.execute(
        "UPDATE connector_oauth_states SET status = 'authorized',"
        " finished_at = ? WHERE tenant_id = ? AND state_id = ?",
        (_now(), tenant_id, state_id),
    )
    conn.commit()
    return {"ok": True, "stateId": state_id, "status": "authorized"}
