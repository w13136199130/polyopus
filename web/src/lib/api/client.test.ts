import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  UNAUTHORIZED_EVENT,
  apiFetch,
  errorIntent,
  newTraceId,
  resetUnauthorizedLatch,
} from "./client";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetUnauthorizedLatch();
});

describe("apiFetch", () => {
  it("sends credentials, JSON headers and a trace id", async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(jsonResponse(200, { ok: true })) as Promise<Response>,
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/health");

    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe("/api/v1/health");
    expect(init?.credentials).toBe("include");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Trace-Id"]).toMatch(/^tr_fe_[0-9a-f]{16}$/);
  });

  it("maps the error envelope into ApiError (code + traceId)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(409, {
            error: { code: "ATTENTION_ALREADY_RESOLVED", message: "已处理",
                     traceId: "tr_server_1" },
          }),
        ),
      ),
    );

    const error = (await apiFetch("/attentions/x/answer", { method: "POST" }).catch(
      (e: unknown) => e as ApiError,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("ATTENTION_ALREADY_RESOLVED");
    expect(error.traceId).toBe("tr_server_1");
  });

  it("falls back to INTERNAL_ERROR when the body has no envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(503, { weird: true }))),
    );
    const error = (await apiFetch("/x").catch((e: unknown) => e as ApiError)) as ApiError;
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.status).toBe(503);
  });

  it("fires poly:unauthorized exactly once per episode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse(401, { error: { code: "UNAUTHORIZED" } })),
      ),
    );
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);

    await apiFetch("/threads").catch(() => undefined);
    await apiFetch("/tickets").catch(() => undefined);

    expect(listener).toHaveBeenCalledTimes(1);

    resetUnauthorizedLatch(); // login success re-arms the latch
    await apiFetch("/usage/summary").catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("skipUnauthorized keeps the session alive (login wrong password)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse(401, { error: { code: "AUTH_FAILED" } })),
      ),
    );
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);

    await apiFetch("/auth/login", { method: "POST", skipUnauthorized: true }).catch(
      () => undefined,
    );
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("errorIntent mapping (docs/49 §7.3)", () => {
  const cases: Array<[number, string, string]> = [
    [401, "AUTH_FAILED", "login"],
    [403, "FORBIDDEN", "forbidden"],
    [404, "NOT_FOUND", "not-found"],
    [409, "CONFLICT", "conflict"],
    [422, "VALIDATION_FAILED", "validation"],
    [400, "VALIDATION_FAILED", "validation"],
    [429, "RATE_LIMITED", "rate-limit"],
    [500, "INTERNAL_ERROR", "server"],
  ];
  it.each(cases)("%s %s -> %s", (status, code, intent) => {
    expect(errorIntent(new ApiError(status, code, ""))).toBe(intent);
  });
});

describe("newTraceId", () => {
  it("is unique and prefixed", () => {
    const a = newTraceId();
    const b = newTraceId();
    expect(a).not.toBe(b);
    expect(a.startsWith("tr_fe_")).toBe(true);
  });
});
