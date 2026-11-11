import { afterEach, describe, expect, it, vi } from "vitest";
import { UNAUTHORIZED_EVENT } from "@/lib/api/client";
import { connectEvents } from "./sse";
import type { TransportState } from "./transport";

function sseResponse(frames: string[], opts?: { status?: number; keepOpen?: boolean }) {
  if (opts?.status && opts.status !== 200) {
    return new Response("nope", { status: opts.status });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      if (!opts?.keepOpen) controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function event(seq: number, type = "message.delta", extra?: Record<string, unknown>) {
  return `data: ${JSON.stringify({ seq, type, ts: seq, ...extra })}\n\n`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("connectEvents", () => {
  it("delivers events in order and stops after turn.finished", async () => {
    const events: number[] = [];
    const states: TransportState[] = [];
    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      signal: new AbortController().signal,
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          sseResponse([event(1, "turn.queued"), event(2), event(3, "turn.finished")]),
        ),
      ),
      onEvent: (e) => events.push(e.seq),
      onState: (s) => states.push(s),
    });

    await expect(connection.done).resolves.toBe("closed");
    expect(events).toEqual([1, 2, 3]);
    expect(states).toContain("open");
    expect(connection.lastSeq()).toBe(3);
  });

  it("dedupes seqs replayed after a reconnect and resumes from after_seq", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const urls: string[] = [];
    let calls = 0;
    const fetchImpl = vi.fn((url: RequestInfo | URL) => {
      urls.push(String(url));
      calls += 1;
      if (calls === 1) {
        // first connection drops after seq 2 (EOF on a follow stream)
        return Promise.resolve(sseResponse([event(1), event(2)], { keepOpen: false }));
      }
      // reconnect replays 2 (duplicate) then continues 3..4
      return Promise.resolve(
          sseResponse([event(2), event(3), event(4, "turn.finished")], {
            keepOpen: false,
          }),
        );
    }) as unknown as typeof fetch;

    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      signal: new AbortController().signal,
      fetchImpl,
      onEvent: (e) => seen.push(e.seq),
    });

    // first connection ends immediately; the loop waits 500ms before retrying
    await vi.advanceTimersByTimeAsync(600);
    await expect(connection.done).resolves.toBe("closed");
    expect(seen).toEqual([1, 2, 3, 4]); // the replayed seq 2 arrives once
    expect(urls[1]).toContain("after_seq=2");
  });

  it("reports a gap when seq jumps", async () => {
    const gaps: Array<[number, number]> = [];
    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      signal: new AbortController().signal,
      fetchImpl: vi.fn(() =>
        Promise.resolve(sseResponse([event(1), event(4, "turn.finished")])),
      ),
      onEvent: () => undefined,
      onGap: (from, to) => gaps.push([from, to]),
    });
    await connection.done;
    expect(gaps).toEqual([[2, 3]]);
  });

  it("401 fires the global unauthorized event once and stops", async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      signal: new AbortController().signal,
      fetchImpl: vi.fn(() => Promise.resolve(sseResponse([], { status: 401 }))),
      onEvent: () => undefined,
    });
    await expect(connection.done).resolves.toBe("unauthorized");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it("gives up after maxRetries with state error", async () => {
    vi.useFakeTimers();
    const states: TransportState[] = [];
    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      signal: new AbortController().signal,
      fetchImpl: vi.fn(() => Promise.reject(new TypeError("network down"))),
      maxRetries: 2,
      backoffMs: [10],
      onEvent: () => undefined,
      onState: (s) => states.push(s),
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(connection.done).resolves.toBe("error");
    expect(states.filter((s) => s === "reconnecting")).toHaveLength(2);
  });

  it("close() settles immediately as closed", async () => {
    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      signal: new AbortController().signal,
      fetchImpl: vi.fn(() => Promise.resolve(sseResponse([], { keepOpen: true }))),
      onEvent: () => undefined,
    });
    connection.close();
    await expect(connection.done).resolves.toBe("closed");
  });

  it("ignores unknown event types and malformed frames", async () => {
    const types: string[] = [];
    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      signal: new AbortController().signal,
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          sseResponse([
            "data: not-json\n\n",
            "data: {\"seq\":1,\"type\":\"some.future.event\"}\n\n",
            "data: {\"seq\":2,\"type\":\"turn.finished\"}\n\n",
          ]),
        ),
      ),
      onEvent: (e) => types.push(e.type),
    });
    await connection.done;
    expect(types).toEqual(["some.future.event", "turn.finished"]);
  });
});
