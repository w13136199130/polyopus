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

function minutesLeft(expiresAt: number): number {
  return Math.max(0, Math.round((expiresAt * 1000 - Date.now()) / 60000));
}

/**
 * Policy-gate pause card restyled to the task-card prototype (待审批 state):
 * tc-top (icon/title/pill) + 影响 line + auto-deny chip + tc-actions.
 */
export function ApprovalCard({ attention, busy, onAnswer }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { tool, toolKey, source, preview, risk } = summarize(attention);
  const minutes = minutesLeft(attention.expiresAt);

  return (
    <div className={styles.wrap}>
      <div className={styles.card} data-testid="approval-card">
        <div className={styles.top}>
          <span className={styles.icon} aria-hidden="true">⚑</span>
          <span className={styles.title} data-testid="approval-tool-label">
            等待你批准：{tool}
          </span>
          <span className={styles.pill}>待审批</span>
        </div>

        <div className={styles.line}>
          <b>待批准</b>
          <span>
            <code>{toolKey || tool}</code>
            {tool !== toolKey ? <> · {tool}</> : null}
            {" "}· 风险 {risk}
          </span>
        </div>
        <div className={styles.line}>
          <b>影响</b>
          <span>批准后继续执行，不会回滚；拒绝则跳过该工具</span>
        </div>

        {preview ? (
          <div className={styles.line}>
            <b>参数</b>
            <button
              type="button"
              className={styles.toggle}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? "收起参数" : "查看参数"}
            </button>
            {expanded ? (
              <pre className={styles.args}>{preview}</pre>
            ) : null}
          </div>
        ) : null}

        <div className={styles.chips}>
          <span className={`${styles.chip} ${styles.chipAmber}`}>
            {minutes > 0 ? `${minutes} 分钟后自动拒绝` : "即将自动拒绝"}
          </span>
          {source === "mcp" ? <span className={styles.chip}>MCP 外部工具</span> : null}
          <span className={styles.chip}>审计已记录</span>
        </div>

        <div className={styles.actions}>
          <Button
            size="sm"
            variant="danger"
            data-testid="approval-deny"
            disabled={busy}
            onClick={() => onAnswer(attention.attentionId, "deny")}
          >
            拒绝
          </Button>
          <Button
            size="sm"
            variant="secondary"
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
          <span className={styles.note}>拒绝不会执行该工具</span>
        </div>
      </div>
    </div>
  );
}
