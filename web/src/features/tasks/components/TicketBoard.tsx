import { Empty, ErrorState, Loading } from "@/components/ui";
import { BUCKETS, type Bucket, type BucketFilter } from "../api";
import type { TicketRow } from "@/lib/api/wire";
import styles from "./TicketBoard.module.css";

interface Props {
  rows: TicketRow[] | undefined;
  loading: boolean;
  error: boolean;
  counts: Record<Bucket, number>;
  filter: BucketFilter;
  onFilter: (filter: BucketFilter) => void;
  onOpen: (ticketId: string) => void;
  onSeed: () => void;
  seeding: boolean;
  onRetry: () => void;
}

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export function TicketBoard({
  rows, loading, error, counts, filter, onFilter, onOpen, onSeed, seeding, onRetry,
}: Props) {
  return (
    <div className={styles.board}>
      <div className={styles.tabs} role="tablist" aria-label="任务桶">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={`${styles.tab} ${filter === "all" ? styles.tabActive : ""}`}
          onClick={() => onFilter("all")}
        >
          全部 {rows?.length ?? 0}
        </button>
        {BUCKETS.map((bucket) => (
          <button
            key={bucket}
            type="button"
            role="tab"
            aria-selected={filter === bucket}
            className={`${styles.tab} ${filter === bucket ? styles.tabActive : ""}`}
            onClick={() => onFilter(bucket)}
            data-testid={`bucket-${bucket}`}
          >
            {bucket === "attention"
              ? "待决"
              : bucket === "running"
                ? "进行"
                : bucket === "queued"
                  ? "排队"
                  : "完成"}{" "}
            <span className={styles.count}>{counts[bucket]}</span>
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
            hint="发一条演示 webhook，看看工单如何进入队列。"
            action={{ label: seeding ? "创建中…" : "创建演示任务", onClick: onSeed }}
          />
        ) : (
          <ul className={styles.list}>
            {rows.map((row) => (
              <li key={row.ticketId}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => onOpen(row.ticketId)}
                  data-testid="ticket-row"
                >
                  <span className={styles.title}>{row.title}</span>
                  <span className={`${styles.badge} ${styles[row.bucket] ?? ""}`}>
                    {row.bucket}
                  </span>
                  <span className={styles.meta}>
                    {row.sourceId ? `${row.sourceId.slice(0, 10)}… · ` : ""}
                    {timeAgo(row.createdAt)}前
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
