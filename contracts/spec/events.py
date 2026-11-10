"""PolyOpus event specification — the single authoring source.

Everything under `schemas/events/`, `generated/py/.../events.py` and
`generated/ts/src/events.gen.ts` is generated from this file. Do not edit
generated files by hand; run `python contracts/generate.py`.

Type DSL (kept intentionally small):
    str | int | float | bool | ts | json
    ref:<prefix>            e.g. ref:tu  -> string id
    enum:a|b|c
    arr:<type>              e.g. arr:str, arr:obj:ArtifactRef
    obj:<Name>              shared object from COMMON
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Field:
    name: str
    type: str
    required: bool = True
    desc: str = ""


def f(name: str, type: str, required: bool = True, desc: str = "") -> Field:
    return Field(name, type, required, desc)


@dataclass(frozen=True)
class Event:
    type: str
    stream: str
    group: str
    producer: str
    retention: str
    payload: tuple[Field, ...]
    desc: str = ""


def ev(
    type: str,
    *,
    stream: str,
    group: str,
    producer: str,
    retention: str,
    payload: tuple[Field, ...],
    desc: str = "",
) -> Event:
    return Event(type, stream, group, producer, retention, payload, desc)


# --------------------------------------------------------------------------
# Shared objects ($defs in schemas/events/common.schema.json)
# --------------------------------------------------------------------------

COMMON: dict[str, tuple[Field, ...]] = {
    "Actor": (
        f("kind", "enum:user|agent|system|executor|source", desc="who produced it"),
        f("id", "str", desc="user id / agent id / executor kind"),
        f("name", "str", required=False),
        f("on_behalf_of", "str", required=False),
    ),
    "Refs": (
        f("thread_id", "ref:th", required=False),
        f("turn_id", "ref:tu", required=False),
        f("run_id", "ref:rn", required=False),
        f("ticket_id", "ref:tk", required=False),
        f("assignment_id", "ref:as", required=False),
        f("event_thread_id", "ref:et", required=False),
        f("source_id", "ref:src", required=False),
    ),
    "ArtifactRef": (
        f("kind", "enum:file|image|pdf|pr|diff|report|link"),
        f("ref", "str", desc="storage ref or URL"),
        f("mime", "str", required=False),
        f("size", "int", required=False),
    ),
    "Action": (
        f("tool", "str"),
        f("args_preview", "str", desc="redacted, <=500 chars"),
        f("risk", "enum:low|medium|high|critical"),
        f("scope", "arr:str", required=False),
    ),
    "Block": (
        f("type", "enum:text|image|file|reference"),
        f("text", "str", required=False),
        f("ref", "str", required=False),
    ),
    "Step": (
        f("id", "str"),
        f("title", "str"),
        f("status", "enum:pending|active|done|skipped|failed"),
        f("note", "str", required=False),
    ),
    "Mandate": (
        f("policy_version", "int"),
        f("scope", "arr:str"),
        f("strength", "enum:explicit|inferred"),
        f("matched_rules", "arr:str"),
        f("actor", "obj:Actor"),
        f("granted_at", "ts"),
    ),
    "Usage": (
        f("input_tokens", "int"),
        f("output_tokens", "int"),
        f("cached_tokens", "int", required=False),
        f("cost_micros", "int"),
        f("model", "str", required=False),
    ),
    "Error": (
        f("code", "str"),
        f("message", "str"),
        f("retryable", "bool"),
        f("source", "enum:model|tool|executor|intake|platform"),
        f("details", "json", required=False),
    ),
}


# --------------------------------------------------------------------------
# Events — 48 types
# --------------------------------------------------------------------------

CONV = "conv"
SRC = "src"
TICKET = "ticket"
USER = "user"
SYS = "sys"

EVENTS: tuple[Event, ...] = (
    # ---- conversation lifecycle -----------------------------------------
    ev("turn.queued", stream=CONV, group="conv", producer="conversations", retention="90d",
       desc="A turn was accepted and queued.",
       payload=(f("turn_id", "ref:tu"), f("delivery", "enum:auto|steer|follow_up"), f("input_ref", "ref:msg"))),
    ev("turn.started", stream=CONV, group="conv", producer="worker", retention="90d",
       desc="Execution of a turn started.",
       payload=(f("turn_id", "ref:tu"), f("run_id", "ref:rn"), f("attempt", "int"), f("model", "str"))),
    ev("turn.resumed", stream=CONV, group="conv", producer="worker", retention="90d",
       desc="A turn resumed from a checkpoint or approval.",
       payload=(f("turn_id", "ref:tu"), f("run_id", "ref:rn"), f("from_step", "int"),
                f("reason", "enum:lease_expired|user_resume|approval"))),
    ev("turn.finished", stream=CONV, group="conv", producer="worker", retention="forever",
       desc="Terminal state of a turn.",
       payload=(f("turn_id", "ref:tu"), f("run_id", "ref:rn"),
                f("status", "enum:completed|failed|cancelled"), f("duration_ms", "int"),
                f("usage", "obj:Usage", required=False), f("error", "obj:Error", required=False),
                f("finish_reason", "enum:stop|length|tool_calls|error|cancelled", required=False))),

    # ---- messages & reasoning -------------------------------------------
    ev("message.started", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("message_id", "ref:msg"), f("role", "enum:assistant|tool|system"),
                f("index", "int"), f("speaker", "str", required=False))),
    ev("message.delta", stream=CONV, group="conv", producer="kernel", retention="90d",
       desc="Text delta; may be coalesced.",
       payload=(f("message_id", "ref:msg"), f("index", "int"), f("text", "str"),
                f("coalesced", "bool", required=False))),
    ev("message.completed", stream=CONV, group="conv", producer="kernel", retention="forever",
       payload=(f("message_id", "ref:msg"), f("blocks", "arr:obj:Block"),
                f("finish_reason", "enum:stop|length|tool_calls|error"),
                f("usage", "obj:Usage", required=False))),
    ev("reasoning.delta", stream=CONV, group="conv", producer="kernel", retention="30d",
       payload=(f("message_id", "ref:msg"), f("text", "str"))),
    ev("reasoning.summary", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("message_id", "ref:msg"), f("text", "str"))),

    # ---- tools ------------------------------------------------------------
    ev("tool.started", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("tool_call_id", "ref:tc"), f("name", "str"),
                f("source", "enum:builtin|mcp|plugin|openapi|skill"),
                f("risk", "enum:low|medium|high|critical"), f("args_digest", "str"),
                f("args_preview", "str", required=False))),
    ev("tool.delta", stream=CONV, group="conv", producer="executor", retention="30d",
       payload=(f("tool_call_id", "ref:tc"), f("text", "str", required=False),
                f("progress", "float", required=False))),
    ev("tool.completed", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("tool_call_id", "ref:tc"), f("output", "json"),
                f("artifacts", "arr:obj:ArtifactRef", required=False),
                f("ui", "json", required=False), f("usage", "obj:Usage", required=False))),
    ev("tool.failed", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("tool_call_id", "ref:tc"), f("code", "str"), f("message", "str"),
                f("retryable", "bool"))),
    ev("tool.async_started", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("tool_call_id", "ref:tc"), f("handle_id", "ref:h"))),
    ev("tool.async_completed", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("tool_call_id", "ref:tc"), f("handle_id", "ref:h"), f("output", "json"))),
    ev("tool.async_cancelled", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("tool_call_id", "ref:tc"), f("handle_id", "ref:h"), f("reason", "str"))),

    # ---- approvals & steering --------------------------------------------
    ev("approval.requested", stream=CONV, group="conv", producer="kernel", retention="forever",
       payload=(f("approval_id", "ref:ap"), f("actions", "arr:obj:Action"),
                f("allowed_decisions", "arr:enum:approve|approve_session|deny"),
                f("expires_at", "ts"), f("summary", "str"))),
    ev("approval.resolved", stream=CONV, group="conv", producer="conversations", retention="forever",
       payload=(f("approval_id", "ref:ap"),
                f("decision", "enum:approved|approved_session|denied|expired"),
                f("by", "ref:u", required=False), f("scope", "json", required=False))),
    ev("steer.queued", stream=CONV, group="conv", producer="conversations", retention="30d",
       payload=(f("steer_id", "ref:st"), f("preview", "str"), f("queue_length", "int"))),
    ev("steer.drained", stream=CONV, group="conv", producer="kernel", retention="30d",
       payload=(f("steer_id", "ref:st"), f("turn_id", "ref:tu"),
                f("injected_at", "enum:before_model|turn_end"))),
    ev("steer.removed", stream=CONV, group="conv", producer="conversations", retention="30d",
       payload=(f("steer_id", "ref:st"), f("reason", "str"))),
    ev("steer.rejected", stream=CONV, group="conv", producer="conversations", retention="30d",
       payload=(f("steer_id", "ref:st"), f("reason", "str"))),

    # ---- context / plan / artifacts / errors ------------------------------
    ev("context.updated", stream=CONV, group="conv", producer="kernel", retention="30d",
       payload=(f("used", "int"), f("max", "int"), f("breakdown", "json"))),
    ev("context.compacted", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("before", "int"), f("after", "int"),
                f("strategy", "enum:summary|truncate|evict"))),
    ev("plan.updated", stream=CONV, group="conv", producer="kernel", retention="90d",
       payload=(f("steps", "arr:obj:Step"), f("status", "enum:draft|active|done|cancelled"))),
    ev("artifact.created", stream=CONV, group="conv", producer="tools", retention="forever",
       payload=(f("artifact_id", "ref:art"), f("kind", "enum:file|image|pdf|pr|diff|report|link"),
                f("mime", "str", required=False), f("size", "int", required=False),
                f("ref", "str"), f("ticket_id", "ref:tk", required=False))),
    ev("artifact.updated", stream=CONV, group="conv", producer="tools", retention="forever",
       payload=(f("artifact_id", "ref:art"), f("patch", "json", required=False))),
    ev("error", stream=CONV, group="conv", producer="any", retention="90d",
       payload=(f("code", "str"), f("message", "str"), f("retryable", "bool"),
                f("source", "enum:model|tool|executor|intake|platform"),
                f("details", "json", required=False))),

    # ---- intake: triggers & eval -----------------------------------------
    ev("trigger.received", stream=SRC, group="intake", producer="intake", retention="30d",
       payload=(f("trigger_id", "ref:tr"), f("source_id", "ref:src"), f("kind", "str"),
                f("actor", "obj:Actor"), f("thread_key", "str"), f("dedupe_key", "str"))),
    ev("trigger.filtered", stream=SRC, group="intake", producer="intake", retention="30d",
       payload=(f("trigger_id", "ref:tr"),
                f("reason", "enum:actor_not_allowed|bot_not_allowed|not_explicit|rate_limited|rule_denied|self_message"),
                f("rule_id", "str", required=False))),
    ev("trigger.fanned_out", stream=SRC, group="intake", producer="intake", retention="30d",
       payload=(f("trigger_id", "ref:tr"), f("ticket_id", "ref:tk"), f("event_thread_id", "ref:et"))),
    ev("eval.started", stream=SRC, group="intake", producer="intake", retention="90d",
       payload=(f("eval_id", "ref:ev"), f("event_thread_id", "ref:et"),
                f("batch_size", "int"), f("model", "str"))),
    ev("eval.decided", stream=SRC, group="intake", producer="intake", retention="180d",
       payload=(f("eval_id", "ref:ev"), f("decision", "enum:accept|stop|ignore|unavailable"),
                f("strength", "enum:explicit|inferred", required=False),
                f("scope", "arr:str", required=False), f("confidence", "float"),
                f("policy_version", "int"), f("reasons", "arr:str"),
                f("duplicate_of", "ref:tk", required=False))),
    ev("cron.fired", stream=SRC, group="intake", producer="scheduler", retention="1y",
       payload=(f("cron_job_id", "ref:cj"), f("scheduled_at", "ts"), f("fired_at", "ts"),
                f("action", "enum:notify|run_agent|run_workflow"),
                f("trigger_id", "ref:tr", required=False), f("late", "bool", required=False))),
    ev("channel.inbound", stream=SRC, group="intake", producer="channels", retention="30d",
       payload=(f("channel_id", "ref:ch"), f("channel_kind", "str"),
                f("external_id", "str"), f("sender", "json"), f("content", "json"),
                f("thread_key", "str"), f("received_at", "ts"), f("dedupe_key", "str"))),

    # ---- ticket lifecycle -------------------------------------------------
    ev("ticket.opened", stream=TICKET, group="ticket", producer="intake", retention="forever",
       payload=(f("ticket_id", "ref:tk"), f("title", "str"), f("source_id", "ref:src"),
                f("mandate", "obj:Mandate"), f("event_thread_id", "ref:et"))),
    ev("ticket.resumed", stream=TICKET, group="ticket", producer="intake", retention="forever",
       payload=(f("ticket_id", "ref:tk"), f("by", "ref:u"), f("input_id", "ref:tr"))),
    ev("ticket.ended", stream=TICKET, group="ticket", producer="intake", retention="forever",
       payload=(f("ticket_id", "ref:tk"),
                f("reason", "enum:completed|stopped_by_human|policy_revoked|abandoned|merged"),
                f("by", "ref:u", required=False), f("summary", "str", required=False))),
    ev("ticket.mandate_invalidated", stream=TICKET, group="ticket", producer="intake", retention="forever",
       payload=(f("ticket_id", "ref:tk"), f("policy_version", "int"), f("reasons", "arr:str"))),
    ev("ticket.merged", stream=TICKET, group="ticket", producer="intake", retention="forever",
       payload=(f("ticket_id", "ref:tk"), f("into", "ref:tk"))),

    # ---- assignments ------------------------------------------------------
    ev("assignment.started", stream=TICKET, group="ticket", producer="intake", retention="1y",
       payload=(f("assignment_id", "ref:as"), f("ticket_id", "ref:tk"),
                f("executor_kind", "enum:builtin|codex|claude_code|dsh"),
                f("session_ref", "str", required=False))),
    ev("assignment.reported", stream=TICKET, group="ticket", producer="executor", retention="1y",
       payload=(f("assignment_id", "ref:as"),
                f("state", "enum:progress|waiting|ready|blocked|failed|dropped"),
                f("progress", "float", required=False), f("summary", "str"),
                f("facts", "json", required=False),
                f("artifacts", "arr:obj:ArtifactRef", required=False),
                f("usage", "obj:Usage", required=False))),
    ev("assignment.ended", stream=TICKET, group="ticket", producer="intake", retention="1y",
       payload=(f("assignment_id", "ref:as"), f("state", "enum:ended|dead"),
                f("reason", "str", required=False))),
    ev("assignment.dead", stream=TICKET, group="ticket", producer="intake", retention="1y",
       payload=(f("assignment_id", "ref:as"), f("attempts", "int"), f("reason", "str"))),

    # ---- delegations (team dispatch) --------------------------------------
    ev("delegation.started", stream=TICKET, group="ticket", producer="orchestration", retention="1y",
       payload=(f("delegation_id", "ref:dg"), f("team_id", "str"),
                f("parent_run_id", "ref:rn"), f("member_agent_id", "str"),
                f("child_thread_id", "ref:th", required=False),
                f("dedupe_key", "str"))),
    ev("delegation.ended", stream=TICKET, group="ticket", producer="orchestration", retention="1y",
       payload=(f("delegation_id", "ref:dg"), f("state", "enum:ended|dead"),
                f("reason", "str", required=False), f("usage", "obj:Usage", required=False))),

    # ---- attentions -------------------------------------------------------
    ev("attention.requested", stream=USER, group="user", producer="intake", retention="forever",
       payload=(f("attention_id", "ref:at"), f("ticket_id", "ref:tk"),
                f("kind", "enum:approval|question|blocked"), f("question", "str"),
                f("options", "arr:str", required=False), f("expires_at", "ts"))),
    ev("attention.resolved", stream=USER, group="user", producer="user", retention="forever",
       payload=(f("attention_id", "ref:at"),
                f("status", "enum:answered|expired|dismissed"),
                f("answer", "json", required=False), f("by", "ref:u", required=False))),

    # ---- watchdog / channel / usage --------------------------------------
    ev("watchdog.alert", stream=SYS, group="sys", producer="watchdog", retention="90d",
       payload=(f("assignment_id", "ref:as"),
                f("kind", "enum:stalled|drifting|error_loop"), f("detail", "str"),
                f("action", "enum:notify|stop|requeue"))),
    ev("channel.sent", stream=TICKET, group="ticket", producer="channels", retention="1y",
       payload=(f("channel_id", "ref:ch"), f("ticket_id", "ref:tk"), f("target", "json"),
                f("external_id", "str"), f("idem_key", "str"))),
    ev("channel.failed", stream=TICKET, group="ticket", producer="channels", retention="1y",
       payload=(f("channel_id", "ref:ch"), f("code", "str"), f("message", "str"),
                f("retryable", "bool"))),
    ev("memory.written", stream=SYS, group="sys", producer="memory", retention="forever",
       payload=(f("atom_id", "ref:ma"), f("tenant_id", "str"), f("agent_id", "str"),
                f("kind", "enum:fact|preference|episode|profile|skill"),
                f("source", "enum:explicit_user|assistant_inferred|import|migration"),
                f("confidence", "float"), f("evidence", "json"))),
    ev("memory.updated", stream=SYS, group="sys", producer="memory", retention="forever",
       payload=(f("atom_id", "ref:ma"),
                f("status", "enum:active|retired|pending_review"),
                f("supersedes", "ref:ma", required=False), f("reason", "str", required=False))),
    ev("plugin.installed", stream=SYS, group="sys", producer="capabilities", retention="1y",
       payload=(f("plugin_id", "ref:pl"), f("version", "str"),
                f("permissions", "arr:str"), f("signature", "str", required=False))),
    ev("plugin.failed", stream=SYS, group="sys", producer="capabilities", retention="1y",
       payload=(f("plugin_id", "ref:pl"), f("code", "str"), f("message", "str"))),
    ev("notification.created", stream=SYS, group="sys", producer="notifications", retention="90d",
       payload=(f("notification_id", "ref:nt"), f("user_id", "ref:u"),
                f("kind", "enum:task|cloud|export|system"), f("title", "str"),
                f("link", "str", required=False), f("dedupe_key", "str"))),
    ev("workspace.changed", stream=SYS, group="sys", producer="capabilities", retention="90d",
       payload=(f("agent_id", "str"), f("thread_id", "ref:th", required=False),
                f("path", "str"), f("change", "enum:created|updated|deleted"),
                f("size", "int", required=False))),
    ev("control.started", stream=SYS, group="sys", producer="control", retention="90d",
       payload=(f("session_id", "ref:cs"), f("kind", "enum:terminal|browser"),
                f("agent_id", "ref:ag", required=False))),
    ev("control.ended", stream=SYS, group="sys", producer="control", retention="90d",
       payload=(f("session_id", "ref:cs"), f("status", "enum:closed|error"),
                f("reason", "str", required=False))),
    ev("subscription.created", stream=TICKET, group="ticket", producer="intake", retention="1y",
       payload=(f("subscription_id", "ref:sb"), f("ticket_id", "ref:tk"),
                f("event_thread_id", "ref:et"))),
    ev("usage.recorded", stream=SYS, group="sys", producer="any", retention="1y",
       payload=(f("scope", "enum:turn|eval|tool|embedding|executor"),
                f("model", "str", required=False), f("input_tokens", "int"),
                f("output_tokens", "int"), f("cached_tokens", "int"),
                f("cost_micros", "int"), f("currency", "enum:CNY|USD"),
                f("price_version", "str"))),
)


def validate_spec() -> None:
    """Cheap invariants that must hold for the generator to be meaningful."""
    assert len(EVENTS) == 61, f"expected 61 events, got {len(EVENTS)}"
    seen: set[str] = set()
    for e in EVENTS:
        assert e.type not in seen, f"duplicate event type: {e.type}"
        seen.add(e.type)
        assert e.stream in {CONV, SRC, TICKET, USER, SYS}, e.type
        assert e.group in {"conv", "intake", "ticket", "user", "sys"}, e.type
        names = [p.name for p in e.payload]
        assert len(names) == len(set(names)), f"duplicate field in {e.type}"
        for p in e.payload:
            root = p.type.split(":", 1)[0]
            assert root in {"str", "int", "float", "bool", "ts", "json", "ref", "enum", "arr", "obj"}, \
                f"{e.type}.{p.name}: bad type {p.type}"
            if p.type.startswith("obj:"):
                assert p.type[4:] in COMMON, f"{e.type}.{p.name}: unknown object {p.type}"


validate_spec()
