"""Async tool execution (V05-17).

An `execution="async"` tool is not run inside the turn's worker slot. The
engine persists a `tool_calls` row (status=running), starts a daemon thread
with its own SQLite connection, and hands the model an immediate handle.
When the job settles it writes the contract event **with the original
turn_id**:

- `tool.async_completed` / `tool.async_cancelled` / `tool.failed`;
- the turn is still running -> the event lands in its stream;
- the turn already ended -> the event stays in the trajectory only (no
  continuation turn, per docs/48 V05-17 risk note).

Timeouts and cancels are observable: `tool_calls.status=failed` plus
`error_code=timeout|cancelled`, and the matching event.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from polyopus.kernel.tools import ToolError, dispatch
from polyopus.platform.db import migrator
from polyopus.platform.events.store import EventStore
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.async_tools")

ARTIFACT_INLINE_LIMIT = 8000
DEFAULT_TIMEOUT_SECONDS = 300.0

# tool_call_id -> cancellation flag; the DB row's status is the source of truth.
_CANCEL_LOCK = threading.Lock()
_CANCEL: dict[str, threading.Event] = {}


def _db_path(conn: sqlite3.Connection) -> Path:
    row = conn.execute("PRAGMA database_list").fetchone()
    raw = str(row[2]) if row is not None else ""
    if not raw or raw == ":memory:":
        raise RuntimeError("async tools need a file-backed SQLite database")
    return Path(raw)


def _thread_of(conn: sqlite3.Connection, turn_id: str) -> str:
    row = conn.execute(
        "SELECT thread_id FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()
    return str(row[0]) if row is not None else ""


def _artifact_for(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    thread_id: str,
    turn_id: str,
    run_id: str,
    tool_call_id: str,
    output_json: str,
) -> str | None:
    """Large async results get an artifact row (tool_calls keeps the JSON)."""
    if len(output_json) <= ARTIFACT_INLINE_LIMIT:
        return None
    artifact_id = "ar_" + secrets.token_hex(8)
    conn.execute(
        "INSERT INTO artifacts "
        "(artifact_id, tenant_id, thread_id, turn_id, run_id, kind, ref, mime,"
        " size, sha256, created_at) VALUES (?, ?, ?, ?, ?, 'report', ?, ?, ?, ?, ?)",
        (artifact_id, tenant_id, thread_id, turn_id, run_id,
         f"tool_call:{tool_call_id}", "application/json", len(output_json),
         hashlib.sha256(output_json.encode()).hexdigest(), int(time.time())),
    )
    return artifact_id


def _finalize(
    conn: sqlite3.Connection,
    *,
    tool_call_id: str,
    handle_id: str,
    tenant_id: str,
    thread_id: str,
    turn_id: str,
    run_id: str,
    status: str,  # completed | failed | timeout | cancelled
    output: dict[str, Any] | None = None,
    error_code: str | None = None,
    error_message: str = "",
) -> bool:
    """CAS running -> terminal; append the matching contract event. Returns
    False when a cancel already won the race (no second event)."""
    output_json = json.dumps(output, ensure_ascii=False) if output is not None else None
    artifact_ids: list[str] = []
    if output_json is not None:
        artifact_id = _artifact_for(
            conn, tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
            run_id=run_id, tool_call_id=tool_call_id, output_json=output_json,
        )
        if artifact_id:
            artifact_ids.append(artifact_id)
    db_status = "completed" if status == "completed" else "failed"
    changed = conn.execute(
        "UPDATE tool_calls SET status = ?, result_json = ?, ended_at = ?, "
        "error_code = ? WHERE tool_call_id = ? AND status = 'running'",
        (db_status, output_json, int(time.time()), error_code, tool_call_id),
    ).rowcount
    conn.commit()
    if not changed:
        return False

    store = EventStore(conn)
    if status == "completed":
        body: dict[str, Any] = dict(output or {})
        if artifact_ids:
            body["artifact_ids"] = artifact_ids
        store.append(
            thread_id,
            "tool.async_completed",
            {"tool_call_id": tool_call_id, "handle_id": handle_id,
             "output": body},
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        )
    elif status == "cancelled":
        store.append(
            thread_id,
            "tool.async_cancelled",
            {"tool_call_id": tool_call_id, "handle_id": handle_id,
             "reason": error_message or "cancelled"},
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        )
    else:
        store.append(
            thread_id,
            "tool.failed",
            {"tool_call_id": tool_call_id,
             "code": error_code or "TOOL_FAILED",
             "message": error_message, "retryable": False},
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        )
    return True


def _run_job(
    *,
    db_path: Path,
    tool_call_id: str,
    handle_id: str,
    internal: str,
    arguments_json: str,
    workspace: Path,
    timeout_seconds: float,
    cancel: threading.Event,
    tenant_id: str,
    thread_id: str,
    turn_id: str,
    run_id: str,
) -> None:
    conn = migrator.connect(db_path)
    try:
        box: dict[str, Any] = {}

        def invoke() -> None:
            try:
                box["result"] = dispatch(internal, workspace, arguments_json)
            except BaseException as exc:  # noqa: BLE001 - relayed to the row
                box["error"] = exc

        # The tool may block (sleep/CI/browser). A daemon runner thread +
        # bounded join gives us an observable timeout without killing the
        # process; a timed-out tool is best-effort abandoned.
        runner = threading.Thread(
            target=invoke, name=f"async-tool-run-{tool_call_id[-6:]}", daemon=True
        )
        runner.start()
        runner.join(timeout_seconds)

        if cancel.is_set():
            _finalize(
                conn, tool_call_id=tool_call_id, handle_id=handle_id,
                tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
                run_id=run_id, status="cancelled", error_code="cancelled",
                error_message="cancelled by user",
            )
            return
        if runner.is_alive():
            _finalize(
                conn, tool_call_id=tool_call_id, handle_id=handle_id,
                tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
                run_id=run_id, status="timeout", error_code="timeout",
                error_message=f"tool exceeded {timeout_seconds}s",
            )
            return
        exc = box.get("error")
        if exc is not None:
            code = exc.code if isinstance(exc, ToolError) else "TOOL_FAILED"
            _finalize(
                conn, tool_call_id=tool_call_id, handle_id=handle_id,
                tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
                run_id=run_id, status="failed", error_code=code,
                error_message=str(exc),
            )
            return
        result = box["result"]
        _finalize(
            conn, tool_call_id=tool_call_id, handle_id=handle_id,
            tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
            run_id=run_id, status="completed", output=result.output,
        )
    except Exception as exc:  # noqa: BLE001 - a dead job must stay visible
        tlog.log(logger, 40, "async_tool_job_error", tool_call_id=tool_call_id,
                 error=str(exc))
    finally:
        with _CANCEL_LOCK:
            _CANCEL.pop(tool_call_id, None)
        conn.close()


def start_async_call(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    internal: str,
    arguments_json: str,
    risk: str,
    workspace: Path,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    tenant_id: str,
    thread_id: str,
    turn_id: str,
    run_id: str,
) -> dict[str, Any]:
    """Persist + start one async tool call; returns the handle immediately."""
    tool_call_id = "tc_" + secrets.token_hex(8)
    # The handle is the tool_call_id: one stable identifier for the DB row,
    # the start/completion events, and the caller's poll token.
    handle_id = tool_call_id
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO tool_calls
          (tool_call_id, tenant_id, turn_id, run_id, tool_key, args_json,
           status, risk, started_at)
        VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
        """,
        (tool_call_id, tenant_id, turn_id, run_id, internal, arguments_json,
         risk, now),
    )
    conn.commit()
    cancel = threading.Event()
    with _CANCEL_LOCK:
        _CANCEL[tool_call_id] = cancel

    store.append(
        thread_id,
        "tool.started",
        {
            "tool_call_id": tool_call_id,
            "name": internal,
            "source": "builtin",
            "risk": risk,
            "args_digest": str(len(arguments_json)),
            "args_preview": arguments_json[:200],
        },
        tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
    )
    store.append(
        thread_id,
        "tool.async_started",
        {"tool_call_id": tool_call_id, "handle_id": handle_id},
        tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
    )
    threading.Thread(
        target=_run_job,
        kwargs={
            "db_path": _db_path(conn),
            "tool_call_id": tool_call_id,
            "handle_id": handle_id,
            "internal": internal,
            "arguments_json": arguments_json,
            "workspace": workspace,
            "timeout_seconds": timeout_seconds,
            "cancel": cancel,
            "tenant_id": tenant_id,
            "thread_id": thread_id,
            "turn_id": turn_id,
            "run_id": run_id,
        },
        name=f"async-tool-{tool_call_id[-6:]}",
        daemon=True,
    ).start()
    return {
        "handle_id": handle_id,
        "tool_call_id": tool_call_id,
        "status": "running",
        "poll_after_s": 5,
    }


