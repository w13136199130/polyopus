import { useState } from "react";
import { Button } from "@/components/ui";
import type { AttentionItem } from "@/lib/api/wire";
import styles from "./ApprovalCard.module.css";

interface Props {
  attention: AttentionItem;
  busy: boolean;
  onAnswer: (attentionId: string, decision: "approve" | "deny") => void;
}

function summarize(attention: AttentionItem): { tool: string; preview: string } {
  const payload = attention.payload as {
    summary?: string;
    actions?: Array<{ tool?: string; args_preview?: string }>;
  };
  const first = payload.actions?.[0];
  // older rows may only carry a summary; never render "unknown tool" noise
  return { tool: first?.tool ?? payload.summary ?? "审批请求", preview: first?.args_preview ?? "" };
}

/** Policy-gate pause card: approve/deny via the Attention API (docs/48 V05-03). */
export function ApprovalCard({ attention, busy, onAnswer }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { tool, preview } = summarize(attention);

  return (
    <div className={styles.card} data-testid="approval-card">
      <div className={styles.head}>
        <span className={styles.risk}>需审批</span>
        <code className={styles.tool}>{tool}</code>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "收起参数" : "查看参数"}
        </button>
      </div>
      {expanded && preview ? (
        <pre className={styles.args}>{preview}</pre>
      ) : null}
      <div className={styles.ops}>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onAnswer(attention.attentionId, "approve")}
        >
          批准
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onAnswer(attention.attentionId, "deny")}
        >
          拒绝
        </Button>
      </div>
    </div>
  );
}
