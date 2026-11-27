/**
 * Endpoint wrappers (docs/49 §7.2). Every route here MUST exist in
 * schemas/api/implemented.json — endpoints.test.ts walks the `.route`
 * metadata below and fails otherwise, so the contract-vs-implementation gap
 * (P0-2) can never creep in silently.
 */

import { apiFetch } from "../client";
import type {
  AdminOverview,
  AdminSettings,
  AgentFile,
  AgentFileListResponse,
  AgentListResponse,
  AgentVersion,
  AgentVersionListResponse,
  BackupAutoSettings,
  AgentRow,
  AgentSubagentRow,
  AgentToolBinding,
  AnswerResponse,
  BatchAnswerResponse,
  ApiKeyRow,
  AuditRow,
  QuotaRow,
  BackupRow,
  DataJobRow,
  AttentionListResponse,
  ChannelListResponse,
  ChannelRow,
  ConnectorCatalogRow,
  ConnectorInstanceRow,
  ConnectorToolRow,
  CronJobListResponse,
  CronJobView,
  CronRunRow,
  LoginRequest,
  LoginResponse,
  MessageListResponse,
  MemoryAtom,
  MemoryAtomListResponse,
  MemoryExport,
  MemoryPauseState,
  MemorySearchResult,
  ModelListResponse,
  NotificationListResponse,
  NotificationRow,
  PluginRow,
  PostTurnResponse,
  ProviderListResponse,
  ProviderRow,
  SecurityRule,
  SecuritySnapshot,
  SessionUser,
  AdminUserListResponse,
  AdminUserRow,
  InviteListResponse,
  InviteRow,
  KnowledgeBaseRow,
  KnowledgeDocRow,
  KnowledgeSearchResult,
  RoleRow,
  SourceListResponse,
  SourceView,
  StorageSnapshot,
  ThreadListResponse,
  ThreadSettings,
  TeamListResponse,
  TeamRow,
  TeamRunResult,
  TicketCounts,
  TicketDetail,
  TicketListResponse,
  TicketTimelineResponse,
  ToolRow,
  TraceEvent,
  UsageSummaryResponse,
  WebhookAccepted,
  WorkspaceFile,
  WorkspaceTree,
} from "../wire";

type Routed = { route: [method: string, path: string] };

/** Tag a wrapper with its (method, path) so tests can pin it to the whitelist. */
function op<A extends unknown[], R>(
  method: string,
  path: string, // template form, e.g. "/threads/{thread_id}/messages"
  fn: (...args: A) => Promise<R>,
): ((...args: A) => Promise<R>) & Routed {
  const routed = fn as ((...args: A) => Promise<R>) & Routed;
  routed.route = [method, path];
  return routed;
}

export const auth = {
  login: op("POST", "/auth/login", (body: LoginRequest) =>
    apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
      skipUnauthorized: true,
    })),
  me: op("GET", "/auth/me", () =>
    apiFetch<{ user: SessionUser }>("/auth/me", { skipUnauthorized: true })),
  updateMe: op("PATCH", "/auth/me", (input: {
    displayName?: string;
    notificationPrefs?: Record<string, boolean>;
  }) => apiFetch<{ user: SessionUser }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  })),
  logout: op("POST", "/auth/logout", () =>
    apiFetch<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      skipUnauthorized: true,
    })),
};