def cancel_async(
    conn: sqlite3.Connection, store: EventStore, tool_call_id: str
) -> bool:
    """Best-effort cancel; the DB CAS decides whether an event is emitted."""
    row = conn.execute(
        "SELECT * FROM tool_calls WHERE tool_call_id = ?", (tool_call_id,)
    ).fetchone()
    if row is None or str(row["status"]) != "running":
        return False
    with _CANCEL_LOCK:
        flag = _CANCEL.get(tool_call_id)
    if flag is not None:
        flag.set()
    changed = conn.execute(
        "UPDATE tool_calls SET status = 'failed', error_code = 'cancelled', "
        "ended_at = ? WHERE tool_call_id = ? AND status = 'running'",
        (int(time.time()), tool_call_id),
    ).rowcount
    conn.commit()
    if not changed:
        return False
    thread_id = _thread_of(conn, str(row["turn_id"]))
    if thread_id:
        store.append(
            thread_id,
            "tool.async_cancelled",
            {
                "tool_call_id": tool_call_id,
                "handle_id": tool_call_id,
                "reason": "cancelled by user",
            },
            tenant_id=str(row["tenant_id"]),
            turn_id=str(row["turn_id"]),
            run_id=str(row["run_id"]) if row["run_id"] else None,
        )
    return True


def cancel_for_turn(
    conn: sqlite3.Connection, store: EventStore, turn_id: str
) -> int:
    rows = conn.execute(
        "SELECT tool_call_id FROM tool_calls "
        "WHERE turn_id = ? AND status = 'running'",
        (turn_id,),
    ).fetchall()
    return sum(cancel_async(conn, store, str(r[0])) for r in rows)


def cancel_for_thread(
    conn: sqlite3.Connection, store: EventStore, thread_id: str
) -> int:
    rows = conn.execute(
        "SELECT tool_call_id FROM tool_calls WHERE status = 'running' "
        "AND turn_id IN (SELECT turn_id FROM turns WHERE thread_id = ?)",
        (thread_id,),
    ).fetchall()
    return sum(cancel_async(conn, store, str(r[0])) for r in rows)


__all__ = [
    "ARTIFACT_INLINE_LIMIT",
    "cancel_async",
    "cancel_for_thread",
    "cancel_for_turn",
    "start_async_call",
]
