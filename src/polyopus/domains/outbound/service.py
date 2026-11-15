"""Outbound replies: Report ready/blocked/failed -> callback POST (V05-08).

Mirrors the inbound webhook contract (docs/09 §1.1): HMAC-SHA256 over
canonical JSON in `X-Signature`, plus `X-Timestamp` and `Idempotency-Key`
so receivers can reject replays and de-duplicate. The source secret never
lands in the outbox payload (SEC-03): it is re-read from the source at
send time, so rotating a source secret also fixes queued replies.

Enqueue is a single INSERT on the ticket worker's connection; the POST
itself happens in the outbox loop thread — an unreachable callback can
pile rows up in the outbox but never blocks a turn (V05-08 risk note).
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import re
import sqlite3
import time
import urllib.parse
from collections.abc import Mapping
from typing import Any

from polyopus.domains.intake import service as intake
from polyopus.domains.outbound import shaper
from polyopus.domains.outbound.port import DeliveryResult, ReplyTransport, UrllibTransport
from polyopus.platform.errors import AppError
from polyopus.platform.queue.outbox import Outbox, OutboxItem

TENANT = "default"
TOPIC = "reply"
# only these Report states reply back; `waiting` still owes a human
REPLY_STATES = ("ready", "blocked", "failed")
SEND_TIMEOUT_SECONDS = 5.0

# 4xx the receiver will never accept on retry (429 excluded: throttling)
PERMANENT_HTTP = frozenset({400, 401, 403, 404, 405, 410, 422})

_ABSOLUTE_PATH_RE = re.compile(
    r"(?<![A-Za-z])[A-Za-z]:[\\/][^\s\"']*"  # windows drive paths E:\x / C:/x
    r"|/(?:home|Users|tmp|etc|var|root|opt|srv)/[^\s\"']*"  # unix prefixes
)


# ---- wire format ------------------------------------------------------------


def canonical(payload: Mapping[str, Any]) -> bytes:
    """Same canonical form the inbound webhook signature uses."""
    return json.dumps(dict(payload), sort_keys=True, separators=(",", ":")).encode()


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def redact(text: str) -> str:
    """Strip absolute paths from anything that leaves the instance
    (V05-08 acceptance: 回复内容不含密钥/绝对路径)."""
    return _ABSOLUTE_PATH_RE.sub("[path]", text)


def reply_event_id(ticket_id: str, report_id: str) -> str:
    """docs/09 §10.1 idem key semantics: one delivery per (ticket, report);
    doubles as the outbox event_id so re-enqueues are no-ops."""
    return f"reply:{ticket_id}:{report_id}"


# ---- callback URL policy (docs/09 §11 SSRF) ---------------------------------


def _ip_blocked(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False  # hostname: v0.5 does not resolve DNS (documented gap)
    if addr.is_loopback:
        return False  # dev/test receivers bind 127.0.0.1
    return (
        addr.is_private
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def validate_callback_url(url: str) -> str:
    """Eager validation for config surfaces (create source / test-reply).
    The dispatcher validates again at send time and dead-letters on miss."""
    candidate = url.strip()
    parsed = urllib.parse.urlsplit(candidate)
    if parsed.scheme not in ("http", "https"):
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "callbackUrl", "reason": "scheme must be http(s)"},
        )
    host = parsed.hostname or ""
    if not host:
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "callbackUrl", "reason": "missing host"},
        )
    if _ip_blocked(host):
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "callbackUrl",
                     "reason": "private/link-local hosts are blocked (docs/09 §11)"},
        )
    return candidate


# ---- payload ----------------------------------------------------------------


def build_payload(
    *,
    source_id: str,
    ticket_id: str,
    report_id: str,
    state: str,
    title: str,
    summary: str,
    base_url: str,
    reply_style: str = shaper.DEFAULT_STYLE,
) -> dict[str, Any]:
    """Whitelist-only fields; the body comes from V05-15's shaper, so one
    Report renders differently per `source.reply_style`."""
    link = f"{base_url}/tasks?ticketId={ticket_id}"
    rendered = shaper.shape(
        reply_style,
        shaper.ReportView(
            ticket_id=ticket_id,
            report_id=report_id,
            state=state,
            title=str(title),
            summary=str(summary),
            link=link,
        ),
    )
    # The link is a URL, not free text: never run it through path redaction.
    # Whitelist renderer output too, so a future renderer cannot smuggle
    # internal fields (trace/tool args) into the envelope.
    body = {
        key: redact(str(value))
        for key, value in rendered.items()
        if key in ("title", "summary", "text")
    }
    return {
        "kind": "reply",
        "sourceId": source_id,
        "ticketId": ticket_id,
        "reportId": report_id,
        "state": state,
        **body,
        "link": link,
        "idemKey": reply_event_id(ticket_id, report_id),
        "sentAt": int(time.time()),
    }


def on_report(
    conn: sqlite3.Connection,
    ticket_id: str,
    report_id: str,
    state: str,
    summary: str,
) -> int | None:
    """Called at the tail of run_assignment. Returns the outbox row id, or
    None when this ticket owes no reply (no source / no callback_url /
    non-reply state). Never raises for a missing callback: only an INSERT
    can fail here and the caller guards with try/except anyway."""
    if state not in REPLY_STATES:
        return None
    ticket = conn.execute(
        "SELECT source_id, title FROM tickets WHERE ticket_id = ?", (ticket_id,)
    ).fetchone()
    if ticket is None or ticket["source_id"] is None:
        return None
    source = conn.execute(
        "SELECT * FROM sources WHERE tenant_id = ? AND source_id = ?",
        (TENANT, str(ticket["source_id"])),
    ).fetchone()
    if source is None:
        return None
    cfg = intake.config_of(source)
    if not cfg.callback_url:
        return None

    # V05-15: render the Report row itself, not the caller's copy — the same
    # Report can land on sources with different reply styles. `_record_report`
    # commits before `_enqueue_reply`, so the row is always visible here.
    report = conn.execute(
        "SELECT state, summary FROM reports WHERE tenant_id = ? AND report_id = ?",
        (TENANT, report_id),
    ).fetchone()
    if report is not None:
        state = str(report["state"])
        summary = str(report["summary"])
        if state not in REPLY_STATES:
            return None

    from polyopus.config import load_settings

    payload = build_payload(
        source_id=cfg.source_id,
        ticket_id=ticket_id,
        report_id=report_id,
        state=state,
        title=str(ticket["title"]),
        summary=summary,
        base_url=load_settings().public_base_url,
        reply_style=cfg.reply_style,
    )
    return Outbox(conn).enqueue(
        TENANT, TOPIC, payload, event_id=str(payload["idemKey"])
    )


# ---- delivery ----------------------------------------------------------------


def resolve_delivery(
    conn: sqlite3.Connection, payload: Mapping[str, Any]
) -> tuple[str, str] | None:
    """(url, secret) for this payload, or None when it can never be
    delivered (source deleted / callback_url removed / invalid URL) —
    the dispatcher dead-letters those instead of retrying."""
    source_id = str(payload.get("sourceId", ""))
    row = conn.execute(
        "SELECT * FROM sources WHERE tenant_id = ? AND source_id = ?",
        (TENANT, source_id),
    ).fetchone()
    if row is None:
        return None
    cfg = intake.config_of(row)
    if not cfg.callback_url:
        return None
    try:
        url = validate_callback_url(cfg.callback_url)
    except AppError:
        return None
    return url, cfg.secret


def send(
    url: str,
    secret: str,
    payload: Mapping[str, Any],
    transport: ReplyTransport | None = None,
    *,
    timeout: float = SEND_TIMEOUT_SECONDS,
) -> DeliveryResult:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "X-Timestamp": str(int(time.time())),
        "Idempotency-Key": str(payload.get("idemKey", "")),
        "X-Polyopus-Kind": str(payload.get("kind", TOPIC)),
    }
    body = canonical(payload)
    if secret:
        headers["X-Signature"] = sign(secret, body)  # mirrors inbound X-Signature
    return (transport or UrllibTransport()).post(url, body, headers, timeout=timeout)


def outcome_of(result: DeliveryResult) -> str:
    """"sent" | "retry" | "dead": 5xx and transport errors retry (bounded by
    max_attempts), non-429 4xx never succeeds on retry."""
    if result.ok:
        return "sent"
    if result.status_code is None or result.status_code == 429:
        return "retry"
    if 400 <= result.status_code < 500:
        return "dead"
    return "retry"


# ---- API surface --------------------------------------------------------------


def test_reply(
    conn: sqlite3.Connection,
    source_id: str,
    override_url: str | None = None,
    transport: ReplyTransport | None = None,
) -> dict[str, Any]:
    """Synchronous single-shot probe: same signing scheme as a real reply,
    `kind:"test"` payload, never touches the outbox."""
    source = intake.get_source(conn, source_id)  # SOURCE_NOT_FOUND / PAUSED
    cfg = intake.config_of(source)
    raw = (override_url or cfg.callback_url or "").strip()
    if not raw:
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "callbackUrl",
                     "reason": "source has no callback_url configured"},
        )
    url = validate_callback_url(raw)
    payload = {
        "kind": "test",
        "sourceId": cfg.source_id,
        "message": "polyopus test reply",
        "idemKey": f"test:{cfg.source_id}:{time.time_ns()}",
        "sentAt": int(time.time()),
    }
    result = send(url, cfg.secret, payload, transport)
    out: dict[str, Any] = {
        "delivered": result.ok,
        "statusCode": result.status_code,
        "callbackUrl": url,
    }
    if result.error:
        out["error"] = result.error
    return out


def list_outbox(
    conn: sqlite3.Connection,
    *,
    status: str | None = None,
    topic: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    where: list[str] = ["1=1"]
    params: list[Any] = []
    if status:
        where.append("status = ?")
        params.append(status)
    if topic:
        where.append("topic = ?")
        params.append(topic)
    params.append(limit)
    rows = conn.execute(
        "SELECT event_id, topic, status, attempts, next_retry_at, created_at, "
        "json_extract(payload_json, '$.ticketId') AS ticket_id "
        f"FROM outbox WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT ?",
        params,
    ).fetchall()
    return [
        {
            "eventId": str(r["event_id"]),
            "topic": str(r["topic"]),
            "status": str(r["status"]),
            "attempts": int(r["attempts"]),
            "nextRetryAt": r["next_retry_at"],
            "createdAt": r["created_at"],
            "ticketId": r["ticket_id"],
        }
        for r in rows
    ]


__all__ = [
    "OutboxItem",
    "TOPIC",
    "REPLY_STATES",
    "build_payload",
    "canonical",
    "list_outbox",
    "on_report",
    "outcome_of",
    "redact",
    "reply_event_id",
    "resolve_delivery",
    "send",
    "sign",
    "test_reply",
    "validate_callback_url",
]
