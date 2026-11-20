"""Provider/model configuration for the admin console.

Credentials use the same secretbox envelope as connectors and are never
returned. The registry resolves env-first; this service only manages the
database-backed providers that apply when no env provider is configured.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import sqlite3
import time
from typing import Any, cast

from polyopus.platform.errors import AppError
from polyopus.platform.security import secretbox

TENANT = "default"
KIND = "openai_compat"


def _now() -> int:
    return int(time.time())


def _models(conn: sqlite3.Connection, provider_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT model_id, name, enabled, caps_json FROM models "
        "WHERE provider_id = ? ORDER BY id", (provider_id,),
    ).fetchall()
    return [
        {
            "modelId": row["model_id"],
            "name": row["name"],
            "enabled": bool(row["enabled"]),
            "caps": json.loads(row["caps_json"] or "{}"),
        }
        for row in rows
    ]


def _view(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    return {
        "providerId": row["provider_id"],
        "name": row["name"],
        "kind": row["kind"],
        "baseUrl": row["base_url"] or "",
        "status": row["status"],
        "configured": bool(row["api_key_enc"]),
        "models": _models(conn, str(row["provider_id"])),
        "updatedAt": row["updated_at"],
    }


def _row(conn: sqlite3.Connection, provider_id: str, tenant_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM providers WHERE tenant_id = ? AND provider_id = ?",
        (tenant_id, provider_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"providerId": provider_id})
    return cast(sqlite3.Row, row)


def list_providers(
    conn: sqlite3.Connection, tenant_id: str = TENANT
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM providers WHERE tenant_id = ? ORDER BY id", (tenant_id,)
    ).fetchall()
    return [_view(conn, row) for row in rows]


def _validate(name: str, base_url: str) -> tuple[str, str]:
    clean = name.strip()
    if not clean:
        raise AppError("VALIDATION_FAILED", details={"fields": {"name": "required"}})
    url = base_url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise AppError(
            "VALIDATION_FAILED",
            details={"fields": {"baseUrl": "must start with http(s)://"}},
        )
    return clean, url


def _replace_models(
    conn: sqlite3.Connection, provider_id: str, names: list[str],
) -> None:
    clean: list[str] = []
    for name in names:
        value = str(name).strip()
        if value and value not in clean:
            clean.append(value)
    conn.execute("DELETE FROM models WHERE provider_id = ?", (provider_id,))
    for name in clean:
        conn.execute(
            "INSERT INTO models (model_id, provider_id, name, caps_json, enabled)"
            " VALUES (?, ?, ?, '{}', 1)",
            ("md_" + secrets.token_hex(8), provider_id, name),
        )
    conn.execute(
        "UPDATE providers SET models_json = ? WHERE provider_id = ?",
        (json.dumps({"models": clean}, ensure_ascii=False), provider_id),
    )


def create_provider(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    name: str,
    base_url: str,
    api_key: str,
    models: list[str],
    secret_key: str,
) -> dict[str, Any]:
    clean, url = _validate(name, base_url)
    provider_id = "pv_" + secrets.token_hex(8)
    now = _now()
    encrypted = secretbox.encrypt(api_key, secret_key) if api_key else None
    try:
        conn.execute(
            "INSERT INTO providers (tenant_id, provider_id, name, kind, base_url,"
            " api_key_enc, status, models_json, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'unconfigured', '{}', ?, ?)",
            (tenant_id, provider_id, clean, KIND, url, encrypted, now, now),
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "provider_name_taken"}) from exc
    _replace_models(conn, provider_id, models)
    conn.commit()
    return _view(conn, _row(conn, provider_id, tenant_id))


def update_provider(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    provider_id: str,
    name: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    models: list[str] | None = None,
    status: str | None = None,
    secret_key: str,
) -> dict[str, Any]:
    row = _row(conn, provider_id, tenant_id)
    clean, url = _validate(
        name if name is not None else str(row["name"]),
        base_url if base_url is not None else str(row["base_url"] or ""),
    )
    updates = ["name = ?", "base_url = ?", "updated_at = ?", "version = version + 1"]
    params: list[object] = [clean, url, _now()]
    if api_key:  # empty means "keep the stored key"
        updates.append("api_key_enc = ?")
        params.append(secretbox.encrypt(api_key, secret_key))
    if status is not None:
        if status not in ("unconfigured", "authorized", "error"):
            raise AppError("VALIDATION_FAILED", details={"status": status})
        updates.append("status = ?")
        params.append(status)
    params.extend([tenant_id, provider_id])
    try:
        conn.execute(
            f"UPDATE providers SET {', '.join(updates)} "
            "WHERE tenant_id = ? AND provider_id = ?", params,
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "provider_name_taken"}) from exc
    if models is not None:
        _replace_models(conn, provider_id, models)
    conn.commit()
    return _view(conn, _row(conn, provider_id, tenant_id))


def delete_provider(
    conn: sqlite3.Connection, *, tenant_id: str, provider_id: str
) -> None:
    _row(conn, provider_id, tenant_id)
    conn.execute("DELETE FROM models WHERE provider_id = ?", (provider_id,))
    conn.execute(
        "DELETE FROM providers WHERE tenant_id = ? AND provider_id = ?",
        (tenant_id, provider_id),
    )
    conn.commit()


def _api_key(row: sqlite3.Row) -> str:
    raw = str(row["api_key_enc"] or "")
    if not raw:
        return ""
    try:
        from polyopus.config import load_settings

        return secretbox.decrypt(raw, load_settings().secret_key)
    except (ValueError, TypeError):
        return raw  # legacy plaintext row


def probe_provider(
    conn: sqlite3.Connection, *, tenant_id: str, provider_id: str,
) -> dict[str, Any]:
    """One minimal streamed request; persists authorized/error."""
    row = _row(conn, provider_id, tenant_id)
    models = _models(conn, provider_id)
    model = next((str(item["name"]) for item in models if item["enabled"]), "")
    key = _api_key(row)
    base_url = str(row["base_url"] or "")
    ok = False
    detail = ""
    if not base_url or not key:
        detail = "base_url / api_key 未配置"
    elif not model:
        detail = "没有可用模型"
    else:
        from polyopus.kernel.models.gateway import ChatMessage, ModelRequest
        from polyopus.kernel.models.openai_compat import (
            OpenAICompatProvider,
            ProviderConfig,
        )

        provider = OpenAICompatProvider(ProviderConfig(base_url=base_url, api_key=key))

        async def ping() -> None:
            async for _delta in provider.stream(
                ModelRequest(
                    model=model,
                    messages=(ChatMessage(role="user", content="ping"),),
                    max_output_tokens=1,
                    temperature=0,
                )
            ):
                return

        try:
            asyncio.run(ping())
            ok = True
            detail = f"{model} reachable"
        except Exception as exc:  # noqa: BLE001 - probe reports, never crashes
            detail = str(exc)[:300]
    conn.execute(
        "UPDATE providers SET status = ?, updated_at = ? WHERE provider_id = ?",
        ("authorized" if ok else "error", _now(), provider_id),
    )
    conn.commit()
    result = _view(conn, _row(conn, provider_id, tenant_id))
    result.update({
        "ok": ok,
        "detail": detail or ("reachable" if ok else "unreachable"),
    })
    return result


__all__ = [
    "create_provider",
    "delete_provider",
    "list_providers",
    "probe_provider",
    "update_provider",
]
