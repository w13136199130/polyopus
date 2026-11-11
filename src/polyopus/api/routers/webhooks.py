"""Webhook entrypoint (public, HMAC) + source management (session)."""

from __future__ import annotations

import json
import secrets
import time
from sqlite3 import Connection

from fastapi import APIRouter, Body, Depends, Header, Request
from pydantic import BaseModel, Field

from polyopus.api.deps import current_user, get_db, get_store
from polyopus.domains.identity.service import User
from polyopus.domains.intake import service
from polyopus.platform.events.store import EventStore

router = APIRouter(tags=["intake"])


class CreateSourceBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    allow_actors: list[str] = Field(default_factory=list)
    explicit_patterns: list[str] = Field(default_factory=list)
    default_scope: list[str] = Field(default_factory=lambda: ["workspace:default"])
    max_total_tokens: int | None = Field(default=None, gt=0)
    generate_secret: bool = True


def _view(source_id: str, name: str, status: str) -> dict[str, str]:
    return {
        "sourceId": source_id,
        "kind": "webhook",
        "name": name,
        "status": status,
        "webhookUrl": f"/api/v1/webhooks/{source_id}",
    }


@router.post("/sources", status_code=201)
def create_source(
    body: CreateSourceBody,
    request: Request,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    source_id = "src_" + secrets.token_hex(8)
    secret = secrets.token_urlsafe(24) if body.generate_secret else ""
    config: dict[str, object] = {
        "secret": secret,
        "allow_actors": body.allow_actors,
        "explicit_patterns": body.explicit_patterns,
        "default_scope": body.default_scope,
    }
    if body.max_total_tokens is not None:
        config["max_total_tokens"] = body.max_total_tokens
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO sources
          (tenant_id, source_id, kind, name, config_json, status, created_at, updated_at)
        VALUES ('default', ?, 'webhook', ?, ?, 'active', ?, ?)
        """,
        (source_id, body.name, json.dumps(config, ensure_ascii=False), now, now),
    )
    conn.commit()
    out: dict[str, object] = dict(_view(source_id, body.name, "active"))
    if secret:
        out["secret"] = secret  # shown exactly once, like the admin password
        out["secretNote"] = "store this now; it will not be shown again"
    return out


@router.get("/sources")
def list_sources(
    user: User = Depends(current_user), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    rows = conn.execute(
        "SELECT source_id, name, status FROM sources WHERE tenant_id='default' "
        "ORDER BY id"
    ).fetchall()
    return {
        "items": [
            {"sourceId": r["source_id"], "name": r["name"], "status": r["status"]}
            for r in rows
        ]
    }


@router.post("/webhooks/{source_id}", status_code=202)
def receive_webhook(
    source_id: str,
    request: Request,
    payload: dict[str, object] = Body(...),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
    signature: str | None = Header(default=None, alias="X-Signature"),
    actor_hint: str | None = Header(default=None, alias="X-Actor"),
) -> dict[str, object]:
    raw = b""  # signature verified over the parsed canonical form
    source = service.get_source(conn, source_id)
    cfg = service.config_of(source)
    if cfg.secret:
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        service.verify_signature(cfg.secret, canonical, signature)

    trigger_id, dedupe, duplicate = service.receive(
        conn, store, source, payload, actor_hint
    )
    ticket_id: str | None = None
    if not duplicate:
        ticket_id = service.process(conn, store, source, trigger_id)

    disposition = None
    row = conn.execute(
        "SELECT disposition FROM triggers WHERE trigger_id = ?", (trigger_id,)
    ).fetchone()
    if row is not None:
        disposition = str(row[0])
    _ = raw
    return {
        "triggerId": trigger_id,
        "dedupeKey": dedupe,
        "duplicate": duplicate,
        "ticketId": ticket_id,
        "disposition": disposition,
    }
