"""Webhook entrypoint (public, HMAC) + source management (session)."""

from __future__ import annotations

import json
import secrets
import time
from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Body, Depends, Header, Request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.intake import service
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

router = APIRouter(tags=["intake"])


class CreateSourceBody(BaseModel):
    """Accepts snake_case and the repo-wide camelCase wire convention:
    the SPA sends camelCase (docs/29); silently defaulting `generateSecret`
    to true once caused unsigned demo webhooks to 401 (V05-04 e2e catch)."""

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=100)
    allow_actors: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("allow_actors", "allowActors"),
    )
    explicit_patterns: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("explicit_patterns", "explicitPatterns"),
    )
    default_scope: list[str] = Field(
        default_factory=lambda: ["workspace:default"],
        validation_alias=AliasChoices("default_scope", "defaultScope"),
    )
    max_total_tokens: int | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("max_total_tokens", "maxTotalTokens"),
    )
    max_cost_micros: int | None = Field(
        default=None,
        gt=0,
        description="V05-18 per-ticket cost cap (micros)",
        validation_alias=AliasChoices("max_cost_micros", "maxCostMicros"),
    )
    max_cost_micros_per_day: int | None = Field(
        default=None,
        gt=0,
        description="V05-18 per-source daily cost cap (micros)",
        validation_alias=AliasChoices(
            "max_cost_micros_per_day", "maxCostMicrosPerDay"
        ),
    )
    callback_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("callback_url", "callbackUrl"),
    )
    reply_style: Literal["structured", "full"] = Field(
        default="structured",
        description="V05-15 reply shaping: structured = webhook payload, "
        "full = web markdown",
        validation_alias=AliasChoices("reply_style", "replyStyle"),
    )
    auto_approve_tools: list[str] = Field(
        default_factory=list,
        description="V05-16 explicit tool whitelist; empty = every ask "
        "still needs a human",
        validation_alias=AliasChoices("auto_approve_tools", "autoApproveTools"),
    )
    auto_approve_max_risk: Literal["low", "medium", "high"] = Field(
        default="high",
        description="critical tools are never auto-approved",
        validation_alias=AliasChoices(
            "auto_approve_max_risk", "autoApproveMaxRisk"
        ),
    )
    assessment: Literal["off", "dry_run", "auto"] = Field(
        default="off",
        description="model-based admission (V05-13): off = rule Gate only",
    )
    generate_secret: bool = Field(
        default=True,
        validation_alias=AliasChoices("generate_secret", "generateSecret"),
    )


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
    user: User = Depends(require_permission("source:write")),
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
    if body.max_cost_micros is not None:
        config["max_cost_micros"] = body.max_cost_micros
    if body.max_cost_micros_per_day is not None:
        config["max_cost_micros_per_day"] = body.max_cost_micros_per_day
    if body.callback_url:
        from polyopus.domains.outbound import service as outbound

        config["callback_url"] = outbound.validate_callback_url(body.callback_url)
    if body.assessment != "off":
        config["assessment"] = body.assessment
    if body.reply_style != "structured":
        config["reply_style"] = body.reply_style
    if body.auto_approve_tools:
        config["auto_approve_tools"] = body.auto_approve_tools
        if body.auto_approve_max_risk != "high":
            config["auto_approve_max_risk"] = body.auto_approve_max_risk
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO sources
          (tenant_id, source_id, kind, name, config_json, status, created_at, updated_at)
        VALUES (?, ?, 'webhook', ?, ?, 'active', ?, ?)
        """,
        (user.tenant_id, source_id, body.name,
         json.dumps(config, ensure_ascii=False), now, now),
    )
    conn.commit()
    out: dict[str, object] = dict(_view(source_id, body.name, "active"))
    if secret:
        out["secret"] = secret  # shown exactly once, like the admin password
        out["secretNote"] = "store this now; it will not be shown again"
    return out


@router.get("/sources")
def list_sources(
    user: User = Depends(require_permission("source:read")), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    from polyopus.domains.intake import schedule as schedule_svc
    from polyopus.domains.intake import service as intake

    rows = conn.execute(
        "SELECT * FROM sources WHERE tenant_id = ? ORDER BY id",
        (user.tenant_id,),
    ).fetchall()
    items: list[dict[str, object]] = []
    for row in rows:
        cfg = intake.config_of(row)
        item: dict[str, object] = {
            "sourceId": row["source_id"],
            "kind": row["kind"],
            "name": row["name"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "callbackUrl": cfg.callback_url or None,
            "assessment": cfg.assessment,
            "replyStyle": cfg.reply_style,
            "allowActors": list(cfg.allow_actors),
            "explicitPatterns": list(cfg.explicit_patterns),
            "schedule": None,
        }
        if str(row["kind"]) == "schedule":
            item["schedule"] = schedule_svc.latest_job_for_source(
                conn, str(row["source_id"]), user.tenant_id
            )
        items.append(item)
    return {"items": items}


@router.post("/sources/{source_id}/pause")
def pause_source(
    source_id: str,
    user: User = Depends(require_permission("source:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return _set_source_status(conn, user.tenant_id, source_id, "paused")


@router.post("/sources/{source_id}/resume")
def resume_source(
    source_id: str,
    user: User = Depends(require_permission("source:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return _set_source_status(conn, user.tenant_id, source_id, "active")


@router.delete("/sources/{source_id}")
def delete_source(
    source_id: str,
    user: User = Depends(require_permission("source:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    row = conn.execute(
        "SELECT kind FROM sources WHERE tenant_id = ? AND source_id = ?",
        (user.tenant_id, source_id),
    ).fetchone()
    if row is None:
        raise AppError("SOURCE_NOT_FOUND")
    conn.execute(
        "DELETE FROM cron_jobs WHERE tenant_id = ? "
        "AND json_extract(payload_json, '$.source_id') = ?",
        (user.tenant_id, source_id),
    )
    conn.execute(
        "DELETE FROM sources WHERE tenant_id = ? AND source_id = ?",
        (user.tenant_id, source_id),
    )
    conn.commit()
    return {"sourceId": source_id, "deleted": True}


def _set_source_status(
    conn: Connection, tenant_id: str, source_id: str, status: str
) -> dict[str, object]:
    row = conn.execute(
        "SELECT kind FROM sources WHERE tenant_id = ? AND source_id = ?",
        (tenant_id, source_id),
    ).fetchone()
    if row is None:
        raise AppError("SOURCE_NOT_FOUND")
    now = int(time.time())
    conn.execute(
        "UPDATE sources SET status = ?, updated_at = ? "
        "WHERE tenant_id = ? AND source_id = ?",
        (status, now, tenant_id, source_id),
    )
    if str(row["kind"]) == "schedule":
        conn.execute(
            "UPDATE cron_jobs SET enabled = ? "
            "WHERE tenant_id = ? "
            "AND json_extract(payload_json, '$.source_id') = ?",
            (1 if status == "active" else 0, tenant_id, source_id),
        )
    conn.commit()
    return {"sourceId": source_id, "status": status}


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
