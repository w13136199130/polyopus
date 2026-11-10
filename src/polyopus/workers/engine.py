"""Turn engine: FakeModel stream -> events -> approval pause/resume (slice ①).

The engine runs a queued turn:
  load turn -> stream reply as message.delta/message.completed ->
  (optional) request approval before "executing" the tool ->
  wait (turn status waiting_approval, lease released) ->
  resolved -> resume from the approval step -> turn.finished.

Kernel rule (ADR-007) is bent deliberately here: the engine lives in workers/
and only talks to domains via their services; it never imports api.
"""

from __future__ import annotations

import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import cast

from polyopus.domains.agents import models as agents_registry
from polyopus.domains.attention import service as attention
from polyopus.kernel.models import FakeModel
from polyopus.kernel.models import gateway as gateway_types
from polyopus.platform.errors import AppError
from polyopus.platform.events import projection
from polyopus.platform.events.store import EventStore
from polyopus.platform.queue import lease


@dataclass(frozen=True)
class EngineConfig:
    require_approval: bool = False
    approval_tool: str = "fs.write"
    chunk_words: int = 4
    delay_seconds: float = 0.0
    model_hint: str | None = None


def _now() -> int:
    return int(time.time())


def _turn(conn: sqlite3.Connection, turn_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM turns WHERE turn_id = ?", (turn_id,)).fetchone()
    if row is None:
        raise AppError("TURN_NOT_FOUND", details={"turn_id": turn_id})
    return cast(sqlite3.Row, row)


def _user_content(conn: sqlite3.Connection, turn_id: str) -> str:
    row = conn.execute(
        "SELECT content FROM messages WHERE turn_id = ? AND role = 'user' "
        "ORDER BY seq LIMIT 1",
        (turn_id,),
    ).fetchone()
    return str(row[0]) if row else ""


def _set_turn_status(
    conn: sqlite3.Connection, turn_id: str, status: str, now: int | None = None
) -> None:
    conn.execute(
        "UPDATE turns SET status = ?, updated_at = COALESCE(?, updated_at) "
        "WHERE turn_id = ?",
        (status, now, turn_id),
    )
    conn.commit()


async def run_turn(
    conn: sqlite3.Connection,
    store: EventStore,
    turn_id: str,
    *,
    owner: str = "engine",
    config: EngineConfig | None = None,
    model: FakeModel | None = None,
    registry: agents_registry.Registry | None = None,
    trace_id: str | None = None,
) -> str:
    """Run one queued turn to completion or to an approval pause.

    Returns "completed" or "waiting_approval".
    """
    cfg = config or EngineConfig()
    registry = registry or agents_registry.Registry(conn)
    resolved = registry.resolve(cfg.model_hint)
    turn = _turn(conn, turn_id)
    thread_id = str(turn["thread_id"])
    tenant_id = str(turn["tenant_id"])

    existing = conn.execute(
        "SELECT status FROM runs WHERE turn_id = ? ORDER BY attempt DESC LIMIT 1",
        (turn_id,),
    ).fetchone()
    if existing is not None and str(existing[0]) in ("leased", "running", "waiting"):
        raise AppError("TURN_ACTIVE", details={"turn_id": turn_id, "status": str(existing[0])})
    attempt = 1 if existing is None else 2  # retry after a finished run keeps history

    run_id = "run_" + secrets.token_hex(8)
    now = _now()
    conn.execute(
        """
        INSERT INTO runs
          (tenant_id, run_id, turn_id, attempt, status, lease_owner, lease_until,
           heartbeat_at, last_step_idx, started_at)
        VALUES (?, ?, ?, ?, 'leased', ?, ?, ?, -1, ?)
        """,
        (tenant_id, run_id, turn_id, attempt, owner, now + 60, now, now),
    )
    conn.commit()
    lease.claim(conn, run_id, owner, 60)
    _set_turn_status(conn, turn_id, "running", now)
    store.append(
        thread_id,
        "turn.started",
        {"turn_id": turn_id, "run_id": run_id, "attempt": attempt, "model": resolved.model},
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )

    # step 0: model stream -> message events
    message_id = "msg_" + secrets.token_hex(8)
    projection.apply(
        conn,
        store.append(
            thread_id,
            "message.started",
            {"message_id": message_id, "role": "assistant", "index": 0},
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        ),
    )
    request = gateway_types.ModelRequest(
        model=resolved.model,
        messages=(gateway_types.ChatMessage(role="user", content=_user_content(conn, turn_id)),),
        max_output_tokens=2048,
        tenant_id=tenant_id,
        trace_id=trace_id,
    )
    text = ""
    index = 0
    input_tokens = output_tokens = cached_tokens = 0
    first_token_ms: int | None = None
    started = time.monotonic()
    source: gateway_types.ModelGateway
    if model is not None:
        source = model
    elif resolved.fake:
        source = FakeModel(chunk_words=cfg.chunk_words, delay_seconds=cfg.delay_seconds)
    else:
        source = resolved.gateway
    async for delta in source.stream(request):
        if isinstance(delta, gateway_types.TextDelta):
            if first_token_ms is None:
                first_token_ms = int((time.monotonic() - started) * 1000)
            text += delta.text
            store.append(
                thread_id,
                "message.delta",
                {"message_id": message_id, "index": index, "text": delta.text},
                tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
            )
            index += 1
        elif isinstance(delta, gateway_types.UsageDelta):
            input_tokens += delta.input_tokens
            output_tokens += delta.output_tokens
            cached_tokens += delta.cached_tokens
    projection.apply(
        conn,
        store.append(
            thread_id,
            "message.completed",
            {
                "message_id": message_id,
                "blocks": [{"type": "text", "text": text}],
                "finish_reason": "stop",
            },
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        ),
    )
    conn.commit()
    conn.execute("UPDATE runs SET last_step_idx = 0 WHERE run_id = ?", (run_id,))
    conn.commit()

    _record_usage(
        conn, store,
        tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
        model=resolved.model,
        input_tokens=input_tokens, output_tokens=output_tokens,
        cached_tokens=cached_tokens, first_token_ms=first_token_ms,
    )

    # step 1: optional tool gate
    if cfg.require_approval:
        _, attention_id = attention.request(
            conn,
            store,
            tenant_id=tenant_id,
            thread_id=thread_id,
            turn_id=turn_id,
            run_id=run_id,
            step_idx=1,
            req=attention.ApprovalRequest(
                tool=cfg.approval_tool,
                args_preview=_user_content(conn, turn_id)[:200],
                risk="high",
                summary="需要批准后写入",
            ),
        )
        _set_turn_status(conn, turn_id, "waiting_approval")
        lease.release(conn, run_id, owner)
        conn.execute("UPDATE runs SET status = 'waiting' WHERE run_id = ?", (run_id,))
        conn.commit()
        return "waiting_approval"

    _finish(conn, store, tenant_id=tenant_id, thread_id=thread_id,
            turn_id=turn_id, run_id=run_id, status="completed")
    return "completed"


def resume_after_approval(
    conn: sqlite3.Connection,
    store: EventStore,
    turn_id: str,
    *,
    owner: str = "engine",
    decision: str,
) -> str:
    """Continue a turn after its approval was resolved."""
    turn = _turn(conn, turn_id)
    thread_id = str(turn["thread_id"])
    tenant_id = str(turn["tenant_id"])
    run_row = conn.execute(
        "SELECT * FROM runs WHERE turn_id = ? ORDER BY attempt DESC LIMIT 1", (turn_id,)
    ).fetchone()
    if run_row is None:
        raise AppError("TURN_NOT_FOUND", details={"turn_id": turn_id})
    run_id = str(run_row["run_id"])

    status = "completed" if decision == "denied" else "completed"
    _set_turn_status(conn, turn_id, "running")
    store.append(
        thread_id,
        "turn.resumed",
        {"turn_id": turn_id, "run_id": run_id, "from_step": 1, "reason": "approval"},
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )
    _finish(conn, store, tenant_id=tenant_id, thread_id=thread_id,
            turn_id=turn_id, run_id=run_id, status=status,
            note=f"approval {decision}")
    return status


def _record_usage(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    thread_id: str,
    turn_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int,
    first_token_ms: int | None,
) -> None:
    entry_id = "us_" + secrets.token_hex(8)
    conn.execute(
        """
        INSERT INTO usage_ledger
          (tenant_id, entry_id, turn_id, model, input_tokens, output_tokens,
           cache_read, latency_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tenant_id, entry_id, turn_id, model, input_tokens, output_tokens,
         cached_tokens, first_token_ms, _now()),
    )
    conn.commit()
    store.append(
        thread_id,
        "usage.recorded",
        {
            "scope": "turn",
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cached_tokens": cached_tokens,
            "cost_micros": 0,
            "currency": "CNY",
            "price_version": "unpriced",
        },
        tenant_id=tenant_id,
        turn_id=turn_id,
    )


def _finish(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    tenant_id: str,
    thread_id: str,
    turn_id: str,
    run_id: str,
    status: str,
    note: str | None = None,
) -> None:
    now = _now()
    # events are the truth: append turn.finished BEFORE flipping row status,
    # so no reader can observe status=completed without the terminal event.
    store.append(
        thread_id,
        "turn.finished",
        {
            "turn_id": turn_id,
            "run_id": run_id,
            "status": status,
            "duration_ms": 0,
            "finish_reason": "stop",
        },
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )
    conn.execute(
        "UPDATE runs SET status = ?, finished_at = ?, lease_owner = NULL, "
        "lease_until = NULL WHERE run_id = ?",
        (status, now, run_id),
    )
    _set_turn_status(conn, turn_id, status, now)
    _ = note  # reserved for richer finish payloads
