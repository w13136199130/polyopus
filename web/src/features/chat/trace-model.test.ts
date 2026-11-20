import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/lib/api/wire";
import { buildTrace } from "./trace-model";

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  turnId = "tu_1",
  ts = 100 + seq,
): TraceEvent {
  return { seq, type, ts, turnId, runId: "run_1", payload };
}

describe("trace-model", () => {
  it("groups user/model/assistant and pairs tool input/output", () => {
    const { groups } = buildTrace([
      event(1, "message.user", { content: "读一下 auth.ts" }),
      event(2, "turn.started", { model: "deepseek-flash" }),
      event(3, "tool.started", {
        tool_call_id: "tc_1",
        name: "fs.read",
        args_preview: '{"path":"src/auth.ts"}',
      }),
      event(4, "tool.completed", {
        tool_call_id: "tc_1",
        output: { content: "export {}" },
      }),
      event(5, "message.completed", {
        blocks: [{ type: "text", text: "看完了" }],
      }),
      event(6, "turn.finished", { status: "completed" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.kind)).toEqual([
      "user", "model", "tool", "assistant", "turn",
    ]);
    const tool = groups[0].items.find((item) => item.kind === "tool")!;
    expect(tool.status).toBe("ok");
    expect(tool.input).toEqual({ path: "src/auth.ts" });
    expect(tool.durationMs).toBe(1000);
  });

  it("keeps a failed tool and its error output", () => {
    const { items } = buildTrace([
      event(1, "tool.started", {
        tool_call_id: "tc_x",
        name: "fs.read",
        args_preview: '{"path":"../secret"}',
      }),
      event(2, "tool.failed", {
        tool_call_id: "tc_x",
        code: "TOOL_PATH_DENIED",
        message: "越界",
      }),
    ]);
    expect(items[0].status).toBe("failed");
    expect(String(items[0].output)).toContain("越界");
  });

  it("treats separate turns as separate groups", () => {
    const { groups } = buildTrace([
      event(1, "message.user", { content: "第一问" }, "tu_1", 100),
      event(2, "message.completed", {
        blocks: [{ type: "text", text: "第一答" }],
      }, "tu_1", 101),
      event(3, "message.user", { content: "第二问" }, "tu_2", 200),
      event(4, "message.completed", {
        blocks: [{ type: "text", text: "第二答" }],
      }, "tu_2", 201),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.index)).toEqual([1, 2]);
    expect(groups[1].items[0].title).toBe("第二问");
  });
});
