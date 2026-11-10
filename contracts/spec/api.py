"""PolyOpus HTTP API specification: M0/M1 slice + task center.

Covers auth, agents, threads, turns, attachments, sources, health, tickets and
attentions (46 operations). Authoring source for `schemas/api/openapi.json`,
`generated/py/.../api_models.py` and `generated/ts/src/api.gen.ts`.
Run `python contracts/generate.py`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .events import Field, f


@dataclass(frozen=True)
class Model:
    name: str
    fields: tuple[Field, ...]
    desc: str = ""


@dataclass(frozen=True)
class Param:
    name: str
    location: Literal["query", "path", "header"]
    type: str
    required: bool = False
    desc: str = ""


@dataclass(frozen=True)
class Op:
    method: Literal["GET", "POST", "PATCH", "DELETE"]
    path: str
    op_id: str
    summary: str
    tag: str
    response: str
    params: tuple[Param, ...] = ()
    body: str | None = None
    desc: str = ""


MODELS: tuple[Model, ...] = (
    Model("SourceRef", (
        f("id", "str"), f("kind", "enum:github|feishu|wecom|dingtalk|email|webhook|schedule"),
        f("name", "str"), f("status", "enum:active|paused|degraded"),
    )),
    Model("ActorRef", (f("id", "str"), f("name", "str"))),
    Model("Badge", (
        f("kind", "enum:strength|executor|policy|stalled|budget|merged"),
        f("label", "str"), f("tone", "enum:neutral|info|warn|danger|success"),
    )),
    Model("Attention", (
        f("id", "ref:at"), f("kind", "enum:approval|question|blocked"), f("question", "str"),
        f("options", "arr:str", required=False),
        f("status", "enum:pending|answered|expired|dismissed"),
        f("expiresAt", "ts"), f("ticketId", "ref:tk"), f("ticketTitle", "str"),
    ), "A structured item that needs a human decision."),
    Model("Assignment", (
        f("id", "ref:as"), f("executor", "enum:builtin|codex|claude_code|dsh"),
        f("state", "enum:pending|running|ended|dead"), f("progress", "float", required=False),
        f("lastHeartbeatAt", "ts", required=False), f("startedAt", "ts", required=False),
        f("stalled", "bool", required=False), f("costMicros", "int", required=False),
        f("budgetMicros", "int", required=False),
    )),
    Model("Artifact", (
        f("kind", "enum:file|image|pdf|pr|diff|report|link"), f("ref", "str"),
        f("mime", "str", required=False), f("size", "int", required=False),
    )),
    Model("Report", (
        f("id", "ref:rp"), f("at", "ts"),
        f("state", "enum:progress|waiting|ready|blocked|failed|dropped"),
        f("summary", "str"), f("progress", "float", required=False),
        f("facts", "json", required=False), f("artifacts", "arr:obj:Artifact", required=False),
    )),
    Model("TimelineEvent", (
        f("id", "str"), f("at", "ts"),
        f("kind", "enum:trigger|gate|eval|ticket|assignment|report|attention|channel"),
        f("title", "str"), f("description", "str", required=False),
        f("actor", "obj:ActorRef", required=False),
        f("tone", "enum:neutral|info|success|warn|danger"),
        f("link", "json", required=False), f("expandable", "json", required=False),
    )),
    Model("Ticket", (
        f("id", "ref:tk"), f("title", "str"),
        f("bucket", "enum:attention|running|queued|done"),
        f("state", "enum:open|ended"), f("source", "obj:SourceRef"), f("actor", "obj:ActorRef"),
        f("createdAt", "ts"), f("updatedAt", "ts"),
        f("strength", "enum:explicit|inferred"), f("policyVersion", "int"),
        f("executor", "enum:builtin|codex|claude_code|dsh", required=False),
        f("assignment", "obj:Assignment", required=False),
        f("attention", "obj:Attention", required=False),
        f("summary", "str", required=False), f("progress", "float", required=False),
        f("costMicros", "int", required=False), f("badges", "arr:obj:Badge"),
    ), "A unit of authorized work."),
    Model("TicketList", (f("items", "arr:obj:Ticket"), f("nextCursor", "str", required=False))),
    Model("ReportList", (f("items", "arr:obj:Report"), f("nextCursor", "str", required=False))),
    Model("TimelineList", (f("items", "arr:obj:TimelineEvent"), f("nextCursor", "str", required=False))),
    Model("AttentionList", (f("items", "arr:obj:Attention"), f("nextCursor", "str", required=False))),
    Model("Counts", (f("attention", "int"), f("running", "int"), f("queued", "int"), f("done", "int"))),
    Model("StopRequest", (f("reason", "str", required=False),)),
    Model("AssignRequest", (
        f("executor", "enum:builtin|codex|claude_code|dsh"), f("note", "str", required=False),
    )),
    Model("BudgetRequest", (
        f("maxTokens", "int", required=False), f("maxCostMicros", "int", required=False),
        f("maxWallClockSeconds", "int", required=False),
    )),
    Model("MergeRequest", (f("into", "ref:tk"), f("note", "str", required=False))),
    Model("AnswerRequest", (
        f("decision", "enum:approve|deny|answer|snooze"),
        f("answer", "json", required=False), f("scope", "enum:once|session", required=False),
    )),
    Model("ErrorBody", (
        f("code", "str"), f("message", "str"), f("details", "json", required=False),
        f("traceId", "str", required=False),
    )),
    Model("ErrorEnvelope", (f("error", "obj:ErrorBody"),)),

    # ---- M0/M1: identity -------------------------------------------------
    Model("TenantRef", (f("id", "str"), f("name", "str"))),
    Model("TenantList", (f("items", "arr:obj:TenantRef"),)),
    Model("User", (
        f("id", "ref:u"), f("username", "str"), f("displayName", "str"),
        f("role", "enum:admin|member|auditor"), f("tenantId", "str"),
        f("status", "enum:active|disabled", required=False),
        f("createdAt", "ts"), f("lastLoginAt", "ts", required=False),
    )),
    Model("LoginRequest", (f("username", "str"), f("password", "str"))),
    Model("TokenPair", (
        f("accessToken", "str"), f("refreshToken", "str"), f("expiresIn", "int"),
    )),
    Model("LoginResponse", (
        f("accessToken", "str"), f("refreshToken", "str"), f("expiresIn", "int"),
        f("user", "obj:User"),
    )),
    Model("RefreshRequest", (f("refreshToken", "str"),)),
    Model("SetupRequest", (
        f("username", "str"), f("password", "str"),
        f("displayName", "str", required=False), f("tenantName", "str", required=False),
    )),
    Model("SetupResponse", (f("user", "obj:User"), f("tenant", "obj:TenantRef"))),
    Model("Me", (
        f("user", "obj:User"), f("permissions", "arr:str"),
        f("tenants", "arr:obj:TenantRef"),
    )),
    Model("Ok", (f("ok", "bool"),)),

    # ---- M0/M1: agents ---------------------------------------------------
    Model("Agent", (
        f("id", "ref:ag"), f("name", "str"), f("description", "str", required=False),
        f("status", "enum:draft|published|disabled"), f("version", "int"),
        f("model", "str", required=False), f("tools", "arr:str"),
        f("createdAt", "ts"), f("updatedAt", "ts"),
    )),
    Model("AgentList", (f("items", "arr:obj:Agent"), f("nextCursor", "str", required=False))),
    Model("AgentCreate", (
        f("name", "str"), f("description", "str", required=False),
        f("model", "str", required=False), f("systemPrompt", "str", required=False),
    )),
    Model("AgentPatch", (
        f("name", "str", required=False), f("description", "str", required=False),
        f("model", "str", required=False),
        f("status", "enum:draft|published|disabled", required=False),
    )),
    Model("AgentTestRequest", (f("message", "str"),)),

    # ---- M0/M1: conversations -------------------------------------------
    Model("Thread", (
        f("id", "ref:th"), f("agentId", "ref:ag"), f("title", "str"),
        f("agentVersionId", "str", required=False),
        f("unreadCount", "int", required=False),
        f("status", "enum:active|archived|deleted"),
        f("createdAt", "ts"), f("updatedAt", "ts"),
        f("lastMessageAt", "ts", required=False),
    )),
    Model("ThreadList", (f("items", "arr:obj:Thread"), f("nextCursor", "str", required=False))),
    Model("ThreadCreate", (f("agentId", "ref:ag"), f("title", "str", required=False))),
    Model("ThreadPatch", (
        f("title", "str", required=False),
        f("status", "enum:active|archived", required=False),
    )),
    Model("Message", (
        f("id", "ref:ms"), f("threadId", "ref:th"), f("turnId", "ref:tu", required=False),
        f("role", "enum:user|assistant|tool|system"), f("content", "json"),
        f("status", "enum:streaming|completed|failed"), f("createdAt", "ts"),
    )),
    Model("MessageList", (f("items", "arr:obj:Message"), f("nextCursor", "str", required=False))),
    Model("Turn", (
        f("id", "ref:tu"), f("threadId", "ref:th"), f("seq", "int"),
        f("status", "enum:queued|running|waiting_approval|waiting_input|completed|failed|cancelled"),
        f("input", "json"), f("errorCode", "str", required=False),
        f("createdAt", "ts"), f("startedAt", "ts", required=False),
        f("finishedAt", "ts", required=False),
    )),
    Model("TurnCreate", (
        f("input", "json"), f("attachments", "arr:str", required=False),
        f("model", "str", required=False),
    )),
    Model("TurnList", (f("items", "arr:obj:Turn"), f("nextCursor", "str", required=False))),
    Model("Event", (
        f("seq", "int"), f("type", "str"), f("at", "ts"), f("payload", "json"),
    )),
    Model("EventList", (f("items", "arr:obj:Event"), f("nextCursor", "str", required=False))),
    Model("SteerRequest", (f("kind", "enum:text|image|file"), f("content", "json"))),
    Model("SteerResponse", (
        f("id", "ref:st"), f("status", "enum:queued|drained|removed|rejected"),
    )),
    Model("RegenerateRequest", (f("note", "str", required=False),)),
    Model("EditResendRequest", (f("content", "json"),)),

    # ---- M0/M1: runs / trace --------------------------------------------
    Model("Run", (
        f("id", "ref:rn"), f("turnId", "ref:tu"), f("attempt", "int"),
        f("status", "enum:leased|running|waiting|completed|failed|cancelled"),
        f("startedAt", "ts", required=False), f("endedAt", "ts", required=False),
    )),
    Model("RunList", (f("items", "arr:obj:Run"), f("nextCursor", "str", required=False))),
    Model("Step", (
        f("id", "str"), f("runId", "ref:rn"), f("idx", "int"),
        f("kind", "enum:model|tool|approval|compact|delegate"),
        f("status", "enum:running|completed|failed|skipped"),
        f("startedAt", "ts", required=False), f("endedAt", "ts", required=False),
        f("inputRef", "str", required=False), f("outputRef", "str", required=False),
    )),
    Model("StepList", (f("items", "arr:obj:Step"), f("nextCursor", "str", required=False))),
    Model("Trace", (f("turn", "obj:Turn"), f("runs", "arr:obj:Run"))),

    # ---- M0/M1: attachments / sources / health --------------------------
    Model("Attachment", (
        f("id", "ref:af"), f("name", "str"), f("mime", "str"), f("size", "int"),
        f("url", "str", required=False), f("createdAt", "ts"),
    )),
    # M1 先按 JSON metadata + base64 建模；生产可切 multipart，字段名保持一致
    Model("AttachmentCreate", (
        f("name", "str"), f("mime", "str"), f("size", "int"),
        f("contentBase64", "str", required=False),
    )),
    Model("Source", (
        f("id", "ref:src"),
        f("kind", "enum:github|feishu|wecom|dingtalk|email|webhook|schedule"),
        f("name", "str"), f("status", "enum:active|paused|degraded"),
        f("createdAt", "ts"),
    )),
    Model("SourceList", (f("items", "arr:obj:Source"), f("nextCursor", "str", required=False))),
    Model("SourceCreate", (
        f("kind", "enum:github|feishu|wecom|dingtalk|email|webhook|schedule"),
        f("name", "str"), f("config", "json", required=False),
    )),
    Model("SourcePauseRequest", (f("paused", "bool"),)),
    Model("Trigger", (
        f("id", "ref:tr"), f("sourceId", "ref:src"), f("kind", "str"),
        f("status", "enum:received|filtered|fanned_out"), f("dedupeKey", "str"),
        f("receivedAt", "ts"),
    )),
    Model("TriggerList", (f("items", "arr:obj:Trigger"), f("nextCursor", "str", required=False))),
    Model("Health", (
        f("status", "enum:ok|degraded"), f("version", "str"), f("time", "ts"),
    )),

    # ---- P0: memory / context -------------------------------------------
    Model("MemoryAtom", (
        f("id", "ref:ma"),
        f("kind", "enum:fact|preference|episode|profile|skill"),
        f("text", "str"), f("confidence", "float"),
        f("status", "enum:active|retired|pending_review"),
        f("source", "enum:explicit_user|assistant_inferred|import|migration"),
        f("validFrom", "ts", required=False), f("validTo", "ts", required=False),
        f("supersedes", "ref:ma", required=False), f("evidence", "json"),
        f("createdAt", "ts"), f("updatedAt", "ts"),
    )),
    Model("MemoryAtomList", (
        f("items", "arr:obj:MemoryAtom"), f("nextCursor", "str", required=False),
    )),
    Model("MemoryCreate", (
        f("kind", "enum:fact|preference|episode|profile|skill"), f("text", "str"),
        f("confidence", "float", required=False), f("evidence", "json", required=False),
    )),
    Model("MemoryPatch", (
        f("text", "str", required=False),
        f("status", "enum:active|retired|pending_review", required=False),
        f("reason", "str", required=False),
    )),
    Model("MemoryHit", (f("atom", "obj:MemoryAtom"), f("score", "float"))),
    Model("MemorySearchResult", (f("query", "str"), f("items", "arr:obj:MemoryHit"))),
    Model("MemoryExport", (
        f("format", "enum:jsonl|json"), f("items", "arr:obj:MemoryAtom"),
    )),
    Model("MemoryPauseRequest", (
        f("paused", "bool"), f("until", "ts", required=False),
    )),
    Model("MemoryPauseState", (
        f("paused", "bool"), f("until", "ts", required=False), f("updatedAt", "ts"),
    )),
    Model("MemoryMetrics", (
        f("writeAccuracy", "float", required=False), f("recallAt8", "float", required=False),
        f("contradictionRate", "float", required=False), f("staleRate", "float", required=False),
        f("poisonedRate", "float", required=False), f("evaluatedAt", "ts"),
    )),
    Model("ContextSegment", (
        f("name", "enum:system|tools|skills|memory|knowledge|summary|recent|input|output"),
        f("tokens", "int"), f("budget", "int"),
    )),
    Model("ContextUsage", (
        f("threadId", "ref:th"), f("window", "int"), f("used", "int"),
        f("segments", "arr:obj:ContextSegment"), f("compactedAt", "ts", required=False),
    )),
    Model("CompactRequest", (
        f("strategy", "enum:auto|clear|compress", required=False),
    )),
    Model("CompactResult", (
        f("beforeTokens", "int"), f("afterTokens", "int"), f("strategy", "str"),
        f("snapshotRef", "str", required=False), f("probesPassed", "bool"),
    )),

    # ---- P0: channels ----------------------------------------------------
    Model("Channel", (
        f("id", "ref:ch"),
        f("kind", "enum:feishu|dingtalk|wecom|qq|telegram|discord"),
        f("displayName", "str"),
        f("status", "enum:active|disabled|error|expired"),
        f("lastError", "str", required=False),
        f("createdAt", "ts"), f("updatedAt", "ts"),
    )),
    Model("ChannelList", (
        f("items", "arr:obj:Channel"), f("nextCursor", "str", required=False),
    )),
    Model("ChannelCreate", (
        f("kind", "enum:feishu|dingtalk|wecom|qq|telegram|discord"),
        f("displayName", "str"), f("config", "json", required=False),
        f("credential", "json", required=False),
    )),
    Model("ChannelPatch", (
        f("displayName", "str", required=False), f("config", "json", required=False),
        f("credential", "json", required=False),
        f("status", "enum:active|disabled", required=False),
    )),
    Model("ChannelProbeResult", (
        f("ok", "bool"), f("missing", "arr:str"), f("details", "json", required=False),
    )),
    Model("ChannelBinding", (
        f("id", "ref:cb"), f("channelId", "ref:ch"), f("agentId", "ref:ag"),
        f("externalKey", "str"), f("config", "json", required=False),
        f("status", "enum:active|disabled"),
    )),
    Model("ChannelBindingList", (
        f("items", "arr:obj:ChannelBinding"), f("nextCursor", "str", required=False),
    )),
    Model("ChannelBindingCreate", (
        f("channelId", "ref:ch"), f("agentId", "ref:ag"), f("externalKey", "str"),
        f("config", "json", required=False),
    )),
    Model("ChannelBindingPatch", (
        f("agentId", "ref:ag", required=False), f("externalKey", "str", required=False),
        f("config", "json", required=False),
        f("status", "enum:active|disabled", required=False),
    )),
    Model("ChannelMessage", (
        f("id", "ref:cm"), f("channelId", "ref:ch"),
        f("direction", "enum:inbound|outbound"),
        f("externalId", "str"), f("threadId", "ref:th", required=False),
        f("status", "enum:received|sent|failed"), f("errorCode", "str", required=False),
        f("createdAt", "ts"),
    )),
    Model("ChannelMessageList", (
        f("items", "arr:obj:ChannelMessage"), f("nextCursor", "str", required=False),
    )),

    # ---- P0: tools / policy ---------------------------------------------
    Model("Tool", (
        f("toolKey", "str"),
        f("source", "enum:builtin|mcp|plugin|openapi|skill"),
        f("version", "str"), f("description", "str"),
        f("risk", "enum:low|medium|high|critical"),
        f("sideEffects", "bool"), f("idempotent", "bool"),
        f("scopes", "arr:str"), f("enabledGlobal", "bool"),
        f("inputSchema", "json"), f("outputSchema", "json", required=False),
        f("renderer", "str", required=False),
    )),
    Model("ToolList", (f("items", "arr:obj:Tool"), f("nextCursor", "str", required=False))),
    Model("ToolPatch", (f("enabledGlobal", "bool", required=False),)),
    Model("AgentToolBinding", (
        f("toolKey", "str"), f("enabled", "bool"), f("config", "json", required=False),
    )),
    Model("AgentToolList", (f("agentId", "ref:ag"), f("items", "arr:obj:AgentToolBinding"))),
    Model("AgentToolsUpdate", (f("items", "arr:obj:AgentToolBinding"),)),
    Model("PolicyRule", (
        f("id", "ref:pr"), f("tenantId", "str"), f("priority", "int"),
        f("when", "json"), f("effect", "enum:allow|ask|deny"),
        f("obligations", "json", required=False), f("version", "int"),
        f("enabled", "bool"), f("updatedAt", "ts"),
    )),
    Model("PolicyList", (
        f("items", "arr:obj:PolicyRule"), f("nextCursor", "str", required=False),
    )),
    Model("PolicyCreate", (
        f("priority", "int"), f("when", "json"), f("effect", "enum:allow|ask|deny"),
        f("obligations", "json", required=False), f("enabled", "bool", required=False),
    )),
    Model("PolicyPatch", (
        f("priority", "int", required=False), f("when", "json", required=False),
        f("effect", "enum:allow|ask|deny", required=False),
        f("obligations", "json", required=False), f("enabled", "bool", required=False),
    )),
    Model("PolicyEvaluationRequest", (
        f("agentId", "ref:ag", required=False), f("toolKey", "str"), f("args", "json"),
    )),
    Model("PolicyEvaluation", (
        f("decision", "enum:allow|ask|deny"), f("matchedRules", "arr:str"),
        f("obligations", "json", required=False), f("reason", "str", required=False),
    )),
    Model("OpenApiImportRequest", (
        f("url", "str", required=False), f("spec", "json", required=False),
        f("auth", "json", required=False),
    )),
    Model("OpenApiImportResult", (
        f("tools", "arr:obj:Tool"), f("warnings", "arr:str"),
    )),

    # ---- P0: teams / delegations ----------------------------------------
    Model("Team", (
        f("id", "ref:tm"), f("name", "str"), f("description", "str", required=False),
        f("coordinatorAgentId", "ref:ag"),
        f("status", "enum:active|disabled"), f("memberCount", "int"),
        f("createdAt", "ts"), f("updatedAt", "ts"),
    )),
    Model("TeamMember", (
        f("agentId", "ref:ag"), f("role", "enum:coordinator|member"),
        f("status", "enum:idle|busy"), f("joinedAt", "ts"),
    )),
    Model("TeamDetail", (
        f("team", "obj:Team"), f("members", "arr:obj:TeamMember"),
    )),
    Model("TeamList", (f("items", "arr:obj:Team"), f("nextCursor", "str", required=False))),
    Model("TeamCreate", (
        f("name", "str"), f("description", "str", required=False),
        f("coordinatorAgentId", "ref:ag"),
        f("memberAgentIds", "arr:str", required=False),
    )),
    Model("TeamPatch", (
        f("name", "str", required=False), f("description", "str", required=False),
        f("coordinatorAgentId", "ref:ag", required=False),
        f("status", "enum:active|disabled", required=False),
    )),
    Model("TeamMemberAdd", (
        f("agentId", "ref:ag"), f("role", "enum:member|coordinator", required=False),
    )),
    Model("TeamStopRequest", (
        f("scope", "enum:coordinator|room"), f("reason", "str", required=False),
    )),
    Model("Delegation", (
        f("id", "ref:dg"), f("teamId", "ref:tm"),
        f("parentRunId", "ref:rn", required=False),
        f("memberAgentId", "ref:ag"), f("childThreadId", "ref:th", required=False),
        f("state", "enum:pending|running|ended|dead"), f("attempts", "int"),
        f("dedupeKey", "str"), f("createdAt", "ts"), f("endedAt", "ts", required=False),
    )),
    Model("DelegationList", (
        f("items", "arr:obj:Delegation"), f("nextCursor", "str", required=False),
    )),
    Model("DelegationCreate", (
        f("teamId", "ref:tm"), f("parentRunId", "ref:rn", required=False),
        f("memberAgentId", "ref:ag"), f("taskId", "str"),
        f("payload", "json", required=False),
    )),
    Model("DelegationRetryRequest", (f("note", "str", required=False),)),

    # ---- P0: control plane (terminal / browser) -------------------------
    Model("ControlSession", (
        f("id", "ref:cs"), f("kind", "enum:terminal|browser"),
        f("agentId", "ref:ag", required=False),
        f("status", "enum:starting|running|closed|error"),
        f("endpoint", "str", required=False), f("meta", "json", required=False),
        f("startedAt", "ts"), f("lastSeenAt", "ts", required=False),
        f("endedAt", "ts", required=False),
    )),
    Model("ControlSessionList", (
        f("items", "arr:obj:ControlSession"), f("nextCursor", "str", required=False),
    )),
    Model("ControlSessionCreate", (
        f("kind", "enum:terminal|browser"), f("agentId", "ref:ag", required=False),
    )),
    Model("ControlStreamTicket", (
        f("url", "str"), f("protocol", "enum:webrtc|jpeg|ws"), f("expiresAt", "ts"),
    )),
    Model("ControlInputRequest", (
        f("kind", "enum:key|text|resize"), f("payload", "json"),
    )),

    # ---- auth extensions: MFA / SSO / API keys / sessions ----------------
    Model("MfaEnrollment", (
        f("secret", "str"), f("otpauthUrl", "str"), f("recoveryCodes", "arr:str"),
    )),
    Model("MfaVerifyRequest", (f("code", "str"),)),
    Model("MfaStatus", (
        f("enabled", "bool"), f("methods", "arr:str"),
        f("recoveryCodesRemaining", "int"),
    )),
    Model("WebAuthnChallenge", (
        f("challenge", "str"), f("rpId", "str"), f("timeout", "int"),
    )),
    Model("WebAuthnRegisterRequest", (
        f("credential", "json"), f("label", "str", required=False),
    )),
    Model("AuthProvider", (
        f("id", "str"), f("kind", "enum:oidc|oauth|ldap"),
        f("name", "str"), f("enabled", "bool"),
    )),
    Model("AuthProviderList", (f("items", "arr:obj:AuthProvider"),)),
    Model("SsoStartRequest", (
        f("provider", "str"), f("redirectUri", "str", required=False),
    )),
    Model("AuthRedirect", (f("url", "str"), f("state", "str"))),
    Model("SsoCallbackRequest", (
        f("provider", "str"), f("code", "str"), f("state", "str"),
    )),
    Model("LdapLoginRequest", (f("username", "str"), f("password", "str"))),
    Model("ApiKey", (
        f("id", "ref:ak"), f("name", "str"), f("prefix", "str"),
        f("scopes", "arr:str"), f("lastUsedAt", "ts", required=False),
        f("expiresAt", "ts", required=False), f("createdAt", "ts"),
    )),
    Model("ApiKeyList", (f("items", "arr:obj:ApiKey"),)),
    Model("ApiKeyCreate", (
        f("name", "str"), f("scopes", "arr:str"), f("expiresAt", "ts", required=False),
    )),
    Model("ApiKeyCreated", (f("key", "obj:ApiKey"), f("secret", "str"))),
    Model("SessionInfo", (
        f("id", "str"), f("userAgent", "str", required=False),
        f("ip", "str", required=False), f("createdAt", "ts"),
        f("lastSeenAt", "ts"), f("current", "bool"),
    )),
    Model("SessionList", (f("items", "arr:obj:SessionInfo"),)),

    # ---- cron lifecycle --------------------------------------------------
    Model("CronJob", (
        f("id", "ref:cj"), f("name", "str"), f("schedule", "str"),
        f("timezone", "str"), f("action", "enum:notify|run_agent|run_workflow"),
        f("enabled", "bool"), f("nextRunAt", "ts", required=False),
        f("lastRunAt", "ts", required=False), f("createdAt", "ts"),
    )),
    Model("CronJobList", (f("items", "arr:obj:CronJob"), f("nextCursor", "str", required=False))),
    Model("CronJobCreate", (
        f("name", "str"), f("schedule", "str"), f("timezone", "str", required=False),
        f("action", "enum:notify|run_agent|run_workflow"),
        f("payload", "json", required=False),
    )),
    Model("CronJobPatch", (
        f("name", "str", required=False), f("schedule", "str", required=False),
        f("timezone", "str", required=False),
        f("action", "enum:notify|run_agent|run_workflow", required=False),
        f("enabled", "bool", required=False),
    )),
    Model("CronRun", (
        f("id", "ref:cr"), f("jobId", "ref:cj"),
        f("status", "enum:queued|running|succeeded|failed|skipped"),
        f("scheduledAt", "ts"), f("startedAt", "ts", required=False),
        f("endedAt", "ts", required=False), f("error", "str", required=False),
        f("triggerId", "ref:tr", required=False),
    )),
    Model("CronRunList", (f("items", "arr:obj:CronRun"), f("nextCursor", "str", required=False))),

    # ---- users / invites / roles / groups --------------------------------
    Model("UserList", (
        f("items", "arr:obj:User"), f("nextCursor", "str", required=False),
    )),
    Model("UserCreate", (
        f("username", "str"), f("displayName", "str"),
        f("role", "enum:admin|member|auditor"),
        f("password", "str", required=False), f("sendInvite", "bool", required=False),
    )),
    Model("UserPatch", (
        f("displayName", "str", required=False),
        f("role", "enum:admin|member|auditor", required=False),
        f("status", "enum:active|disabled", required=False),
    )),
    Model("PasswordResetRequest", (f("newPassword", "str", required=False),)),
    Model("PasswordResetResult", (f("temporaryPassword", "str"),)),
    Model("UserBatchRequest", (
        f("userIds", "arr:str"), f("action", "enum:enable|disable|delete"),
    )),
    Model("BatchFailure", (f("id", "str"), f("code", "str"), f("message", "str"))),
    Model("UserBatchResult", (
        f("ok", "int"), f("failed", "arr:obj:BatchFailure"),
    )),
    Model("Invite", (
        f("id", "ref:iv"), f("email", "str"), f("role", "str"),
        f("status", "enum:pending|accepted|expired|revoked"),
        f("expiresAt", "ts"), f("createdAt", "ts"),
    )),
    Model("InviteList", (
        f("items", "arr:obj:Invite"), f("nextCursor", "str", required=False),
    )),
    Model("InviteCreate", (
        f("email", "str"), f("role", "str"),
        f("expiresInHours", "int", required=False),
    )),
    Model("InviteAcceptRequest", (
        f("token", "str"), f("password", "str"), f("displayName", "str", required=False),
    )),
    Model("InvitePreview", (
        f("email", "str"), f("role", "str"), f("tenantName", "str"),
        f("expiresAt", "ts"),
    )),
    Model("Role", (
        f("id", "ref:rl"), f("name", "str"), f("description", "str", required=False),
        f("builtin", "bool"), f("permissions", "arr:str"),
    )),
    Model("RoleList", (f("items", "arr:obj:Role"),)),
    Model("RoleDetail", (
        f("role", "obj:Role"), f("permissions", "arr:str"), f("userCount", "int"),
    )),
    Model("RoleCreate", (
        f("name", "str"), f("description", "str", required=False),
        f("permissions", "arr:str"),
    )),
    Model("RolePatch", (
        f("name", "str", required=False), f("description", "str", required=False),
        f("permissions", "arr:str", required=False),
    )),
    Model("Group", (
        f("id", "ref:gp"), f("name", "str"), f("description", "str", required=False),
        f("memberCount", "int"), f("createdAt", "ts"),
    )),
    Model("GroupList", (
        f("items", "arr:obj:Group"), f("nextCursor", "str", required=False),
    )),
    Model("GroupDetail", (f("group", "obj:Group"), f("members", "arr:obj:User"))),
    Model("GroupCreate", (
        f("name", "str"), f("description", "str", required=False),
    )),
    Model("GroupPatch", (
        f("name", "str", required=False), f("description", "str", required=False),
    )),
    Model("GroupMembersUpdate", (f("userIds", "arr:str"),)),
    Model("ReauthRequest", (
        f("method", "enum:password|totp|passkey"),
        f("password", "str", required=False), f("code", "str", required=False),
    )),
    Model("ReauthGrant", (
        f("grantToken", "str"), f("expiresAt", "ts"), f("scope", "arr:str"),
    )),

    # ---- v1.1: cloud hosts ----------------------------------------------
    Model("CloudAccount", (
        f("id", "ref:ca"), f("provider", "enum:tencent|aws|aliyun"),
        f("displayName", "str"),
        f("status", "enum:active|expired|revoked|error"),
        f("scopes", "arr:str"), f("expiresAt", "ts", required=False),
        f("lastSyncAt", "ts", required=False), f("createdAt", "ts"),
    )),
    Model("CloudStatus", (
        f("authorized", "bool"), f("provider", "enum:tencent|aws|aliyun"),
        f("accounts", "arr:obj:CloudAccount"), f("syncAt", "ts", required=False),
    )),
    Model("CloudAuthorizeRequest", (
        f("provider", "enum:tencent|aws|aliyun"),
        f("redirectUri", "str", required=False),
    )),
    Model("CloudCallbackRequest", (
        f("provider", "enum:tencent|aws|aliyun"), f("code", "str"), f("state", "str"),
    )),
    Model("CloudImportRequest", (
        f("provider", "enum:tencent|aws|aliyun"), f("profile", "str", required=False),
    )),
    Model("CloudRegion", (
        f("id", "str"), f("name", "str"), f("zones", "arr:str"),
    )),
    Model("CloudRegionList", (f("items", "arr:obj:CloudRegion"),)),
    Model("CloudInstance", (
        f("id", "ref:ci"), f("accountId", "ref:ca"),
        f("provider", "enum:tencent|aws|aliyun"),
        f("region", "str"), f("zone", "str", required=False),
        f("externalId", "str"), f("name", "str"),
        f("state", "enum:running|stopped|starting|stopping|rebooting|error|unknown"),
        f("spec", "json", required=False), f("address", "json", required=False),
        f("os", "str", required=False), f("tags", "json", required=False),
        f("lastSeenAt", "ts", required=False), f("snapshotAt", "ts", required=False),
    )),
    Model("CloudInstanceList", (
        f("items", "arr:obj:CloudInstance"), f("nextCursor", "str", required=False),
    )),
    Model("CloudInstanceRef", (
        f("region", "str"), f("externalId", "str"),
    )),
    Model("MetricPoint", (
        f("at", "ts"), f("cpu", "float"),
        f("memory", "float", required=False), f("disk", "float", required=False),
        f("netIn", "float", required=False), f("netOut", "float", required=False),
    )),
    Model("CloudMetrics", (
        f("instance", "obj:CloudInstanceRef"),
        f("points", "arr:obj:MetricPoint"), f("stale", "bool", required=False),
    )),
    Model("CloudMetricsRequest", (
        f("instances", "arr:obj:CloudInstanceRef"),
        f("minutes", "int", required=False), f("period", "int", required=False),
    )),
    Model("CloudMetricsBatch", (f("items", "arr:obj:CloudMetrics"),)),
    Model("CloudTrendRequest", (
        f("instances", "arr:obj:CloudInstanceRef"),
        f("minutes", "int", required=False), f("period", "int", required=False),
        f("maxInstances", "int", required=False),
    )),
    Model("CloudTrendSeries", (
        f("name", "str"), f("points", "arr:obj:MetricPoint"),
    )),
    Model("CloudClusterTrend", (f("series", "arr:obj:CloudTrendSeries"),)),
    Model("CloudActionRequest", (
        f("action", "enum:start|stop|reboot"), f("reason", "str", required=False),
    )),
    Model("CloudOp", (
        f("id", "ref:co"), f("accountId", "ref:ca"), f("instanceId", "ref:ci"),
        f("action", "enum:start|stop|reboot"),
        f("status", "enum:pending|running|succeeded|failed"),
        f("requestedBy", "ref:u"), f("reason", "str", required=False),
        f("result", "json", required=False),
        f("createdAt", "ts"), f("finishedAt", "ts", required=False),
    )),

    # ---- resource ACL ----------------------------------------------------
    Model("ResourceGrant", (
        f("id", "ref:rg"), f("tenantId", "str"),
        f("resourceType", "enum:skill_package|knowledge_base|connector|model|storage_backend|plugin|expert|agent"),
        f("resourceKey", "str"), f("groupId", "ref:gp"),
        f("permission", "enum:view|edit|manage"),
        f("grantedBy", "ref:u"), f("createdAt", "ts"),
    )),
    Model("ResourceGrantList", (
        f("items", "arr:obj:ResourceGrant"), f("nextCursor", "str", required=False),
    )),
    Model("ResourceGrantCreate", (
        f("resourceType", "enum:skill_package|knowledge_base|connector|model|storage_backend|plugin|expert|agent"),
        f("resourceKey", "str"), f("permission", "enum:view|edit|manage"),
    )),
    Model("GrantBatchRequest", (f("items", "arr:obj:ResourceGrantCreate"),)),
    Model("GrantBatchResult", (f("created", "int"), f("failed", "arr:obj:BatchFailure"))),
    Model("AccessExplanation", (
        f("resourceType", "enum:skill_package|knowledge_base|connector|model|storage_backend|plugin|expert|agent"),
        f("resourceKey", "str"),
        f("visibility", "enum:private|team|tenant|public"),
        f("ownerId", "str", required=False),
        f("grants", "arr:obj:ResourceGrant"),
        f("effective", "enum:allowed|denied"), f("reason", "str"),
    )),

    # ---- notifications ---------------------------------------------------
    Model("Notification", (
        f("id", "ref:nt"), f("kind", "enum:task|cloud|export|system"),
        f("title", "str"), f("body", "str", required=False),
        f("link", "str", required=False), f("readAt", "ts", required=False),
        f("createdAt", "ts"),
    )),
    Model("NotificationList", (
        f("items", "arr:obj:Notification"), f("unreadCount", "int"),
        f("nextCursor", "str", required=False),
    )),

    # ---- admin: import / quotas / audit export --------------------------
    Model("UserImportRequest", (
        f("csvBase64", "str"), f("dryRun", "bool", required=False),
    )),
    Model("UserImportResult", (
        f("created", "int"), f("skipped", "int"),
        f("failed", "arr:obj:BatchFailure"),
    )),
    Model("Quota", (
        f("id", "ref:qt"),
        f("scope", "enum:tenant|user|agent"), f("scopeId", "str"),
        f("metric", "enum:tokens|cost|requests|storage|concurrency"),
        f("limitValue", "int"), f("window", "enum:day|month|absolute"),
        f("updatedAt", "ts"),
    )),
    Model("QuotaList", (f("items", "arr:obj:Quota"),)),
    Model("QuotaPatch", (f("limitValue", "int"),)),
    Model("AuditExport", (f("url", "str"), f("expiresAt", "ts"))),
    Model("SsoProvider", (
        f("id", "ref:sp"), f("kind", "enum:oidc|oauth|ldap"), f("name", "str"),
        f("enabled", "bool"), f("allowedEmailDomains", "arr:str"),
        f("allowedGroups", "arr:str"), f("autoProvision", "bool"),
        f("defaultRole", "enum:admin|member|auditor"),
        f("roleSync", "enum:none|login"),
    )),
    Model("SsoProviderList", (f("items", "arr:obj:SsoProvider"),)),
    Model("SsoProviderCreate", (
        f("kind", "enum:oidc|oauth|ldap"), f("name", "str"), f("config", "json"),
        f("allowedEmailDomains", "arr:str", required=False),
        f("allowedGroups", "arr:str", required=False),
        f("autoProvision", "bool", required=False),
        f("defaultRole", "enum:admin|member|auditor", required=False),
        f("roleSync", "enum:none|login", required=False),
    )),
    Model("SsoProviderPatch", (
        f("name", "str", required=False), f("config", "json", required=False),
        f("allowedEmailDomains", "arr:str", required=False),
        f("allowedGroups", "arr:str", required=False),
        f("autoProvision", "bool", required=False),
        f("defaultRole", "enum:admin|member|auditor", required=False),
        f("roleSync", "enum:none|login", required=False),
        f("enabled", "bool", required=False),
    )),

    # ---- data export / tenant purge --------------------------------------
    Model("DataJob", (
        f("id", "ref:dj"), f("kind", "enum:export|delete"),
        f("status", "enum:queued|running|ready|failed|done"),
        f("progress", "float"), f("storageRef", "str", required=False),
        f("error", "str", required=False),
        f("createdAt", "ts"), f("finishedAt", "ts", required=False),
    )),
    Model("ExportRequest", (
        f("format", "enum:jsonl|json"), f("includeArtifacts", "bool", required=False),
    )),
    Model("TenantPurgeRequest", (
        f("confirmName", "str"), f("reason", "str"),
    )),

    # ---- multi-instance / secrets ----------------------------------------
    Model("InstanceInfo", (
        f("id", "ref:ins"), f("role", "enum:api|worker|scheduler"),
        f("version", "str"), f("hostname", "str", required=False),
        f("startedAt", "ts"), f("lastHeartbeatAt", "ts"),
        f("alive", "bool"),
    )),
    Model("InstanceList", (f("items", "arr:obj:InstanceInfo"),)),
    Model("ConfigVersion", (
        f("scope", "enum:settings|permissions|policy|plugins|acl"),
        f("key", "str"), f("version", "int"),
        f("changedBy", "str", required=False), f("createdAt", "ts"),
    )),
    Model("ConfigVersionList", (f("items", "arr:obj:ConfigVersion"),)),
    Model("SecretRotateRequest", (f("newValueCipher", "str"),)),
    Model("ModelPrice", (
        f("id", "ref:mp"), f("model", "str"), f("currency", "enum:CNY|USD"),
        f("inputPerMtok", "float"), f("outputPerMtok", "float"),
        f("cachedPerMtok", "float"), f("version", "int"),
        f("effectiveFrom", "ts"),
    )),
    Model("ModelPriceList", (f("items", "arr:obj:ModelPrice"),)),
    Model("BackupInfo", (
        f("id", "ref:bk"), f("kind", "enum:full|incremental"),
        f("manifest", "json"), f("checksum", "str"), f("sizeBytes", "int"),
        f("auto", "bool"),
        f("status", "enum:creating|ready|failed|restoring|restored"),
        f("createdAt", "ts"), f("restoredAt", "ts", required=False),
    )),
    Model("BackupList", (f("items", "arr:obj:BackupInfo"), f("nextCursor", "str", required=False))),
    Model("BackupStatus", (f("busy", "bool"), f("operation", "enum:create|restore|none"),
        f("backupId", "ref:bk", required=False), f("since", "ts", required=False))),
    Model("BackupAutoSettings", (
        f("autoEnabled", "bool"), f("intervalHours", "int"),
        f("retentionCount", "int"), f("includes", "json"),
    )),
    Model("BackupAutoUpdate", (
        f("autoEnabled", "bool", required=False), f("intervalHours", "int", required=False),
        f("retentionCount", "int", required=False), f("includes", "json", required=False),
    )),
    Model("BackupCreateRequest", (f("includes", "json", required=False),)),
    Model("BackupImportRequest", (f("contentBase64", "str"),)),
    Model("LabelEntry", (f("key", "str"), f("label", "str"), f("icon", "str", required=False))),
    Model("LabelMap", (f("entries", "arr:obj:LabelEntry"), f("locale", "str")),
    ),
    Model("ModelPriceUpsert", (
        f("model", "str"), f("currency", "enum:CNY|USD"),
        f("inputPerMtok", "float"), f("outputPerMtok", "float"),
        f("cachedPerMtok", "float", required=False),
    )),
    Model("SecretInfo", (
        f("id", "ref:sec"), f("name", "str"), f("version", "int"),
        f("rotatedAt", "ts", required=False), f("previousVersionKept", "bool"),
    )),
)

MODEL_BY_NAME = {m.name: m for m in MODELS}

OPS: tuple[Op, ...] = (
    # ---- M0/M1: auth -----------------------------------------------------
    Op("POST", "/auth/login", "login", "Password login", "auth", "LoginResponse",
       body="LoginRequest"),
    Op("POST", "/auth/refresh", "refreshToken", "Rotate refresh token", "auth", "TokenPair",
       body="RefreshRequest"),
    Op("POST", "/auth/logout", "logout", "Revoke current session", "auth", "Ok"),
    Op("GET", "/auth/me", "getMe", "Current user and permissions", "auth", "Me"),
    Op("GET", "/me/tenants", "listMyTenants", "Tenants the user belongs to", "auth", "TenantList"),
    Op("POST", "/setup", "setup", "Create the first admin", "auth", "SetupResponse",
       body="SetupRequest"),

    # ---- M0/M1: agents ---------------------------------------------------
    Op("GET", "/agents", "listAgents", "List agents", "agents", "AgentList",
       params=(
           Param("status", "query", "enum:draft|published|disabled"),
           Param("q", "query", "str", desc="search name / description"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/agents", "createAgent", "Create a draft agent", "agents", "Agent",
       body="AgentCreate"),
    Op("GET", "/agents/{agentId}", "getAgent", "Get one agent", "agents", "Agent",
       params=(Param("agentId", "path", "str", required=True),)),
    Op("PATCH", "/agents/{agentId}", "updateAgent", "Update agent draft fields", "agents", "Agent",
       params=(Param("agentId", "path", "str", required=True),), body="AgentPatch"),
    Op("DELETE", "/agents/{agentId}", "deleteAgent", "Delete an agent", "agents", "Ok",
       params=(Param("agentId", "path", "str", required=True),)),
    Op("POST", "/agents/{agentId}/publish", "publishAgent", "Publish an immutable version",
       "agents", "Agent", params=(Param("agentId", "path", "str", required=True),)),
    Op("POST", "/agents/{agentId}/test", "testAgent", "Test the draft without publishing",
       "agents", "Turn",
       params=(Param("agentId", "path", "str", required=True),), body="AgentTestRequest"),

    # ---- M0/M1: threads --------------------------------------------------
    Op("GET", "/threads", "listThreads", "List threads", "threads", "ThreadList",
       params=(
           Param("agentId", "query", "str"), Param("q", "query", "str"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/threads", "createThread", "Create a thread", "threads", "Thread",
       body="ThreadCreate"),
    Op("GET", "/threads/{threadId}", "getThread", "Get one thread", "threads", "Thread",
       params=(Param("threadId", "path", "str", required=True),)),
    Op("PATCH", "/threads/{threadId}", "updateThread", "Rename / archive a thread", "threads", "Thread",
       params=(Param("threadId", "path", "str", required=True),), body="ThreadPatch"),
    Op("DELETE", "/threads/{threadId}", "deleteThread", "Soft-delete a thread", "threads", "Ok",
       params=(Param("threadId", "path", "str", required=True),)),
    Op("GET", "/threads/{threadId}/messages", "listMessages", "Page message history",
       "threads", "MessageList",
       params=(
           Param("threadId", "path", "str", required=True),
           Param("before", "query", "str", desc="cursor"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/threads/{threadId}/turns", "createTurn", "Send a message and start a turn",
       "threads", "Turn",
       params=(
           Param("threadId", "path", "str", required=True),
           Param("Idempotency-Key", "header", "str"),
       ), body="TurnCreate"),
    Op("GET", "/threads/{threadId}/events", "listEvents", "Replay events after seq",
       "threads", "EventList",
       params=(
           Param("threadId", "path", "str", required=True),
           Param("afterSeq", "query", "int"),
           Param("limit", "query", "int"),
       )),

    # ---- M0/M1: turns ----------------------------------------------------
    Op("POST", "/turns/{turnId}/stop", "stopTurn", "Stop a running turn", "turns", "Turn",
       params=(Param("turnId", "path", "str", required=True),), body="StopRequest"),
    Op("POST", "/turns/{turnId}/steer", "steerTurn", "Queue a steering message", "turns",
       "SteerResponse",
       params=(Param("turnId", "path", "str", required=True),), body="SteerRequest"),
    Op("DELETE", "/turns/{turnId}/steer/{steerId}", "removeSteer", "Remove a queued steer",
       "turns", "Ok",
       params=(Param("turnId", "path", "str", required=True),
               Param("steerId", "path", "str", required=True))),
    Op("POST", "/turns/{turnId}/regenerate", "regenerateTurn", "Regenerate as a new turn",
       "turns", "Turn",
       params=(Param("turnId", "path", "str", required=True),), body="RegenerateRequest"),
    Op("POST", "/messages/{messageId}/edit-resend", "editResendTurn",
       "Edit a user message and regenerate", "turns", "Turn",
       params=(Param("messageId", "path", "str", required=True),), body="EditResendRequest"),
    Op("GET", "/turns/{turnId}/runs", "listTurnRuns", "Execution attempts of a turn", "turns",
       "RunList",
       params=(Param("turnId", "path", "str", required=True),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("GET", "/runs/{runId}/steps", "listRunSteps", "Steps of a run", "turns", "StepList",
       params=(Param("runId", "path", "str", required=True),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("GET", "/turns/{turnId}/trace", "getTurnTrace", "Turn + runs for replay", "turns", "Trace",
       params=(Param("turnId", "path", "str", required=True),)),

    # ---- M0/M1: attachments / sources / health ---------------------------
    Op("POST", "/attachments", "uploadAttachment", "Upload an attachment", "attachments",
       "Attachment", body="AttachmentCreate"),
    Op("GET", "/attachments/{attachmentId}", "getAttachment", "Get attachment metadata",
       "attachments", "Attachment",
       params=(Param("attachmentId", "path", "str", required=True),)),
    Op("GET", "/sources", "listSources", "List intake sources", "sources", "SourceList",
       params=(Param("kind", "query", "str"), Param("cursor", "query", "str"),
               Param("limit", "query", "int"))),
    Op("POST", "/sources", "createSource", "Create an intake source", "sources", "Source",
       body="SourceCreate"),
    Op("POST", "/sources/{sourceId}/pause", "pauseSource", "Pause/resume a source", "sources",
       "Source", params=(Param("sourceId", "path", "str", required=True),),
       body="SourcePauseRequest"),
    Op("GET", "/triggers", "listTriggers", "List triggers for debugging", "sources", "TriggerList",
       params=(
           Param("sourceId", "query", "str"),
           Param("status", "query", "enum:received|filtered|fanned_out"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("GET", "/health", "getHealth", "Liveness and version", "health", "Health"),

    # ---- P0: memory / context -------------------------------------------
    Op("GET", "/memories", "listMemories", "List memory atoms", "memory", "MemoryAtomList",
       params=(
           Param("kind", "query", "enum:fact|preference|episode|profile|skill"),
           Param("status", "query", "enum:active|retired|pending_review"),
           Param("source", "query", "enum:explicit_user|assistant_inferred|import|migration"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/memories", "createMemory", "Write an explicit memory atom", "memory",
       "MemoryAtom", body="MemoryCreate"),
    Op("GET", "/memories/search", "searchMemories", "Search memory within budget", "memory",
       "MemorySearchResult",
       params=(Param("q", "query", "str", required=True),
               Param("limit", "query", "int"))),
    Op("GET", "/memories/export", "exportMemories", "Export memory as JSONL/JSON", "memory",
       "MemoryExport", params=(Param("format", "query", "enum:jsonl|json"),)),
    Op("POST", "/memories/pause", "pauseMemoryWrites", "Pause/resume memory writes", "memory",
       "MemoryPauseState", body="MemoryPauseRequest"),
    Op("GET", "/memories/{memoryId}", "getMemory", "Get one memory atom", "memory",
       "MemoryAtom", params=(Param("memoryId", "path", "str", required=True),)),
    Op("PATCH", "/memories/{memoryId}", "updateMemory", "Correct or retire a memory", "memory",
       "MemoryAtom",
       params=(Param("memoryId", "path", "str", required=True),), body="MemoryPatch"),
    Op("DELETE", "/memories/{memoryId}", "deleteMemory", "Delete a memory atom", "memory", "Ok",
       params=(Param("memoryId", "path", "str", required=True),)),
    Op("GET", "/threads/{threadId}/context", "getThreadContext",
       "Context budget breakdown", "memory", "ContextUsage",
       params=(Param("threadId", "path", "str", required=True),)),
    Op("POST", "/threads/{threadId}/compact", "compactThread", "Compact thread context",
       "memory", "CompactResult",
       params=(Param("threadId", "path", "str", required=True),), body="CompactRequest"),
    Op("GET", "/admin/memory-metrics", "getMemoryMetrics", "Memory quality metrics", "memory",
       "MemoryMetrics"),

    # ---- P0: channels ----------------------------------------------------
    Op("GET", "/channels", "listChannels", "List channel accounts", "channels", "ChannelList",
       params=(
           Param("kind", "query", "enum:feishu|dingtalk|wecom|qq|telegram|discord"),
           Param("status", "query", "enum:active|disabled|error|expired"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/channels", "createChannel", "Create a channel account", "channels", "Channel",
       body="ChannelCreate"),
    Op("PATCH", "/channels/{channelId}", "updateChannel", "Update channel config", "channels",
       "Channel",
       params=(Param("channelId", "path", "str", required=True),), body="ChannelPatch"),
    Op("DELETE", "/channels/{channelId}", "deleteChannel", "Delete a channel account", "channels",
       "Ok", params=(Param("channelId", "path", "str", required=True),)),
    Op("POST", "/channels/{channelId}/probe", "probeChannel", "Probe credentials and report gaps",
       "channels", "ChannelProbeResult",
       params=(Param("channelId", "path", "str", required=True),)),
    Op("GET", "/channel-bindings", "listChannelBindings", "List channel-agent bindings",
       "channels", "ChannelBindingList",
       params=(Param("channelId", "query", "str"), Param("agentId", "query", "str"),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("POST", "/channel-bindings", "createChannelBinding", "Bind a channel to an agent",
       "channels", "ChannelBinding", body="ChannelBindingCreate"),
    Op("PATCH", "/channel-bindings/{bindingId}", "updateChannelBinding",
       "Update binding rules", "channels", "ChannelBinding",
       params=(Param("bindingId", "path", "str", required=True),),
       body="ChannelBindingPatch"),
    Op("GET", "/channel-messages", "listChannelMessages", "Debug inbound/outbound messages",
       "channels", "ChannelMessageList",
       params=(Param("channelId", "query", "str"), Param("threadId", "query", "str"),
               Param("status", "query", "enum:received|sent|failed"),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),

    # ---- P0: tools / policy ---------------------------------------------
    Op("GET", "/tools", "listTools", "List the tool registry", "tools", "ToolList",
       params=(
           Param("source", "query", "enum:builtin|mcp|plugin|openapi|skill"),
           Param("risk", "query", "enum:low|medium|high|critical"),
           Param("q", "query", "str"), Param("cursor", "query", "str"),
           Param("limit", "query", "int"),
       )),
    Op("PATCH", "/tools/{toolKey}", "updateTool", "Enable/disable a tool globally", "tools",
       "Tool", params=(Param("toolKey", "path", "str", required=True),), body="ToolPatch"),
    Op("GET", "/agents/{agentId}/tools", "listAgentTools", "Per-agent tool bindings", "tools",
       "AgentToolList", params=(Param("agentId", "path", "str", required=True),)),
    Op("PATCH", "/agents/{agentId}/tools", "updateAgentTools",
       "Replace per-agent tool bindings", "tools", "AgentToolList",
       params=(Param("agentId", "path", "str", required=True),), body="AgentToolsUpdate"),
    Op("GET", "/admin/policies", "listPolicies", "List policy rules", "tools", "PolicyList",
       params=(Param("enabled", "query", "int"), Param("cursor", "query", "str"),
               Param("limit", "query", "int"))),
    Op("POST", "/admin/policies", "createPolicy", "Create a policy rule", "tools", "PolicyRule",
       body="PolicyCreate"),
    Op("PATCH", "/admin/policies/{ruleId}", "updatePolicy", "Update a policy rule", "tools",
       "PolicyRule",
       params=(Param("ruleId", "path", "str", required=True),), body="PolicyPatch"),
    Op("DELETE", "/admin/policies/{ruleId}", "deletePolicy", "Delete a policy rule", "tools",
       "Ok", params=(Param("ruleId", "path", "str", required=True),)),
    Op("POST", "/admin/policies/evaluate", "evaluatePolicy", "Dry-run policy evaluation",
       "tools", "PolicyEvaluation", body="PolicyEvaluationRequest"),
    Op("POST", "/connectors/openapi/import", "importOpenApiTools",
       "Import OpenAPI operations as tools", "tools", "OpenApiImportResult",
       body="OpenApiImportRequest"),

    # ---- P0: teams / delegations ----------------------------------------
    Op("GET", "/teams", "listTeams", "List teams", "teams", "TeamList",
       params=(
           Param("status", "query", "enum:active|disabled"),
           Param("q", "query", "str"), Param("cursor", "query", "str"),
           Param("limit", "query", "int"),
       )),
    Op("POST", "/teams", "createTeam", "Create a team", "teams", "Team",
       body="TeamCreate"),
    Op("GET", "/teams/{teamId}", "getTeam", "Team with members", "teams", "TeamDetail",
       params=(Param("teamId", "path", "str", required=True),)),
    Op("PATCH", "/teams/{teamId}", "updateTeam", "Update team settings", "teams", "TeamDetail",
       params=(Param("teamId", "path", "str", required=True),), body="TeamPatch"),
    Op("DELETE", "/teams/{teamId}", "deleteTeam", "Delete a team", "teams", "Ok",
       params=(Param("teamId", "path", "str", required=True),)),
    Op("POST", "/teams/{teamId}/members", "addTeamMember", "Add a member", "teams",
       "TeamDetail", params=(Param("teamId", "path", "str", required=True),),
       body="TeamMemberAdd"),
    Op("DELETE", "/teams/{teamId}/members/{agentId}", "removeTeamMember",
       "Remove a member", "teams", "Ok",
       params=(Param("teamId", "path", "str", required=True),
               Param("agentId", "path", "str", required=True))),
    Op("POST", "/teams/{teamId}/stop", "stopTeam",
       "Stop coordinator or the whole room", "teams", "TeamDetail",
       params=(Param("teamId", "path", "str", required=True),), body="TeamStopRequest"),
    Op("GET", "/delegations", "listDelegations", "List delegations", "teams",
       "DelegationList",
       params=(
           Param("teamId", "query", "str"), Param("memberAgentId", "query", "str"),
           Param("state", "query", "enum:pending|running|ended|dead"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/delegations", "createDelegation", "Dispatch a task to a member", "teams",
       "Delegation", body="DelegationCreate"),
    Op("POST", "/delegations/{delegationId}/retry", "retryDelegation",
       "Retry a dead/failed delegation", "teams", "Delegation",
       params=(Param("delegationId", "path", "str", required=True),),
       body="DelegationRetryRequest"),

    # ---- P0: control plane (terminal / browser) -------------------------
    Op("GET", "/control/sessions", "listControlSessions", "List terminal/browser sessions",
       "control", "ControlSessionList",
       params=(
           Param("kind", "query", "enum:terminal|browser"),
           Param("status", "query", "enum:starting|running|closed|error"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/control/sessions", "createControlSession",
       "Start a terminal/browser session", "control", "ControlSession",
       body="ControlSessionCreate"),
    Op("GET", "/control/sessions/{sessionId}", "getControlSession",
       "Get one session", "control", "ControlSession",
       params=(Param("sessionId", "path", "str", required=True),)),
    Op("DELETE", "/control/sessions/{sessionId}", "closeControlSession",
       "Close a session (kill process / browser)", "control", "Ok",
       params=(Param("sessionId", "path", "str", required=True),)),
    Op("POST", "/control/sessions/{sessionId}/takeover", "takeoverControlSession",
       "Take over a browser session", "control", "ControlSession",
       params=(Param("sessionId", "path", "str", required=True),)),
    Op("GET", "/control/sessions/{sessionId}/stream", "getControlStream",
       "Issue a live-view stream ticket", "control", "ControlStreamTicket",
       params=(Param("sessionId", "path", "str", required=True),)),
    Op("POST", "/control/sessions/{sessionId}/input", "sendControlInput",
       "Send terminal input / resize", "control", "Ok",
       params=(Param("sessionId", "path", "str", required=True),),
       body="ControlInputRequest"),

    # ---- auth extensions: MFA / SSO / API keys / sessions ----------------
    Op("POST", "/auth/mfa/totp/enroll", "enrollTotp", "Start TOTP enrollment", "auth",
       "MfaEnrollment"),
    Op("POST", "/auth/mfa/totp/verify", "verifyTotp", "Verify TOTP and enable MFA", "auth",
       "MfaStatus", body="MfaVerifyRequest"),
    Op("DELETE", "/auth/mfa/{method}", "disableMfa", "Disable an MFA method", "auth", "Ok",
       params=(Param("method", "path", "enum:totp|webauthn", required=True),)),
    Op("GET", "/auth/mfa/webauthn/challenge", "getWebAuthnChallenge",
       "Get WebAuthn registration challenge", "auth", "WebAuthnChallenge"),
    Op("POST", "/auth/mfa/webauthn/register", "registerWebAuthn",
       "Finish WebAuthn registration", "auth", "MfaStatus",
       body="WebAuthnRegisterRequest"),
    Op("GET", "/auth/providers", "listAuthProviders", "Configured SSO providers", "auth",
       "AuthProviderList"),
    Op("POST", "/auth/sso/start", "startSso", "Begin an SSO redirect", "auth", "AuthRedirect",
       body="SsoStartRequest"),
    Op("POST", "/auth/sso/callback", "ssoCallback", "Exchange SSO code for tokens", "auth",
       "LoginResponse", body="SsoCallbackRequest"),
    Op("POST", "/auth/ldap/login", "ldapLogin", "LDAP/AD login", "auth", "LoginResponse",
       body="LdapLoginRequest"),
    Op("POST", "/auth/reauth", "reauthenticate", "Step-up reauthentication for sensitive ops",
       "auth", "ReauthGrant", body="ReauthRequest"),

    # ---- v1.1: cloud hosts ----------------------------------------------
    Op("GET", "/cloud/status", "getCloudStatus", "Cloud authorization status", "cloud",
       "CloudStatus"),
    Op("POST", "/cloud/authorize", "authorizeCloud", "Start cloud authorization", "cloud",
       "AuthRedirect", body="CloudAuthorizeRequest"),
    Op("POST", "/cloud/callback", "cloudCallback", "Exchange cloud auth code", "cloud",
       "CloudAccount", body="CloudCallbackRequest"),
    Op("POST", "/cloud/accounts/import", "importCloudAccount",
       "Import credentials from local CLI profile", "cloud", "CloudAccount",
       body="CloudImportRequest"),
    Op("POST", "/cloud/accounts/{accountId}/refresh", "refreshCloudAccount",
       "Refresh cloud credentials", "cloud", "CloudAccount",
       params=(Param("accountId", "path", "str", required=True),)),
    Op("DELETE", "/cloud/accounts/{accountId}", "revokeCloudAccount",
       "Revoke a cloud account", "cloud", "Ok",
       params=(Param("accountId", "path", "str", required=True),)),
    Op("GET", "/cloud/regions", "listCloudRegions", "List regions/zones", "cloud",
       "CloudRegionList",
       params=(Param("accountId", "query", "str"),
               Param("provider", "query", "enum:tencent|aws|aliyun"))),
    Op("GET", "/cloud/instances", "listCloudInstances", "List cloud instances", "cloud",
       "CloudInstanceList",
       params=(
           Param("accountId", "query", "str"), Param("region", "query", "str"),
           Param("state", "query", "enum:running|stopped|starting|stopping|rebooting|error|unknown"),
           Param("q", "query", "str"), Param("cursor", "query", "str"),
           Param("limit", "query", "int"),
       )),
    Op("GET", "/cloud/instances/{instanceId}/metrics", "getCloudInstanceMetrics",
       "Metrics of one instance", "cloud", "CloudMetrics",
       params=(Param("instanceId", "path", "str", required=True),
               Param("minutes", "query", "int"), Param("period", "query", "int"))),
    Op("POST", "/cloud/metrics/batch", "getCloudMetricsBatch", "Batch instance metrics",
       "cloud", "CloudMetricsBatch", body="CloudMetricsRequest"),
    Op("POST", "/cloud/metrics/cluster-trend", "getCloudClusterTrend",
       "Cluster trend series", "cloud", "CloudClusterTrend", body="CloudTrendRequest"),
    Op("POST", "/cloud/instances/{instanceId}/action", "runCloudInstanceAction",
       "Start/stop/reboot an instance", "cloud", "CloudOp",
       params=(Param("instanceId", "path", "str", required=True),),
       body="CloudActionRequest"),
    Op("GET", "/me/api-keys", "listApiKeys", "List personal API keys", "auth", "ApiKeyList"),
    Op("POST", "/me/api-keys", "createApiKey", "Create an API key (secret shown once)",
       "auth", "ApiKeyCreated", body="ApiKeyCreate"),
    Op("DELETE", "/me/api-keys/{keyId}", "revokeApiKey", "Revoke an API key", "auth", "Ok",
       params=(Param("keyId", "path", "str", required=True),)),
    Op("GET", "/me/sessions", "listSessions", "List active sessions/devices", "auth",
       "SessionList"),
    Op("DELETE", "/me/sessions/{sessionId}", "revokeSession", "Revoke a session", "auth", "Ok",
       params=(Param("sessionId", "path", "str", required=True),)),

    # ---- cron lifecycle --------------------------------------------------
    Op("GET", "/cron-jobs", "listCronJobs", "List cron jobs", "cron", "CronJobList",
       params=(
           Param("enabled", "query", "int"), Param("q", "query", "str"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/cron-jobs", "createCronJob", "Create a cron job", "cron", "CronJob",
       body="CronJobCreate"),
    Op("GET", "/cron-jobs/{jobId}", "getCronJob", "Get one cron job", "cron", "CronJob",
       params=(Param("jobId", "path", "str", required=True),)),
    Op("PATCH", "/cron-jobs/{jobId}", "updateCronJob", "Update a cron job", "cron", "CronJob",
       params=(Param("jobId", "path", "str", required=True),), body="CronJobPatch"),
    Op("DELETE", "/cron-jobs/{jobId}", "deleteCronJob", "Delete a cron job", "cron", "Ok",
       params=(Param("jobId", "path", "str", required=True),)),
    Op("POST", "/cron-jobs/{jobId}/run-now", "runCronJob", "Run once immediately", "cron",
       "CronRun", params=(Param("jobId", "path", "str", required=True),)),
    Op("GET", "/cron-jobs/{jobId}/runs", "listCronRuns", "Run history", "cron", "CronRunList",
       params=(Param("jobId", "path", "str", required=True),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),

    # ---- users -----------------------------------------------------------
    Op("GET", "/users", "listUsers", "List users", "users", "UserList",
       params=(
           Param("q", "query", "str"), Param("status", "query", "enum:active|disabled"),
           Param("role", "query", "enum:admin|member|auditor"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/users", "createUser", "Create a user", "users", "User",
       body="UserCreate"),
    Op("PATCH", "/users/{userId}", "updateUser", "Update role/status/display name", "users",
       "User", params=(Param("userId", "path", "str", required=True),), body="UserPatch"),
    Op("DELETE", "/users/{userId}", "deleteUser", "Delete a user (not self)", "users", "Ok",
       params=(Param("userId", "path", "str", required=True),)),
    Op("POST", "/users/{userId}/reset-password", "resetUserPassword",
       "Reset password and return a temporary one", "users", "PasswordResetResult",
       params=(Param("userId", "path", "str", required=True),),
       body="PasswordResetRequest"),
    Op("POST", "/users/batch", "batchUsers", "Batch enable/disable/delete", "users",
       "UserBatchResult", body="UserBatchRequest"),
    Op("POST", "/users/import", "importUsers", "CSV import users with dry-run", "users",
       "UserImportResult", body="UserImportRequest"),
    Op("POST", "/me/export", "exportMyData", "Export my data as an async job", "users",
       "DataJob", body="ExportRequest"),
    Op("GET", "/me/export/{jobId}", "getMyExport", "Export job progress/download", "users",
       "DataJob", params=(Param("jobId", "path", "str", required=True),)),
    Op("DELETE", "/admin/tenants/{tenantId}", "purgeTenant", "Delete a tenant (async purge)",
       "admin", "DataJob",
       params=(Param("tenantId", "path", "str", required=True),),
       body="TenantPurgeRequest"),
    Op("GET", "/admin/data-jobs/{jobId}", "getDataJob", "Export/delete job progress", "admin",
       "DataJob", params=(Param("jobId", "path", "str", required=True),)),
    Op("GET", "/admin/quotas", "listQuotas", "List quota limits", "admin", "QuotaList",
       params=(Param("scope", "query", "enum:tenant|user|agent"),
               Param("metric", "query", "enum:tokens|cost|requests|storage|concurrency"))),
    Op("PATCH", "/admin/quotas/{quotaId}", "updateQuota", "Update a quota limit", "admin",
       "Quota", params=(Param("quotaId", "path", "str", required=True),),
       body="QuotaPatch"),
    Op("GET", "/admin/audit/export", "exportAudit", "Export audit log as CSV/JSON",
       "audit", "AuditExport",
       params=(Param("from", "query", "ts"), Param("to", "query", "ts"),
               Param("actor", "query", "str"), Param("format", "query", "enum:csv|json"))),
    Op("GET", "/admin/sso-providers", "listSsoProviders", "List SSO providers", "admin",
       "SsoProviderList"),
    Op("POST", "/admin/sso-providers", "createSsoProvider", "Create an SSO provider",
       "admin", "SsoProvider", body="SsoProviderCreate"),
    Op("PATCH", "/admin/sso-providers/{providerId}", "updateSsoProvider",
       "Update SSO allowlist / first-login role", "admin", "SsoProvider",
       params=(Param("providerId", "path", "str", required=True),),
       body="SsoProviderPatch"),
    Op("GET", "/admin/instances", "listInstances", "List instances with liveness",
       "admin", "InstanceList",
       params=(Param("role", "query", "enum:api|worker|scheduler"),)),
    Op("GET", "/admin/config-versions", "listConfigVersions",
       "Current config version per scope", "admin", "ConfigVersionList"),
    Op("GET", "/admin/backup", "listBackups", "List backup archives", "admin",
       "BackupList", params=(Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("GET", "/admin/backup/status", "getBackupStatus", "Is a backup/restore running", "admin",
       "BackupStatus"),
    Op("GET", "/admin/backup/auto", "getBackupAuto", "Auto-backup settings", "admin",
       "BackupAutoSettings"),
    Op("PUT", "/admin/backup/auto", "updateBackupAuto", "Update auto-backup settings", "admin",
       "BackupAutoSettings", body="BackupAutoUpdate"),
    Op("POST", "/admin/backup/auto/run", "runBackupAuto", "Run auto backup now", "admin",
       "BackupInfo"),
    Op("POST", "/admin/backup", "createBackup", "Create a backup with manifest", "admin",
       "BackupInfo", body="BackupCreateRequest"),
    Op("POST", "/admin/backup/import", "importBackup", "Upload a backup archive", "admin",
       "BackupInfo", body="BackupImportRequest"),
    Op("DELETE", "/admin/backup/{backupId}", "deleteBackup", "Delete a stored backup", "admin",
       "Ok", params=(Param("backupId", "path", "str", required=True),)),
    Op("POST", "/admin/backup/{backupId}/restore", "restoreBackup",
       "Restore (checksum + schema check first)", "admin", "BackupInfo",
       params=(Param("backupId", "path", "str", required=True),)),
    Op("POST", "/threads/{threadId}/read", "markThreadRead", "Clear unread count", "threads",
       "Thread", params=(Param("threadId", "path", "str", required=True),)),
    Op("GET", "/tool-labels", "getToolLabels", "Server-side tool display names", "i18n",
       "LabelMap", params=(Param("locale", "query", "str"),)),
    Op("GET", "/skill-labels", "getSkillLabels", "Server-side skill display names", "i18n",
       "LabelMap", params=(Param("locale", "query", "str"),)),
    Op("GET", "/admin/model-prices", "listModelPrices", "Price table (current per model)",
       "admin", "ModelPriceList",
       params=(Param("currency", "query", "enum:CNY|USD"), Param("model", "query", "str"))),
    Op("PUT", "/admin/model-prices", "upsertModelPrice", "Upsert a price (bumps version)",
       "admin", "ModelPrice", body="ModelPriceUpsert"),
    Op("POST", "/admin/secrets/{secretId}/rotate", "rotateSecret",
       "Rotate a secret (dual-version)", "admin", "SecretInfo",
       params=(Param("secretId", "path", "str", required=True),),
       body="SecretRotateRequest"),

    # ---- invites ---------------------------------------------------------
    Op("GET", "/invites", "listInvites", "List invitations", "invites", "InviteList",
       params=(Param("status", "query", "enum:pending|accepted|expired|revoked"),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("POST", "/invites", "createInvite", "Create an invitation", "invites", "Invite",
       body="InviteCreate"),
    Op("POST", "/invites/accept", "acceptInvite", "Accept an invitation", "invites",
       "LoginResponse", body="InviteAcceptRequest"),
    Op("GET", "/invites/{token}", "previewInvite", "Preview an invitation", "invites",
       "InvitePreview", params=(Param("token", "path", "str", required=True),)),
    Op("DELETE", "/invites/{inviteId}", "revokeInvite", "Revoke an invitation", "invites",
       "Ok", params=(Param("inviteId", "path", "str", required=True),)),

    # ---- roles -----------------------------------------------------------
    Op("GET", "/roles", "listRoles", "List roles", "roles", "RoleList"),
    Op("POST", "/roles", "createRole", "Create a role", "roles", "Role", body="RoleCreate"),
    Op("GET", "/roles/{roleId}", "getRole", "Role detail with permission matrix", "roles",
       "RoleDetail", params=(Param("roleId", "path", "str", required=True),)),
    Op("PATCH", "/roles/{roleId}", "updateRole", "Update role permissions", "roles",
       "RoleDetail", params=(Param("roleId", "path", "str", required=True),),
       body="RolePatch"),
    Op("DELETE", "/roles/{roleId}", "deleteRole", "Delete a custom role", "roles", "Ok",
       params=(Param("roleId", "path", "str", required=True),)),

    # ---- groups ----------------------------------------------------------
    Op("GET", "/groups", "listGroups", "List user groups", "groups", "GroupList",
       params=(Param("q", "query", "str"), Param("cursor", "query", "str"),
               Param("limit", "query", "int"))),
    Op("POST", "/groups", "createGroup", "Create a group", "groups", "Group",
       body="GroupCreate"),
    Op("GET", "/groups/{groupId}", "getGroup", "Group with members", "groups", "GroupDetail",
       params=(Param("groupId", "path", "str", required=True),)),
    Op("PATCH", "/groups/{groupId}", "updateGroup", "Rename a group", "groups", "Group",
       params=(Param("groupId", "path", "str", required=True),), body="GroupPatch"),
    Op("DELETE", "/groups/{groupId}", "deleteGroup", "Delete a group", "groups", "Ok",
       params=(Param("groupId", "path", "str", required=True),)),
    Op("POST", "/groups/{groupId}/members", "addGroupMembers", "Replace group members",
       "groups", "GroupDetail",
       params=(Param("groupId", "path", "str", required=True),),
       body="GroupMembersUpdate"),
    Op("DELETE", "/groups/{groupId}/members/{userId}", "removeGroupMember",
       "Remove one member", "groups", "Ok",
       params=(Param("groupId", "path", "str", required=True),
               Param("userId", "path", "str", required=True))),
    Op("GET", "/groups/{groupId}/grants", "listGroupGrants",
       "List resource grants of a group", "groups", "ResourceGrantList",
       params=(Param("groupId", "path", "str", required=True),
               Param("resourceType",
                     "query",
                     "enum:skill_package|knowledge_base|connector|model|storage_backend|plugin|expert|agent"),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("POST", "/groups/{groupId}/grants", "createGroupGrant",
       "Grant a resource to a group", "groups", "ResourceGrant",
       params=(Param("groupId", "path", "str", required=True),),
       body="ResourceGrantCreate"),
    Op("DELETE", "/groups/{groupId}/grants/{grantId}", "deleteGroupGrant",
       "Revoke a resource grant", "groups", "Ok",
       params=(Param("groupId", "path", "str", required=True),
               Param("grantId", "path", "str", required=True))),
    Op("POST", "/groups/{groupId}/grants/batch", "batchGroupGrants",
       "Grant multiple resources to a group", "groups", "GrantBatchResult",
       params=(Param("groupId", "path", "str", required=True),),
       body="GrantBatchRequest"),
    Op("GET", "/resources/{resourceType}/{resourceKey}/access", "explainResourceAccess",
       "Explain why a user can/cannot access a resource", "groups", "AccessExplanation",
       params=(Param("resourceType", "path", "str", required=True),
               Param("resourceKey", "path", "str", required=True),
               Param("userId", "query", "str"))),

    # ---- notifications ---------------------------------------------------
    Op("GET", "/notifications", "listNotifications", "List my notifications",
       "notifications", "NotificationList",
       params=(Param("unreadOnly", "query", "int"), Param("cursor", "query", "str"),
               Param("limit", "query", "int"))),
    Op("POST", "/notifications/{notificationId}/read", "markNotificationRead",
       "Mark one notification read", "notifications", "Notification",
       params=(Param("notificationId", "path", "str", required=True),)),
    Op("POST", "/notifications/read-all", "markAllNotificationsRead",
       "Mark all notifications read", "notifications", "Ok"),

    # ---- task center -----------------------------------------------------
    Op("GET", "/tickets", "listTickets", "List tickets by bucket", "tickets", "TicketList",
       params=(
           Param("bucket", "query", "enum:attention|running|queued|done", desc="bucket filter"),
           Param("source", "query", "str", desc="source id"),
           Param("executor", "query", "enum:builtin|codex|claude_code|dsh"),
           Param("q", "query", "str", desc="search title / actor / PR number"),
           Param("sort", "query", "enum:priority|updated|created"),
           Param("cursor", "query", "str"),
           Param("limit", "query", "int"),
       )),
    Op("GET", "/tickets/counts", "getTicketCounts", "Counts per bucket", "tickets", "Counts"),
    Op("GET", "/tickets/{ticketId}", "getTicket", "Get one ticket", "tickets", "Ticket",
       params=(Param("ticketId", "path", "str", required=True),)),
    Op("POST", "/tickets/{ticketId}/stop", "stopTicket", "Stop a ticket (human only)", "tickets", "Ticket",
       params=(Param("ticketId", "path", "str", required=True),), body="StopRequest"),
    Op("POST", "/tickets/{ticketId}/assign", "assignTicket", "Assign to another executor", "tickets", "Ticket",
       params=(Param("ticketId", "path", "str", required=True),), body="AssignRequest"),
    Op("POST", "/tickets/{ticketId}/budget", "updateTicketBudget", "Raise the ticket budget", "tickets", "Ticket",
       params=(Param("ticketId", "path", "str", required=True),), body="BudgetRequest"),
    Op("POST", "/tickets/{ticketId}/merge", "mergeTicket", "Merge into another ticket", "tickets", "Ticket",
       params=(Param("ticketId", "path", "str", required=True),), body="MergeRequest"),
    Op("GET", "/tickets/{ticketId}/reports", "listTicketReports", "Reports of a ticket", "tickets", "ReportList",
       params=(Param("ticketId", "path", "str", required=True),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("GET", "/tickets/{ticketId}/timeline", "getTicketTimeline", "Unified ticket timeline", "tickets", "TimelineList",
       params=(Param("ticketId", "path", "str", required=True),
               Param("cursor", "query", "str"), Param("limit", "query", "int"))),
    Op("GET", "/attentions", "listAttentions", "List pending/answered attentions", "attentions", "AttentionList",
       params=(
           Param("status", "query", "enum:pending|answered|expired|dismissed"),
           Param("kind", "query", "enum:approval|question|blocked"),
           Param("cursor", "query", "str"), Param("limit", "query", "int"),
       )),
    Op("POST", "/attentions/{attentionId}/answer", "answerAttention", "Answer an attention", "attentions", "Attention",
       params=(Param("attentionId", "path", "str", required=True),), body="AnswerRequest"),
)


def validate_spec() -> None:
    assert len(MODELS) == 229, len(MODELS)
    names = {m.name for m in MODELS}
    for m in MODELS:
        for p in m.fields:
            if p.type.startswith("obj:"):
                assert p.type[4:] in names, f"{m.name}.{p.name}: unknown model {p.type}"
    for op in OPS:
        assert op.response in names, f"{op.op_id}: unknown response {op.response}"
        if op.body:
            assert op.body in names, f"{op.op_id}: unknown body {op.body}"


validate_spec()
