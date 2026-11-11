"""Intake: webhook receive -> dedupe -> Gate -> Ticket+Mandate (slice ② cards 1-3).

docs/09: receive returns 202 after the trigger row is durable; platform
retries are absorbed by (source_id, dedupe_key). The Gate is deterministic
in v1 (actor whitelist + explicit patterns); the model-based Assessment is
deferred until its own card.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

TENANT = "default"

FILTER_REASONS = ("actor_not_allowed", "bot_not_allowed", "not_explicit",
                  "rate_limited", "rule_denied", "self_message")


@dataclass(frozen=True)
class SourceConfig:
    source_id: str
    kind: str
    name: str
    status: str
    secret: str
    allow_actors: tuple[str, ...]
    bot_actors: tuple[str, ...]
    explicit_patterns: tuple[str, ...]
    default_scope: tuple[str, ...]


def config_of(row: sqlite3.Row) -> SourceConfig:
    cfg: dict[str, Any] = json.loads(row["config_json"] or "{}")
    return SourceConfig(
        source_id=str(row["source_id"]),
        kind=str(row["kind"]),
        name=str(row["name"]),
        status=str(row["status"]),
        secret=str(cfg.get("secret", "")),
        allow_actors=tuple(cfg.get("allow_actors", ())),
        bot_actors=tuple(cfg.get("bot_actors", ())),
        explicit_patterns=tuple(cfg.get("explicit_patterns", ())),
        default_scope=tuple(cfg.get("default_scope", ("workspace:default",))),
    )


def get_source(conn: sqlite3.Connection, source_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM sources WHERE tenant_id = ? AND source_id = ?",
        (TENANT, source_id),
    ).fetchone()
    if row is None:
        raise AppError("SOURCE_NOT_FOUND")
    if str(row["status"]) != "active":
        raise AppError("SOURCE_PAUSED")
    return row  # type: ignore[no-any-return]


def verify_signature(secret: str, body: bytes, signature: str | None) -> None:
    if not secret:
        return  # dev sources without a secret accept unsigned posts
    if not signature:
        raise AppError("UNAUTHORIZED")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature.strip().lower()):
        raise AppError("UNAUTHORIZED")


# ---- receive: normalize + dedupe (docs/09 §2) -------------------------------


def normalize(body: dict[str, Any], headers_actor: str | None) -> dict[str, Any]:
    actor_raw = body.get("actor") or {}
    return {
        "kind": str(body.get("kind", "webhook.received")),
        "actor_id": str(actor_raw.get("id") or headers_actor or "anonymous"),
        "actor_kind": str(actor_raw.get("kind", "user")),
        "thread_key": str(body.get("thread_key") or "default"),
        "text": str(body.get("text", "")),
        "external_id": body.get("external_id"),
    }


def dedupe_key(event: dict[str, Any]) -> str:
    if event["external_id"]:
        return f"{event['kind']}:{event['external_id']}"
    digest = hashlib.sha256(
        f"{event['thread_key']}{event['actor_id']}{event['text']}".encode()
    ).hexdigest()[:16]
    minute = time.strftime("%Y%m%d%H%M", time.gmtime())
    return f"{event['kind']}:{digest}:{minute}"


def receive(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    body: dict[str, Any],
    headers_actor: str | None,
) -> tuple[str, str, bool]:
    """Insert the trigger idempotently. Returns (trigger_id, dedupe_key, duplicate)."""
    cfg = config_of(source)
    event = normalize(body, headers_actor)
    key = dedupe_key(event)
    trigger_id = "tr_" + secrets.token_hex(8)
    now = int(time.time())

    cur = conn.execute(
        """
        INSERT INTO triggers
          (tenant_id, trigger_id, source_id, dedupe_key, thread_key, actor_id,
           actor_kind, payload_json, disposition, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(source_id, dedupe_key) DO NOTHING
        """,
        (TENANT, trigger_id, cfg.source_id, key, event["thread_key"],
         event["actor_id"], event["actor_kind"],
         json.dumps({**event, "raw": body}, ensure_ascii=False)[:4000], now),
    )
    if cur.rowcount == 0:
        existing = conn.execute(
            "SELECT trigger_id FROM triggers WHERE source_id = ? AND dedupe_key = ?",
            (cfg.source_id, key),
        ).fetchone()
        conn.commit()
        return str(existing[0]), key, True

    conn.commit()
    store.append(
        cfg.source_id,
        "trigger.received",
        {
            "trigger_id": trigger_id,
            "source_id": cfg.source_id,
            "kind": event["kind"],
            "actor": {"kind": event["actor_kind"], "id": event["actor_id"]},
            "thread_key": event["thread_key"],
            "dedupe_key": key,
        },
        tenant_id=TENANT,
    )
    return trigger_id, key, False


# ---- Gate: deterministic admission (docs/09 §3) -----------------------------


@dataclass(frozen=True)
class GateResult:
    accept: bool
    reason: str | None = None
    rule_id: str | None = None


def evaluate_gate(cfg: SourceConfig, trigger: sqlite3.Row) -> GateResult:
    actor_id = str(trigger["actor_id"])
    payload = json.loads(trigger["payload_json"])
    text = str(payload.get("text", ""))

    if actor_id in cfg.bot_actors:
        return GateResult(False, "bot_not_allowed")
    if cfg.allow_actors and actor_id not in cfg.allow_actors:
        return GateResult(False, "actor_not_allowed")
    if cfg.explicit_patterns and not any(
        re.search(p, text) for p in cfg.explicit_patterns
    ):
        return GateResult(False, "not_explicit")
    return GateResult(True)


# ---- Ticket + Mandate (docs/09 §6/§7, ADR-012 execution basis) ---------------


def open_ticket(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    trigger_id: str,
) -> str:
    cfg = config_of(source)
    trigger = conn.execute(
        "SELECT * FROM triggers WHERE trigger_id = ?", (trigger_id,)
    ).fetchone()
    if trigger is None:
        raise AppError("NOT_FOUND")
    payload = json.loads(trigger["payload_json"])
    now = int(time.time())

    ticket_id = "tk_" + secrets.token_hex(8)
    mandate_id = "md_" + secrets.token_hex(8)
    thread_id = "th_" + secrets.token_hex(12)
    title = str(payload.get("text", ""))[:80] or "webhook 工单"
    scope = list(cfg.default_scope)

    # ADR-012: all execution lands on thread+turn; the ticket carries the mandate
    conn.execute(
        """
        INSERT INTO threads
          (tenant_id, thread_id, owner_id, title, status, created_at, updated_at)
        VALUES (?, ?, 'system', ?, 'active', ?, ?)
        """,
        (TENANT, thread_id, title, now, now),
    )
    conn.execute(
        """
        INSERT INTO tickets
          (tenant_id, ticket_id, title, state, bucket, source_id, trigger_id,
           actor_json, strength, policy_version, scope_json, created_at, updated_at)
        VALUES (?, ?, ?, 'open', 'queued', ?, ?, ?, 'explicit', 1, ?, ?, ?)
        """,
        (TENANT, ticket_id, title, cfg.source_id, trigger_id,
         json.dumps({"id": str(trigger["actor_id"]), "kind": str(trigger["actor_kind"])}),
         json.dumps(scope), now, now),
    )
    conn.execute(
        """
        INSERT INTO mandates
          (tenant_id, mandate_id, ticket_id, policy_version, scope_json, strength,
           matched_rules_json, created_at)
        VALUES (?, ?, ?, 1, ?, 'explicit', ?, ?)
        """,
        (TENANT, mandate_id, ticket_id, json.dumps(scope),
         json.dumps(["gate:explicit"]), now),
    )
    conn.execute(
        "UPDATE triggers SET disposition = 'accepted' WHERE trigger_id = ?",
        (trigger_id,),
    )
    conn.commit()

    store.append(
        thread_id,
        "ticket.opened",
        {
            "ticket_id": ticket_id,
            "title": title,
            "source_id": cfg.source_id,
            "mandate": {
                "policy_version": 1,
                "scope": scope,
                "strength": "explicit",
                "matched_rules": ["gate:explicit"],
                "actor": {"kind": str(trigger["actor_kind"]),
                          "id": str(trigger["actor_id"])},
                "granted_at": now,
            },
            "event_thread_id": thread_id,
        },
        tenant_id=TENANT,
    )
    return ticket_id


def filter_trigger(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    trigger_id: str,
    result: GateResult,
) -> None:
    cfg = config_of(source)
    conn.execute(
        "UPDATE triggers SET disposition = 'filtered' WHERE trigger_id = ?",
        (trigger_id,),
    )
    conn.commit()
    store.append(
        cfg.source_id,
        "trigger.filtered",
        {
            "trigger_id": trigger_id,
            "reason": result.reason,
            **({"rule_id": result.rule_id} if result.rule_id else {}),
        },
        tenant_id=TENANT,
    )


def process(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    trigger_id: str,
) -> str | None:
    """Gate + open. Returns ticket_id, or None when filtered."""
    cfg = config_of(source)
    trigger = conn.execute(
        "SELECT * FROM triggers WHERE trigger_id = ?", (trigger_id,)
    ).fetchone()
    if trigger is None:
        raise AppError("NOT_FOUND")
    result = evaluate_gate(cfg, trigger)
    if not result.accept:
        filter_trigger(conn, store, source, trigger_id, result)
        return None
    return open_ticket(conn, store, source, trigger_id)
