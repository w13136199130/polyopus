import { afterEach, describe, expect, it, vi } from "vitest";
import { bindTransport, ChatStreamStore } from "./streamStore";
import { createSseTransport } from "@/lib/stream/sseTransport";
import type { EventFrame } from "@/lib/stream/transport";

function frame(seq: number, type: string, extra?: Partial<EventFrame>): EventFrame {
  return { seq, type, ts: seq, turnId: "tu_1", payload: {}, ...extra };
}

function delta(seq: number, text: string, turnId = "tu_1"): EventFrame {
  return frame(seq, "message.delta", {
    turnId,
    payload: { text },
  });
}

let store: ChatStreamStore;

afterEach(() => {
  vi.useRealTimers();
  store?.flush();
});

describe("ChatStreamStore", () => {
  it("optimistic -> ack -> streaming -> finished clears live text", () => {
    store = new ChatStreamStore();
    store.beginOptimistic("p1", "你好");
    expect(store.getSnapshot().status).toBe("optimistic");
    expect(store.getSnapshot().pendingUser?.content).toBe("你好");

    store.ack("tu_1");
    expect(store.getSnapshot().status).toBe("streaming");
    expect(store.getSnapshot().pendingUser).toBeNull();

    store.ingest(delta(1, "回"));
    store.ingest(delta(2, "复"));
    store.flush();
    expect(store.getSnapshot().text).toBe("回复");

    store.ingest(frame(3, "turn.finished"));
    expect(store.getSnapshot().status).toBe("finished");
    expect(store.getSnapshot().text).toBe("");
    expect(store.getSnapshot().turnId).toBe("tu_1");
  });

  it("message.completed overwrites accumulated deltas (authoritative blocks)", () => {
    store = new ChatStreamStore();
    store.beginOptimistic("p", "x");
    store.ack("tu_1");
    store.ingest(delta(1, "部分文"));
    store.ingest(delta(2, "本…"));
    store.ingest(
      frame(3, "message.completed", {
        payload: { blocks: [{ type: "text", text: "最终全文" }] },
      }),
    );
    store.flush();
    expect(store.getSnapshot().text).toBe("最终全文");
  });

  it("approval.requested pauses; approval.resumed returns to streaming", () => {
    store = new ChatStreamStore();
    store.beginOptimistic("p", "写文件");
    store.ack("tu_1");
    store.ingest(frame(1, "approval.requested"));
    expect(store.getSnapshot().status).toBe("waiting_approval");
    store.ingest(frame(2, "turn.resumed"));
    expect(store.getSnapshot().status).toBe("streaming");
  });

  it("ignores foreign turns (replayed history) but still tracks seq", () => {
    store = new ChatStreamStore();
    store.beginOptimistic("p", "hi");
    store.ack("tu_1");
    store.ingest(delta(1, "旧轮文本", "tu_OLD"));
    store.ingest(delta(2, "新文本"));
    store.flush();
    expect(store.getSnapshot().text).toBe("新文本");
    expect(store.getSnapshot().lastEventSeq).toBe(2);
  });

  it("rollback withdraws the bubble and returns the text", () => {
    store = new ChatStreamStore();
    store.beginOptimistic("p1", "没发出去的话");
    expect(store.rollback()).toBe("没发出去的话");
    expect(store.getSnapshot().status).toBe("idle");
    expect(store.getSnapshot().pendingUser).toBeNull();
  });

  it("coalesces text paints on a 50ms timer and flush() forces them", () => {
    vi.useFakeTimers();
    store = new ChatStreamStore();
    store.beginOptimistic("p", "x");
    store.ack("tu_1");

    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().text));

    store.ingest(delta(1, "a"));
    store.ingest(delta(2, "b"));
    store.ingest(delta(3, "c"));
    // no paint yet: all three deltas coalesce
    expect(seen).toEqual([]);

    vi.advanceTimersByTime(50);
    expect(seen).toEqual(["abc"]); // exactly one paint

    store.ingest(delta(4, "d"));
    store.flush();
    expect(seen).toEqual(["abc", "abcd"]);
  });

  it("idle store ignores frames entirely", () => {
    store = new ChatStreamStore();
    store.ingest(delta(1, "ghost"));
    expect(store.getSnapshot().text).toBe("");
    expect(store.getSnapshot().lastEventSeq).toBe(0);
  });
});

describe("bindTransport", () => {
  it("unsubscribes cleanly (no throw after off)", () => {
    const store2 = new ChatStreamStore();
    const transport = createSseTransport();
    const off = bindTransport(transport, store2);
    expect(() => off()).not.toThrow();
    transport.close();
  });
});
