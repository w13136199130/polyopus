"""v1.1 channels: Feishu ingress/egress over the existing intake pipeline.

A channel owns a hidden backing source (`kind=channel_feishu`), so inbound
messages reuse the Gate, dedupe, ticket and subscription machinery instead of
creating a parallel task path.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from typing import Any, cast

import httpx

from polyopus.domains.audit import service as audit
from polyopus.domains.intake import service as intake
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore
from polyopus.platform.security import secretbox

TENANT = "default"
SUPPORTED_KINDS = ("feishu",)
SOURCE_KIND = "channel_feishu"
FEISHU_BASE = "https://open.feishu.cn"


def _now() -> int:
    return int(time.time())


def _base_url() -> str:
    return os.environ.get("POLY_FEISHU_BASE", FEISHU_BASE).rstrip("/")


def _secret_key() -> str:
    from polyopus.config import load_settings

    return str(load_settings().secret_key)


def _encrypt(credentials: dict[str, Any]) -> str:
    return secretbox.encrypt(
        json.dumps(credentials, ensure_ascii=False), _secret_key()
    )


def _decrypt(token: str) -> dict[str, Any]:
    try:
        value = json.loads(secretbox.decrypt(token, _secret_key()))
    except (ValueError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _config(row: sqlite3.Row) -> dict[str, Any]:
    try:
        value = json.loads(str(row["config_json"] or "{}"))
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _view(row: sqlite3.Row) -> dict[str, Any]:
    cfg = _config(row)
    return {
        "channelId": row["channel_id"],
        "kind": row["kind"],
        "displayName": row["display_name"],
        "status": row["status"],
        "appId": cfg.get("app_id"),
        "sourceId": cfg.get("source_id"),
        "webhookPath": f"/api/v1/channels/{row['kind']}/{row['channel_id']}/events",
        "lastError": row["last_error"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _channel(
    conn: sqlite3.Connection, tenant_id: str, channel_id: str,
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM channels WHERE tenant_id = ? AND channel_id = ?",
        (tenant_id, channel_id),
    ).fetchone()
    if row is None:
        raise AppError("CHANNEL_NOT_FOUND", details={"channelId": channel_id})
    return cast(sqlite3.Row, row)


def list_channels(
    conn: sqlite3.Connection, *, tenant_id: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM channels WHERE tenant_id = ? ORDER BY updated_at DESC, id DESC",
        (tenant_id,),
    ).fetchall()
    return [_view(row) for row in rows]


def create_channel(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    kind: str,
    display_name: str,
    app_id: str,
    app_secret: str,
    verification_token: str | None = None,
    encrypt_key: str | None = None,
    by: str = "system",
) -> dict[str, Any]:
    if kind not in SUPPORTED_KINDS:
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "kind", "reason": "unsupported channel"},
        )
    name = display_name.strip()
    if not name or not app_id.strip() or not app_secret.strip():
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "appId/appSecret", "reason": "required"},
        )
    channel_id = "ch_" + secrets.token_hex(8)
    source_id = "src_" + secrets.token_hex(8)
    now = _now()
    credentials = {
        "app_secret": app_secret.strip(),
        "verification_token": (verification_token or "").strip(),
        "encrypt_key": (encrypt_key or "").strip(),
    }
    source_name = f"飞书 · {name}"
    config = {
        "app_id": app_id.strip(),
        "source_id": source_id,
    }
    try:
        conn.execute(
            "INSERT INTO channels"
            " (channel_id, tenant_id, kind, display_name, config_json,"
            "  credential_ref, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
            (channel_id, tenant_id, kind, name,
             json.dumps(config, ensure_ascii=False),
             _encrypt(credentials), now, now),
        )
        conn.execute(
            "INSERT INTO sources"
            " (tenant_id, source_id, kind, name, config_json, status, created_at,"
            "  updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
            (
                tenant_id, source_id, SOURCE_KIND, source_name,
                json.dumps({
                    "allow_actors": [],
                    "explicit_patterns": [],
                    "default_scope": ["workspace:default", "fs:write"],
                    "reply_style": "full",
                    "channel_id": channel_id,
                    "hidden": True,
                }, ensure_ascii=False),
                now, now,
            ),
        )
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        raise AppError(
            "CONFLICT", details={"reason": "channel_name_taken"},
        ) from exc
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="channel.create", result="ok",
        actor_id=by, resource_type="channel", resource_id=channel_id,
        detail={"kind": kind, "displayName": name},
    )
    return _view(_channel(conn, tenant_id, channel_id))


def update_channel(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    channel_id: str,
    display_name: str | None = None,
    config: dict[str, Any] | None = None,
    credentials: dict[str, Any] | None = None,
    status: str | None = None,
    by: str = "system",
) -> dict[str, Any]:
    row = _channel(conn, tenant_id, channel_id)
    cfg = _config(row)
    updates: list[str] = []
    params: list[object] = []
    if display_name is not None:
        name = display_name.strip()
        if not name:
            raise AppError("VALIDATION_FAILED", details={"field": "displayName"})
        updates.append("display_name = ?")
        params.append(name)
        source_id = str(cfg.get("source_id") or "")
        if source_id:
            conn.execute(
                "UPDATE sources SET name = ?, updated_at = ? WHERE source_id = ?",
                (f"飞书 · {name}", _now(), source_id),
            )
    if config:
        cfg.update(config)
        updates.append("config_json = ?")
        params.append(json.dumps(cfg, ensure_ascii=False))
    if credentials:
        current = _decrypt(str(row["credential_ref"] or ""))
        current.update({key: str(value) for key, value in credentials.items()})
        updates.append("credential_ref = ?")
        params.append(_encrypt(current))
    if status is not None:
        if status not in ("active", "disabled", "error", "expired"):
            raise AppError("VALIDATION_FAILED", details={"field": "status"})
        updates.append("status = ?")
        params.append(status)
        source_id = str(cfg.get("source_id") or "")
        if source_id:
            conn.execute(
                "UPDATE sources SET status = ?, updated_at = ? WHERE source_id = ?",
                ("active" if status == "active" else "paused", _now(), source_id),
            )
    if not updates:
        return _view(row)
    updates.append("updated_at = ?")
    params.extend([_now(), tenant_id, channel_id])
    try:
        conn.execute(
            f"UPDATE channels SET {', '.join(updates)}"
            " WHERE tenant_id = ? AND channel_id = ?", params,
        )
    except sqlite3.IntegrityError as exc:
        conn.commit()
        raise AppError("CONFLICT", details={"reason": "channel_name_taken"}) from exc
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="channel.update", result="ok",
        actor_id=by, resource_type="channel", resource_id=channel_id,
        detail={"status": status, "displayName": display_name},
    )
    return _view(_channel(conn, tenant_id, channel_id))


def delete_channel(
    conn: sqlite3.Connection, *, tenant_id: str, channel_id: str, by: str = "system",
) -> None:
    row = _channel(conn, tenant_id, channel_id)
    cfg = _config(row)
    conn.execute(
        "DELETE FROM channels WHERE tenant_id = ? AND channel_id = ?",
        (tenant_id, channel_id),
    )
    source_id = str(cfg.get("source_id") or "")
    if source_id:
        conn.execute(
            "UPDATE sources SET status = 'paused', updated_at = ? WHERE source_id = ?",
            (_now(), source_id),
        )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="channel.delete", result="ok",
        actor_id=by, resource_type="channel", resource_id=channel_id,
        detail={"displayName": row["display_name"]},
    )


def _tenant_token(row: sqlite3.Row) -> str:
    cfg = _config(row)
    creds = _decrypt(str(row["credential_ref"] or ""))
    app_id = str(cfg.get("app_id") or "")
    app_secret = str(creds.get("app_secret") or "")
    if not app_id or not app_secret:
        raise AppError("CHANNEL_NOT_CONFIGURED")
    try:
        response = httpx.post(
            f"{_base_url()}/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=10,
        )
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise AppError(
            "CHANNEL_AUTH_FAILED", details={"reason": str(exc)},
        ) from exc
    if int(payload.get("code") or 0) != 0:
        raise AppError("CHANNEL_AUTH_FAILED", details={
            "reason": payload.get("msg") or "tenant_access_token failed",
        })
    return str(payload.get("tenant_access_token") or "")


def probe(
    conn: sqlite3.Connection, *, tenant_id: str, channel_id: str,
) -> dict[str, Any]:
    row = _channel(conn, tenant_id, channel_id)
    try:
        token = _tenant_token(row)
        ok = bool(token)
        error = None if ok else "empty tenant_access_token"
    except AppError as exc:
        ok, error = False, str(exc)
    status = "active" if ok else "error"
    conn.execute(
        "UPDATE channels SET status = ?, last_error = ?, updated_at = ?"
        " WHERE tenant_id = ? AND channel_id = ?",
        (status, error, _now(), tenant_id, channel_id),
    )
    conn.commit()
    result = _view(_channel(conn, tenant_id, channel_id))
    result.update({"ok": ok, "error": error})
    return result


def send_text(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    channel_id: str,
    chat_id: str,
    text: str,
) -> dict[str, Any]:
    row = _channel(conn, tenant_id, channel_id)
    token = _tenant_token(row)
    try:
        response = httpx.post(
            f"{_base_url()}/open-apis/im/v1/messages",
            params={"receive_id_type": "chat_id"},
            headers={"Authorization": f"Bearer {token}"},
            json={
                "receive_id": chat_id,
                "msg_type": "text",
                "content": json.dumps({"text": text}, ensure_ascii=False),
            },
            timeout=15,
        )
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        _record_message(
            conn, tenant_id=tenant_id, channel_id=channel_id,
            direction="outbound", external_id="out_" + secrets.token_hex(8),
            thread_id=None, ticket_id=None, actor_id=None, actor_kind="bot",
            payload={"chat_id": chat_id, "text": text},
            status="failed", error_code=str(exc),
        )
        raise AppError("CHANNEL_SEND_FAILED", details={"reason": str(exc)}) from exc
    ok = int(payload.get("code") or 0) == 0
    message_id = str((payload.get("data") or {}).get("message_id") or "")
    _record_message(
        conn, tenant_id=tenant_id, channel_id=channel_id,
        direction="outbound",
        external_id=message_id or "out_" + secrets.token_hex(8),
        thread_id=None, ticket_id=None, actor_id=None, actor_kind="bot",
        payload={"chat_id": chat_id, "text": text, "response": payload},
        status="sent" if ok else "failed",
        error_code=None if ok else str(payload.get("msg") or "send failed"),
    )
    if not ok:
        raise AppError("CHANNEL_SEND_FAILED", details={
            "reason": payload.get("msg") or "send failed",
        })
    return {"ok": True, "messageId": message_id}


def _record_message(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    channel_id: str,
    direction: str,
    external_id: str,
    thread_id: str | None,
    ticket_id: str | None,
    actor_id: str | None,
    actor_kind: str | None,
    payload: dict[str, Any],
    status: str,
    error_code: str | None = None,
) -> bool:
    try:
        conn.execute(
            "INSERT INTO channel_messages"
            " (message_id, tenant_id, channel_id, direction, external_id,"
            "  thread_id, ticket_id, actor_id, actor_kind, payload_json, status,"
            "  error_code, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "cm_" + secrets.token_hex(8), tenant_id, channel_id, direction,
                external_id, thread_id, ticket_id, actor_id, actor_kind,
                json.dumps(payload, ensure_ascii=False)[:20000], status,
                error_code, _now(),
            ),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        conn.rollback()
        return False


def _source_of(
    conn: sqlite3.Connection, tenant_id: str, row: sqlite3.Row,
) -> sqlite3.Row:
    source_id = str(_config(row).get("source_id") or "")
    source = conn.execute(
        "SELECT * FROM sources WHERE tenant_id = ? AND source_id = ?",
        (tenant_id, source_id),
    ).fetchone()
    if source is None:
        raise AppError("CHANNEL_NOT_CONFIGURED", details={"reason": "source"})
    return cast(sqlite3.Row, source)


def _event_token(body: dict[str, Any]) -> str:
    return str(
        body.get("token")
        or (body.get("header") or {}).get("token")
        or ""
    )


def handle_event(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    channel_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Feishu event subscription entrypoint (challenge + message receive)."""
    row = _channel(conn, tenant_id, channel_id)
    if str(row["status"]) != "active":
        raise AppError("CHANNEL_DISABLED")
    creds = _decrypt(str(row["credential_ref"] or ""))
    expected = str(creds.get("verification_token") or "")
    if expected and _event_token(body) != expected:
        raise AppError("UNAUTHORIZED")
    if body.get("type") == "url_verification":
        return {"challenge": str(body.get("challenge") or "")}

    header = body.get("header") or {}
    event_type = str(header.get("event_type") or body.get("type") or "")
    if event_type != "im.message.receive_v1":
        return {"ignored": "unsupported_event", "eventType": event_type}
    event = body.get("event") or {}
    message = event.get("message") or {}
    if str(message.get("message_type") or "") != "text":
        return {"ignored": "unsupported_message"}
    chat_id = str(message.get("chat_id") or "")
    external_id = str(message.get("message_id") or "")
    actor = str(
        ((event.get("sender") or {}).get("sender_id") or {}).get("open_id")
        or "unknown"
    )
    try:
        content = json.loads(str(message.get("content") or "{}"))
    except ValueError:
        content = {}
    text = str(content.get("text") or "").strip()
    if not text or not chat_id or not external_id:
        return {"ignored": "empty_message"}
    chat_type = str(message.get("chat_type") or "p2p")
    mentions = message.get("mentions") or []
    if chat_type != "p2p" and not mentions:
        _record_message(
            conn, tenant_id=tenant_id, channel_id=channel_id,
            direction="inbound", external_id=external_id,
            thread_id=None, ticket_id=None, actor_id=actor, actor_kind="user",
            payload=body, status="ignored", error_code="no_mention",
        )
        return {"ignored": "no_mention"}

    inserted = _record_message(
        conn, tenant_id=tenant_id, channel_id=channel_id,
        direction="inbound", external_id=external_id,
        thread_id=None, ticket_id=None, actor_id=actor, actor_kind="user",
        payload=body, status="received",
    )
    if not inserted:
        return {"duplicate": True, "externalId": external_id}

    source = _source_of(conn, tenant_id, row)
    trigger_body = {
        "kind": "feishu.message",
        "external_id": external_id,
        "thread_key": chat_id,
        "actor": {"id": actor, "kind": "user"},
        "text": text,
        "raw": body,
    }
    trigger_id, _key, duplicate = intake.receive(
        conn, store, source, trigger_body, headers_actor=actor,
    )
    if duplicate:
        return {"duplicate": True, "triggerId": trigger_id}
    ticket_id = intake.process(conn, store, source, trigger_id)
    thread_id = None
    if ticket_id:
        from polyopus.domains.tickets import service as tickets

        try:
            thread_id = tickets.thread_of_ticket(conn, ticket_id)
        except AppError:
            thread_id = None
        conn.execute(
            "UPDATE channel_messages SET ticket_id = ?, thread_id = ?"
            " WHERE tenant_id = ? AND channel_id = ? AND external_id = ?",
            (ticket_id, thread_id, tenant_id, channel_id, external_id),
        )
        conn.commit()
    return {
        "triggerId": trigger_id,
        "ticketId": ticket_id,
        "threadId": thread_id,
        "duplicate": False,
    }
