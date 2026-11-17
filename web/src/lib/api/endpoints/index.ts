/**
 * Endpoint wrappers (docs/49 §7.2). Every route here MUST exist in
 * schemas/api/implemented.json — endpoints.test.ts walks the `.route`
 * metadata below and fails otherwise, so the contract-vs-implementation gap
 * (P0-2) can never creep in silently.
 */

import { apiFetch } from "../client";
import type {
  AnswerResponse,
  AttentionListResponse,
  CronJobListResponse,
  CronJobView,
  LoginRequest,
  LoginResponse,
  MessageListResponse,
  PostTurnResponse,
  SessionUser,
  AdminUserListResponse,
  AdminUserRow,
  InviteListResponse,
  InviteRow,
  RoleRow,
  SourceListResponse,
  SourceView,
  ThreadListResponse,
  TicketCounts,
  TicketDetail,
  TicketListResponse,
  TicketTimelineResponse,
  UsageSummaryResponse,
  WebhookAccepted,
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
  logout: op("POST", "/auth/logout", () =>
    apiFetch<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      skipUnauthorized: true,
    })),
};

export const threads = {
  list: op("GET", "/threads", () => apiFetch<ThreadListResponse>("/threads")),
  create: op("POST", "/threads", (title: string) =>
    apiFetch<ThreadListResponse["items"][number]>("/threads", {
      method: "POST",
      body: JSON.stringify({ title }),
    })),
  messages: op("GET", "/threads/{thread_id}/messages", (threadId: string) =>
    apiFetch<MessageListResponse>(
      `/threads/${encodeURIComponent(threadId)}/messages`,
    )),
  postTurn: op(
    "POST",
    "/threads/{thread_id}/turns",
    (threadId: string, content: string, clientMessageId?: string) =>
      apiFetch<PostTurnResponse>(`/threads/${encodeURIComponent(threadId)}/turns`, {
        method: "POST",
        body: JSON.stringify({ content, clientMessageId }),
      }),
  ),
};

export const attentions = {
  list: op("GET", "/attentions", () =>
    apiFetch<AttentionListResponse>("/attentions")),
  answer: op(
    "POST",
    "/attentions/{attention_id}/answer",
    (attentionId: string, decision: "approve" | "approve_session" | "deny") =>
      apiFetch<AnswerResponse>(
        `/attentions/${encodeURIComponent(attentionId)}/answer`,
        { method: "POST", body: JSON.stringify({ decision }) },
      ),
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
  setEnabled: op(
    "PATCH",
    "/cron-jobs/{job_id}",
    (jobId: string, enabled: boolean) =>
      apiFetch<CronJobView>(`/cron-jobs/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
  ),
  remove: op("DELETE", "/cron-jobs/{job_id}", (jobId: string) =>
    apiFetch<{ cronJobId: string; deleted: boolean }>(
      `/cron-jobs/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
    )),
};

export const tickets = {
  list: op("GET", "/tickets", () => apiFetch<TicketListResponse>("/tickets")),
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
  watchdogRun: op("POST", "/tickets/watchdog/run", () =>
    apiFetch<{ alerts: number }>("/tickets/watchdog/run", { method: "POST" })),
};

function usageParams(
  window: string,
  filters?: { asUser?: string; agentId?: string },
): string {
  const params = new URLSearchParams({ window });
  if (filters?.asUser) params.set("asUser", filters.asUser);
  if (filters?.agentId) params.set("agentId", filters.agentId);
  return params.toString();
}

export const usage = {
  summary: op(
    "GET",
    "/usage/summary",
    (window: "day" | "week" | "month", filters?: { asUser?: string; agentId?: string }) =>
      apiFetch<UsageSummaryResponse>(`/usage/summary?${usageParams(window, filters)}`),
  ),
  /** Raw CSV — plain fetch, not the JSON client. */
  exportCsv: op(
    "GET",
    "/usage/export",
    (window: "day" | "week" | "month", filters?: { asUser?: string; agentId?: string }) =>
      fetch(`/api/v1/usage/export?${usageParams(window, filters)}`, {
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
    username: string; displayName?: string; password: string; roles: string[];
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

export const ENDPOINT_GROUPS = [
  auth, threads, attentions, sources, cronJobs, tickets, usage,
  users, roles, invites,
];
