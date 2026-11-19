import { Link } from "react-router";
import type { SourceView, TicketRow } from "@/lib/api/wire";
import styles from "./TaskSidebar.module.css";

interface Props {
  rows: TicketRow[];
  todayCount: number;
  attentionCount: number;
  sources: SourceView[];
  query: string;
  onQuery: (query: string) => void;
  sourceId: string;
  onSource: (sourceId: string) => void;
  executor: string;
  onExecutor: (executor: string) => void;
  onAttention: () => void;
}

const SOURCE_TAG: Record<string, string> = {
  github: "GH",
  feishu: "FS",
  lark: "FS",
  email: "EM",
  schedule: "CR",
  webhook: "WB",
  rss: "RS",
};

function sourceTag(kind: string | null | undefined): string {
  if (!kind) return "手动";
  return SOURCE_TAG[kind] ?? kind.slice(0, 2).toUpperCase();
}

function executorLabel(value: string): string {
  return value === "builtin" ? "内置" : value;
}

/**
 * Tasks secondary rail (prototype `.side`): search, source filters with
 * counts, executor filters, and shortcuts. This is page-local, not the app
 * navigation rail — the prototype nests it under the global rail.
 */
export function TaskSidebar({
  rows, todayCount, attentionCount, sources, query, onQuery,
  sourceId, onSource, executor, onExecutor, onAttention,
}: Props) {
  const sourceCount = (id: string) =>
    rows.filter((row) => row.sourceId === id).length;
  const executors = Array.from(
    new Set(rows.map((row) => row.executor || "builtin")),
  );
  const executorCount = (value: string) =>
    rows.filter((row) => (row.executor || "builtin") === value).length;

  return (
    <aside className={styles.side} aria-label="任务筛选">
      <div className={styles.head}>
        <div>
          <div className={styles.title}>任务</div>
          <div className={styles.sub}>
            今日 {todayCount} · 待决 {attentionCount}
          </div>
        </div>
      </div>

      <div className={styles.searchWrap}>
        <input
          className={styles.search}
          type="search"
          placeholder="搜索任务、发起人或 PR"
          aria-label="搜索任务"
          data-testid="task-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>

      <div className={styles.body}>
        <div className={styles.groupLabel}>来源</div>
        <button
          type="button"
          className={`${styles.nav} ${sourceId === "" ? styles.active : ""}`}
          onClick={() => onSource("")}
        >
          <span className={styles.badgeNeutral}>全</span>
          <span className={styles.navLabel}>全部来源</span>
          <span className={styles.count}>{rows.length}</span>
        </button>
        {sources.map((source) => (
          <button
            key={source.sourceId}
            type="button"
            className={`${styles.nav} ${sourceId === source.sourceId ? styles.active : ""}`}
            data-testid="task-source"
            data-source-id={source.sourceId}
            onClick={() => onSource(source.sourceId)}
          >
            <span className={styles.badge}>{sourceTag(source.kind)}</span>
            <span className={styles.navLabel}>{source.name}</span>
            <span className={styles.count}>{sourceCount(source.sourceId)}</span>
          </button>
        ))}

        <div className={styles.groupLabel}>执行器</div>
        {executors.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.nav} ${executor === value ? styles.active : ""}`}
            onClick={() => onExecutor(executor === value ? "" : value)}
          >
            <span className={styles.dot} />
            <span className={styles.navLabel}>{executorLabel(value)}</span>
            <span className={styles.count}>{executorCount(value)}</span>
          </button>
        ))}

        <div className={styles.groupLabel}>快捷</div>
        <button type="button" className={styles.nav} onClick={onAttention}>
          <span className={styles.icon} aria-hidden="true">⚑</span>
          <span className={styles.navLabel}>待我决定</span>
          <span className={`${styles.count} ${styles.countRed}`}>{attentionCount}</span>
        </button>
        <Link className={styles.nav} to="/settings">
          <span className={styles.icon} aria-hidden="true">⚙</span>
          <span className={styles.navLabel}>任务设置</span>
        </Link>
      </div>
    </aside>
  );
}
