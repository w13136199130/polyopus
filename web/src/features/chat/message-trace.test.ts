import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/lib/api/wire";
import { formatArgs, summarizeTrace, traceFor } from "./message-trace";

function event(seq: number, type: string, payload: Record<string, unknown>, turnId = "tu_1"): TraceEvent {
  return { seq, type, ts: 1000 + seq, turnId, payload };
}

describe("message-trace", () => {
  it("pairs tool start/completion and extracts duration + output", () => {
    const trace = summarizeTrace([
      event(1, "tool.started", {
        tool_call_id: "tc_1", name: "fs.read", args_preview: '{"path":"src/auth.ts"}',
      }),
      event(3, "tool.completed", {
        tool_call_id: "tc_1", output: { content: "export const x = 1" },
      }),
    ]);
    const turn = traceFor(trace, "tu_1");
    expect(turn.steps).toHaveLength(1);
    expect(turn.steps[0]).toMatchObject({
      name: "fs.read", args: "src/auth.ts", status: "ok", durationMs: 2000,
    });
    expect(turn.steps[0].output).toContain("export const x");
    expect(turn.files).toEqual([]);
  });

  it("turns fs.write into a file change card", () => {
    const trace = summarizeTrace([
      event(1, "tool.started", {
        tool_call_id: "tc_w",
        name: "fs.write",
        args_preview: '{"path":"notes/report.md","content":"hello"}',
      }),
      event(2, "tool.completed", {
        tool_call_id: "tc_w", output: { path: "notes/report.md", bytes: 5 },
      }),
    ]);
    const turn = traceFor(trace, "tu_1");
    expect(turn.files).toEqual([{ path: "notes/report.md", bytes: 5 }]);
  });

  it("marks failed tools and keeps the error message", () => {
    const trace = summarizeTrace([
      event(1, "tool.started", {
        tool_call_id: "tc_x", name: "fs.read", args_preview: '{"path":"../secret"}',
      }),
      event(2, "tool.failed", {
        tool_call_id: "tc_x", code: "TOOL_PATH_DENIED", message: "路径越界",
      }),
    ]);
    const turn = traceFor(trace, "tu_1");
    expect(turn.steps[0].status).toBe("failed");
    expect(turn.steps[0].output).toContain("路径越界");
  });

  it("collects KB citations emitted for the turn", () => {
    const trace = summarizeTrace([
      event(1, "context.knowledge", {
        citations: [
          { kb: "运维手册", doc: "deploy.md", heading: "发布流程", score: -1.2 },
        ],
      }),
    ]);
    expect(traceFor(trace, "tu_1").citations).toEqual([
      { kb: "运维手册", doc: "deploy.md", heading: "发布流程", score: -1.2 },
    ]);
  });

  it("formatArgs prefers the path and trims unknown payloads", () => {
    expect(formatArgs("fs.read", '{"path":"a.txt"}')).toBe("a.txt");
    expect(formatArgs("shell.exec", `{"cmd":"${"x".repeat(120)}"}`)).toHaveLength(81);
  });
});
