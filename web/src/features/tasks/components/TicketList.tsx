import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import { pendingInbox, useAnswerAttention, useAttentions } from "@/lib/api/hooks";
import type { AttentionItem, TicketRow } from "@/lib/api/wire";
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

export function fmtCost(micros?: number): string {
  return `¥${((micros ?? 0) / 1_000_000).toFixed(2)}`;
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

function questionOf(attention: AttentionItem): string {
  const payload = attention.payload as { summary?: string; question?: string };
  return payload.summary ?? payload.question ?? "需要你的决定";
}

function TicketCard({
  row, attention, selected, canWrite, busy, onAnswer, onOpen,
}: {
  row: TicketRow;
  attention: AttentionItem | undefined;
  selected: boolean;
  canWrite: boolean;
  busy: boolean;
  onAnswer: (attentionId: string, decision: "approve" | "deny") => void;
  onOpen: (ticketId: string) => void;
}) {
  const [label, tone] = stateTag(row.bucket);
  const actor = row.actor?.name ?? "系统";
  return (
    <div
      className={[
        styles.card,
        styles[`card_${row.bucket}`] ?? "",
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
      <div className={styles.top}>
        <span className={styles.source}>
          <span className={styles.sourceTag}>{sourceTag(row.sourceKind)}</span>
          <span className={styles.ref} title={row.ticketId}>
            {shortRef(row.ticketId)} · {row.sourceName ?? "手动"}
          </span>
        </span>
        <span className={styles.spacer} />
        <span className={styles.time}>{timeAgo(row.createdAt)}</span>
      </div>

      <div className={styles.title}>{row.title}</div>

      <div className={styles.meta}>
        <span className={styles.avatar}>{(actor[0] ?? "?").toUpperCase()}</span>
        <span>{actor}</span>
        <span className={styles.executor}>{row.executor === "builtin" ? "内置" : (row.executor ?? "内置")}</span>
        <span className={`${styles.tag} ${tone}`}>{label}</span>
      </div>

      {attention ? (
        <div
          className={styles.question}
          onClick={(event) => event.stopPropagation()}
        >
          <span className={styles.warn} aria-hidden="true">⚠</span>
          <span className={styles.questionText}>{questionOf(attention)}</span>
          <span className={styles.acts}>
            {attention.kind === "approval" ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
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
            ) : (
              <Button size="sm" onClick={() => onOpen(row.ticketId)}>
                查看详情
              </Button>
            )}
          </span>
        </div>
      ) : null}

      {!attention && row.bucket === "running" ? (
        <>
          <div className={styles.progress}>
            <i style={{ width: `${row.progress ?? 0}%` }} />
          </div>
          <div className={styles.foot}>
            <span>{row.summary || "执行中"}</span>
            <span className={styles.spacer} />
            <span>{fmtCost(row.costMicros)}</span>
          </div>
        </>
      ) : null}

      {!attention && row.bucket !== "running" ? (
        <div className={styles.foot}>
          <span>{row.summary || (row.bucket === "done" ? "已结束" : "等待执行")}</span>
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
        />
      ))}
    </div>
  );
}
