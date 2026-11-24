/** Turn trace -> chat message decorations (steps / tool cards / files /
 * citations). The raw events come from GET /threads/{id}/trace, so a reload
 * renders exactly what happened without another schema. */

import type { TraceEvent } from "@/lib/api/wire";

export interface SubagentMeta {
  name: string;
  model?: string;
  rounds?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ToolStep {
  id: string;
  name: string;
  args: string;
  status: "running" | "ok" | "failed";
  durationMs?: number;
  output?: string;
  /** Child tool calls made by a delegated subagent. */
  children?: ToolStep[];
  /** v1.1 delegation metadata from subagent.* events. */
  subagent?: SubagentMeta;
}

export interface FileChange {
  path: string;
  bytes?: number;
}

export interface Citation {
  kb: string;
  doc: string;
  heading?: string;
  score?: number;
}

export interface TurnTrace {
  model?: string;
  mode?: "act" | "ask" | "plan";
  finished?: boolean;
  durationMs?: number;
  steps: ToolStep[];
  files: FileChange[];
  citations: Citation[];
}

type Payload = Record<string, unknown>;
const EMPTY: TurnTrace = { steps: [], files: [], citations: [] };

function payloadOf(event: TraceEvent): Payload {
  return event.payload ?? {};
}

function turnOf(event: TraceEvent): string | null {
  const payload = payloadOf(event);
  return event.turnId ?? (typeof payload.turn_id === "string" ? payload.turn_id : null);
}

function compact(value: unknown, max = 600): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pathOf(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : "";
  try {
    const parsed = JSON.parse(text) as { path?: unknown };
    if (typeof parsed.path === "string") return parsed.path;
  } catch {
    /* args_preview may be truncated: fall back to a regex */
  }
  const match = text.match(/"path"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/** Human-readable argument label: fs.read/write show the path, subagent
 * calls show the task, others trim. */
export function formatArgs(_name: string, raw: unknown): string {
  const path = pathOf(raw);
  if (path) return path;
  const text = typeof raw === "string" ? raw : compact(raw, 80);
  if (_name.startsWith("子智能体")) {
    try {
      const parsed = JSON.parse(text) as { task?: unknown };
      if (typeof parsed.task === "string") return compact(parsed.task, 80);
    } catch {
      /* args_preview may be truncated */
    }
    const match = text.match(/"task"\s*:\s*"([^"]*)"/);
    if (match) return compact(match[1], 80);
  }
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** Delegation output is a structured result; show the child's summary. */
function summaryOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = (value as Record<string, unknown>).summary;
  return typeof summary === "string" ? summary : null;
}

/**
 * Group tool events and KB evidence by turn. Steps keep trace order; a
 * completed/failed event closes the matching started step.
 */
export function summarizeTrace(
  items: TraceEvent[] | undefined,
): Map<string, TurnTrace> {
  const byTurn = new Map<string, TurnTrace>();
  const started = new Map<string, number>();
  const open = new Map<string, { turnId: string; step: ToolStep; startedAt: number }>();
  // delegate call id -> child tool call prefix ("<callId>_sub")
  const childParents = new Map<string, ToolStep>();

  const ensure = (turnId: string): TurnTrace => {
    let trace = byTurn.get(turnId);
    if (!trace) {
      trace = { steps: [], files: [], citations: [] };
      byTurn.set(turnId, trace);
    }
    return trace;
  };

  for (const event of items ?? []) {
    const turnId = turnOf(event);
    if (!turnId) continue;
    const payload = payloadOf(event);

    if (event.type === "turn.started") {
      const trace = ensure(turnId);
      trace.model = String(payload.model ?? "");
      const mode = String(payload.mode ?? "act");
      if (mode === "ask" || mode === "plan") trace.mode = mode;
      started.set(turnId, event.ts);
      continue;
    }
    if (event.type === "turn.finished") {
      const trace = ensure(turnId);
      trace.finished = true;
      const start = started.get(turnId);
      if (start !== undefined && event.ts > start) {
        trace.durationMs = (event.ts - start) * 1000;
      }
      continue;
    }
    if (event.type === "context.knowledge") {
      const trace = ensure(turnId);
      const citations = Array.isArray(payload.citations) ? payload.citations : [];
      for (const item of citations) {
        if (typeof item !== "object" || item === null) continue;
        const row = item as Record<string, unknown>;
        trace.citations.push({
          kb: String(row.kb ?? ""),
          doc: String(row.doc ?? ""),
          heading: row.heading ? String(row.heading) : undefined,
          score: typeof row.score === "number" ? row.score : undefined,
        });
      }
      continue;
    }

    if (event.type === "subagent.started") {
      const callId = String(payload.tool_call_id ?? "");
      const entry = open.get(callId);
      if (entry) {
        entry.step.subagent = {
          name: String(payload.agent_name ?? "子智能体"),
          model: payload.model ? String(payload.model) : undefined,
        };
        childParents.set(`${callId}_sub`, entry.step);
      }
      continue;
    }

    if (event.type === "subagent.completed" || event.type === "subagent.cancelled") {
      const callId = String(payload.tool_call_id ?? "");
      const entry = open.get(callId);
      const step = entry?.step ?? ensure(turnId).steps.find((item) => item.id === callId);
      if (step) {
        const usage = payload.usage;
        const meta = step.subagent ?? { name: String(payload.agent_name ?? "子智能体") };
        step.subagent = {
          ...meta,
          rounds: typeof payload.rounds === "number" ? payload.rounds : meta.rounds,
          inputTokens: usage && typeof usage === "object"
            ? Number((usage as Record<string, unknown>).input_tokens ?? 0) || undefined
            : meta.inputTokens,
          outputTokens: usage && typeof usage === "object"
            ? Number((usage as Record<string, unknown>).output_tokens ?? 0) || undefined
            : meta.outputTokens,
        };
      }
      continue;
    }

    if (event.type === "tool.started") {
      const callId = String(payload.tool_call_id ?? event.seq);
      const name = String(payload.name ?? "tool");
      const args = String(payload.args_preview ?? "");
      const step: ToolStep = { id: callId, name, args: formatArgs(name, args), status: "running" };
      let parent: ToolStep | undefined;
      for (const [prefix, candidate] of childParents) {
        if (callId.startsWith(prefix)) {
          parent = candidate;
          break;
        }
      }
      if (parent) {
        parent.children = [...(parent.children ?? []), step];
      } else {
        ensure(turnId).steps.push(step);
      }
      open.set(callId, { turnId, step, startedAt: event.ts });
      continue;
    }

    if (event.type === "tool.completed" || event.type === "tool.failed") {
      const callId = String(payload.tool_call_id ?? "");
      const entry = open.get(callId);
      if (!entry) continue;
      open.delete(callId);
      const step = entry.step;
      step.status = event.type === "tool.completed" ? "ok" : "failed";
      step.output = event.type === "tool.completed"
        ? summaryOf(payload.output) ?? compact(payload.output)
        : compact(payload.message ?? payload.code ?? "工具执行失败");
      const seconds = event.ts - entry.startedAt;
      if (seconds > 0) step.durationMs = seconds * 1000;

      if (step.name === "fs.write" && step.status === "ok") {
        const path = pathOf(step.args) ?? step.args;
        const trace = ensure(entry.turnId);
        let bytes: number | undefined;
        if (typeof payload.output === "object" && payload.output !== null) {
          const value = (payload.output as Record<string, unknown>).bytes;
          if (typeof value === "number") bytes = value;
        }
        if (path) trace.files.push({ path, bytes });
      }
    }
  }
  return byTurn;
}

export function traceFor(
  byTurn: Map<string, TurnTrace>, turnId: string | null | undefined,
): TurnTrace {
  if (!turnId) return EMPTY;
  return byTurn.get(turnId) ?? EMPTY;
}
