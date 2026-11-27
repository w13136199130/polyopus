import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import { pendingInbox, useAnswerAttention, useAttentions } from "@/lib/api/hooks";
import type { AttentionItem, TicketRow } from "@/lib/api/wire";
import { approvalQuestion, fmtCost, formatSummary } from "../format";
import styles from "./TicketList.module.css";

interface Props {
  rows: TicketRow[];
  loading: boolean;
  error: boolean;
  selectedId: string | null;
  onOpen: (ticketId: string) => void;
  onCreate: () => void;
  creating: boolean;
  onRetry: () => void;
  /** Inbox bulk mode: approval rows get a checkbox. */
  selectable?: boolean;
  selectedAttentionIds?: Set<string>;
  onToggleSelect?: (attentionId: string, checked: boolean) => void;
  onAnswerQuestion?: (attentionId: string, answer: string) => void;
  questionBusy?: boolean;
}

const SOURCE_TAG: Record<string, string> = {
  github: "GH", feishu: "FS", lark: "FS", email: "EM",
  schedule: "CR", webhook: "WB", rss: "RS",
};

function sourceTag(kind: string | null | undefined): string {
  if (!kind) return "手动";
  return SOURCE_TAG[kind] ?? kind.slice(0, 2).toUpperCase();
}

export function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function shortRef(ticketId: string): string {
  return `#${ticketId.replace(/^tk_/, "").slice(0, 4).toUpperCase()}`;
}

function stateTag(bucket: string): [string, string] {
  if (bucket === "attention") return ["待决", styles.tagRed];
  if (bucket === "running") return ["运行中", styles.tagGreen];
  if (bucket === "done") return ["已完成", styles.tagGreen];
  return ["排队中", styles.tagNeutral];
}

