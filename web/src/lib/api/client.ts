/**
 * API client (docs/49 §7): one fetch wrapper, cookie-first auth, trace ids,
 * error-envelope mapping and a single-flight global 401.
 *
 * Rules pinned by tests:
 * - credentials: "include"; token never read from storage
 * - every request carries X-Trace-Id; ApiError surfaces the server's traceId
 * - a 401 fires the `poly:unauthorized` event exactly ONCE per episode
 *   (login itself opts out via `skipUnauthorized`)
 */

export const UNAUTHORIZED_EVENT = "poly:unauthorized";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId?: string;

  constructor(status: number, code: string, message: string, traceId?: string) {
    super(message || code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }
}

const BASE = "/api/v1";

interface Envelope {
  error?: { code?: string; message?: string; traceId?: string };
}

let unauthorizedInFlight = false;

/** Test hook: reset the single-flight latch (also cleared on login success). */
export function resetUnauthorizedLatch(): void {
  unauthorizedInFlight = false;
}

/** Fire the global unauthorized event once per episode (also used by the SSE client on stream 401). */
export function fireUnauthorizedOnce(): void {
  if (unauthorizedInFlight) return;
  unauthorizedInFlight = true;
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

export function newTraceId(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(8);
    c.getRandomValues(bytes);
    return `tr_fe_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  // jsdom fallback
  return `tr_fe_${Math.random().toString(16).slice(2).padEnd(16, "0")}`;
}

export interface ApiFetchOptions extends RequestInit {
  /** 401 does not fire the global unauthorized event (login, boot probe). */
  skipUnauthorized?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { skipUnauthorized, headers, ...init } = options;
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Trace-Id": newTraceId(),
      ...(headers as Record<string, string> | undefined),
    },
  });

  const text = await response.text();
  const body: unknown = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const env = (body ?? {}) as Envelope;
    const error = new ApiError(
      response.status,
      env.error?.code ?? "INTERNAL_ERROR",
      env.error?.message ?? `HTTP ${response.status}`,
      env.error?.traceId,
    );
    if (response.status === 401 && !skipUnauthorized) fireUnauthorizedOnce();
    throw error;
  }
  return body as T;
}

/** Error code -> the UI behavior it maps to (docs/49 §7.3). */
export type ErrorIntent =
  | "login" // 401: session gone, go to /login (returnTo preserved)
  | "forbidden" // 403: show Forbidden state
  | "not-found" // 404: empty state, no existence leak
  | "conflict" // 409: toast + refresh the object
  | "validation" // 400/422: field errors, keep input
  | "rate-limit" // 429: cooldown
  | "server"; // 5xx / unknown: retryable ErrorState + traceId

export function errorIntent(error: ApiError): ErrorIntent {
  switch (error.status) {
    case 401:
      return "login";
    case 403:
      return "forbidden";
    case 404:
      return "not-found";
    case 409:
      return "conflict";
    case 422:
      return "validation";
    case 400:
      return error.code === "VALIDATION_FAILED" ? "validation" : "server";
    case 429:
      return "rate-limit";
    default:
      return "server";
  }
}
