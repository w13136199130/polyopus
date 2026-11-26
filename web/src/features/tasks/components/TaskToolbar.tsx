import { Button, Chip, FilterBar } from "@/components/ui";
import type { SourceView, TicketRow } from "@/lib/api/wire";
import styles from "./TaskToolbar.module.css";

export type TaskSort = "newest" | "oldest" | "cost";

const SORT_LABEL: Record<TaskSort, string> = {
  newest: "最新优先",
  oldest: "最早优先",
  cost: "成本从高到低",
};

export interface TaskToolbarProps {
  rows: readonly TicketRow[];
  filteredCount: number;
  sources: readonly SourceView[];
  sourceId: string;
  executor: string;
  scheduleOnly: boolean;
  query: string;
  sort: TaskSort;
  hasFilters: boolean;
  onParam: (key: string, value: string | null) => void;
  onClear: () => void;
}

/** 任务工具条：来源/执行器两排胶囊 + 搜索/排序 (docs/52 §8). */
export function TaskToolbar({
  rows,
  filteredCount,
  sources,
  sourceId,
  executor,
  scheduleOnly,
  query,
  sort,
  hasFilters,
  onParam,
  onClear,
}: TaskToolbarProps) {
  const executors = Array.from(
    new Set(rows.map((row) => row.executor || "builtin")),
  );
  const manualCount = rows.filter((row) => !row.sourceId).length;
  const sourceCount = (id: string) => rows.filter((row) => row.sourceId === id).length;
  const executorCount = (value: string) =>
    rows.filter((row) => (row.executor || "builtin") === value).length;

  return (
    <div className={styles.toolbar}>
      <FilterBar
        count={`共 ${filteredCount} 条`}
        testId="task-filters"
        right={
          <>
            <input
              className={styles.search}
              type="search"
              aria-label="搜索任务"
              data-testid="task-search"
              placeholder="搜索任务、发起人或来源"
              value={query}
              onChange={(event) => onParam("q", event.target.value || null)}
            />
            <select
              className={styles.sort}
              aria-label="排序"
              data-testid="task-sort"
              value={sort}
              onChange={(event) =>
                onParam("sort", event.target.value === "newest" ? null : event.target.value)}
            >
              {(Object.keys(SORT_LABEL) as TaskSort[]).map((key) => (
                <option key={key} value={key}>{SORT_LABEL[key]}</option>
              ))}
            </select>
            {hasFilters ? (
              <Button size="sm" variant="ghost" onClick={onClear}>清除筛选</Button>
            ) : null}
          </>
        }
      >
        <span className={styles.filterLabel}>来源</span>
        <Chip active={!sourceId} onClick={() => onParam("source", null)} count={rows.length}>
          全部
        </Chip>
        {manualCount > 0 ? (
          <Chip active={sourceId === "__manual"} onClick={() => onParam("source", "__manual")} count={manualCount}>
            手动
          </Chip>
        ) : null}
        {sources.map((source) => (
          <Chip
            key={source.sourceId}
            active={sourceId === source.sourceId}
            onClick={() => onParam("source", source.sourceId)}
            count={sourceCount(source.sourceId)}
            testId="task-source"
          >
            {source.name}
          </Chip>
        ))}
      </FilterBar>

      <FilterBar
        right={
          <label className={styles.scheduleOnly}>
            <input
              type="checkbox"
              checked={scheduleOnly}
              onChange={(event) =>
                onParam("kind", event.target.checked ? "schedule" : null)}
            />
            仅定时任务
          </label>
        }
      >
        <span className={styles.filterLabel}>执行器</span>
        <Chip active={!executor} onClick={() => onParam("executor", null)} count={rows.length}>
          全部
        </Chip>
        {executors.map((value) => (
          <Chip
            key={value}
            active={executor === value}
            onClick={() => onParam("executor", value)}
            count={executorCount(value)}
          >
            {value === "builtin" ? "内置" : value}
          </Chip>
        ))}
      </FilterBar>
    </div>
  );
}
