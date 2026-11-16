"""Assessment: model-based admission judgement (V05-13, docs/09 §4).

Runs AFTER the deterministic Gate accepted a trigger and BEFORE a ticket is
opened. The model is a cheap advisor and is NEVER trusted: post-processing
clamps its output — scope grammar + prefix whitelist (trim or default),
confidence floor, explicit-strength cross-check against the Gate, and
duplicate_of must point at a real open ticket. Anything the pipeline cannot
verify degrades to ignore/unavailable: 宁漏不乱 (G5: accept precision >= 0.9,
false-accept <= 0.1).

Failure path per docs/09 §4.3: 8s timeout -> unavailable (no ticket, retry
via `poly eval --dry-run`); invalid JSON retried once with a "JSON only"
nudge; a dead provider trips a 5-minute breaker so intake never stalls.
The thread snapshot is cached for 5 minutes per event thread (docs/09 §4.1).
"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any

from polyopus.domains.intake.service import TENANT, SourceConfig, config_of
from polyopus.kernel.models.gateway import (
    ChatMessage,
    ModelRequest,
    ModelUnavailableError,
    TextDelta,
)
from polyopus.platform.events.store import EventStore

TIMEOUT_SECONDS = 8.0
CONFIDENCE_FLOOR = 0.6
BREAKER_SECONDS = 300.0
SNAPSHOT_TTL_SECONDS = 300.0
SNAPSHOT_MESSAGES = 12
MAX_EVENT_CHARS = 4000
SCOPE_RE = re.compile(r"^[a-z]+:[A-Za-z0-9._/-]+$")
SCOPE_PREFIXES = ("repo", "path", "workspace", "net", "fs")

# module runtime state (breaker + snapshot cache); tests reset via
# reset_runtime_state()
_BREAKER: dict[str, float] = {"until": 0.0}
_SNAPSHOT_CACHE: dict[tuple[str, str], tuple[float, str]] = {}


def reset_runtime_state() -> None:
    """Tests call this so breaker/cache state never leaks between cases."""
    _BREAKER["until"] = 0.0
    _SNAPSHOT_CACHE.clear()


@dataclass(frozen=True)
class AssessResult:
    status: str  # decided | unavailable
    decision: str  # accept | ignore | stop | unavailable
    strength: str = "inferred"
    scope: tuple[str, ...] = ()
    title: str = ""
    reason: str = ""
    confidence: float = 0.0
    duplicate_of: str | None = None
    eval_id: str = ""
    reasons: tuple[str, ...] = field(default=())


# ---- model output parsing ------------------------------------------------------


def extract_json(text: str) -> dict[str, Any] | None:
    """Pull one JSON object out of model output: fenced ```json block first,
    then the first balanced {...} span. None when nothing parses."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidates: list[str] = [fenced.group(1)] if fenced else []
    start = text.find("{")
    if start >= 0:
        depth, in_str, escaped, end = 0, False, False, -1
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end > start:
            candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


# ---- thread snapshot (docs/09 §4.1: 5-minute cache) ------------------------------


def _thread_snapshot(
    conn: sqlite3.Connection, thread_key: str, tenant_id: str = TENANT
) -> str:
    cache_key = (tenant_id, thread_key)
    hit = _SNAPSHOT_CACHE.get(cache_key)
    now = time.monotonic()
    if hit is not None and now - hit[0] < SNAPSHOT_TTL_SECONDS:
        return hit[1]
    rows = conn.execute(
        "SELECT actor_id, payload_json FROM triggers WHERE tenant_id = ? "
        "AND thread_key = ? ORDER BY id DESC LIMIT ?",
        (tenant_id, thread_key, SNAPSHOT_MESSAGES),
    ).fetchall()
    lines = []
    for row in reversed(rows):
        text = str(json.loads(row[1]).get("text", ""))[:200]
        lines.append(f"{row[0]}: {text}")
    tickets = conn.execute(
        """
        SELECT t.title, t.bucket FROM tickets t
        JOIN subscriptions s ON s.ticket_id = t.ticket_id
        WHERE s.tenant_id = ? AND s.event_thread_id = ? AND t.state = 'open'
        ORDER BY t.id
        """,
        (tenant_id, thread_key),
    ).fetchall()
    for ticket in tickets:
        lines.append(f"[已有工单] {ticket[0]}（{ticket[1]}）")
    snapshot = "\n".join(lines) or "（新线程，无历史）"
    _SNAPSHOT_CACHE[cache_key] = (now, snapshot)
    return snapshot


def build_prompt(
    conn: sqlite3.Connection, source: sqlite3.Row, trigger: sqlite3.Row,
    cfg: SourceConfig,
) -> str:
    payload = json.loads(str(trigger["payload_json"]))
    event = str(payload.get("text", ""))[:MAX_EVENT_CHARS]
    if len(str(payload.get("text", ""))) > MAX_EVENT_CHARS:
        event += "\n（已截断）"
    schema = ('{"decision": "accept|ignore|stop", "strength": "explicit|inferred", '
              '"scope": ["path:src"], "title": "...", "reason": "...", '
              '"confidence": 0.0, "duplicate_of": null}')
    return (
        "[系统] 你是工作准入评估器。只输出 JSON。\n"
        f"[策略摘要] accept_mode=explicit_only；允许的人：{','.join(cfg.allow_actors) or '（未限制）'}；"
        f"忽略标签：{','.join(cfg.bot_actors) or '无'}\n"
        f"[线程快照]\n{_thread_snapshot(conn, str(trigger['thread_key']))}\n"
        f"[候选事件] {trigger['actor_id']}：{event}\n"
        "[任务] 判断：是否应接单、范围多大、是明确请求还是推断、是否与已有工单重复。\n"
        f"[输出 schema] {schema}"
    )


# ---- model call -------------------------------------------------------------------


def _trip_breaker() -> None:
    _BREAKER["until"] = time.monotonic() + BREAKER_SECONDS


def _stream_sync(gateway: Any, model: str, prompt: str, *, json_nudge: bool) -> str | None:
    """Collect one streamed completion. None = timeout or dead provider."""
    request = ModelRequest(
        model=model,
        messages=(ChatMessage(
            role="user", content=prompt + ("\n只输出 JSON。" if json_nudge else ""),
        ),),
        temperature=0.0,
        max_output_tokens=400,
        response_format="json_object",
    )

    async def collect() -> str:
        chunks: list[str] = []
        async for delta in gateway.stream(request):
            if isinstance(delta, TextDelta):
                chunks.append(delta.text)
        return "".join(chunks)

    try:
        return asyncio.run(asyncio.wait_for(collect(), TIMEOUT_SECONDS))
    except TimeoutError:
        return None
    except ModelUnavailableError:
        _trip_breaker()
        return None
    except Exception:  # noqa: BLE001 - any model shape mismatch: treat as dead
        _trip_breaker()
        return None


def _ask_model(
    conn: sqlite3.Connection, source: sqlite3.Row, trigger: sqlite3.Row,
    cfg: SourceConfig, gateway: Any,
) -> tuple[dict[str, Any] | None, str, str]:
    """(parsed JSON | None, model name, error tag). Breaker-aware."""
    if time.monotonic() < _BREAKER["until"]:
        return None, "", "breaker_open"
    model, gw = "scripted", gateway
    if gw is None:
        from polyopus.domains.agents import models as agents_registry

        resolved = agents_registry.Registry(conn).resolve()
        gw, model = resolved.gateway, resolved.model
    prompt = build_prompt(conn, source, trigger, cfg)
    for attempt in (1, 2):  # one JSON-only retry (docs/09 §4.3)
        text = _stream_sync(gw, model, prompt, json_nudge=attempt == 2)
        if text is None:
            return None, model, "timeout_or_unavailable"
        parsed = extract_json(text)
        if parsed is not None:
            return parsed, model, ""
    _trip_breaker()
    return None, model, "invalid_json"


# ---- post-processing (never trust the model) --------------------------------------


def _valid_scope(item: str) -> bool:
    return bool(SCOPE_RE.match(item)) and item.split(":", 1)[0] in SCOPE_PREFIXES


def post_process(
    raw: dict[str, Any], cfg: SourceConfig, gate_explicit: bool,
    conn: sqlite3.Connection, tenant_id: str = TENANT,
) -> dict[str, Any]:
    """Clamp the model's judgement (docs/09 §4.2). Returns the final dict
    with a `reasons` list of every correction applied."""
    reasons: list[str] = []
    decision = str(raw.get("decision", "ignore")).lower()
    if decision not in ("accept", "ignore", "stop"):
        decision = "ignore"
        reasons.append("unknown_decision")
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence", 0) or 0.0)))
    except ValueError:
        confidence = 0.0
        reasons.append("bad_confidence")

    strength = "inferred"
    if str(raw.get("strength", "")).lower() == "explicit":
        if gate_explicit:
            strength = "explicit"
        else:
            reasons.append("strength_demoted_no_gate_signal")

    scope_raw = [str(s) for s in (raw.get("scope") or []) if str(s).strip()]
    scope = [s for s in scope_raw if _valid_scope(s)]
    if len(scope) != len(scope_raw):
        reasons.append("scope_trimmed")

    if decision == "accept":
        if not scope:
            scope = list(cfg.default_scope)
            reasons.append("scope_defaulted")
        if confidence < CONFIDENCE_FLOOR:
            decision = "ignore"
            reasons.append("low_confidence")

    duplicate_of = raw.get("duplicate_of") or None
    if duplicate_of:
        row = conn.execute(
            "SELECT 1 FROM tickets WHERE tenant_id = ? AND ticket_id = ? "
            "AND state = 'open'",
            (tenant_id, str(duplicate_of)),
        ).fetchone()
        if row is None:
            duplicate_of = None
            reasons.append("invalid_duplicate_of")

    return {
        "decision": decision,
        "strength": strength,
        "scope": scope,
        "title": str(raw.get("title", ""))[:80],
        "reason": str(raw.get("reason", ""))[:300],
        "confidence": confidence,
        "duplicate_of": duplicate_of,
        "reasons": reasons,
    }


# ---- entry point -------------------------------------------------------------------


def run_for_trigger(
    conn: sqlite3.Connection,
    store: EventStore,
    source: sqlite3.Row,
    trigger: sqlite3.Row,
    *,
    gateway: Any = None,
    gate_explicit: bool = False,
    dry_run: bool = False,
) -> AssessResult:
    """Judge one trigger end to end: evals row, model call, post-processing,
    eval.decided event, trigger disposition (accept leaves `accepted` to
    open_ticket when not dry-run). dry_run never opens a ticket (docs/09
    §3.5: 判定照写、不建单)."""
    cfg = config_of(source)
    tenant = str(source["tenant_id"] or TENANT)
    eval_id = "ev_" + secrets.token_hex(8)
    now = int(time.time())
    conn.execute(
        "INSERT INTO evals (tenant_id, eval_id, trigger_id, status, started_at)"
        " VALUES (?, ?, ?, 'running', ?)",
        (tenant, eval_id, str(trigger["trigger_id"]), now),
    )
    conn.commit()

    raw, model, error = _ask_model(conn, source, trigger, cfg, gateway)
    if raw is None:
        _finish_eval(conn, eval_id, "unavailable",
                     {"decision": "unavailable", "error": error})
        _set_disposition(conn, str(trigger["trigger_id"]), "unavailable")
        _emit_decided(conn, store, source, eval_id,
                      decision="unavailable", confidence=0.0,
                      reasons=(error,), raw_scope=[])
        return AssessResult("unavailable", "unavailable", eval_id=eval_id,
                            reasons=(error,))

    final = post_process(raw, cfg, gate_explicit, conn, tenant_id=tenant)
    _finish_eval(conn, eval_id, "decided", final)
    decision = str(final["decision"])
    if decision == "accept":
        # auto mode leaves `accepted` to open_ticket; dry-run keeps the
        # judgement visible without creating anything
        _set_disposition(conn, str(trigger["trigger_id"]),
                         "evaluated" if dry_run else "accepted")
    elif decision == "stop":
        _set_disposition(conn, str(trigger["trigger_id"]), "stopped")
    else:
        _set_disposition(conn, str(trigger["trigger_id"]), "filtered")

    if final["duplicate_of"]:
        # docs/09 §4.2: duplicate_of -> no new ticket, fan out instead
        _set_disposition(conn, str(trigger["trigger_id"]), "fanned_out")
        conn.execute(
            """
            INSERT INTO timeline_events
              (event_id, tenant_id, ticket_id, kind, title, actor, payload_json,
               created_at)
            VALUES (?, ?, ?, 'trigger_fanned_out', '研判判定重复，已并入', 'system', ?, ?)
            """,
            ("tl_" + secrets.token_hex(8), tenant, str(final["duplicate_of"]),
             json.dumps({"trigger_id": str(trigger["trigger_id"]),
                         "via": "assessment"},
                        ensure_ascii=False), int(time.time())),
        )
        conn.commit()

    _emit_decided(conn, store, source, eval_id,
                  decision=decision,
                  confidence=float(final["confidence"]),
                  reasons=tuple(final["reasons"]) or (str(final["reason"]),),
                  raw_scope=list(final["scope"]), final=final)
    return AssessResult(
        "decided", decision,
        strength=str(final["strength"]),
        scope=tuple(final["scope"]),
        title=str(final["title"]),
        reason=str(final["reason"]),
        confidence=float(final["confidence"]),
        duplicate_of=(str(final["duplicate_of"])
                      if final["duplicate_of"] else None),
        eval_id=eval_id,
        reasons=tuple(final["reasons"]),
    )


def _finish_eval(
    conn: sqlite3.Connection, eval_id: str, status: str, payload: dict[str, Any]
) -> None:
    conn.execute(
        "UPDATE evals SET status = ?, decision_json = ?, finished_at = ? "
        "WHERE eval_id = ?",
        (status, json.dumps(payload, ensure_ascii=False), int(time.time()), eval_id),
    )
    conn.commit()


def _set_disposition(conn: sqlite3.Connection, trigger_id: str, value: str) -> None:
    conn.execute(
        "UPDATE triggers SET disposition = ? WHERE trigger_id = ?", (value, trigger_id)
    )
    conn.commit()


def _emit_decided(
    conn: sqlite3.Connection, store: EventStore, source: sqlite3.Row, eval_id: str,
    *, decision: str, confidence: float, reasons: tuple[str, ...],
    raw_scope: list[str], final: dict[str, Any] | None = None,
) -> None:
    from polyopus.domains.policy import service as policy

    version = policy.active_version(conn, str(source["tenant_id"] or TENANT))
    payload: dict[str, Any] = {
        "eval_id": eval_id,
        "decision": decision,
        "confidence": confidence,
        "policy_version": version if version is not None else 0,
        "reasons": list(reasons),
    }
    if final is not None:
        payload["strength"] = final["strength"]
        payload["scope"] = final["scope"]
        if final["duplicate_of"]:
            payload["duplicate_of"] = final["duplicate_of"]
    store.append(str(source["source_id"]), "eval.decided", payload,
                 tenant_id=str(source["tenant_id"] or TENANT))


def eval_dry_run(
    conn: sqlite3.Connection,
    store: EventStore,
    source_id: str,
    *,
    hours: int = 24,
    gateway: Any = None,
) -> dict[str, int]:
    """`poly eval --dry-run` (V05-13): judge every recent trigger of a
    source, write dispositions + evals, open NOTHING."""
    source = conn.execute(
        "SELECT * FROM sources WHERE source_id = ?",
        (source_id,),
    ).fetchone()
    if source is None:
        from polyopus.platform.errors import AppError

        raise AppError("SOURCE_NOT_FOUND")
    cfg = config_of(source)
    cutoff = int(time.time()) - hours * 3600
    triggers = conn.execute(
        "SELECT * FROM triggers WHERE source_id = ? "
        "AND received_at >= ? ORDER BY id",
        (source_id, cutoff),
    ).fetchall()
    counts = {"accept": 0, "ignore": 0, "stop": 0, "unavailable": 0}
    for trigger in triggers:
        result = run_for_trigger(
            conn, store, source, trigger, gateway=gateway,
            gate_explicit=bool(cfg.explicit_patterns), dry_run=True,
        )
        key = result.decision if result.decision in counts else "unavailable"
        counts[key] += 1
    return counts


# re-exported for the engine-style import in tests
__all__ = [
    "AssessResult",
    "TIMEOUT_SECONDS",
    "build_prompt",
    "eval_dry_run",
    "extract_json",
    "post_process",
    "reset_runtime_state",
    "run_for_trigger",
]
