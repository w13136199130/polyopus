"""Plugin registry v1 (V1-15): signed manifests and hot tool toggles.

Only manifests signed by a local trusted signer are installed. `api_version`
major must match 1. Enabling/disabling flips the plugin's tools in the global
registry, which the engine reads on the next turn (no restart).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import time
from typing import Any

from polyopus.platform.errors import AppError

TENANT = "default"
API_MAJOR = "1"
TRUSTED_SIGNERS = ("local",)

EXAMPLES: tuple[dict[str, Any], ...] = (
    {
        "id": "example.echo", "name": "Echo", "version": "1.0.0",
        "apiVersion": "1.0", "permissions": ["tools:read"],
        "tools": [{
            "key": "plugin.echo", "description": "回显输入文本",
            "risk": "low", "inputSchema": {"type": "object"},
        }],
    },
    {
        "id": "example.clock", "name": "Clock", "version": "1.0.0",
        "apiVersion": "1.0", "permissions": ["tools:read"],
        "tools": [{
            "key": "plugin.clock", "description": "返回当前时间",
            "risk": "low", "inputSchema": {"type": "object"},
        }],
    },
    {
        "id": "example.formatter", "name": "Formatter", "version": "1.0.0",
        "apiVersion": "1.0", "permissions": ["tools:read"],
        "tools": [{
            "key": "plugin.format", "description": "格式化文本",
            "risk": "low", "inputSchema": {"type": "object"},
        }],
    },
)


def _now() -> int:
    return int(time.time())


def _canonical(manifest: dict[str, Any]) -> str:
    return json.dumps(manifest, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"))


def sign_manifest(
    manifest: dict[str, Any], secret_key: str, signer: str = "local",
) -> str:
    return hmac.new(
        secret_key.encode(), f"{signer}:{_canonical(manifest)}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _validate(manifest: dict[str, Any]) -> None:
    if not isinstance(manifest, dict):
        raise AppError("PLUGIN_INVALID_ARCHIVE", details={"reason": "manifest"})
    for key in ("id", "name", "version", "apiVersion"):
        if not str(manifest.get(key) or "").strip():
            raise AppError("PLUGIN_INVALID_ARCHIVE", details={"field": key})
    major = str(manifest["apiVersion"]).split(".")[0]
    if major != API_MAJOR:
        raise AppError(
            "VALIDATION_FAILED",
            details={"reason": "api_version_incompatible",
                     "expected": API_MAJOR, "actual": manifest["apiVersion"]},
        )
    tools = manifest.get("tools") or []
    if not isinstance(tools, list):
        raise AppError("PLUGIN_INVALID_ARCHIVE", details={"field": "tools"})
    for tool in tools:
        key = str(tool.get("key") or "") if isinstance(tool, dict) else ""
        if not key.startswith("plugin."):
            raise AppError(
                "PLUGIN_INVALID_ARCHIVE",
                details={"tool": key or "?", "reason": "plugin. prefix required"},
            )


def _view(row: sqlite3.Row) -> dict[str, Any]:
    manifest = json.loads(row["manifest_json"] or "{}")
    return {
        "id": row["plugin_id"],
        "pluginId": row["plugin_id"],
        "name": manifest.get("name") or row["plugin_id"],
        "version": row["version"],
        "apiVersion": manifest.get("apiVersion"),
        "status": row["status"],
        "permissions": list(manifest.get("permissions") or []),
        "tools": [tool.get("key") for tool in manifest.get("tools") or []
                  if isinstance(tool, dict)],
        "signed": bool(row["signature"]),
        "installedAt": row["installed_at"],
    }


def list_plugins(
    conn: sqlite3.Connection, *, tenant_id: str = TENANT,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM plugins WHERE tenant_id = ? ORDER BY installed_at DESC",
        (tenant_id,),
    ).fetchall()
    return [_view(row) for row in rows]


def install_plugin(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    manifest: dict[str, Any],
    signature: str | None,
    secret_key: str,
    signer: str = "local",
) -> dict[str, Any]:
    _validate(manifest)
    expected = sign_manifest(manifest, secret_key, signer)
    if signer not in TRUSTED_SIGNERS or not signature or not hmac.compare_digest(
        expected, signature
    ):
        raise AppError(
            "PLUGIN_SIGNATURE_INVALID",
            details={"signer": signer, "trusted": list(TRUSTED_SIGNERS)},
        )
    plugin_id = str(manifest["id"])
    version = str(manifest["version"])
    existing = conn.execute(
        "SELECT * FROM plugins WHERE tenant_id = ? AND plugin_id = ?",
        (tenant_id, plugin_id),
    ).fetchone()
    if existing is not None and str(existing["version"]) == version:
        raise AppError("PLUGIN_ALREADY_EXISTS", details={"pluginId": plugin_id})
    now = _now()
    status = "enabled"
    conn.execute(
        "INSERT INTO plugins (plugin_id, tenant_id, version, manifest_json,"
        " status, signature, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(plugin_id) DO UPDATE SET version = excluded.version,"
        " manifest_json = excluded.manifest_json, status = excluded.status,"
        " signature = excluded.signature, installed_at = excluded.installed_at",
        (plugin_id, tenant_id, version,
         json.dumps(manifest, ensure_ascii=False), status, signature, now),
    )
    digest = hashlib.sha256(_canonical(manifest).encode()).hexdigest()
    conn.execute(
        "INSERT INTO plugin_signatures (plugin_id, version, sha256, signer,"
        " signed_at) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(plugin_id, version) DO UPDATE SET sha256 = excluded.sha256,"
        " signer = excluded.signer, signed_at = excluded.signed_at",
        (plugin_id, version, digest, signer, now),
    )
    _register_tools(conn, tenant_id, plugin_id, version, manifest, enabled=True)
    conn.commit()
    row = conn.execute(
        "SELECT * FROM plugins WHERE plugin_id = ?", (plugin_id,)
    ).fetchone()
    assert row is not None
    return _view(row)


def _register_tools(
    conn: sqlite3.Connection, tenant_id: str, plugin_id: str, version: str,
    manifest: dict[str, Any], *, enabled: bool,
) -> None:
    now = _now()
    for tool in manifest.get("tools") or []:
        if not isinstance(tool, dict):
            continue
        key = str(tool["key"])
        spec = {
            "name": tool.get("name") or key,
            "description": tool.get("description") or "",
            "inputSchema": tool.get("inputSchema") or {},
            "outputSchema": tool.get("outputSchema"),
            "renderer": tool.get("renderer") or "default",
            "risk": tool.get("risk") or "medium",
            "sideEffects": bool(tool.get("sideEffects")),
            "idempotent": not bool(tool.get("sideEffects")),
            "scopes": list(tool.get("scopes") or []),
            "pluginId": plugin_id,
        }
        conn.execute(
            "INSERT INTO tools (tool_key, source, version, spec_json,"
            " enabled_global, created_at, updated_at) VALUES (?, 'plugin', ?,"
            " ?, ?, ?, ?) ON CONFLICT(tool_key) DO UPDATE SET"
            " version = excluded.version, spec_json = excluded.spec_json,"
            " enabled_global = excluded.enabled_global,"
            " updated_at = excluded.updated_at",
            (key, version, json.dumps(spec, ensure_ascii=False),
             int(enabled), now, now),
        )


def set_enabled(
    conn: sqlite3.Connection, *,
    tenant_id: str, plugin_id: str, enabled: bool,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM plugins WHERE tenant_id = ? AND plugin_id = ?",
        (tenant_id, plugin_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"pluginId": plugin_id})
    manifest = json.loads(row["manifest_json"] or "{}")
    status = "enabled" if enabled else "disabled"
    conn.execute(
        "UPDATE plugins SET status = ? WHERE tenant_id = ? AND plugin_id = ?",
        (status, tenant_id, plugin_id),
    )
    for tool in manifest.get("tools") or []:
        if isinstance(tool, dict) and tool.get("key"):
            conn.execute(
                "UPDATE tools SET enabled_global = ?, updated_at = ?"
                " WHERE tool_key = ?", (int(enabled), _now(), str(tool["key"])),
            )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM plugins WHERE plugin_id = ?", (plugin_id,)
    ).fetchone()
    assert row is not None
    return _view(row)


def uninstall_plugin(
    conn: sqlite3.Connection, *, tenant_id: str, plugin_id: str,
) -> None:
    row = conn.execute(
        "SELECT * FROM plugins WHERE tenant_id = ? AND plugin_id = ?",
        (tenant_id, plugin_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"pluginId": plugin_id})
    manifest = json.loads(row["manifest_json"] or "{}")
    for tool in manifest.get("tools") or []:
        if isinstance(tool, dict) and tool.get("key"):
            conn.execute(
                "UPDATE tools SET enabled_global = 0, updated_at = ?"
                " WHERE tool_key = ?", (_now(), str(tool["key"])),
            )
    conn.execute(
        "DELETE FROM plugins WHERE tenant_id = ? AND plugin_id = ?",
        (tenant_id, plugin_id),
    )
    conn.execute(
        "DELETE FROM plugin_signatures WHERE plugin_id = ?", (plugin_id,)
    )
    conn.commit()


def install_examples(
    conn: sqlite3.Connection, *, tenant_id: str, secret_key: str,
) -> list[dict[str, Any]]:
    installed = []
    for manifest in EXAMPLES:
        try:
            installed.append(install_plugin(
                conn, tenant_id=tenant_id, manifest=dict(manifest),
                signature=sign_manifest(dict(manifest), secret_key),
                secret_key=secret_key,
            ))
        except AppError as exc:
            if exc.code != "PLUGIN_ALREADY_EXISTS":
                raise
    return installed
