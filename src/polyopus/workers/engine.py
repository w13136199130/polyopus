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

from polyopus.domains.attention import service as attention
from polyopus.kernel.models import FakeModel
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
) -> str:
    """Run one queued turn to completion or to an approval pause.

    Returns "completed" or "waiting_approval".
    """
    cfg = config or EngineConfig()
    fake = model or FakeModel(chunk_words=cfg.chunk_words, delay_seconds=cfg.delay_seconds)
    turn = _turn(conn, turn_id)
    thread_id = str(turn["thread_id"])
    tenant_id = str(turn["tenant_id"])

    run_id = "run_" + secrets.token_hex(8)
    now = _now()
    conn.execute(
        """
        INSERT INTO runs
          (tenant_id, run_id, turn_id, attempt, status, lease_owner, lease_until,
           heartbeat_at, last_step_idx, started_at)
        VALUES (?, ?, ?, 1, 'leased', ?, ?, ?, -1, ?)
        """,
        (tenant_id, run_id, turn_id, owner, now + 60, now, now),
    )
    conn.commit()
    lease.claim(conn, run_id, owner, 60)
    _set_turn_status(conn, turn_id, "running", now)
    store.append(
        thread_id,
        "turn.started",
        {"turn_id": turn_id, "run_id": run_id, "attempt": 1, "model": "fake"},
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
    text = ""
    index = 0

    async for chunk in fake.stream(_user_content(conn, turn_id)):
        text += chunk
        store.append(
            thread_id,
            "message.delta",
            {"message_id": message_id, "index": index, "text": chunk},
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        )
        index += 1
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

    # step 1: optional tool gate
    if cfg.require_approval:
        _set_turn_status(conn, turn_id, "waiting_approval")
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
    conn.execute(
        "UPDATE runs SET status = ?, finished_at = ?, lease_owner = NULL, "
        "lease_until = NULL WHERE run_id = ?",
        (status, now, run_id),
    )
    _set_turn_status(conn, turn_id, status, now)
    payload = {
        "turn_id": turn_id,
        "run_id": run_id,
        "status": status,
        "duration_ms": 0,
        "finish_reason": "stop",
    }
    store.append(
        thread_id,
        "turn.finished",
        payload,
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )
    _ = note  # reserved for richer finish payloads