function TicketCard({
  row, attention, selected, canWrite, busy, onAnswer, onOpen,
  selectable, selectedAttentionIds, onToggleSelect,
  onAnswerQuestion, questionBusy,
}: {
  row: TicketRow;
  attention: AttentionItem | undefined;
  selected: boolean;
  canWrite: boolean;
  busy: boolean;
  onAnswer: (attentionId: string, decision: "approve" | "deny") => void;
  onOpen: (ticketId: string) => void;
  selectable?: boolean;
  selectedAttentionIds?: Set<string>;
  onToggleSelect?: (attentionId: string, checked: boolean) => void;
  onAnswerQuestion?: (attentionId: string, answer: string) => void;
  questionBusy?: boolean;
}) {
  const [label, tone] = stateTag(row.bucket);
  const [answerDraft, setAnswerDraft] = useState("");
  const actor = row.actor?.name ?? "系统";
  return (
    <div
      className={[
        styles.card,
        styles[`card_${row.bucket}`] ?? "",
        selectable && attention?.kind === "approval" ? styles.cardSelectable : "",
        selected ? styles.selected : "",
      ].filter(Boolean).join(" ")}
      data-testid="ticket-row"
      data-ticket-id={row.ticketId}
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={() => onOpen(row.ticketId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(row.ticketId);
        }
      }}
    >
      {selectable && attention?.kind === "approval" ? (
        <label
          className={styles.selectBox}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <input
            type="checkbox"
            aria-label={`选择 ${row.title}`}
            data-testid="inbox-select"
            checked={selectedAttentionIds?.has(attention.attentionId) ?? false}
            onChange={(event) => onToggleSelect?.(attention.attentionId, event.target.checked)}
          />
        </label>
      ) : null}
      <div className={styles.top}>
        <span className={styles.source}>
          {attention && !attention.readAt ? (
            <span className={styles.unreadDot} data-testid="attention-unread" aria-label="未读" />
          ) : null}
          <span className={styles.sourceTag}>{sourceTag(row.sourceKind)}</span>
          <span className={styles.ref} title={row.ticketId}>
            {shortRef(row.ticketId)}
          </span>
          {row.sourceName ? (
            <span className={styles.sourceName} title={row.sourceName}>
              · {row.sourceName}
            </span>
          ) : null}
        </span>
        <span className={styles.spacer} />
        <span className={styles.time}>{timeAgo(row.createdAt)}</span>
      </div>

      <div className={styles.title}>{row.title}</div>

      <div className={styles.meta}>
        <span className={styles.avatar}>{(actor[0] ?? "?").toUpperCase()}</span>
        <span className={styles.actor}>{actor}</span>
        <span className={styles.executor}>{row.executor === "builtin" ? "内置" : (row.executor ?? "内置")}</span>
        <span className={`${styles.tag} ${tone}`}>{label}</span>
      </div>

      {attention ? (
        <div
          className={styles.question}
          onClick={(event) => event.stopPropagation()}
        >
          <span className={styles.warn} aria-hidden="true">⚠</span>
          <span className={styles.questionText}>
            {approvalQuestion(attention)}
          </span>
          <span className={styles.acts}>
            {attention.kind === "approval" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="card-deny"
                  disabled={!canWrite || busy}
                  onClick={() => onAnswer(attention.attentionId, "deny")}
                >
                  拒绝
                </Button>
                <Button
                  size="sm"
                  data-testid="card-approve"
                  disabled={!canWrite || busy}
                  onClick={() => onAnswer(attention.attentionId, "approve")}
                >
                  允许
                </Button>
              </>
            ) : attention.kind === "question" ? (
              <>
                <input
                  className={styles.answerInput}
                  aria-label="回答提问"
                  placeholder="输入回答…"
                  value={answerDraft}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setAnswerDraft(event.target.value)}
                />
                <Button
                  size="sm"
                  data-testid="attention-answer-submit"
                  disabled={!answerDraft.trim() || questionBusy}
                  onClick={() => onAnswerQuestion?.(attention.attentionId, answerDraft.trim())}
                >
                  提交
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onOpen(row.ticketId)}>
                查看详情
              </Button>
            )}
          </span>
        </div>
      ) : null}

      {!attention && row.bucket === "attention" ? (
        <div className={styles.question} onClick={(event) => event.stopPropagation()}>
          <span className={styles.warn} aria-hidden="true">⚠</span>
          <span className={styles.questionText}>等待你处理决定</span>
          <span className={styles.acts}>
            <Button size="sm" variant="outline" onClick={() => onOpen(row.ticketId)}>
              处理
            </Button>
          </span>
        </div>
      ) : null}

      {!attention && row.bucket === "running" ? (
        <>
          <div className={styles.progress}>
            <i style={{ width: `${row.progress ?? 0}%` }} />
          </div>
          <div className={styles.foot}>
            <span>{formatSummary(row.summary) || "执行中"}</span>
            <span className={styles.spacer} />
            <span>{fmtCost(row.costMicros)}</span>
          </div>
        </>
      ) : null}

      {!attention && row.bucket !== "running" ? (
        <div className={styles.foot}>
          <span>
            {formatSummary(row.summary, row.bucket === "done")
              || (row.bucket === "done" ? "已结束" : row.bucket === "queued" ? "等待执行" : "等待你的决定")}
          </span>
          <span className={styles.spacer} />
          {row.costMicros ? <span>{fmtCost(row.costMicros)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Middle column of the tasks page (prototype `.task-list`): cards only —
 * tabs/search/filters live in the page shell, detail is the right pane.
 */
export function TicketList({
  rows, loading, error, selectedId, onOpen, onCreate, creating, onRetry,
  selectable = false, selectedAttentionIds, onToggleSelect,
  onAnswerQuestion, questionBusy,
}: Props) {
  const canTicket = useCan("ticket:write");
  const canAttention = useCan("attention:write");
  const canWrite = canTicket && canAttention;
  const attentionsQuery = useAttentions();
  const answer = useAnswerAttention();
  const pending = pendingInbox(attentionsQuery.data?.items);
  const attentionOf = (row: TicketRow) =>
    pending.find((item) => item.ticketId === row.ticketId);

  if (loading && rows.length === 0) return <Loading label="载入任务…" />;
  if (error) return <ErrorState message="任务列表加载失败" onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <Empty
        title="没有匹配的任务"
        hint="试试清除筛选，或新建一个任务。"
        action={{ label: creating ? "创建中…" : "新建任务", onClick: onCreate }}
      />
    );
  }

  return (
    <div className={styles.list}>
      {rows.map((row) => (
        <TicketCard
          key={row.ticketId}
          row={row}
          attention={attentionOf(row)}
          selected={row.ticketId === selectedId}
          canWrite={canWrite}
          busy={answer.isPending}
          onAnswer={(attentionId, decision) =>
            answer.mutate({ attentionId, decision })}
          onOpen={onOpen}
          selectable={selectable}
          selectedAttentionIds={selectedAttentionIds}
          onToggleSelect={onToggleSelect}
          onAnswerQuestion={onAnswerQuestion}
          questionBusy={questionBusy}
        />
      ))}
    </div>
  );
}
