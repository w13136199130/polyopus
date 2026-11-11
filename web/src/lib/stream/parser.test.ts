import { describe, expect, it } from "vitest";
import { SseParser } from "./parser";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("SseParser", () => {
  it("parses well-formed frames", () => {
    const parser = new SseParser();
    const messages = parser.feed(
      bytes('data: {"seq":1}\n\ndata: {"seq":2}\n\n'),
    );
    expect(messages.map((m) => m.data)).toEqual(['{"seq":1}', '{"seq":2}']);
  });

  it("reassembles frames split across chunk boundaries", () => {
    const parser = new SseParser();
    expect(parser.feed(bytes('data: {"seq":1,"tex'))).toEqual([]);
    expect(parser.feed(bytes('t":"hi"}\n'))).toEqual([]);
    const messages = parser.feed(bytes("\ndata: done\n\n"));
    expect(messages.map((m) => m.data)).toEqual(['{"seq":1,"text":"hi"}', "done"]);
  });

  it("ignores comments including heartbeat pings", () => {
    const parser = new SseParser();
    const messages = parser.feed(bytes(": ping\n: ping\n\ndata: x\n\n"));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.data).toBe("x");
  });

  it("supports CRLF line endings and CRLF frame ends", () => {
    const parser = new SseParser();
    const messages = parser.feed(bytes("data: a\r\n\r\ndata: b\r\n\r\n"));
    expect(messages.map((m) => m.data)).toEqual(["a", "b"]);
  });

  it("joins multi-line data with newlines and keeps id/event fields", () => {
    const parser = new SseParser();
    const messages = parser.feed(bytes("id: 7\nevent: custom\ndata: l1\ndata: l2\n\n"));
    expect(messages[0]).toEqual({ id: "7", event: "custom", data: "l1\nl2" });
  });

  it("flush returns a trailing unterminated frame", () => {
    const parser = new SseParser();
    parser.feed(bytes("data: tail"));
    expect(parser.flush().map((m) => m.data)).toEqual(["tail"]);
    expect(parser.flush()).toEqual([]);
  });

  it("drops comment-only frames", () => {
    const parser = new SseParser();
    expect(parser.feed(bytes(": keepalive\n\n"))).toEqual([]);
  });
});