export const threads = {
  list: op("GET", "/threads", () => apiFetch<ThreadListResponse>("/threads")),
  create: op("POST", "/threads", (title: string, agentId?: string | null) =>
    apiFetch<ThreadListResponse["items"][number]>("/threads", {
      method: "POST",
      body: JSON.stringify(agentId ? { title, agentId } : { title }),
    })),
  messages: op("GET", "/threads/{thread_id}/messages", (threadId: string) =>
    apiFetch<MessageListResponse>(
      `/threads/${encodeURIComponent(threadId)}/messages`,
    )),
  update: op(
    "PATCH",
    "/threads/{thread_id}",
    (
      threadId: string,
      body: {
        title?: string;
        pinned?: boolean;
        settings?: ThreadSettings;
      },
    ) => apiFetch<ThreadListResponse["items"][number]>(
      `/threads/${encodeURIComponent(threadId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  ),
  remove: op("DELETE", "/threads/{thread_id}", (
    threadId: string, compact = false,
  ) =>
    apiFetch<{ ok: boolean; threadId: string; compact?: boolean; vacuumed?: boolean }>(
      `/threads/${encodeURIComponent(threadId)}${compact ? "?compact=true" : ""}`,
      { method: "DELETE" },
    )),
  branch: op(
    "POST",
    "/threads/{thread_id}/branch",
    (threadId: string, title?: string, messageId?: string) =>
      apiFetch<ThreadListResponse["items"][number]>(
        `/threads/${encodeURIComponent(threadId)}/branch`,
        { method: "POST", body: JSON.stringify({ title, messageId }) },
      ),
  ),
  stopTurn: op(
    "POST",
    "/threads/{thread_id}/turns/{turn_id}/stop",
    (threadId: string, turnId: string) =>
      apiFetch<{ turnId: string; status: string }>(
        `/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/stop`,
        { method: "POST" },
      ),
  ),
  regenerateTurn: op(
    "POST",
    "/threads/{thread_id}/turns/{turn_id}/regenerate",
    (threadId: string, turnId: string) =>
      apiFetch<{ turnId: string; status: string }>(
        `/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/regenerate`,
        { method: "POST" },
      ),
  ),
  editTurn: op(
    "POST",
    "/threads/{thread_id}/turns/{turn_id}/edit",
    (threadId: string, turnId: string, content: string) =>
      apiFetch<{ turnId: string; status: string }>(
        `/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/edit`,
        { method: "POST", body: JSON.stringify({ content }) },
      ),
  ),
  trace: op("GET", "/threads/{thread_id}/trace", (threadId: string) =>
    apiFetch<{ items: TraceEvent[] }>(
      `/threads/${encodeURIComponent(threadId)}/trace`,
    )),
  postTurn: op(
    "POST",
    "/threads/{thread_id}/turns",
    (
      threadId: string,
      content: string,
      clientMessageId?: string,
      mode: "act" | "ask" | "plan" = "act",
    ) => apiFetch<PostTurnResponse>(`/threads/${encodeURIComponent(threadId)}/turns`, {
      method: "POST",
      body: JSON.stringify({ content, clientMessageId, mode }),
    }),
  ),
};

export const attentions = {
  list: op("GET", "/attentions", () =>
    apiFetch<AttentionListResponse>("/attentions")),
  answer: op(
    "POST",
    "/attentions/{attention_id}/answer",
    (attentionId: string, decision?: "approve" | "approve_session" | "deny" | "answer", answer?: string) =>
      apiFetch<AnswerResponse>(
        `/attentions/${encodeURIComponent(attentionId)}/answer`,
        { method: "POST", body: JSON.stringify({ decision, answer }) },
      ),
  ),
  markRead: op("POST", "/attentions/{attention_id}/read", (attentionId: string) =>
    apiFetch<AttentionListResponse["items"][number]>(
      `/attentions/${encodeURIComponent(attentionId)}/read`, { method: "POST" },
    )),
  markAllRead: op("POST", "/attentions/read-all", () =>
    apiFetch<{ updated: number }>("/attentions/read-all", { method: "POST" })),
  snooze: op("POST", "/attentions/{attention_id}/snooze", (
    attentionId: string, until: number,
  ) => apiFetch<AttentionListResponse["items"][number]>(
    `/attentions/${encodeURIComponent(attentionId)}/snooze`,
    { method: "POST", body: JSON.stringify({ until }) },
  )),
  answerBatch: op(
    "POST",
    "/attentions/answer-batch",
    (attentionIds: string[], decision: "approve" | "approve_session" | "deny") =>
      apiFetch<BatchAnswerResponse>("/attentions/answer-batch", {
        method: "POST",
        body: JSON.stringify({ attention_ids: attentionIds, decision }),
      }),
  ),
};

export interface CreateSourceBody {
  name: string;
  allowActors?: string[];
  explicitPatterns?: string[];
  defaultScope?: string[];
  maxTotalTokens?: number;
  generateSecret?: boolean;
  callbackUrl?: string;
  replyStyle?: "structured" | "full";
}

export interface TestReplyResult {
  delivered: boolean;
  statusCode: number | null;
  callbackUrl: string;
  error?: string;
}

export interface WebhookPayload {
  external_id: string;
  thread_key?: string;
  actor?: { id: string; kind?: string };
  text: string;
}

export const sources = {
  create: op("POST", "/sources", (body: CreateSourceBody) =>
    apiFetch<SourceView>("/sources", {
      method: "POST",
      body: JSON.stringify(body),
    })),
  list: op("GET", "/sources", () => apiFetch<SourceListResponse>("/sources")),
  pause: op("POST", "/sources/{source_id}/pause", (sourceId: string) =>
    apiFetch<{ sourceId: string; status: string }>(
      `/sources/${encodeURIComponent(sourceId)}/pause`,
      { method: "POST" },
    )),
  resume: op("POST", "/sources/{source_id}/resume", (sourceId: string) =>
    apiFetch<{ sourceId: string; status: string }>(
      `/sources/${encodeURIComponent(sourceId)}/resume`,
      { method: "POST" },
    )),
  remove: op("DELETE", "/sources/{source_id}", (sourceId: string) =>
    apiFetch<{ sourceId: string; deleted: boolean }>(
      `/sources/${encodeURIComponent(sourceId)}`,
      { method: "DELETE" },
    )),
  testReply: op(
    "POST",
    "/sources/{source_id}/test-reply",
    (sourceId: string, callbackUrl?: string) =>
      apiFetch<TestReplyResult>(
        `/sources/${encodeURIComponent(sourceId)}/test-reply`,
        {
          method: "POST",
          body: JSON.stringify(callbackUrl ? { callbackUrl } : {}),
        },
      ),
  ),
  /** Public webhook intake (HMAC-signed by the caller). */
  postWebhook: op(
    "POST",
    "/webhooks/{source_id}",
    (sourceId: string, payload: WebhookPayload, signature?: string) =>
      apiFetch<WebhookAccepted>(`/webhooks/${encodeURIComponent(sourceId)}`, {
        method: "POST",
        body: JSON.stringify(payload),
        ...(signature ? { headers: { "X-Signature": signature } } : {}),
      }),
  ),
};

export interface CreateCronBody {
  name: string;
  schedule: string;
  timezone: string;
  text: string;
}

export const cronJobs = {
  list: op("GET", "/cron-jobs", () =>
    apiFetch<CronJobListResponse>("/cron-jobs")),
  create: op("POST", "/cron-jobs", (body: CreateCronBody) =>
    apiFetch<CronJobView>("/cron-jobs", {
      method: "POST",
      body: JSON.stringify(body),
    })),
  update: op(
    "PATCH",
    "/cron-jobs/{job_id}",
    (
      jobId: string,
      body: {
        enabled?: boolean;
        name?: string;
        schedule?: string;
        timezone?: string;
        text?: string;
      },
    ) => apiFetch<CronJobView>(`/cron-jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  ),
  setEnabled: op(
    "PATCH",
    "/cron-jobs/{job_id}",
    (jobId: string, enabled: boolean) =>
      apiFetch<CronJobView>(`/cron-jobs/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
  ),
  run: op("POST", "/cron-jobs/{job_id}/run", (jobId: string) =>
    apiFetch<{
      runId: string;
      status: string;
      triggerId: string | null;
      ticketId: string | null;
      error: string | null;
    }>(`/cron-jobs/${encodeURIComponent(jobId)}/run`, { method: "POST" })),
  runs: op("GET", "/cron-jobs/{job_id}/runs", (jobId: string) =>
    apiFetch<{ items: CronRunRow[] }>(
      `/cron-jobs/${encodeURIComponent(jobId)}/runs`,
    )),
  remove: op("DELETE", "/cron-jobs/{job_id}", (jobId: string) =>
    apiFetch<{ cronJobId: string; deleted: boolean }>(
      `/cron-jobs/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
    )),
};

export const tickets = {
  list: op("GET", "/tickets", () => apiFetch<TicketListResponse>("/tickets")),
  create: op("POST", "/tickets", (body: {
    title: string; content?: string; priority?: number;
  }) => apiFetch<{ ticketId: string; bucket: string; state: string }>(
    "/tickets", { method: "POST", body: JSON.stringify(body) },
  )),
  counts: op("GET", "/tickets/counts", () =>
    apiFetch<TicketCounts>("/tickets/counts")),
  detail: op("GET", "/tickets/{ticket_id}", (ticketId: string) =>
    apiFetch<TicketDetail>(`/tickets/${encodeURIComponent(ticketId)}`)),
  timeline: op("GET", "/tickets/{ticket_id}/timeline", (ticketId: string) =>
    apiFetch<TicketTimelineResponse>(
      `/tickets/${encodeURIComponent(ticketId)}/timeline`,
    )),
  stop: op("POST", "/tickets/{ticket_id}/stop", (ticketId: string) =>
    apiFetch<{ ticketId: string; state: string }>(
      `/tickets/${encodeURIComponent(ticketId)}/stop`,
      { method: "POST" },
    )),
  update: op("PATCH", "/tickets/{ticket_id}", (
    ticketId: string, body: { title?: string; content?: string },
  ) => apiFetch<{ ticketId: string; updated: boolean }>(
    `/tickets/${encodeURIComponent(ticketId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  )),
  reassign: op("POST", "/tickets/{ticket_id}/reassign", (ticketId: string) =>
    apiFetch<{ ticketId: string; bucket: string; state: string }>(
      `/tickets/${encodeURIComponent(ticketId)}/reassign`,
      { method: "POST" },
    )),
  rerun: op("POST", "/tickets/{ticket_id}/rerun", (ticketId: string) =>
    apiFetch<{ ticketId: string; bucket: string; state: string }>(
      `/tickets/${encodeURIComponent(ticketId)}/rerun`,
      { method: "POST" },
    )),
  remove: op("DELETE", "/tickets/{ticket_id}", (ticketId: string) =>
    apiFetch<{ ticketId: string; deleted: boolean }>(
      `/tickets/${encodeURIComponent(ticketId)}`,
      { method: "DELETE" },
    )),
  addBudget: op(
    "POST",
    "/tickets/{ticket_id}/budget",
    (ticketId: string, body: { additionalCostMicros?: number; additionalTokens?: number }) =>
      apiFetch<{
        ticketId: string;
        maxCostMicros: number | null;
        maxTotalTokens: number | null;
      }>(`/tickets/${encodeURIComponent(ticketId)}/budget`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  ),
  watchdogRun: op("POST", "/tickets/watchdog/run", () =>
    apiFetch<{ alerts: number }>("/tickets/watchdog/run", { method: "POST" })),
};

export interface UsageQuery {
  range: 7 | 30 | 90;
  groupBy: "model" | "agent" | "day";
  asUser?: string;
  agentId?: string;
}

function usageParams(query: UsageQuery): string {
  const params = new URLSearchParams({
    range: String(query.range),
    groupBy: query.groupBy,
  });
  if (query.asUser) params.set("asUser", query.asUser);
  if (query.agentId) params.set("agentId", query.agentId);
  return params.toString();
}

export const usage = {
  summary: op(
    "GET",
    "/usage/summary",
    (query: UsageQuery) =>
      apiFetch<UsageSummaryResponse>(`/usage/summary?${usageParams(query)}`),
  ),
  /** Raw CSV — plain fetch, not the JSON client. */
  exportCsv: op(
    "GET",
    "/usage/export",
    (query: UsageQuery) =>
      fetch(`/api/v1/usage/export?${usageParams(query)}`, {
        credentials: "include",
      }).then((response) => {
        if (!response.ok) throw new Error(`export failed: HTTP ${response.status}`);
        return response.text();
      }),
  ),
};

/** All wrapper groups — tests walk this for whitelist enforcement. */
export const users = {
  list: op("GET", "/users", () => apiFetch<AdminUserListResponse>("/users")),
  create: op("POST", "/users", (body: {
    username: string; displayName?: string; email?: string;
    password: string; roles: string[];
  }) => apiFetch<AdminUserRow>("/users", {
    method: "POST", body: JSON.stringify(body),
  })),
  update: op("PATCH", "/users/{user_id}", (
    userId: string,
    body: { displayName?: string; status?: string; roles?: string[] },
  ) => apiFetch<AdminUserRow>(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH", body: JSON.stringify(body),
  })),
  remove: op("DELETE", "/users/{user_id}", (userId: string) =>
    apiFetch<{ userId: string; deleted: boolean }>(
      `/users/${encodeURIComponent(userId)}`, { method: "DELETE" },
    )),
};

export const roles = {
  list: op("GET", "/roles", () =>
    apiFetch<{ items: RoleRow[] }>("/roles")),
};

export const invites = {
  list: op("GET", "/invites", () =>
    apiFetch<InviteListResponse>("/invites")),
  create: op("POST", "/invites", (body: {
    email: string; role: string; expiresInHours?: number;
  }) => apiFetch<InviteRow>("/invites", {
    method: "POST", body: JSON.stringify(body),
  })),
  remove: op("DELETE", "/invites/{invite_id}", (inviteId: string) =>
    apiFetch<{ inviteId: string; revoked: boolean }>(
      `/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" },
    )),
  accept: op("POST", "/invites/accept", (body: {
    token: string; password: string; displayName?: string;
  }) => apiFetch<unknown>("/invites/accept", {
    method: "POST", body: JSON.stringify(body),
  })),
};

export const tools = {
  list: op("GET", "/tools", () =>
    apiFetch<{ items: ToolRow[] }>("/tools")),
  update: op("PATCH", "/tools/{tool_key}", (toolKey: string, enabledGlobal: boolean) =>
    apiFetch<ToolRow>(`/tools/${encodeURIComponent(toolKey)}`, {
      method: "PATCH", body: JSON.stringify({ enabledGlobal }),
    })),
  agentBindings: op("GET", "/agents/{agent_id}/tools", (agentId: string) =>
    apiFetch<{ agentId: string; items: AgentToolBinding[] }>(
      `/agents/${encodeURIComponent(agentId)}/tools`,
    )),
  updateAgentBindings: op(
    "PATCH",
    "/agents/{agent_id}/tools",
    (agentId: string, items: AgentToolBinding[]) =>
      apiFetch<{ agentId: string; items: AgentToolBinding[] }>(
        `/agents/${encodeURIComponent(agentId)}/tools`,
        { method: "PATCH", body: JSON.stringify({ items }) },
      ),
  ),
};

export const channels = {
  list: op("GET", "/channels", () =>
    apiFetch<ChannelListResponse>("/channels")),
  create: op("POST", "/channels", (body: {
    kind: string; displayName: string; appId: string; appSecret: string;
    verificationToken?: string; encryptKey?: string; approvers?: string[];
  }) => apiFetch<ChannelRow>("/channels", {
    method: "POST", body: JSON.stringify(body),
  })),
  update: op("PATCH", "/channels/{channel_id}", (
    channelId: string,
    body: {
      displayName?: string; appId?: string; appSecret?: string;
      verificationToken?: string; encryptKey?: string; approvers?: string[];
      status?: string;
    },
  ) => apiFetch<ChannelRow>(`/channels/${encodeURIComponent(channelId)}`, {
    method: "PATCH", body: JSON.stringify(body),
  })),
  remove: op("DELETE", "/channels/{channel_id}", (channelId: string) =>
    apiFetch<{ ok: boolean; channelId: string }>(
      `/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" },
    )),
  probe: op("POST", "/channels/{channel_id}/probe", (channelId: string) =>
    apiFetch<ChannelRow & { ok: boolean; error: string | null }>(
      `/channels/${encodeURIComponent(channelId)}/probe`, { method: "POST" },
    )),
};

export const connectors = {
  catalog: op("GET", "/connectors/catalog", () =>
    apiFetch<{ items: ConnectorCatalogRow[] }>("/connectors/catalog")),
  instances: op("GET", "/connectors/instances", () =>
    apiFetch<{ items: ConnectorInstanceRow[] }>("/connectors/instances")),
  create: op("POST", "/connectors/instances", (body: {
    kind: string;
    displayName: string;
    config: Record<string, unknown>;
    defaultOpen?: boolean;
    shared?: boolean;
  }) => apiFetch<ConnectorInstanceRow>("/connectors/instances", {
    method: "POST", body: JSON.stringify(body),
  })),
  update: op("PATCH", "/connectors/instances/{instance_id}", (
    instanceId: string,
    body: {
      displayName?: string;
      config?: Record<string, unknown>;
      status?: string;
      shared?: boolean;
      defaultOpen?: boolean;
    },
  ) => apiFetch<ConnectorInstanceRow>(
    `/connectors/instances/${encodeURIComponent(instanceId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  )),
  remove: op("DELETE", "/connectors/instances/{instance_id}", (instanceId: string) =>
    apiFetch<{ ok: boolean; instanceId: string }>(
      `/connectors/instances/${encodeURIComponent(instanceId)}`,
      { method: "DELETE" },
    )),
  probe: op("POST", "/connectors/instances/{instance_id}/probe", (instanceId: string) =>
    apiFetch<ConnectorInstanceRow & { ok: boolean; error?: string }>(
      `/connectors/instances/${encodeURIComponent(instanceId)}/probe`,
      { method: "POST" },
    )),
  tools: op("GET", "/connectors/instances/{instance_id}/tools", (instanceId: string) =>
    apiFetch<{ items: ConnectorToolRow[] }>(
      `/connectors/instances/${encodeURIComponent(instanceId)}/tools`,
    )),
  toggleTool: op("PATCH", "/connectors/instances/{instance_id}/tools", (
    instanceId: string, body: { toolKey: string; enabled: boolean },
  ) => apiFetch<ConnectorToolRow>(
    `/connectors/instances/${encodeURIComponent(instanceId)}/tools`,
    { method: "PATCH", body: JSON.stringify(body) },
  )),
  discover: op("POST", "/connectors/instances/{instance_id}/discover", (instanceId: string) =>
    apiFetch<{
      items: ConnectorToolRow[];
      errors: Array<{ server: string; error: string }>;
    }>(
      `/connectors/instances/${encodeURIComponent(instanceId)}/discover`,
      { method: "POST" },
    )),
  oauthStart: op("POST", "/connectors/oauth/start", (kind: string) =>
    apiFetch<{ stateId: string; authorizeUrl: string; status: string }>(
      "/connectors/oauth/start",
      { method: "POST", body: JSON.stringify({ kind }) },
    )),
  oauthPending: op("GET", "/connectors/oauth/pending/{state_id}", (stateId: string) =>
    apiFetch<{ stateId: string; kind: string; status: string }>(
      `/connectors/oauth/pending/${encodeURIComponent(stateId)}`,
    )),
  oauthCallback: op("GET", "/connectors/oauth/callback", (
    state: string, code: string,
  ) => {
    const params = new URLSearchParams({ state, code });
    return apiFetch<{ ok: boolean; stateId: string; status: string }>(
      `/connectors/oauth/callback?${params.toString()}`,
    );
  }),
};

/** P2-7 admin console: quotas, audit, backup, data jobs. */
export const adminOps = {
  quotas: op("GET", "/admin/quotas", () =>
    apiFetch<{ items: QuotaRow[] }>("/admin/quotas")),
  createQuota: op("POST", "/admin/quotas", (body: {
    scope: string; scopeId: string; metric: string; limit: number; window: string;
  }) => apiFetch<QuotaRow>("/admin/quotas", {
    method: "POST", body: JSON.stringify(body),
  })),
  updateQuota: op("PATCH", "/admin/quotas/{quota_id}", (
    quotaId: string, limit: number,
  ) => apiFetch<QuotaRow>(`/admin/quotas/${encodeURIComponent(quotaId)}`, {
    method: "PATCH", body: JSON.stringify({ limit }),
  })),
  audit: op("GET", "/admin/audit", (params?: {
    action?: string; actorId?: string; result?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.action) query.set("action", params.action);
    if (params?.actorId) query.set("actorId", params.actorId);
    if (params?.result) query.set("result", params.result);
    const suffix = query.toString();
    return apiFetch<{ items: AuditRow[] }>(
      `/admin/audit${suffix ? `?${suffix}` : ""}`,
    );
  }),
  backups: op("GET", "/admin/backup", () =>
    apiFetch<{ items: BackupRow[] }>("/admin/backup")),
  createBackup: op("POST", "/admin/backup", () =>
    apiFetch<BackupRow>("/admin/backup", {
      method: "POST", body: JSON.stringify({}),
    })),
  restoreBackup: op("POST", "/admin/backup/{backup_id}/restore", (backupId: string) =>
    apiFetch<BackupRow>(
      `/admin/backup/${encodeURIComponent(backupId)}/restore`, { method: "POST" },
    )),
  removeBackup: op("DELETE", "/admin/backup/{backup_id}", (backupId: string) =>
    apiFetch<{ ok: boolean; backupId: string }>(
      `/admin/backup/${encodeURIComponent(backupId)}`, { method: "DELETE" },
    )),
  dataJobs: op("GET", "/admin/data-jobs", () =>
    apiFetch<{ items: DataJobRow[] }>("/admin/data-jobs")),
};


export const settings = {
  exportData: op("POST", "/me/export", (body?: {
    format?: "jsonl" | "json";
    includeArtifacts?: boolean;
  }) => apiFetch<DataJobRow>("/me/export", {
    method: "POST",
    body: JSON.stringify(body ?? { format: "jsonl", includeArtifacts: true }),
  })),
  exportJob: op("GET", "/me/export/{job_id}", (jobId: string) =>
    apiFetch<DataJobRow>(`/me/export/${encodeURIComponent(jobId)}`)),
  get: op("GET", "/admin/settings", () =>
    apiFetch<AdminSettings>("/admin/settings")),
  reauth: op("POST", "/auth/reauth", (password: string, mfaCode?: string) =>
    apiFetch<{ grantToken: string; expiresAt: number }>("/auth/reauth", {
      method: "POST", body: JSON.stringify({ password, mfaCode }),
    })),
  mfaEnroll: op("POST", "/auth/mfa/totp/enroll", () =>
    apiFetch<{ secret: string; otpauthUrl: string }>("/auth/mfa/totp/enroll", {
      method: "POST",
    })),
  mfaVerify: op("POST", "/auth/mfa/totp/verify", (code: string) =>
    apiFetch<{ enabled: boolean; recoveryCodes: string[] }>(
      "/auth/mfa/totp/verify", { method: "POST", body: JSON.stringify({ code }) },
    )),
  mfaDisable: op("DELETE", "/auth/mfa/{method}", (method: string) =>
    apiFetch<{ enabled: boolean }>(`/auth/mfa/${encodeURIComponent(method)}`, {
      method: "DELETE",
    })),
  apiKeys: op("GET", "/me/api-keys", () =>
    apiFetch<{ items: ApiKeyRow[] }>("/me/api-keys")),
  createApiKey: op("POST", "/me/api-keys", (body: {
    name: string; scopes: string[]; expiresInSeconds?: number;
  }) => apiFetch<{ key: ApiKeyRow; secret: string }>("/me/api-keys", {
    method: "POST", body: JSON.stringify(body),
  })),
  revokeApiKey: op("DELETE", "/me/api-keys/{api_key_id}", (apiKeyId: string) =>
    apiFetch<{ apiKeyId: string; revoked: boolean }>(
      `/me/api-keys/${encodeURIComponent(apiKeyId)}`, { method: "DELETE" },
    )),
};

export const plugins = {
  list: op("GET", "/plugins", () =>
    apiFetch<{ items: PluginRow[] }>("/plugins")),
  install: op("POST", "/plugins/{plugin_id}/install", (
    pluginId: string,
    body: { manifest: Record<string, unknown>; signature: string; signer?: string },
  ) => apiFetch<PluginRow>(`/plugins/${encodeURIComponent(pluginId)}/install`, {
    method: "POST", body: JSON.stringify(body),
  })),
  installExamples: op("POST", "/plugins/examples/install", () =>
    apiFetch<{ items: PluginRow[] }>("/plugins/examples/install", {
      method: "POST",
    })),
  setEnabled: op("PATCH", "/plugins/{plugin_id}", (
    pluginId: string, enabled: boolean,
  ) => apiFetch<PluginRow>(`/plugins/${encodeURIComponent(pluginId)}`, {
    method: "PATCH", body: JSON.stringify({ enabled }),
  })),
  remove: op("DELETE", "/plugins/{plugin_id}", (pluginId: string) =>
    apiFetch<{ ok: boolean; pluginId: string }>(
      `/plugins/${encodeURIComponent(pluginId)}`, { method: "DELETE" },
    )),
};

export const knowledge = {
  listKbs: op("GET", "/knowledge-bases", () =>
    apiFetch<{ items: KnowledgeBaseRow[] }>("/knowledge-bases")),
  createKb: op("POST", "/knowledge-bases", (body: {
    name: string; description?: string;
  }) => apiFetch<KnowledgeBaseRow>("/knowledge-bases", {
    method: "POST", body: JSON.stringify(body),
  })),
  updateKb: op("PATCH", "/knowledge-bases/{kb_id}", (
    kbId: string, body: { name?: string; description?: string },
  ) => apiFetch<KnowledgeBaseRow>(
    `/knowledge-bases/${encodeURIComponent(kbId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  )),
  removeKb: op("DELETE", "/knowledge-bases/{kb_id}", (kbId: string) =>
    apiFetch<{ ok: boolean; kbId: string }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}`, { method: "DELETE" },
    )),
  docs: op("GET", "/knowledge-bases/{kb_id}/docs", (kbId: string, q?: string) => {
    const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
    return apiFetch<{ items: KnowledgeDocRow[] }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/docs${suffix}`,
    );
  }),
  upload: op("POST", "/knowledge-bases/{kb_id}/docs", (
    kbId: string, body: { filename: string; content: string },
  ) => apiFetch<KnowledgeDocRow>(
    `/knowledge-bases/${encodeURIComponent(kbId)}/docs`,
    { method: "POST", body: JSON.stringify(body) },
  )),
  removeDoc: op("DELETE", "/knowledge-docs/{doc_id}", (docId: string) =>
    apiFetch<{ ok: boolean; docId: string }>(
      `/knowledge-docs/${encodeURIComponent(docId)}`, { method: "DELETE" },
    )),
  preview: op("GET", "/knowledge-docs/{doc_id}/preview", (docId: string) =>
    apiFetch<{ doc: KnowledgeDocRow; chunks: Array<{
      idx: number; heading: string | null; content: string;
    }> }>(`/knowledge-docs/${encodeURIComponent(docId)}/preview`)),
  search: op("POST", "/knowledge-bases/{kb_id}/search", (
    kbId: string, query: string,
  ) => apiFetch<KnowledgeSearchResult>(
    `/knowledge-bases/${encodeURIComponent(kbId)}/search`,
    { method: "POST", body: JSON.stringify({ query }) },
  )),
  reindex: op("POST", "/knowledge-bases/{kb_id}/reindex-all", (kbId: string) =>
    apiFetch<KnowledgeBaseRow>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/reindex-all`,
      { method: "POST" },
    )),
  reindexDoc: op("POST", "/knowledge-docs/{doc_id}/reindex", (docId: string) =>
    apiFetch<KnowledgeDocRow>(
      `/knowledge-docs/${encodeURIComponent(docId)}/reindex`, { method: "POST" },
    )),
};

export const agents = {
  list: op("GET", "/agents", (params?: { status?: string; q?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.q) query.set("q", params.q);
    const suffix = query.toString();
    return apiFetch<AgentListResponse>(`/agents${suffix ? `?${suffix}` : ""}`);
  }),
  create: op("POST", "/agents", (body: {
    name: string; description?: string; model?: string; systemPrompt?: string;
  }) => apiFetch<AgentRow>("/agents", {
    method: "POST", body: JSON.stringify(body),
  })),
  update: op("PATCH", "/agents/{agent_id}", (
    agentId: string,
    body: {
      name?: string; description?: string; model?: string;
      systemPrompt?: string; status?: string;
    },
  ) => apiFetch<AgentRow>(`/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH", body: JSON.stringify(body),
  })),
  remove: op("DELETE", "/agents/{agent_id}", (agentId: string) =>
    apiFetch<{ ok: boolean; agentId: string }>(
      `/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" },
    )),
  publish: op("POST", "/agents/{agent_id}/publish", (agentId: string) =>
    apiFetch<AgentRow>(`/agents/${encodeURIComponent(agentId)}/publish`, {
      method: "POST",
    })),
  test: op("POST", "/agents/{agent_id}/test", (agentId: string, message: string) =>
    apiFetch<{ turnId: string; threadId: string; status: string }>(
      `/agents/${encodeURIComponent(agentId)}/test`,
      { method: "POST", body: JSON.stringify({ message }) },
    )),
  subagents: op("GET", "/agents/{agent_id}/subagents", (agentId: string) =>
    apiFetch<{ items: AgentSubagentRow[] }>(
      `/agents/${encodeURIComponent(agentId)}/subagents`,
    )),
  setSubagents: op("PUT", "/agents/{agent_id}/subagents", (
    agentId: string, subagentIds: string[],
  ) => apiFetch<{ items: AgentSubagentRow[] }>(
    `/agents/${encodeURIComponent(agentId)}/subagents`,
    { method: "PUT", body: JSON.stringify({ subagentIds }) },
  )),
  listFiles: op("GET", "/agents/{agent_id}/files", (agentId: string) =>
    apiFetch<AgentFileListResponse>(
      `/agents/${encodeURIComponent(agentId)}/files`,
    )),
  getFile: op("GET", "/agents/{agent_id}/files/{name}", (agentId: string, name: string) =>
    apiFetch<AgentFile>(
      `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`,
    )),
  putFile: op("PUT", "/agents/{agent_id}/files/{name}", (
    agentId: string, name: string, content: string,
  ) => apiFetch<AgentFile>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`,
    { method: "PUT", body: JSON.stringify({ content }) },
  )),
  deleteFile: op("DELETE", "/agents/{agent_id}/files/{name}", (
    agentId: string, name: string,
  ) => apiFetch<{ ok: boolean; name: string }>(
    `/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  )),
  listVersions: op("GET", "/agents/{agent_id}/versions", (agentId: string) =>
    apiFetch<AgentVersionListResponse>(
      `/agents/${encodeURIComponent(agentId)}/versions`,
    )),
  getVersion: op("GET", "/agents/{agent_id}/versions/{version}", (
    agentId: string, version: number,
  ) => apiFetch<AgentVersion>(
    `/agents/${encodeURIComponent(agentId)}/versions/${version}`,
  )),
  rollback: op("POST", "/agents/{agent_id}/rollback", (
    agentId: string, version: number,
  ) => apiFetch<AgentRow>(
    `/agents/${encodeURIComponent(agentId)}/rollback`,
    { method: "POST", body: JSON.stringify({ version }) },
  )),
};

export const notifications = {
  list: op("GET", "/notifications", (params?: {
    unreadOnly?: boolean; limit?: number; cursor?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.unreadOnly) query.set("unreadOnly", "1");
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.cursor) query.set("cursor", params.cursor);
    const suffix = query.toString();
    return apiFetch<NotificationListResponse>(
      `/notifications${suffix ? `?${suffix}` : ""}`,
    );
  }),
  markRead: op("POST", "/notifications/{notification_id}/read", (id: string) =>
    apiFetch<NotificationRow>(
      `/notifications/${encodeURIComponent(id)}/read`, { method: "POST" },
    )),
  markAllRead: op("POST", "/notifications/read-all", () =>
    apiFetch<{ ok: boolean; updated: number }>("/notifications/read-all", {
      method: "POST",
    })),
};

export const models = {
  list: op("GET", "/models", () => apiFetch<ModelListResponse>("/models")),
};

/** Read-only workspace viewer behind the chat Dock (文件/工作区 tabs). */
export const workspace = {
  tree: op("GET", "/workspace/tree", (path?: string) => {
    const suffix = path ? `?path=${encodeURIComponent(path)}` : "";
    return apiFetch<WorkspaceTree>(`/workspace/tree${suffix}`);
  }),
  file: op("GET", "/workspace/file", (path: string) =>
    apiFetch<WorkspaceFile>(
      `/workspace/file?path=${encodeURIComponent(path)}`,
    )),
};

export const adminOverview = {
  get: op("GET", "/admin/overview", () =>
    apiFetch<AdminOverview>("/admin/overview")),
};

export const adminModels = {
  list: op("GET", "/admin/providers", () =>
    apiFetch<ProviderListResponse>("/admin/providers")),
  create: op("POST", "/admin/providers", (body: {
    name: string; baseUrl: string; apiKey: string; models: string[];
  }) => apiFetch<ProviderRow>("/admin/providers", {
    method: "POST", body: JSON.stringify(body),
  })),
  update: op("PATCH", "/admin/providers/{provider_id}", (
    providerId: string,
    body: { name?: string; baseUrl?: string; apiKey?: string; models?: string[] },
  ) => apiFetch<ProviderRow>(`/admin/providers/${encodeURIComponent(providerId)}`, {
    method: "PATCH", body: JSON.stringify(body),
  })),
  remove: op("DELETE", "/admin/providers/{provider_id}", (providerId: string) =>
    apiFetch<{ ok: boolean; providerId: string }>(
      `/admin/providers/${encodeURIComponent(providerId)}`, { method: "DELETE" },
    )),
  probe: op("POST", "/admin/providers/{provider_id}/probe", (providerId: string) =>
    apiFetch<ProviderRow & { ok: boolean; detail: string }>(
      `/admin/providers/${encodeURIComponent(providerId)}/probe`, { method: "POST" },
    )),
};

export const adminStorage = {
  get: op("GET", "/admin/storage", () =>
    apiFetch<StorageSnapshot>("/admin/storage")),
  backupAuto: op("GET", "/admin/backup/auto", () =>
    apiFetch<BackupAutoSettings>("/admin/backup/auto")),
  updateBackupAuto: op("PUT", "/admin/backup/auto", (body: {
    autoEnabled?: boolean;
    intervalHours?: number;
    retentionCount?: number;
    includes?: Record<string, boolean>;
  }) => apiFetch<BackupAutoSettings>("/admin/backup/auto", {
    method: "PUT", body: JSON.stringify(body),
  })),
  runBackupAuto: op("POST", "/admin/backup/auto/run", () =>
    apiFetch<{ backupId: string; status: string }>("/admin/backup/auto/run", {
      method: "POST",
    })),
};

export const adminSecurity = {
  get: op("GET", "/admin/security", () =>
    apiFetch<SecuritySnapshot>("/admin/security")),
  publish: op("PUT", "/admin/security/policy", (rules: SecurityRule[]) =>
    apiFetch<SecuritySnapshot & { published: { version: number } }>(
      "/admin/security/policy",
      { method: "PUT", body: JSON.stringify({ rules }) },
    )),
  rollback: op("POST", "/admin/security/policy/rollback", (version: number) =>
    apiFetch<SecuritySnapshot & { rolledBack: { version: number } }>(
      "/admin/security/policy/rollback",
      { method: "POST", body: JSON.stringify({ version }) },
    )),
};

export const teams = {
  list: op("GET", "/teams", (params?: { q?: string }) => {
    const suffix = params?.q ? `?q=${encodeURIComponent(params.q)}` : "";
    return apiFetch<TeamListResponse>(`/teams${suffix}`);
  }),
  create: op("POST", "/teams", (body: {
    name: string; description?: string; leadId?: string; memberIds?: string[];
  }) => apiFetch<TeamRow>("/teams", {
    method: "POST", body: JSON.stringify(body),
  })),
  get: op("GET", "/teams/{team_id}", (teamId: string) =>
    apiFetch<TeamRow>(`/teams/${encodeURIComponent(teamId)}`)),
  update: op("PATCH", "/teams/{team_id}", (
    teamId: string, body: { name?: string; description?: string },
  ) => apiFetch<TeamRow>(`/teams/${encodeURIComponent(teamId)}`, {
    method: "PATCH", body: JSON.stringify(body),
  })),
  remove: op("DELETE", "/teams/{team_id}", (teamId: string) =>
    apiFetch<{ ok: boolean; teamId: string }>(
      `/teams/${encodeURIComponent(teamId)}`, { method: "DELETE" },
    )),
  addMember: op("POST", "/teams/{team_id}/members", (
    teamId: string, member: { agentId: string; role?: string },
  ) => apiFetch<TeamRow>(`/teams/${encodeURIComponent(teamId)}/members`, {
    method: "POST", body: JSON.stringify(member),
  })),
  removeMember: op("DELETE", "/teams/{team_id}/members/{agent_id}", (
    teamId: string, agentId: string,
  ) => apiFetch<TeamRow>(
    `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(agentId)}`,
    { method: "DELETE" },
  )),
  run: op("POST", "/teams/{team_id}/runs", (
    teamId: string, body: { task: string; memberIds?: string[] },
  ) => apiFetch<TeamRunResult>(
    `/teams/${encodeURIComponent(teamId)}/runs`,
    { method: "POST", body: JSON.stringify(body) },
  )),
  stop: op("POST", "/teams/{team_id}/stop", (
    teamId: string, body: { scope?: string } = {},
  ) => apiFetch<{ stopped: number }>(
    `/teams/${encodeURIComponent(teamId)}/stop`,
    { method: "POST", body: JSON.stringify(body) },
  )),
};

export const memories = {
  list: op("GET", "/memories", (params?: {
    kind?: string; status?: string; source?: string; cursor?: string; limit?: number;
  }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const suffix = query.toString();
    return apiFetch<MemoryAtomListResponse>(`/memories${suffix ? `?${suffix}` : ""}`);
  }),
  create: op("POST", "/memories", (body: {
    kind: string; text: string; confidence?: number;
    evidence?: Record<string, unknown>;
  }) => apiFetch<MemoryAtom>("/memories", {
    method: "POST", body: JSON.stringify(body),
  })),
  search: op("GET", "/memories/search", (q: string, limit?: number) => {
    const query = new URLSearchParams({ q });
    if (limit) query.set("limit", String(limit));
    return apiFetch<MemorySearchResult>(`/memories/search?${query.toString()}`);
  }),
  export: op("GET", "/memories/export", (format: "jsonl" | "json" = "json") =>
    apiFetch<MemoryExport>(`/memories/export?format=${format}`)),
  getPause: op("GET", "/memories/pause", () =>
    apiFetch<MemoryPauseState>("/memories/pause")),
  setPause: op("POST", "/memories/pause", (body: { paused: boolean; until?: string }) =>
    apiFetch<MemoryPauseState>("/memories/pause", {
      method: "POST", body: JSON.stringify(body),
    })),
  get: op("GET", "/memories/{memory_id}", (memoryId: string) =>
    apiFetch<MemoryAtom>(`/memories/${encodeURIComponent(memoryId)}`)),
  update: op("PATCH", "/memories/{memory_id}", (
    memoryId: string,
    body: { text?: string; status?: string; reason?: string },
  ) => apiFetch<MemoryAtom>(`/memories/${encodeURIComponent(memoryId)}`, {
    method: "PATCH", body: JSON.stringify(body),
  })),
  remove: op("DELETE", "/memories/{memory_id}", (memoryId: string) =>
    apiFetch<{ ok: boolean; memoryId: string }>(
      `/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" },
    )),
};

export const ENDPOINT_GROUPS = [
  auth, threads, attentions, sources, channels, cronJobs, tickets, usage,
  users, roles, invites, notifications, agents, teams, tools, knowledge,
  connectors, plugins, settings, adminOps, models, workspace, memories,
  adminModels, adminStorage, adminSecurity, adminOverview,
];
