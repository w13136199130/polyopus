/**
 * V05-23 regression: inflight tail cache, history merge, seal prior, and the
 * transport's duplicate-seq/gap handling used by recovery.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents } from "@/lib/stream/sse";
import type { Message } from "@/lib/api/wire";
import {
  clearInflight,
  flushInflight,
  INFLIGHT_LIMITS,
  loadInflight,
  resetInflightForTests,
  saveInflight,
} from "./inflight-cache";
import { mergeHistory } from "./merge-history";
import { ChatStreamStore } from "./streamStore";

function msg(
  messageId: string,
  turnId: string,
  role: Message["role"],
  content: string,
): Message {
  return {
    messageId,
    threadId: "th",
    turnId,
    role,
    content,
    status: "completed",
    seq: 1,
    createdAt: 1,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  resetInflightForTests();
});

afterEach(() => {
  resetInflightForTests();
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe("inflight cache", () => {
  it("round-trips an entry and clears on demand", () => {
    saveInflight({
      threadId: "t1",
      userMessageId: "m1",
      turnId: "tu1",
      text: "半截回复",
      seq: 7,
      status: "streaming",
      updatedAt: 0,
    });
    flushInflight();
    const hit = loadInflight("t1");
    expect(hit?.text).toBe("半截回复");
    expect(hit?.seq).toBe(7);
    expect(hit?.userMessageId).toBe("m1");

    clearInflight("t1");
    expect(loadInflight("t1")).toBeNull();
  });

  it("truncates one entry and the total session budget", () => {
    saveInflight({
      threadId: "big",
      userMessageId: "m",
      turnId: "tu",
      text: "x".repeat(INFLIGHT_LIMITS.maxTextChars + 5_000),
      seq: 1,
      status: "streaming",
      updatedAt: 0,
    });
    flushInflight();
    expect(loadInflight("big")?.text.length).toBe(INFLIGHT_LIMITS.maxTextChars);

    for (let i = 0; i < 20; i += 1) {
      saveInflight({
        threadId: `t${i}`,
        userMessageId: `m${i}`,
        turnId: `tu${i}`,
        text: "y".repeat(INFLIGHT_LIMITS.maxTextChars),
        seq: 1,
        status: "streaming",
        updatedAt: 0,
      });
    }
    flushInflight();
    let total = 0;
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i) ?? "";
      if (key.startsWith("poly:inflight:")) {
        total += (window.sessionStorage.getItem(key) ?? "").length;
      }
    }
    expect(total).toBeLessThanOrEqual(INFLIGHT_LIMITS.maxTotalChars);
  });

  it("misses for an unknown or expired thread", () => {
    expect(loadInflight("nope")).toBeNull();
    saveInflight({
      threadId: "old",
      userMessageId: "m",
      turnId: "tu",
      text: "stale",
      seq: 1,
      status: "streaming",
      updatedAt: 0,
    });
    flushInflight();
    const raw = JSON.parse(
      window.sessionStorage.getItem("poly:inflight:old") as string,
    );
    raw.updatedAt = Date.now() - 11 * 60_000;
    window.sessionStorage.setItem("poly:inflight:old", JSON.stringify(raw));
    expect(loadInflight("old")).toBeNull();
  });
});

describe("history merge", () => {
  it("appends the live tail when history has no assistant row yet", () => {
    const messages = [msg("m1", "tu1", "user", "问题"), msg("a1", "tu1", "assistant", "旧答")];
    const merged = mergeHistory(messages, {
      turnId: "tu2", userMessageId: "m2", text: "新答", status: "streaming",
    });
    expect(merged.liveText).toBe("新答");
    expect(merged.messages).toHaveLength(2);
  });

  it("ignores a cache whose user message is not the last one", () => {
    const messages = [
      msg("m1", "tu1", "user", "旧问"),
      msg("a1", "tu1", "assistant", "旧答"),
      msg("m2", "tu2", "user", "新问"),
    ];
    const merged = mergeHistory(messages, {
      turnId: "tu3", userMessageId: "m1", text: "陈旧尾部", status: "streaming",
    });
    expect(merged.liveText).toBe("");
    expect(merged.messages).toBe(messages);
  });

  it("takes the richer side for the same turn, never two streams", () => {
    const messages = [msg("m1", "tu1", "user", "问"), msg("a1", "tu1", "assistant", "短")];
    const merged = mergeHistory(messages, {
      turnId: "tu1", userMessageId: "m1", text: "长很多的新文本", status: "streaming",
    });
    expect(merged.liveText).toBe("");
    expect(merged.messages[1].content).toBe("长很多的新文本");

    const historyRicher = mergeHistory(
      [msg("m1", "tu1", "user", "问"), msg("a1", "tu1", "assistant", "历史全文")],
      { turnId: "tu1", userMessageId: "m1", text: "短", status: "streaming" },
    );
    expect(historyRicher.messages[1].content).toBe("历史全文");
    expect(historyRicher.liveText).toBe("");
  });
});

describe("seal prior + restore", () => {
  it("a new send seals the previous streaming turn", () => {
    const store = new ChatStreamStore();
    store.beginOptimistic("p1", "第一问");
    store.ack("tu1", "m1");
    store.ingest({
      seq: 1, type: "message.delta", ts: 1, turnId: "tu1",
      payload: { text: "上一轮还在流" },
    });
    store.flush();
    expect(store.getSnapshot().text).toBe("上一轮还在流");

    store.beginOptimistic("p2", "第二问");
    expect(store.getSnapshot().status).toBe("optimistic");
    expect(store.getSnapshot().text).toBe("");
    expect(store.getSnapshot().turnId).toBeNull();
  });

  it("restores a cached tail and continues from its seq", () => {
    const store = new ChatStreamStore();
    store.restore({
      turnId: "tu2", userMessageId: "m2", text: "刷新前的半句",
      seq: 9, status: "streaming",
    });
    expect(store.getSnapshot().userMessageId).toBe("m2");
    expect(store.getSnapshot().lastEventSeq).toBe(9);
    store.ingest({
      seq: 10, type: "message.delta", ts: 10, turnId: "tu2",
      payload: { text: "，继续" },
    });
    store.flush();
    expect(store.getSnapshot().text).toBe("刷新前的半句，继续");
  });
});

describe("recovery transport", () => {
  it("dedupes a replayed seq and reports the gap", async () => {
    const encoder = new TextEncoder();
    const frames = [
      { seq: 1, type: "message.delta", ts: 1 },
      { seq: 1, type: "message.delta", ts: 1 },
      { seq: 4, type: "turn.finished", ts: 4 },
    ]
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join("");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(frames));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
    const seen: number[] = [];
    const gaps: Array<[number, number]> = [];
    const connection = connectEvents({
      threadId: "t1",
      afterSeq: 0,
      follow: false,
      signal: new AbortController().signal,
      fetchImpl: vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch,
      onEvent: (event) => seen.push(event.seq),
      onGap: (from, to) => gaps.push([from, to]),
    });
    await connection.done;
    expect(seen).toEqual([1, 4]);
    expect(gaps).toEqual([[2, 3]]);
  });
});
