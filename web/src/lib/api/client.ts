/**
 * Minimal API client for V05-01 (login/me/logout only).
 * V05-02 replaces this with the full envelope/error map + endpoint wrappers
 * over `generated/ts` — keep the surface small on purpose.
 */

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

export interface SessionUser {
  userId: string;
  tenantId: string;
  username: string;
  displayName: string;
  isOwner: boolean;
}

interface Envelope {
  error?: { code?: string; message?: string; traceId?: string };
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body: unknown = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const env = (body ?? {}) as Envelope;
    throw new ApiError(
      response.status,
      env.error?.code ?? "INTERNAL_ERROR",
      env.error?.message ?? `HTTP ${response.status}`,
      env.error?.traceId,
    );
  }
  return body as T;
}
