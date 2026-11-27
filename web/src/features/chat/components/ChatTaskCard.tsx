import { useState } from "react";
import { Button, StatusTag } from "@/components/ui";
import { pendingInbox, useAnswerAttention, useAttentions } from "@/lib/api/hooks";
import { useStopTicket, useTicketDetail } from "@/features/tasks/api";
import styles from "./ChatTaskCard.module.css";

export interface ChatTaskCardProps {
  /** Persisted mapping turnId → ticketId (thread settings). */
  ticketId?: string;
  /** Show the "建议创建任务" state for this turn. */
  suggested: boolean;
  title: string;
  content: string;
  onCreate: () => Promise<void>;
  onOpen: (ticketId: string) => void;
}

function costLabel(micros: number): string {
  return micros === 0 ? "未计价" : `¥${(micros / 1_000_000).toFixed(4)}`;
}

function stateOf(ticket: { bucket: string; report?: { state: string } | null }): {
  label: string;
  tone: "blue" | "green" | "amber" | "red" | "neutral";
} {
  if (ticket.report?.state === "failed") return { label: "失败", tone: "red" };
  if (ticket.bucket === "attention") return { label: "待授权", tone: "amber" };
  if (ticket.bucket === "running") return { label: "运行中", tone: "blue" };
  if (ticket.bucket === "done") {
    return ticket.report?.state === "completed"
      ? { label: "已完成", tone: "green" }
      : { label: "已结束", tone: "neutral" };
  }
  return { label: "已排队", tone: "neutral" };
}

/** 对话内任务卡: suggestion → ticket states → inline actions (docs/52 §3). */
export function ChatTaskCard({
  ticketId,
  suggested,
  title,
  content,
  onCreate,
  onOpen,
}: ChatTaskCardProps) {
  const [dismissed, setDismissed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = useTicketDetail(ticketId ?? null);
  const attentions = useAttentions();
  const answer = useAnswerAttention();
  const stop = useStopTicket();

  if (!ticketId) {
    if (!suggested || dismissed) return null;
    return (
      <div className={styles.card} data-testid="chat-task-suggest">
        <div className={styles.head}>
          <b>建议创建任务</b>
          <span>这个回合执行了有副作用的工具</span>
        </div>
        <p className={styles.desc}>
          固化为任务后会拿到独立的授权范围、预算和时间线，可在任务中心继续跟踪。
        </p>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDismissed(true)}
          >
            忽略
          </Button>
          <Button
            size="sm"
            data-testid="chat-task-create"
            loading={creating}
            onClick={() => {
              setError(null);
              setCreating(true);
              void onCreate()
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : "创建任务失败");
                })
                .finally(() => setCreating(false));
            }}
          >
            创建任务
          </Button>
        </div>
        <span className={styles.preview} title={content}>
          {title}
        </span>
      </div>
    );
  }

  const ticket = detail.data;
  const pendingApproval = pendingInbox(attentions.data?.items)
    .find((item) => item.ticketId === ticketId && item.kind === "approval");
  const status = ticket ? stateOf(ticket) : { label: "同步中", tone: "neutral" as const };

  return (
    <div className={styles.card} data-testid="chat-task-card" data-ticket-id={ticketId}>
      <div className={styles.head}>
        <b>任务卡</b>
        <StatusTag tone={status.tone} testId="chat-task-status">{status.label}</StatusTag>
        <span className={styles.ref}>{ticketId.slice(0, 11)}</span>
      </div>

      {detail.isError ? (
        <p className={styles.desc}>任务已不可用（可能已删除）。</p>
      ) : (
        <>
          <p className={styles.title}>{ticket?.title ?? title}</p>
          {ticket?.summary ? <p className={styles.desc}>{ticket.summary}</p> : null}
          {ticket?.bucket === "running" ? (
            <div className={styles.progress} aria-hidden="true">
              <i style={{ width: `${ticket.progress ?? 0}%` }} />
            </div>
          ) : null}
          <div className={styles.meta}>
            {ticket?.costMicros ? <span>{costLabel(ticket.costMicros)}</span> : null}
            {ticket?.executor ? <span>{ticket.executor === "builtin" ? "内置执行器" : ticket.executor}</span> : null}
          </div>
        </>
      )}

      <div className={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          data-testid="chat-task-open"
          onClick={() => onOpen(ticketId)}
        >
          打开工单
        </Button>
        {pendingApproval ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ attentionId: pendingApproval.attentionId, decision: "deny" })}
            >
              拒绝
            </Button>
            <Button
              size="sm"
              data-testid="chat-task-approve"
              loading={answer.isPending}
              onClick={() => answer.mutate({ attentionId: pendingApproval.attentionId, decision: "approve" })}
            >
              允许
            </Button>
          </>
        ) : ticket && (ticket.bucket === "running" || ticket.bucket === "queued") ? (
          <Button
            size="sm"
            variant="ghost"
            loading={stop.isPending}
            onClick={() => stop.mutate(ticketId)}
          >
            停止
          </Button>
        ) : null}
      </div>
    </div>
  );
}
