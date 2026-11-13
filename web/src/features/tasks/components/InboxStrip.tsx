import { ErrorState, Loading } from "@/components/ui";
import { ApprovalCard } from "@/components/attention/ApprovalCard";
import { useAnswerAttention } from "@/lib/api/hooks";
import type { AttentionItem } from "@/lib/api/wire";
import styles from "./InboxStrip.module.css";

interface Props {
  items: AttentionItem[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

function describe(attention: AttentionItem): string {
  const payload = attention.payload as { summary?: string };
  if (attention.kind === "blocked") return payload.summary ?? "执行受阻";
  if (attention.kind === "failed") return payload.summary ?? "执行失败";
  if (attention.kind === "question") return payload.summary ?? "待回答";
  return payload.summary ?? "待审批";
}

function kindLabel(kind: string): string {
  if (kind === "blocked") return "受阻";
  if (kind === "failed") return "执行失败";
  return "待回答";
}

/** Attention inbox (V05-04): approvals answer inline, blocked/failed/question inform. */
export function InboxStrip({ items, loading, error, onRetry }: Props) {
  const answer = useAnswerAttention();

  if (loading && !items) return <Loading label="载入收件箱…" />;
  if (error) {
    return <ErrorState message="收件箱加载失败" onRetry={onRetry} />;
  }
  if (!items || items.length === 0) {
    return <p className={styles.empty}>收件箱为空：没有待处理的审批或告警。</p>;
  }

  return (
    <section className={styles.strip} aria-label="注意力收件箱">
      {items.map((attention) =>
        attention.kind === "approval" ? (
          <ApprovalCard
            key={attention.attentionId}
            attention={attention}
            busy={answer.isPending}
            onAnswer={(attentionId, decision) =>
              answer.mutate({ attentionId, decision })
            }
          />
        ) : (
          <div
            key={attention.attentionId}
            className={`${styles.note} ${styles[attention.kind] ?? ""}`}
            role="status"
          >
            <div>
              <strong>{kindLabel(attention.kind)}</strong>
              <span> · {describe(attention)}</span>
            </div>
            {attention.ticketId ? (
              <code className={styles.ticketRef}>{attention.ticketId}</code>
            ) : null}
          </div>
        ),
      )}
    </section>
  );
}
