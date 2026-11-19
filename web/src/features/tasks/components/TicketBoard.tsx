import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import { pendingInbox, useAnswerAttention, useAttentions } from "@/lib/api/hooks";
import type { AttentionItem, TicketRow } from "@/lib/api/wire";
import { BUCKETS, type Bucket, type BucketFilter } from "../api";
import styles from "./TicketBoard.module.css";

interface Props {
  rows: TicketRow[] | undefined;
  loading: boolean;
  error: boolean;
  counts: Record<Bucket, number>;
  filter: BucketFilter;
  onFilter: (filter: BucketFilter) => void;
  onOpen: (ticketId: string) => void;
  onCreate: () => void;
  creating: boolean;
  onRetry: () => void;
}

const BUCKET_LABELS: Record<BucketFilter, string> = {
  all: "全部",
  attention: "待我决定",
  running: "进行中",
  queued: "已排队",
  done: "已完成",
};

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function bucketClass(bucket: string): string {
  if (bucket === "attention") return styles.cardAttention;
  if (bucket === "running") return styles.cardRunning;
  if (bucket === "done") return styles.cardDone;
  return styles.cardQueued;
}

function bucketTagClass(bucket: string): string {
  if (bucket === "attention") return styles.tagAttention;
  if (bucket === "running") return styles.tagRunning;
  if (bucket === "done") return styles.tagDone;
  return styles.tagQueued;
}

function bucketLabel(bucket: string): string {
  return BUCKET_LABELS[bucket as BucketFilter] ?? bucket;
}

/** Prototype .task card: source/ref header, title, actor+state meta, and the
 * pending decision inline (allow/deny answer the approval in place). */
function TaskCard({
  row, attention, canWrite, busy, onAnswer, onOpen,
}: {
  row: TicketRow;
  attention: AttentionItem | undefined;
  canWrite: boolean;
  busy: boolean;
  onAnswer: (attentionId: string, decision: "approve" | "deny") => void;
  onOpen: (ticketId: string) => void;
}) {
  const question = attention
    ? String(
        (attention.payload as { summary?: string; question?: string }).summary
        ?? (attention.payload as { question?: string }).question
        ?? "需要你的决定",
      )
    : "";
  return (
    <li>
      <div
        className={`${styles.card} ${bucketClass(row.bucket)}`}
        data-testid="ticket-row"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row.ticketId)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onOpen(row.ticketId);
        }}
      >
        <div className={styles.cardTop}>
          <span>{row.sourceId ? row.sourceId.slice(0, 14) : "手动"}</span>
          <span className={styles.tagOutline}>{row.ticketId.slice(0, 11)}</span>
          <span className="spacer" />
          <span>{timeAgo(row.createdAt)}前</span>
        </div>
        <div className={styles.cardTitle}>{row.title}</div>
        <div className={styles.cardMeta}>
          <span className={styles.avatarXs}>
            {(row.strength[0] ?? "?").toUpperCase()}
          </span>
          <span>{row.strength}</span>
          <span className={`${styles.tag} ${bucketTagClass(row.bucket)}`}>
            {bucketLabel(row.bucket)}
          </span>
        </div>
        {attention ? (
          <div
            className={styles.question}
            onClick={(event) => event.stopPropagation()}
          >
            <span>⚠ {question}</span>
            <span className={styles.acts}>
              {attention.kind === "approval" ? (
                <>
                  <Button size="sm" variant="ghost" disabled={!canWrite || busy}
                    data-testid="card-deny"
                    onClick={() => onAnswer(attention.attentionId, "deny")}>
                    拒绝
                  </Button>
                  <Button size="sm" disabled={!canWrite || busy}
                    data-testid="card-approve"
                    onClick={() => onAnswer(attention.attentionId, "approve")}>
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
      </div>
    </li>
  );
}

export function TicketBoard({
  rows, loading, error, counts, filter, onFilter, onOpen, onCreate, creating, onRetry,
}: Props) {
  const canTicket = useCan("ticket:write");
  const canAttention = useCan("attention:write");
  const canWrite = canTicket && canAttention;
  const attentionsQuery = useAttentions();
  const answer = useAnswerAttention();
  const pending = pendingInbox(attentionsQuery.data?.items);

  const attentionOf = (row: TicketRow) =>
    pending.find((item) => item.ticketId === row.ticketId);

  return (
    <div className={styles.board}>
      <div className={styles.tabs} role="tablist" aria-label="任务桶">
        {(["all", ...BUCKETS] as const).map((bucket) => (
          <button
            key={bucket}
            type="button"
            role="tab"
            aria-selected={filter === bucket}
            className={`${styles.tab} ${filter === bucket ? styles.tabActive : ""}`}
            onClick={() => onFilter(bucket)}
            data-testid={bucket === "all" ? undefined : `bucket-${bucket}`}
          >
            {BUCKET_LABELS[bucket]}
            <span className={`${styles.count} ${
              bucket === "attention" ? styles.countRed : ""
            }`}>
              {bucket === "all"
                ? (rows?.length ?? 0)
                : counts[bucket as Bucket]}
            </span>
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {loading && !rows ? (
          <Loading label="载入任务…" />
        ) : error ? (
          <ErrorState message="任务列表加载失败" onRetry={onRetry} />
        ) : !rows || rows.length === 0 ? (
          <Empty
            title="还没有任务"
            hint="新建一个任务，或从来源 webhook 自动进入。"
            action={{ label: creating ? "创建中…" : "新建任务", onClick: onCreate }}
          />
        ) : (
          <ul className={styles.list}>
            {rows.map((row) => (
              <TaskCard
                key={row.ticketId}
                row={row}
                attention={attentionOf(row)}
                canWrite={canWrite}
                busy={answer.isPending}
                onAnswer={(attentionId, decision) =>
                  answer.mutate({ attentionId, decision })}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
