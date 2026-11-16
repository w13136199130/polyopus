"""Outbox reply dispatcher (v0.5 card V05-08).

Third embedded loop. Claims `topic='reply'` rows from the platform outbox
and POSTs them to the source's callback URL. The ticket worker only ever
INSERTs (enqueue at the tail of run_assignment); delivery happens here,
so an unreachable callback can pile rows up in the outbox but never
blocks a turn.

Retry ladder per docs/16 §3: 0.5/1/2s + jitter, at most 3 attempts, then
dead-letter (`status='failed'`). 429 honors Retry-After; permanent 4xx
and undeliverable rows (source gone / bad URL) dead-letter immediately.
Terminal outcomes append `channel.sent` / `channel.failed` (docs/11 §6.8)
on the ticket's thread for audit (V05-19 seam).
"""

from __future__ import annotations

import random
import sqlite3
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from polyopus.domains.outbound import service as outbound
from polyopus.domains.outbound.port import ReplyTransport
from polyopus.platform.events.store import EventStore
from polyopus.platform.queue.outbox import Outbox
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.outboxworker")

POLL_SECONDS = 0.5
LEASE_SECONDS = 30
MAX_ATTEMPTS = 3
RETRY_DELAYS = (0.5, 1.0, 2.0)  # docs/16 §3; tests shrink this for speed
JITTER_SECONDS = 0.25
TOPIC_LIMITS = {"reply": 4}


def _retry_delay(item_attempt: int, retry_after: float | None) -> float:
    index = min(max(item_attempt - 1, 0), len(RETRY_DELAYS) - 1)
    delay = RETRY_DELAYS[index] + random.uniform(0, JITTER_SECONDS)
    if retry_after is not None:
        delay = max(delay, retry_after)
    return delay


def _notify(
    store: EventStore, conn: sqlite3.Connection, item_id: str,
    payload: Mapping[str, Any], kind: str, *, code: str, message: str | None,
    tenant_id: str = outbound.TENANT,
) -> None:
    ticket_id = payload.get("ticketId")
    if not ticket_id:
        return  # test probes have no thread to journal on
    from polyopus.domains.tickets.service import thread_of_ticket

    thread_id = thread_of_ticket(conn, str(ticket_id))
    fields: dict[str, object] = {
        "channel_id": payload.get("sourceId"),
        "ticket_id": ticket_id,
        "target": {"kind": "webhook", "id": payload.get("sourceId")},
        "idem_key": item_id,
    }
    if kind == "channel.sent":
        fields["external_id"] = payload.get("reportId")
    else:
        fields["code"] = code
        fields["message"] = message
        fields["retryable"] = False
    store.append(thread_id, kind, fields, tenant_id=tenant_id)

    # V05-19: terminal delivery outcome is auditable by ticket. `record` is
    # best-effort and never lets an audit failure break the delivery loop.
    from polyopus.domains.audit import service as audit

    sent = kind == "channel.sent"
    audit.record(
        conn,
        tenant_id=tenant_id,
        action="reply.sent" if sent else "reply.failed",
        result="ok" if sent else "failed",
        actor_id="system",
        resource_type="ticket",
        resource_id=str(ticket_id),
        ticket_id=str(ticket_id),
        detail={
            "eventId": item_id,
            "reportId": payload.get("reportId"),
            "sourceId": payload.get("sourceId"),
            "code": code,
            "message": message,
        },
    )


def dispatch_once(
    conn: sqlite3.Connection,
    transport: ReplyTransport | None = None,
    *,
    store: EventStore | None = None,
) -> dict[str, int]:
    """Lease and deliver one batch. Returns {"sent","retried","dead"} counts."""
    box = Outbox(conn)
    store = store or EventStore(conn)
    stats = {"sent": 0, "retried": 0, "dead": 0}
    for item in box.lease_batch(lease_seconds=LEASE_SECONDS, limits=TOPIC_LIMITS):
        if str(item.payload.get("kind")) != "reply":
            box.mark_dead(item)  # unknown shape: retrying cannot fix it
            stats["dead"] += 1
            continue
        target = outbound.resolve_delivery(conn, item.payload)
        if target is None:
            box.mark_dead(item)
            _notify(store, conn, item.event_id, item.payload, "channel.failed",
                    code="undeliverable", message="source or callback_url gone",
                    tenant_id=item.tenant_id)
            stats["dead"] += 1
            continue
        url, secret = target
        result = outbound.send(url, secret, item.payload, transport)
        outcome = outbound.outcome_of(result)
        if outcome == "sent":
            box.mark_sent(item)
            _notify(store, conn, item.event_id, item.payload, "channel.sent",
                    code="ok", message=None, tenant_id=item.tenant_id)
            stats["sent"] += 1
        elif outcome == "dead":
            box.mark_dead(item)
            _notify(store, conn, item.event_id, item.payload, "channel.failed",
                    code=f"http_{result.status_code}", message=result.error,
                    tenant_id=item.tenant_id)
            stats["dead"] += 1
        else:
            backoff = _retry_delay(item.attempts, result.retry_after)
            if box.mark_failed(item, max_attempts=MAX_ATTEMPTS, backoff=backoff) == "failed":
                _notify(store, conn, item.event_id, item.payload, "channel.failed",
                        code=f"http_{result.status_code}", message=result.error,
                        tenant_id=item.tenant_id)
                stats["dead"] += 1
            else:
                stats["retried"] += 1
    return stats


def run_outbox_loop(
    db_path_factory: Callable[[], Path],
    *,
    stop: threading.Event,
    poll_seconds: float = POLL_SECONDS,
    transport: ReplyTransport | None = None,
) -> int:
    """Deliver queued replies until stopped; returns how many were sent."""
    from polyopus.platform.db.migrator import connect

    sent = 0
    conn: sqlite3.Connection | None = None
    while not stop.is_set():
        try:
            if conn is None:
                conn = connect(db_path_factory())
            stats = dispatch_once(conn, transport)
            sent += stats["sent"]
            if stats == {"sent": 0, "retried": 0, "dead": 0}:
                stop.wait(poll_seconds)
        except Exception as exc:  # noqa: BLE001 - the loop must survive
            tlog.log(logger, 40, "outbox_worker_error", error=str(exc))
            conn = None  # connection may be poisoned
            stop.wait(poll_seconds)
    if conn is not None:
        conn.close()
    return sent


def start_embedded(db_path_factory: Callable[[], Path]) -> threading.Event:
    stop = threading.Event()
    thread = threading.Thread(
        target=run_outbox_loop,
        args=(db_path_factory,),
        kwargs={"stop": stop},
        name="outbox-worker",
        daemon=True,
    )
    thread.start()
    return stop
