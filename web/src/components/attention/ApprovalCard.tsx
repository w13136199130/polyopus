import { useState } from "react";
import { Button } from "@/components/ui";
import type { AttentionItem } from "@/lib/api/wire";
import styles from "./ApprovalCard.module.css";

interface Props {
  attention: AttentionItem;
  busy: boolean;
  onAnswer: (
    attentionId: string,
    decision: "approve" | "approve_session" | "deny",
  ) => void;
}

interface Action {
  tool?: string;
  tool_label?: string;
  source?: string;
  args_preview?: string;
  risk?: string;
}

function summarize(attention: AttentionItem): {
  tool: string;
  toolKey: string;
  source: string;
  preview: string;
  risk: string;
} {
  const payload = attention.payload as {
    summary?: string;
    actions?: Action[];
  };
  const first = payload.actions?.[0];
  const toolKey = first?.tool ?? "";
  // older rows may only carry a summary; never render "unknown tool" noise
  return {
    tool: first?.tool_label || toolKey || payload.summary || "审批请求",
    toolKey,
    source: first?.source ?? "builtin",
    preview: first?.args_preview ?? "",
    risk: first?.risk ?? "high",
  };
}

/** The one argument worth showing on the headline line: a path, a command,
 * or the first short string value. */
function argumentOf(preview: string): string {
  if (!preview) return "";
  try {
    const args = JSON.parse(preview) as Record<string, unknown>;
    for (const key of ["path", "cmd", "command", "city", "query", "url"]) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const first = Object.values(args).find(
      (value) => typeof value === "string" && value.trim(),
    );
    return typeof first === "string" ? first.trim().slice(0, 60) : "";
  } catch {
    /* truncated preview (500 chars): show the head of the raw text */
    return preview.slice(0, 60);
  }
}

function countdown(expiresAt: number): string {
  const seconds = Math.max(0, Math.floor(expiresAt * 1000 - Date.now()) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

const IMPACT: Record<string, string> = {
  fs_read: "批准后读取工作区文件；拒绝则跳过该工具",
  "fs.write": "批准后写入工作区，不会回滚；拒绝则跳过该工具",
};

/**
 * Policy-gate pause card (prototype 需要你确认): amber left rule, the tool
 * and its argument on one line, the consequence, then the three decisions.
 */
export function ApprovalCard({ attention, busy, onAnswer }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { tool, toolKey, source, preview, risk } = summarize(attention);
  const mcp = source === "mcp";
  const subagent = source === "subagent";
  const argument = argumentOf(preview);
  const expiring = attention.expiresAt * 1000 <= Date.now();

  return (
    <div className={styles.wrap}>
      <div className={styles.card} data-testid="approval-card">
        <div className={styles.top}>
          <span className={styles.icon} aria-hidden="true">⚠</span>
          <span className={styles.title}>需要你确认</span>
          <span className={styles.timer}>
            {expiring ? "即将自动拒绝" : `剩 ${countdown(attention.expiresAt)}`}
          </span>
        </div>

        <div className={styles.line}>
          <span className={styles.label}>工具</span>
          <b data-testid="approval-tool-label">{tool}</b>
          {argument ? (
            <>
              <span className={styles.sep}>·</span>
              <code>{argument}</code>
            </>
          ) : null}
          {subagent ? (
            <span className={styles.chip}>子智能体</span>
          ) : null}
          {mcp ? (
            <span className={`${styles.chip} ${risk === "low" ? "" : styles.chipAmber}`}>
              MCP 外部工具
            </span>
          ) : null}
        </div>
        <div className={styles.line}>
          <span className={styles.label}>影响</span>
          <span>
            {IMPACT[toolKey]
              ?? (mcp
                ? "批准后将调用外部 MCP 工具，结果回填到对话"
                : "批准后继续执行，不会回滚；拒绝则跳过该工具")}
          </span>
        </div>
        {tool !== toolKey && toolKey ? (
          <div className={styles.line}>
            <span className={styles.label}>标识</span>
            <code>{toolKey}</code>
          </div>
        ) : null}

        {expanded && preview ? <pre className={styles.args}>{preview}</pre> : null}

        <div className={styles.actions}>
          <Button
            size="sm"
            variant="outline"
            data-testid="approval-deny"
            disabled={busy}
            onClick={() => onAnswer(attention.attentionId, "deny")}
          >
            拒绝
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="approval-approve"
            disabled={busy}
            onClick={() => onAnswer(attention.attentionId, "approve")}
          >
            仅本次允许
          </Button>
          <Button
            size="sm"
            data-testid="approval-approve-session"
            disabled={busy}
            onClick={() => onAnswer(attention.attentionId, "approve_session")}
          >
            本会话允许
          </Button>
          {preview ? (
            <button
              type="button"
              className={styles.toggle}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? "收起参数" : "查看参数"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
