/** Human-readable task text. Reports reach the UI as engine strings such as
 * `执行 completed（1047 tokens / 5457 micros）`; show the state in Chinese
 * and money as money instead of leaking "micros" into cards. */

const STATE_LABEL: Record<string, string> = {
  completed: "执行完成",
  failed: "执行失败",
  blocked: "执行受阻",
  waiting: "等待处理",
  waiting_approval: "等待审批",
};

const REPORT = /^执行 (\w+)（(\d+) tokens \/ (\d+) micros）$/;

const FACT_LABEL: Record<string, string> = {
  total_tokens: "Tokens",
  cost_micros: "成本",
};

export function fmtCost(micros?: number | null): string {
  return `¥${((micros ?? 0) / 1_000_000).toFixed(2)}`;
}

export function fmtTokens(tokens: number): string {
  return `${tokens.toLocaleString("zh-CN")} tokens`;
}

/** "执行 completed（1047 tokens / 5457 micros）" -> "执行完成 · 1,047 tokens · ¥0.01".
 *
 * `ended` marks an already-finished task: its last report can still say
 * `waiting_approval` when nobody answered in time, which must not read as
 * "still waiting". */
export function formatSummary(
  summary: string | null | undefined,
  ended = false,
): string {
  const text = (summary ?? "").trim();
  const match = REPORT.exec(text);
  if (!match) return text;
  if (ended && match[1] === "waiting_approval") {
    return "审批超时未处理，任务已结束";
  }
  const tokens = Number(match[2]);
  const micros = Number(match[3]);
  const parts = [STATE_LABEL[match[1]] ?? `执行 ${match[1]}`];
  if (tokens > 0) parts.push(fmtTokens(tokens));
  if (micros > 0) parts.push(fmtCost(micros));
  return parts.join(" · ");
}

/** Report facts: known keys get a label and a readable unit. */
export function formatFact(
  key: string,
  value: unknown,
): { label: string; value: string } {
  if (key === "total_tokens" && typeof value === "number") {
    return { label: FACT_LABEL.total_tokens, value: fmtTokens(value) };
  }
  if (key === "cost_micros" && typeof value === "number") {
    return { label: FACT_LABEL.cost_micros, value: fmtCost(value) };
  }
  return {
    label: FACT_LABEL[key] ?? key,
    value: typeof value === "object" ? JSON.stringify(value) : String(value),
  };
}

interface ApprovalAction {
  tool?: string;
  tool_label?: string;
  args_preview?: string;
}

/** One question line for an approval, prototype style: "是否允许写入 out.txt？". */
export function approvalQuestion(attention: {
  kind: string;
  payload: unknown;
}): string {
  const payload = attention.payload as {
    summary?: string;
    question?: string;
    actions?: ApprovalAction[];
  };
  const action = payload.actions?.[0];
  if (attention.kind === "approval" && action) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(action.args_preview ?? "{}") as Record<string, unknown>;
    } catch {
      /* truncated preview: fall back to the tool label */
    }
    const label = action.tool_label || action.tool || "该工具";
    const path = typeof args.path === "string" ? args.path : "";
    if (label === "fs.write" && path) return `是否允许写入 ${path}？`;
    if (label === "fs.read" && path) return `是否允许读取 ${path}？`;
    return `是否允许执行 ${label}？`;
  }
  return payload.question ?? payload.summary ?? "需要你的决定";
}
