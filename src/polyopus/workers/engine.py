"""Turn engine: stream -> policy-gated tool loop -> approval pause/resume.

Pipeline step 6 is real now: every model tool call passes the policy engine
(allow executes, ask pauses the turn with the actual tool+args on the
approval card, deny/policy-error refuses and tells the model why). Resume
executes the approved tool, feeds the result back, and runs one final
model round. Kernel rule (ADR-007) is bent deliberately: the engine lives
in workers/ and only talks to domains via services; it never imports api.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from polyopus.domains.agents import models as agents_registry
from polyopus.domains.attention import service as attention
from polyopus.kernel.models import FakeModel
from polyopus.kernel.models import gateway as gateway_types
from polyopus.kernel.tools import (
    GATEWAY_SPECS,
    POLICY_SPECS,
    Decision,
    PolicyEngine,
    Rule,
    ToolError,
    ToolRuntime,
    default_rules,
    dispatch,
    internal_name,
)
from polyopus.platform.errors import AppError
from polyopus.platform.events import projection
from polyopus.platform.events.store import EventStore
from polyopus.platform.queue import lease


@dataclass(frozen=True)
class EngineConfig:
    chunk_words: int = 4
    delay_seconds: float = 0.0
    model_hint: str | None = None
    workspace: Path | None = None
    max_tool_rounds: int = 2
    policy_rules: tuple[Rule, ...] = ()  # empty -> default_rules()


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


@dataclass
class _StreamState:
    text: str = ""
    index: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    first_token_ms: int | None = None
    started: float = field(default_factory=time.monotonic)


async def _stream_round(
    store: EventStore,
    gateway: gateway_types.ModelGateway,
    request: gateway_types.ModelRequest,
    state: _StreamState,
    *,
    thread_id: str,
    turn_id: str,
    run_id: str,
    tenant_id: str,
    message_id: str,
) -> list[gateway_types.ToolCallDelta]:
    """Stream one model round into events; returns accumulated tool calls."""
    calls: list[gateway_types.ToolCallDelta] = []
    async for delta in gateway.stream(request):
        if isinstance(delta, gateway_types.TextDelta):
            if state.first_token_ms is None:
                state.first_token_ms = int((time.monotonic() - state.started) * 1000)
            state.text += delta.text
            store.append(
                thread_id,
                "message.delta",
                {"message_id": message_id, "index": state.index, "text": delta.text},
                tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
            )
            state.index += 1
        elif isinstance(delta, gateway_types.ToolCallDelta):
            calls.append(delta)
        elif isinstance(delta, gateway_types.UsageDelta):
            state.input_tokens += delta.input_tokens
            state.output_tokens += delta.output_tokens
            state.cached_tokens += delta.cached_tokens
    return calls


def _tool_messages_parts(
    calls: list[gateway_types.ToolCallDelta], tool_round: int
) -> gateway_types.ChatMessage:
    return gateway_types.ChatMessage(
        role="assistant",
        content="",
        tool_calls=tuple(
            gateway_types.ToolCallMessagePart(
                id=c.id or f"tc_{tool_round}",
                name=internal_name(c.name),
                arguments_json=c.arguments_json,
            )
            for c in calls
        ),
    )


def _execute_call(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    internal: str,
    arguments_json: str,
    call_id: str,
    risk: str,
    run_id: str,
    thread_id: str,
    turn_id: str,
    tenant_id: str,
    tool_round: int,
    workspace: Path,
) -> tuple[str, bool]:
    """Run one allowed tool; returns (output_json, ok). Emits tool.* events."""
    store.append(
        thread_id,
        "tool.started",
        {
            "tool_call_id": call_id,
            "name": internal,
            "source": "builtin",
            "risk": risk,
            "args_digest": str(len(arguments_json)),
            "args_preview": arguments_json[:200],
        },
        tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
    )
    now_tool = _now()
    try:
        result = dispatch(internal, workspace, arguments_json)
        output_json = json.dumps(result.output, ensure_ascii=False)
        store.append(
            thread_id,
            "tool.completed",
            {"tool_call_id": call_id, "output": result.output},
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        )
        ok = True
    except ToolError as exc:
        output_json = json.dumps({"error": exc.code, "message": str(exc)})
        store.append(
            thread_id,
            "tool.failed",
            {"tool_call_id": call_id, "code": exc.code, "message": str(exc),
             "retryable": False},
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        )
        ok = False
    conn.execute(
        """
        INSERT OR REPLACE INTO steps
          (tenant_id, step_id, run_id, idx, kind, status, input_json,
           output_json, started_at, finished_at)
        VALUES (?, ?, ?, ?, 'tool', 'completed', ?, ?, ?, ?)
        """,
        (tenant_id, f"st_{run_id}_tool{tool_round}_{call_id[-6:]}", run_id,
         tool_round, arguments_json[:500], output_json[:4000], now_tool, _now()),
    )
    conn.commit()
    return output_json, ok


def _refuse_call(
    conn: sqlite3.Connection,
    store: EventStore,
    *,
    call_id: str,
    internal: str,
    code: str,
    message: str,
    risk: str,
    run_id: str,
    thread_id: str,
    turn_id: str,
    tenant_id: str,
    tool_round: int,
    arguments_json: str,
) -> str:
    store.append(
        thread_id,
        "tool.started",
        {
            "tool_call_id": call_id, "name": internal, "source": "builtin",
            "risk": risk, "args_digest": str(len(arguments_json)),
            "args_preview": arguments_json[:200],
        },
        tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
    )
    store.append(
        thread_id,
        "tool.failed",
        {"tool_call_id": call_id, "code": code, "message": message,
         "retryable": False},
        tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
    )
    output_json = json.dumps({"denied": message}, ensure_ascii=False)
    conn.execute(
        """
        INSERT OR REPLACE INTO steps
          (tenant_id, step_id, run_id, idx, kind, status, input_json,
           output_json, started_at, finished_at)
        VALUES (?, ?, ?, ?, 'tool', 'failed', ?, ?, ?, ?)
        """,
        (tenant_id, f"st_{run_id}_tool{tool_round}_{call_id[-6:]}", run_id,
         tool_round, arguments_json[:500], output_json[:4000], _now(), _now()),
    )
    conn.commit()
    return output_json


def _args_of(arguments_json: str) -> dict[str, object]:
    try:
        parsed = json.loads(arguments_json or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


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
    """Run one queued turn to completion or to an approval pause."""
    cfg = config or EngineConfig()
    registry = registry or agents_registry.Registry(conn)
    resolved = registry.resolve(cfg.model_hint)
    turn = _turn(conn, turn_id)
    thread_id = str(turn["thread_id"])
    tenant_id = str(turn["tenant_id"])

    existing = conn.execute(
        "SELECT status, attempt FROM runs WHERE turn_id = ? ORDER BY attempt DESC LIMIT 1",
        (turn_id,),
    ).fetchone()
    if existing is not None and str(existing[0]) in ("leased", "running", "waiting"):
        raise AppError("TURN_ACTIVE", details={"turn_id": turn_id, "status": str(existing[0])})
    attempt = 1 if existing is None else int(existing[1]) + 1  # keep retry history

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
        {"turn_id": turn_id, "run_id": run_id, "attempt": attempt,
         "model": resolved.model},
        tenant_id=tenant_id,
        turn_id=turn_id,
        run_id=run_id,
    )

    from polyopus.domains import memory as memory_svc

    user_content = _user_content(conn, turn_id)
    agent_id = _agent_of(conn, thread_id)
    hints = memory_svc.recall(conn, tenant_id, agent_id, user_content)
    messages: list[gateway_types.ChatMessage] = []
    if hints:
        lines = "\n".join(f"- [{h['kind']}] {h['text']}" for h in hints)
        messages.append(
            gateway_types.ChatMessage(
                role="system", content=f"已知记忆（供参考）：\n{lines}"
            )
        )
    messages.append(gateway_types.ChatMessage(role="user", content=user_content))

    state = _StreamState()
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

    source: gateway_types.ModelGateway
    if model is not None:
        source = model
    elif resolved.fake:
        source = FakeModel(chunk_words=cfg.chunk_words, delay_seconds=cfg.delay_seconds)
    else:
        source = resolved.gateway

    toolspecs = tuple(GATEWAY_SPECS.values()) if cfg.workspace is not None else ()
    runtime = ToolRuntime(
        PolicyEngine(list(cfg.policy_rules) if cfg.policy_rules else default_rules())
    )

    tool_round = 0
    while True:
        request = gateway_types.ModelRequest(
            model=resolved.model,
            messages=tuple(messages),
            max_output_tokens=2048,
            tools=toolspecs,
            tenant_id=tenant_id,
            trace_id=trace_id,
        )
        calls = await _stream_round(
            store, source, request, state,
            thread_id=thread_id, turn_id=turn_id, run_id=run_id,
            tenant_id=tenant_id, message_id=message_id,
        )
        if not calls or tool_round >= cfg.max_tool_rounds:
            break
        tool_round += 1
        assert cfg.workspace is not None  # tools were advertised

        messages.append(_tool_messages_parts(calls, tool_round))
        paused = False
        for call in calls:
            call_id = call.id or f"tc_{tool_round}"
            internal = internal_name(call.name)
            spec = POLICY_SPECS.get(internal)
            args = _args_of(call.arguments_json)
            risk = spec.risk if spec else "critical"
            if spec is None:
                decision = Decision("deny", (), "unknown tool")
            else:
                decision = runtime.check(spec, args)

            if spec is not None and decision.effect == "allow":
                output_json, _ok = _execute_call(
                    conn, store,
                    internal=internal, arguments_json=call.arguments_json,
                    call_id=call_id, risk=risk, run_id=run_id, thread_id=thread_id,
                    turn_id=turn_id, tenant_id=tenant_id, tool_round=tool_round,
                    workspace=cfg.workspace,
                )
            elif spec is not None and decision.effect == "ask":
                # pipeline step 6: pause with the REAL tool and args
                approval_id, _ = attention.request(
                    conn, store,
                    tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
                    run_id=run_id, step_idx=tool_round,
                    req=attention.ApprovalRequest(
                        tool=internal,
                        args_preview=call.arguments_json[:200],
                        risk=risk,
                        summary=f"策略要求审批（{decision.reason}）",
                        args_json=call.arguments_json,
                    ),
                )
                _set_turn_status(conn, turn_id, "waiting_approval")
                lease.release(conn, run_id, owner)
                conn.execute(
                    "UPDATE runs SET status = 'waiting' WHERE run_id = ?",
                    (run_id,),
                )
                conn.commit()
                paused = True
                break
            else:
                code = "tool_not_found" if spec is None else "policy_denied"
                output_json = _refuse_call(
                    conn, store,
                    call_id=call_id, internal=internal, code=code,
                    message=decision.reason, risk=risk, run_id=run_id,
                    thread_id=thread_id, turn_id=turn_id, tenant_id=tenant_id,
                    tool_round=tool_round, arguments_json=call.arguments_json,
                )
            messages.append(
                gateway_types.ChatMessage(
                    role="tool", content=output_json[:4000], tool_call_id=call_id,
                )
            )
        if paused:
            return "waiting_approval"

    projection.apply(
        conn,
        store.append(
            thread_id,
            "message.completed",
            {
                "message_id": message_id,
                "blocks": [{"type": "text", "text": state.text}],
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
        input_tokens=state.input_tokens, output_tokens=state.output_tokens,
        cached_tokens=state.cached_tokens, first_token_ms=state.first_token_ms,
    )

    _finish(conn, store, tenant_id=tenant_id, thread_id=thread_id,
            turn_id=turn_id, run_id=run_id, status="completed")
    _harvest_memory(conn, tenant_id=tenant_id, thread_id=thread_id,
                    turn_id=turn_id)
    return "completed"


def resume_after_approval(
    conn: sqlite3.Connection,
    store: EventStore,
    turn_id: str,
    *,
    owner: str = "engine",
    decision: str,
    registry: agents_registry.Registry | None = None,
    config: EngineConfig | None = None,
) -> str:
    """Execute (or refuse) the approved tool, then run one final model round."""
    import asyncio

    cfg = config or EngineConfig()
    registry = registry or agents_registry.Registry(conn)
    resolved = registry.resolve(cfg.model_hint)
    turn = _turn(conn, turn_id)
    thread_id = str(turn["thread_id"])
    tenant_id = str(turn["tenant_id"])
    run_row = conn.execute(
        "SELECT * FROM runs WHERE turn_id = ? ORDER BY attempt DESC LIMIT 1", (turn_id,)
    ).fetchone()
    if run_row is None:
        raise AppError("TURN_NOT_FOUND", details={"turn_id": turn_id})
    run_id = str(run_row["run_id"])
    lease.claim(conn, run_id, owner, 60)
    _set_turn_status(conn, turn_id, "running")

    approval = conn.execute(
        "SELECT * FROM approvals WHERE turn_id = ? ORDER BY id DESC LIMIT 1",
        (turn_id,),
    ).fetchone()
    if approval is None:
        raise AppError("ATTENTION_NOT_FOUND")
    request_data = json.loads(approval["request_json"])
    action = (request_data.get("actions") or [{}])[0]
    internal = str(action.get("tool", ""))
    arguments_json = str(action.get("args_json", "") or action.get("args_preview", ""))
    risk = str(action.get("risk", "high"))

    store.append(
        thread_id,
        "turn.resumed",
        {"turn_id": turn_id, "run_id": run_id, "from_step": 1, "reason": "approval"},
        tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
    )

    workspace = cfg.workspace or _workspace_default()
    call_id = f"tc_ap_{approval['approval_id'][-6:]}"
    user_content = _user_content(conn, turn_id)

    if decision in ("approved", "approved_session"):
        # execution-time re-evaluation (ADR-011); deny still wins over approval
        spec = POLICY_SPECS.get(internal)
        policy = PolicyEngine(
            list(cfg.policy_rules) if cfg.policy_rules else default_rules()
        )
        verdict = (
            policy.evaluate(spec, _args_of(arguments_json)) if spec
            else Decision("deny", (), "unknown tool")
        )
        if spec is None or verdict.effect == "deny":
            output_json = _refuse_call(
                conn, store, call_id=call_id, internal=internal,
                code="policy_denied" if spec else "tool_not_found",
                message=f"规则变更后拒绝：{verdict.reason}", risk=risk,
                run_id=run_id, thread_id=thread_id, turn_id=turn_id,
                tenant_id=tenant_id, tool_round=99,
                arguments_json=arguments_json,
            )
        else:
            output_json, _ok = _execute_call(
                conn, store, internal=internal, arguments_json=arguments_json,
                call_id=call_id, risk=risk, run_id=run_id, thread_id=thread_id,
                turn_id=turn_id, tenant_id=tenant_id, tool_round=99,
                workspace=workspace,
            )
    else:
        output_json = _refuse_call(
            conn, store, call_id=call_id, internal=internal,
            code="approval_denied", message="用户拒绝了该操作", risk=risk,
            run_id=run_id, thread_id=thread_id, turn_id=turn_id,
            tenant_id=tenant_id, tool_round=99, arguments_json=arguments_json,
        )

    # final model round with the tool outcome, streamed into a fresh message
    state = _StreamState()
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
    messages: list[gateway_types.ChatMessage] = [
        gateway_types.ChatMessage(role="user", content=user_content),
        gateway_types.ChatMessage(
            role="assistant", content="",
            tool_calls=(
                gateway_types.ToolCallMessagePart(
                    id=call_id, name=internal, arguments_json=arguments_json
                ),
            ),
        ),
        gateway_types.ChatMessage(
            role="tool", content=output_json[:4000], tool_call_id=call_id
        ),
    ]
    source: gateway_types.ModelGateway
    if resolved.fake:
        source = FakeModel(chunk_words=cfg.chunk_words, delay_seconds=cfg.delay_seconds)
    else:
        source = resolved.gateway
    request = gateway_types.ModelRequest(
        model=resolved.model, messages=tuple(messages), max_output_tokens=2048,
        tools=(), tenant_id=tenant_id,
    )
    asyncio.run(
        _stream_round(
            store, source, request, state,
            thread_id=thread_id, turn_id=turn_id, run_id=run_id,
            tenant_id=tenant_id, message_id=message_id,
        )
    )
    projection.apply(
        conn,
        store.append(
            thread_id,
            "message.completed",
            {
                "message_id": message_id,
                "blocks": [{"type": "text", "text": state.text}],
                "finish_reason": "stop",
            },
            tenant_id=tenant_id, turn_id=turn_id, run_id=run_id,
        ),
    )
    conn.commit()
    _record_usage(
        conn, store,
        tenant_id=tenant_id, thread_id=thread_id, turn_id=turn_id,
        model=resolved.model,
        input_tokens=state.input_tokens, output_tokens=state.output_tokens,
        cached_tokens=state.cached_tokens, first_token_ms=state.first_token_ms,
    )
    _finish(conn, store, tenant_id=tenant_id, thread_id=thread_id,
            turn_id=turn_id, run_id=run_id, status="completed",
            note=f"approval {decision}")
    _harvest_memory(conn, tenant_id=tenant_id, thread_id=thread_id,
                    turn_id=turn_id)
    return "completed"


def _workspace_default() -> Path:
    from polyopus.config import load_settings

    path = load_settings().workspace_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def _agent_of(conn: sqlite3.Connection, thread_id: str) -> str:
    row = conn.execute(
        "SELECT COALESCE(agent_id, 'agent:default') FROM threads WHERE thread_id = ?",
        (thread_id,),
    ).fetchone()
    return str(row[0]) if row else "agent:default"


def _harvest_memory(
    conn: sqlite3.Connection, *, tenant_id: str, thread_id: str, turn_id: str
) -> None:
    """docs/13 §4.1 write path, rule-based tier: raw -> candidate -> atom."""
    from polyopus.domains import memory as memory_svc

    memory_svc.capture_raw(conn, tenant_id, thread_id, turn_id)
    raw = memory_svc.load_raw(conn, tenant_id)
    candidates = memory_svc.extract_candidates(raw)
    if not candidates:
        return
    agent_id = _agent_of(conn, thread_id)
    memory_svc.stage_candidates(conn, tenant_id, agent_id, candidates)
    memory_svc.promote(conn, tenant_id, agent_id)


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
    from polyopus.domains.usage import service as usage_svc

    cost = usage_svc.price_usage(
        conn, model=model, input_tokens=input_tokens,
        output_tokens=output_tokens, cached_tokens=cached_tokens,
    )
    entry_id = "us_" + secrets.token_hex(8)
    conn.execute(
        """
        INSERT INTO usage_ledger
          (tenant_id, entry_id, turn_id, model, input_tokens, output_tokens,
           cache_read, latency_ms, cost_micros, currency, price_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tenant_id, entry_id, turn_id, model, input_tokens, output_tokens,
         cached_tokens, first_token_ms, cost.cost_micros, cost.currency,
         cost.price_version, _now()),
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
            "cost_micros": cost.cost_micros,
            "currency": cost.currency,
            "price_version": cost.price_version,
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
