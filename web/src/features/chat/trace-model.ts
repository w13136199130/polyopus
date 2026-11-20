/** Build a human-readable trace model from raw thread events.
 *
 * One group per turn; rows are the things a person wants to inspect:
 * what the user sent, which model ran, what it answered, which tools ran
 * (args + output), approvals and KB evidence. Deltas are already filtered
 * by the backend.
 */

import type { TraceEvent } from "@/lib/api/wire";

export type TraceKind =
  | "user" | "model" | "assistant" | "tool" | "approval" | "context" | "turn";

export interface TraceItem {
  id: string;
  kind: TraceKind;
  label: string;
  title: string;
  detail: string;
  ts: number;
  status: "ok" | "failed" | "running" | "neutral" | "waiting";
  turnId: string | null;
  runId: string | null;
  input?: unknown;
  output?: unknown;
  raw: TraceEvent;
  durationMs?: number;
}

export interface TraceGroup {
  key: string;
  turnId: string | null;
  index: number;
  startedAt: number;
  items: TraceItem[];
}

const LABEL: Record<TraceKind, string> = {
  user: "用户",
  model: "模型",
  assistant: "回答",
  tool: "工具",
  approval: "审批",
  context: "上下文",
  turn: "回合",
};

function payloadOf(event: TraceEvent): Record<string, unknown> {
  return event.payload ?? {};
}

function preview(value: unknown, max = 120): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => (block as { type?: string }).type === "text")
    .map((block) => String((block as { text?: string }).text ?? ""))
    .join("\n");
}

function toolInput(payload: Record<string, unknown>): unknown {
  const raw = payload.args_preview;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function buildTrace(
  events: TraceEvent[] | undefined,
): { groups: TraceGroup[]; items: TraceItem[] } {
  const groups = new Map<string, TraceGroup>();
  const tools = new Map<string, TraceItem>();
  const seqToItem = new Map<string, TraceItem>();

  const groupFor = (event: TraceEvent): TraceGroup => {
    const key = event.turnId ?? "history";
    let group = groups.get(key);
    if (!group) {
      group = {
        key, turnId: event.turnId ?? null, index: 0,
        startedAt: event.ts, items: [],
      };
      groups.set(key, group);
    }
    return group;
  };

  const push = (event: TraceEvent, item: Omit<TraceItem, "raw" | "turnId" | "runId">) => {
    const group = groupFor(event);
    const full: TraceItem = {
      ...item,
      turnId: event.turnId ?? null,
      runId: event.runId ?? null,
      raw: event,
    };
    group.items.push(full);
    seqToItem.set(`${event.seq}:${event.type}`, full);
    return full;
  };

  for (const event of [...(events ?? [])].sort((a, b) => a.ts - b.ts || a.seq - b.seq)) {
    const payload = payloadOf(event);
    switch (event.type) {
      case "message.user": {
        const content = String(payload.content ?? "");
        push(event, {
          id: `u-${event.seq}`, kind: "user", label: LABEL.user,
          title: preview(content, 90), detail: content, ts: event.ts,
          status: "ok", input: content,
        });
        break;
      }
      case "message.assistant": {
        const content = String(payload.content ?? "");
        push(event, {
          id: `a-${event.seq}`, kind: "assistant", label: LABEL.assistant,
          title: preview(content, 90), detail: content, ts: event.ts,
          status: "ok", output: content,
        });
        break;
      }
      case "turn.started": {
        const model = String(payload.model ?? "");
        push(event, {
          id: `m-${event.seq}`, kind: "model", label: LABEL.model,
          title: `模型 ${model} 开始`, detail: "", ts: event.ts,
          status: "running", input: { model }, output: undefined,
        });
        break;
      }
      case "message.completed": {
        const content = textOfBlocks(payload.blocks);
        push(event, {
          id: `a-${event.seq}`, kind: "assistant", label: LABEL.assistant,
          title: preview(content, 90), detail: content, ts: event.ts,
          status: "ok", output: content,
        });
        break;
      }
      case "tool.started": {
        const callId = String(payload.tool_call_id ?? event.seq);
        const name = String(payload.name ?? "tool");
        const input = toolInput(payload);
        const item = push(event, {
          id: `t-${callId}`, kind: "tool", label: LABEL.tool,
          title: `${name} ${preview(input, 70)}`, detail: "", ts: event.ts,
          status: "running", input,
        });
        tools.set(callId, item);
        break;
      }
      case "tool.completed":
      case "tool.failed": {
        const callId = String(payload.tool_call_id ?? "");
        const item = tools.get(callId);
        if (!item) break;
        item.status = event.type === "tool.completed" ? "ok" : "failed";
        item.output = payload.output ?? payload.message ?? payload.code;
        item.detail = preview(item.output, 400);
        if (event.ts > item.ts) item.durationMs = (event.ts - item.ts) * 1000;
        tools.delete(callId);
        break;
      }
      case "approval.requested":
        push(event, {
          id: `ap-${event.seq}`, kind: "approval", label: LABEL.approval,
          title: `等待确认 · ${String(payload.tool ?? "")}`,
          detail: preview(payload.args_preview ?? payload.question, 300),
          ts: event.ts, status: "waiting", input: payload,
        });
        break;
      case "approval.resolved":
        push(event, {
          id: `ap-${event.seq}`, kind: "approval", label: LABEL.approval,
          title: `审批结果 · ${String(payload.decision ?? "")}`,
          detail: "", ts: event.ts, status: "ok",
          output: payload.decision,
        });
        break;
      case "context.knowledge": {
        const citations = Array.isArray(payload.citations) ? payload.citations : [];
        push(event, {
          id: `c-${event.seq}`, kind: "context", label: LABEL.context,
          title: `知识库命中 ${citations.length} 条`,
          detail: citations
            .map((row) => {
              const item = row as Record<string, unknown>;
              return `${String(item.kb ?? "")} · ${String(item.doc ?? "")}`;
            })
            .join("\n"),
          ts: event.ts, status: "neutral", output: citations,
        });
        break;
      }
      case "turn.finished": {
        const group = groups.get(event.turnId ?? "history");
        const model = group?.items.find(
          (item) => item.kind === "model" && item.status === "running",
        );
        if (model) {
          model.status = payload.status === "completed" ? "ok" : "failed";
          if (event.ts > model.ts) model.durationMs = (event.ts - model.ts) * 1000;
        }
        push(event, {
          id: `f-${event.seq}`, kind: "turn", label: LABEL.turn,
          title: `回合结束 · ${String(payload.status ?? "")}`,
          detail: "", ts: event.ts,
          status: payload.status === "completed" ? "ok" : "neutral",
          output: payload.status,
        });
        break;
      }
      case "turn.cancel_requested":
      case "turn.requeued":
        push(event, {
          id: `r-${event.seq}`, kind: "turn", label: LABEL.turn,
          title: event.type === "turn.cancel_requested"
            ? "收到停止请求" : "回合重新排队",
          detail: "", ts: event.ts, status: "waiting", input: payload,
        });
        break;
      default:
        break;
    }
  }

  const ordered = [...groups.values()]
    .filter((group) => group.items.length > 0)
    .sort((a, b) => a.startedAt - b.startedAt);
  ordered.forEach((group, index) => { group.index = index + 1; });
  return { groups: ordered, items: ordered.flatMap((group) => group.items) };
}
