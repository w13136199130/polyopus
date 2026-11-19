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
    dispatch,
    internal_name,
)
from polyopus.platform.errors import AppError
from polyopus.platform.events import projection
from polyopus.platform.events.store import EventStore
from polyopus.platform.queue import lease
from polyopus.workers import async_tools


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


def _thread_settings(conn: sqlite3.Connection, thread_id: str) -> dict[str, object]:
    """Per-session composer state (model / KBs / approval policy).

    Missing rows or malformed JSON degrade to `{}` — an old thread must keep
    working after the settings feature ships."""
    row = conn.execute(
        "SELECT settings_json FROM threads WHERE thread_id = ?", (thread_id,)
    ).fetchone()
    if row is None or not row[0]:
        return {}
    try:
        value = json.loads(str(row[0]))
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _kb_context(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    query: str,
    kb_ids: object,
) -> str | None:
    """Prototype 知识库 chip: inject the top KB hits as grounded context.

    Only ready KBs contribute; one that is still ingesting or abstains is
    skipped rather than failing the turn."""
    if not isinstance(kb_ids, list) or not kb_ids or not query.strip():
        return None
    from polyopus.domains.knowledge import service as kb_service

    lines: list[str] = []
    for kb_id in [str(x) for x in kb_ids][:8]:
        try:
            result = kb_service.search(
                conn, kb_id, query, tenant_id=tenant_id, top_k=4
            )
        except AppError:
            continue
        if result.get("status") != "ok":
            continue
        kb_name = str((result.get("kb") or {}).get("name") or kb_id)
        for hit in result.get("hits", []):
            content = str(hit.get("content", "")).strip()
            if not content:
                continue
            heading = str(hit.get("heading") or "").strip()
            where = " › ".join(x for x in (str(hit.get("doc", "")), heading) if x)
            lines.append(f"- [{kb_name} · {where}] {content[:400]}")
    if not lines:
        return None
    return (
        "会话已启用知识库，以下是与当前问题最相关的检索依据（回答时优先引用；"
        "依据不足要明确说明）：\n" + "\n".join(lines)
    )


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
    reasoning: str = ""
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
    state.reasoning = ""  # reasoning belongs to this round's assistant message
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
        elif isinstance(delta, gateway_types.ReasoningDelta):
            # thinking-model output: kept for the next round, not user-visible
            state.reasoning += delta.text
        elif isinstance(delta, gateway_types.ToolCallDelta):
            calls.append(delta)
        elif isinstance(delta, gateway_types.UsageDelta):
            state.input_tokens += delta.input_tokens
            state.output_tokens += delta.output_tokens
            state.cached_tokens += delta.cached_tokens
    return calls


