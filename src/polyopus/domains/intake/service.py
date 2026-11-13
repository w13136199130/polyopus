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
    callback_url: str = ""  # outbound replies (V05-08)
    # V05-13: model-based admission. off = rule Gate only (default,
    # explicit_only); dry_run = judge + write dispositions, never open;
    # auto = judge + open on accept
    assessment: str = "off"


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
        callback_url=str(cfg.get("callback_url", "")),
        assessment=str(cfg.get("assessment", "off")),
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


def _alias(body: dict[str, Any], snake: str, camel: str) -> Any:
    """The webhook contract is snake_case (docs/09), but callers keep
    sending camelCase (V05-04 `generateSecret` catch, V05-10 `threadKey`
    collapse-to-default) — accept both, snake_case wins."""
    value = body.get(snake)
    return value if value is not None else body.get(camel)


def normalize(body: dict[str, Any], headers_actor: str | None) -> dict[str, Any]:
    actor_raw = body.get("actor") or {}
    return {
        "kind": str(body.get("kind", "webhook.received")),
        "actor_id": str(actor_raw.get("id") or headers_actor or "anonymous"),
        "actor_kind": str(actor_raw.get("kind", "user")),
        "thread_key": str(_alias(body, "thread_key", "threadKey") or "default"),
        "text": str(body.get("text", "")),
        "external_id": _alias(body, "external_id", "externalId"),
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
    *,
    strength: str = "explicit",
    matched_rules: list[str] | None = None,
    scope: list[str] | None = None,
) -> str:
    """strength/matched_rules/scope record HOW admission happened: the rule
    Gate ('explicit' + gate:explicit + default scope) or a V05-13 assessment
    (judged strength + assessment:<eval_id> + judged scope)."""
    cfg = config_of(source)
    matched = matched_rules if matched_rules is not None else ["gate:explicit"]
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
    scope = list(scope) if scope else list(cfg.default_scope)

    # ADR-012: all execution lands on thread+turn; the ticket carries the mandate
    conn.execute(
        """
        INSERT INTO threads
          (tenant_id, thread_id, owner_id, title, status, created_at, updated_at)
        VALUES (?, ?, 'system', ?, 'active', ?, ?)
        """,
        (TENANT, thread_id, title, now, now),
    )
    source_cfg = json.loads(source["config_json"] or "{}")
    max_tokens = source_cfg.get("max_total_tokens")
    budget = {"max_total_tokens": int(max_tokens)} if max_tokens else None
    # V05-12: the mandate pins the ACTIVE bundle version (bootstrap publishes
    # the built-in defaults as v1 on the first ticket); later publishes never
    # touch this mandate — it keeps executing its snapshot.
    from polyopus.domains.policy import service as policy

    policy_version = policy.active_version_or_bootstrap(conn)
    conn.execute(
        """
        INSERT INTO tickets
          (tenant_id, ticket_id, title, state, bucket, source_id, trigger_id,
           actor_json, strength, policy_version, scope_json, budget_json,
           created_at, updated_at)
        VALUES (?, ?, ?, 'open', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (TENANT, ticket_id, title, cfg.source_id, trigger_id,
         json.dumps({"id": str(trigger["actor_id"]), "kind": str(trigger["actor_kind"])}),
         strength,
         policy_version,
         json.dumps(scope),
         json.dumps(budget) if budget else None, now, now),
    )
    conn.execute(
        """
        INSERT INTO mandates
          (tenant_id, mandate_id, ticket_id, policy_version, scope_json, strength,
           matched_rules_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (TENANT, mandate_id, ticket_id, policy_version, json.dumps(scope),
         strength, json.dumps(matched), now),
    )
    conn.execute(
        "UPDATE triggers SET disposition = 'accepted' WHERE trigger_id = ?",
        (trigger_id,),
    )
    conn.commit()

    from polyopus.domains.tickets import service as tickets
    tickets.link_thread(conn, ticket_id, thread_id)
    subscribe_ticket(conn, store, thread_id=thread_id, ticket_id=ticket_id,
                     event_thread_key=str(trigger["thread_key"]))

    store.append(
        thread_id,
        "ticket.opened",
        {
            "ticket_id": ticket_id,
            "title": title,
            "source_id": cfg.source_id,
            "mandate": {
                "policy_version": policy_version,
                "scope": scope,
                "strength": strength,
                "matched_rules": matched,
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


# ---- subscription fan-out (V05-10, docs/09 §2.4 / docs/32 §13A) --------------

TERMINAL_TURN_STATES = ("completed", "failed", "cancelled")


def subscribe_ticket(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    thread_id: str,
    ticket_id: str,
    event_thread_key: str,
) -> None:
    """An open ticket owns its event thread: later triggers on the thread
    fan out to it instead of opening new tickets."""
    subscription_id = "sub_" + secrets.token_hex(8)
    cur = conn.execute(
        """
        INSERT INTO subscriptions
          (tenant_id, subscription_id, ticket_id, event_thread_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ticket_id, event_thread_id) DO NOTHING
        """,
        (TENANT, subscription_id, ticket_id, event_thread_key, int(time.time())),
    )
    conn.commit()
    if cur.rowcount:
        store.append(
            thread_id,
            "subscription.created",
            {
                "subscription_id": subscription_id,
                "ticket_id": ticket_id,
                "event_thread_id": event_thread_key,
            },
            tenant_id=TENANT,
        )


def release_ticket_subscriptions(conn: sqlite3.Connection, ticket_id: str) -> int:
    """Ticket ended -> its event thread may open new tickets again (the
    anti-leak invariant of V05-10). The fan-out lookup re-checks
    tickets.state anyway; this keeps the table honest. Called from stop()
    and the ready tail of run_assignment."""
    cur = conn.execute(
        "DELETE FROM subscriptions WHERE tenant_id = ? AND ticket_id = ?",
        (TENANT, ticket_id),
    )
    conn.commit()
    return cur.rowcount


def fan_out(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    trigger: sqlite3.Row,
) -> str | None:
    """Route a trigger to the open ticket subscribed to its event thread,
    straight past the Gate (docs/09 §2.4 `fanned_out`). Returns the existing
    ticket id, or None when no live subscription owns the thread."""
    key = str(trigger["thread_key"])
    row = conn.execute(
        """
        SELECT s.ticket_id FROM subscriptions s
        JOIN tickets t ON t.ticket_id = s.ticket_id
        WHERE s.tenant_id = ? AND s.event_thread_id = ? AND t.state = 'open'
        ORDER BY s.id LIMIT 1
        """,
        (TENANT, key),
    ).fetchone()
    if row is None:
        # hygiene: a ticket ended without hitting its release hook (crash
        # window) — drop stale rows so the thread can open new tickets again
        conn.execute(
            """
            DELETE FROM subscriptions WHERE tenant_id = ? AND event_thread_id = ?
              AND ticket_id IN (
                SELECT ticket_id FROM tickets WHERE state != 'open'
              )
            """,
            (TENANT, key),
        )
        conn.commit()
        return None

    ticket_id = str(row["ticket_id"])
    conn.execute(
        "UPDATE triggers SET disposition = 'fanned_out' WHERE trigger_id = ?",
        (str(trigger["trigger_id"]),),
    )
    conn.commit()

    from polyopus.domains.tickets import service as tickets

    thread_id = tickets.thread_of_ticket(conn, ticket_id)
    text = str(json.loads(str(trigger["payload_json"])).get("text", ""))
    conn.execute(
        """
        INSERT INTO timeline_events
          (tenant_id, ticket_id, kind, title, description, actor, payload_json,
           event_id, created_at)
        VALUES (?, ?, 'trigger_fanned_out', '后续触发已并入', ?, 'system', ?, ?, ?)
        """,
        (TENANT, ticket_id, text[:80],
         json.dumps({"trigger_id": str(trigger["trigger_id"]), "thread_key": key},
                    ensure_ascii=False),
         "tl_" + secrets.token_hex(8), int(time.time())),
    )
    conn.commit()
    store.append(
        str(source["source_id"]),
        "trigger.fanned_out",
        {
            "trigger_id": str(trigger["trigger_id"]),
            "ticket_id": ticket_id,
            "event_thread_id": key,
        },
        tenant_id=TENANT,
    )

    # deliver the message as a new turn when the execution thread is idle; a
    # busy thread just records it (the steer queue is not built in v0.5)
    latest = conn.execute(
        "SELECT status FROM turns WHERE thread_id = ? ORDER BY id DESC LIMIT 1",
        (thread_id,),
    ).fetchone()
    if text.strip() and (
        latest is None or str(latest[0]) in TERMINAL_TURN_STATES
    ):
        from polyopus.domains import conversations

        conversations.post_turn(
            conn, store, tenant_id=TENANT, owner_id="system",
            thread_id=thread_id, content=text,
        )
    return ticket_id


def process(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    trigger_id: str,
) -> str | None:
    """Fan out to a subscribed open ticket, else Gate + open. Returns the
    ticket id (existing on fan-out, new on open), or None when filtered."""
    cfg = config_of(source)
    trigger = conn.execute(
        "SELECT * FROM triggers WHERE trigger_id = ?", (trigger_id,)
    ).fetchone()
    if trigger is None:
        raise AppError("NOT_FOUND")
    fanned = fan_out(conn, store, source, trigger)
    if fanned is not None:
        return fanned
    result = evaluate_gate(cfg, trigger)
    if not result.accept:
        filter_trigger(conn, store, source, trigger_id, result)
        return None
    if cfg.assessment != "off":
        # V05-13: model judgement between the Gate and the ticket. The Gate
        # already accepted; assessment may still ignore/stop/duplicate or
        # (auto only) open with the judged strength. dry_run never opens.
        from polyopus.domains.intake import assessment

        outcome = assessment.run_for_trigger(
            conn, store, source, trigger,
            gate_explicit=bool(cfg.explicit_patterns),
            dry_run=cfg.assessment == "dry_run",
        )
        if outcome.status != "decided" or outcome.decision != "accept":
            return None
        if outcome.duplicate_of or cfg.assessment == "dry_run":
            return None
        return open_ticket(conn, store, source, trigger_id,
                           strength=outcome.strength,
                           matched_rules=[f"assessment:{outcome.eval_id}"],
                           scope=list(outcome.scope))
    return open_ticket(conn, store, source, trigger_id)
