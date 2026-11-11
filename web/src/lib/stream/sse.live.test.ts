/**
 * LIVE SSE check (docs/48 V05-02 acceptance: "断线后从 last_seq 续读不重复").
 *
 * Opt-in: spawns a real `poly serve` (FakeModel, temp DB) and proves that a
 * stream cut mid-turn resumes from last_seq with no duplicate or missing seq.
 * Run: RUN_SSE_LIVE=1 pnpm --dir web test -- sse.live
 */
// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectEvents } from "./sse";

const RUN = process.env.RUN_SSE_LIVE === "1";
const d = describe.skipIf(!RUN);

let server: ChildProcess | null = null;
let baseUrl = "";
let cookie = "";

function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolvePort(port));
    });
  });
}

async function waitHealthy(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not become healthy");
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies =
    (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [];
  if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** fetch wrapper that carries the login cookie into connectEvents. */
function cookieFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(String(input), {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), Cookie: cookie },
  });
}

d("live server: resume from last_seq with no duplicates", () => {
  beforeAll(async () => {
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), "poly-sse-live-"));
    const root = resolve(process.cwd(), "..");
    const py = join(root, ".venv", "Scripts", "python.exe");
    server = spawn(
      py,
      ["-m", "polyopus", "serve", "--port", String(port), "--host", "127.0.0.1"],
      {
        cwd: root,
        stdio: "ignore",
        env: {
          ...process.env,
          POLY_DB_PATH: join(dir, "live.db"),
          POLY_WORKSPACE_DIR: join(dir, "ws"),
          POLY_ADMIN_PASSWORD: "live-pass",
          POLY_MODEL_BASE_URL: "",
          POLY_MODEL_API_KEY: "",
          POLY_MODEL_NAME: "",
          POLY_EMBEDDED_WORKER: "true",
        } as NodeJS.ProcessEnv,
      },
    );
    baseUrl = `http://127.0.0.1:${port}`;
    await waitHealthy(baseUrl);
  }, 90_000);
  
  afterAll(() => {
    server?.kill();
  });

  it("cut mid-turn, reconnect, cover every seq exactly once", async () => {
    await call("POST", "/auth/login", { username: "admin", password: "live-pass" });
    const thread = await call<{ threadId: string }>("POST", "/threads", {
      title: "sse-live",
    });
    await call("POST", `/threads/${thread.threadId}/turns`, {
      content: "hello live sse world", // FakeModel echo -> many deltas
    });

    // --- connection 1: read 3 events, then cut hard ---
    const first: number[] = [];
    const cut = new AbortController();
    const c1 = connectEvents({
      threadId: thread.threadId,
      afterSeq: 0,
      signal: cut.signal,
      fetchImpl: cookieFetch,
      baseUrl,
      onState: () => undefined,
      onEvent: (e) => {
        first.push(e.seq);
        if (first.length >= 3) cut.abort(); // mid-stream cut (outer signal)
      },
    });
    await c1.done;
    expect(first).toEqual([1, 2, 3]);

    // --- connection 2: resume from lastSeq until the turn finishes ---
    const second: number[] = [];
    const c2 = connectEvents({
      threadId: thread.threadId,
      afterSeq: c1.lastSeq(),
      signal: new AbortController().signal,
      fetchImpl: cookieFetch,
      baseUrl,
      onEvent: (e) => second.push(e.seq),
    });
    const finalState = await c2.done;

    expect(finalState).toBe("closed"); // stopped at turn.finished
    expect(second[0]).toBe(first.length + 1); // resumes exactly after lastSeq
    // strictly increasing, no duplicates within the second pass
    for (let i = 1; i < second.length; i += 1) {
      expect(second[i]).toBe(second[i - 1]! + 1);
    }
    // combined coverage is contiguous 1..N with zero overlap
    const all = [...first, ...second];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
  }, 120_000);
});