def _tool_messages_parts(
    calls: list[gateway_types.ToolCallDelta], tool_round: int, reasoning: str = ""
) -> gateway_types.ChatMessage:
    return gateway_types.ChatMessage(
        role="assistant",
        content="",
        reasoning_content=reasoning or None,
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
    from polyopus.platform.observability import metrics

    metrics.tool_call(internal, "ok" if ok else "failed")
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
    from polyopus.platform.observability import metrics

    metrics.tool_call(internal, "denied")
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
    turn = _turn(conn, turn_id)
    thread_id = str(turn["thread_id"])
    tenant_id = str(turn["tenant_id"])
    session = _thread_settings(conn, thread_id)
    model_hint = cfg.model_hint or (
        str(session["model"]) if session.get("model") else None
    )
    resolved = registry.resolve(model_hint)

    # V1-05 defense in depth: post_turn already rejects over-quota requests,
    # but a turn may have been queued before the limit was lowered.
    from polyopus.domains.usage import quota as quota_svc

    violation = quota_svc.check(
        conn, tenant_id=tenant_id, model=resolved.model
    )
    if violation is not None:
        raise AppError("QUOTA_EXCEEDED", details=violation.details())

    existing = conn.execute(
        "SELECT status, attempt FROM runs WHERE turn_id = ? ORDER BY attempt DESC LIMIT 1",
        (turn_id,),
    ).fetchone()
    if existing is not None and str(existing[0]) in ("leased", "running", "waiting"):
        raise AppError("THREAD_TURN_ACTIVE", details={"turn_id": turn_id, "status": str(existing[0])})
    attempt = 1 if existing is None else int(existing[1]) + 1  # keep retry history

    run_id = "run_" + secrets.token_hex(8)
    now = _now()
    try:
        conn.execute(
            """
            INSERT INTO runs
              (tenant_id, run_id, turn_id, attempt, status, lease_owner, lease_until,
               heartbeat_at, last_step_idx, started_at)
            VALUES (?, ?, ?, ?, 'leased', ?, ?, ?, -1, ?)
            """,
            (tenant_id, run_id, turn_id, attempt, owner, now + 60, now, now),
        )
    except sqlite3.IntegrityError as exc:
        # two workers raced the same turn: UNIQUE(turn_id, attempt) decides
        raise AppError("THREAD_TURN_ACTIVE",
                       details={"turn_id": turn_id, "status": "race"}) from exc
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
    # 会话级知识库（composer 的「知识库 · N」chip）：检索依据作为系统上下文，
    # 未选库或未命中时什么也不加，保持旧会话行为不变。
    kb_context = _kb_context(
        conn, tenant_id=tenant_id, query=user_content,
        kb_ids=session.get("kbIds"),
    )
    if kb_context:
        messages.append(
            gateway_types.ChatMessage(role="system", content=kb_context)
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

    from polyopus.domains.tools import service as tools_svc

    agent_row = conn.execute(
        "SELECT agent_id FROM threads WHERE thread_id = ?", (thread_id,)
    ).fetchone()
    quota_agent = str(agent_row[0]) if agent_row is not None and agent_row[0] else None
    toolspecs = tuple(
        spec for name, spec in GATEWAY_SPECS.items()
        if cfg.workspace is not None
        and tools_svc.effective_enabled(
            conn, tenant_id=tenant_id, agent_id=quota_agent, tool_key=name
        )
    )
    ticket_id = turn["ticket_id"]
    auto_tools, auto_max_risk = _auto_approve_of(conn, tenant_id, ticket_id)
    # Composer 审批策略「全允许」= 本会话内的 ask 自动升级为 allow；
    # 显式 deny（含 critical、未授权插件）仍然优先，策略引擎负责兜底。
    if str(session.get("approvalPolicy") or "ask") == "auto":
        auto_tools = tuple(GATEWAY_SPECS.keys())
        auto_max_risk = "high"
    runtime = ToolRuntime(
        PolicyEngine(
            _gate_rules(conn, cfg, ticket_id, tenant_id),
            auto_approve=auto_tools,
            auto_approve_max_risk=auto_max_risk,
        )
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

        messages.append(_tool_messages_parts(calls, tool_round, state.reasoning))
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
                # V05-12 scope enforcement (docs/09 §6.3): a write-class tool
                # on a TICKET turn must be covered by the mandate's scope.
                # Chat turns (no ticket) keep today's behaviour.
                if (
                    decision.effect != "deny"
                    and spec.required_scope
                    and ticket_id
                    and not _scope_covers(conn, str(ticket_id), spec.required_scope)
                ):
                    decision = Decision(
                        "deny", decision.matched,
                        f"scope_violation: {spec.required_scope} not in mandate scope",
                    )
                if decision.effect != "deny" and not tools_svc.effective_enabled(
                    conn, tenant_id=tenant_id, agent_id=quota_agent,
                    tool_key=internal,
                ):
                    decision = Decision("deny", decision.matched, "tool_disabled")

            if spec is not None and decision.effect == "allow":
                gateway_spec = GATEWAY_SPECS.get(internal)
                if gateway_spec is not None and gateway_spec.execution == "async":
                    output_json = json.dumps(
                        async_tools.start_async_call(
                            conn, store,
                            internal=internal,
                            arguments_json=call.arguments_json,
                            risk=risk,
                            workspace=cfg.workspace,
                            timeout_seconds=gateway_spec.timeout_seconds,
                            tenant_id=tenant_id,
                            thread_id=thread_id,
                            turn_id=turn_id,
                            run_id=run_id,
                        ),
                        ensure_ascii=False,
                    )
                else:
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
                    ticket_id=str(ticket_id) if ticket_id else None,
                    req=attention.ApprovalRequest(
                        tool=internal,
                        args_preview=call.arguments_json[:200],
                        risk=risk,
                        summary=f"策略要求审批（{decision.reason}）",
                        args_json=call.arguments_json,
                        reasoning=state.reasoning,
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
                if spec is None:
                    code = "tool_not_found"
                elif decision.reason == "tool_disabled":
                    code = "tool_disabled"
                else:
                    code = "policy_denied"
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
    turn = _turn(conn, turn_id)
    thread_id = str(turn["thread_id"])
    tenant_id = str(turn["tenant_id"])
    session = _thread_settings(conn, thread_id)
    resolved = registry.resolve(
        cfg.model_hint
        or (str(session["model"]) if session.get("model") else None)
    )
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
        # execution-time re-evaluation (ADR-011); deny still wins over approval.
        # V05-12: the re-check runs against the CURRENT active bundle — an
        # approval granted minutes ago must not survive a stricter publish.
        spec = POLICY_SPECS.get(internal)
        from polyopus.domains.policy import service as policy_service

        policy = PolicyEngine(
            list(cfg.policy_rules)
            if cfg.policy_rules
            else list(policy_service.resolve_rules(conn, tenant_id)[0])
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
            gateway_spec = GATEWAY_SPECS.get(internal)
            if gateway_spec is not None and gateway_spec.execution == "async":
                output_json = json.dumps(
                    async_tools.start_async_call(
                        conn, store,
                        internal=internal,
                        arguments_json=arguments_json,
                        risk=risk,
                        workspace=workspace,
                        timeout_seconds=gateway_spec.timeout_seconds,
                        tenant_id=tenant_id,
                        thread_id=thread_id,
                        turn_id=turn_id,
                        run_id=run_id,
                    ),
                    ensure_ascii=False,
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
            reasoning_content=str(request_data.get("reasoning_content") or "") or None,
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
    ticket_row = conn.execute(
        "SELECT ticket_id FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()
    ticket_id = str(ticket_row[0]) if ticket_row is not None and ticket_row[0] else None
    conn.execute(
        """
        INSERT INTO usage_ledger
          (tenant_id, entry_id, ticket_id, turn_id, model, input_tokens,
           output_tokens, cache_read, latency_ms, cost_micros, currency,
           price_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tenant_id, entry_id, ticket_id, turn_id, model, input_tokens,
         output_tokens, cached_tokens, first_token_ms, cost.cost_micros,
         cost.currency, cost.price_version, _now()),
    )
    conn.commit()
    if ticket_id:
        usage_svc.refresh_ticket_cost(conn, ticket_id, tenant_id=tenant_id)
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


def _auto_approve_of(
    conn: sqlite3.Connection, tenant_id: str, ticket_id: str | None
) -> tuple[tuple[str, ...], str]:
    """V05-16: source-scoped auto-approve whitelist for a ticket turn.

    Chat turns (no ticket) and sources without the config return an empty
    set — the default is still "every ask opens a card".
    """
    if not ticket_id:
        return (), "high"
    row = conn.execute(
        "SELECT source_id FROM tickets WHERE tenant_id = ? AND ticket_id = ?",
        (tenant_id, str(ticket_id)),
    ).fetchone()
    if row is None or not row["source_id"]:
        return (), "high"
    source = conn.execute(
        "SELECT * FROM sources WHERE tenant_id = ? AND source_id = ?",
        (tenant_id, str(row["source_id"])),
    ).fetchone()
    if source is None:
        return (), "high"
    from polyopus.domains.intake import service as intake

    cfg = intake.config_of(source)
    return cfg.auto_approve_tools, cfg.auto_approve_max_risk


def _gate_rules(
    conn: sqlite3.Connection, cfg: EngineConfig, ticket_id: str | None,
    tenant_id: str = "default",
) -> list[Rule]:
    """V05-12 rule source chain for the tool gate: explicit injection
    (tests) > the mandate's PINNED bundle snapshot (in-flight mandates keep
    executing their version across publishes) > the resolved active bundle
    (chat turns / empty DB fall back to in-memory defaults)."""
    if cfg.policy_rules:
        return list(cfg.policy_rules)
    from polyopus.domains.policy import service as policy_service

    if ticket_id:
        row = conn.execute(
            "SELECT policy_version FROM mandates WHERE ticket_id = ? "
            "AND invalidated_at IS NULL ORDER BY id DESC LIMIT 1",
            (str(ticket_id),),
        ).fetchone()
        if row is not None:
            pinned = policy_service.rules_for(conn, int(row[0]), tenant_id)
            if pinned is not None:
                return pinned
    return list(policy_service.resolve_rules(conn, tenant_id)[0])


def _scope_covers(
    conn: sqlite3.Connection, ticket_id: str, required_scope: str
) -> bool:
    """docs/09 §6.3: write-class scopes must appear explicitly in the
    mandate (no wildcard promotions)."""
    row = conn.execute(
        "SELECT scope_json FROM mandates WHERE ticket_id = ? "
        "AND invalidated_at IS NULL ORDER BY id DESC LIMIT 1",
        (ticket_id,),
    ).fetchone()
    if row is None or not row[0]:
        return False
    try:
        scope = json.loads(row[0])
    except ValueError:
        return False
    return required_scope in scope


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
    if status == "completed":
        # V05-11 (S8): a completed HUMAN-message turn on a parked ticket's
        # execution thread re-queues the ticket. Auto/approval turns are
        # filtered out inside (re-running them would loop into the same
        # pause); plain chat threads no-op; the wake itself never raises.
        from polyopus.domains.tickets import service as tickets

        tickets.wake_thread_ticket(conn, store, thread_id, turn_id)
