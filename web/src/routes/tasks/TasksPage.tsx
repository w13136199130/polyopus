/**
 * Tasks page — prototype 3-pane layout: page-local side rail (search/source/
 * executor/quick), middle task list with inline decisions, right inline
 * detail (mandate / timeline / report / artifacts).
 *
 * URL is the view state for filters + selection: `?bucket=`, `?ticketId=`,
 * `?source=`, `?executor=`, `?kind=schedule`.
 */

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, Dialog } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import {
  bucketCounts,
  inBucket,
  useCreateTicket,
  useTicketCounts,
  useTickets,
  type Bucket,
  type BucketFilter,
} from "@/features/tasks/api";
import { useSources } from "@/features/sources/api";
import { TaskSidebar } from "@/features/tasks/components/TaskSidebar";
import { TicketDetailPanel } from "@/features/tasks/components/TicketDetailPanel";
import { TicketList } from "@/features/tasks/components/TicketList";
import styles from "./TasksPage.module.css";

const BUCKETS: Array<[BucketFilter, string]> = [
  ["all", "全部"],
  ["attention", "待我决定"],
  ["running", "进行中"],
  ["queued", "已排队"],
  ["done", "已完成"],
];

function todayStart(): number {
  const now = new Date();
  return Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000,
  );
}

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const bucketParam = params.get("bucket");
  const filter: BucketFilter = (["attention", "running", "queued", "done"] as const).includes(
    bucketParam as never,
  )
    ? (bucketParam as BucketFilter)
    : "all";
  const ticketId = params.get("ticketId");
  const sourceParam = params.get("source") ?? "";
  const executorParam = params.get("executor") ?? "";
  const scheduleOnly = params.get("kind") === "schedule";

  const ticketsQuery = useTickets();
  const countsQuery = useTicketCounts();
  const sourcesQuery = useSources();
  const createTicket = useCreateTicket();
  const canWrite = useCan("ticket:write");

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftSource, setDraftSource] = useState(sourceParam);
  const [draftExecutor, setDraftExecutor] = useState(executorParam);
  const [draftSchedule, setDraftSchedule] = useState(scheduleOnly);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const sources = useMemo(
    () => sourcesQuery.data?.items ?? [],
    [sourcesQuery.data],
  );
  const scheduleIds = useMemo(
    () =>
      new Set(
        sources
          .filter((source) => source.kind === "schedule")
          .map((source) => source.sourceId),
      ),
    [sources],
  );
  const allRows = useMemo(
    () => ticketsQuery.data?.items ?? [],
    [ticketsQuery.data],
  );

  // source/executor/schedule/search filters, before the bucket tab
  const baseFiltered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (sourceParam && row.sourceId !== sourceParam) return false;
      if (executorParam && (row.executor || "builtin") !== executorParam) return false;
      if (scheduleOnly && (!row.sourceId || !scheduleIds.has(row.sourceId))) return false;
      if (needle) {
        const haystack = [
          row.title,
          row.ticketId,
          row.actor?.name ?? "",
          row.summary ?? "",
          row.sourceName ?? "",
        ].join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [allRows, sourceParam, executorParam, scheduleOnly, scheduleIds, query]);

  const rows = inBucket(baseFiltered, filter);
  const localCounts = bucketCounts(baseFiltered);
  const counts = sourceParam || executorParam || scheduleOnly || query
    ? localCounts
    : (countsQuery.data ?? localCounts);

  const selectedId = ticketId && rows.some((row) => row.ticketId === ticketId)
    ? ticketId
    : rows[0]?.ticketId ?? null;

  const todayCount = allRows.filter((row) => row.createdAt >= todayStart()).length;
  const attentionCount = (countsQuery.data ?? localCounts).attention;

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    // switching filters invalidates the selected ticket in the list
    next.delete("ticketId");
    setParams(next, { replace: true });
  }

  function applyFilters() {
    const next = new URLSearchParams(params);
    if (draftSource) next.set("source", draftSource);
    else next.delete("source");
    if (draftExecutor) next.set("executor", draftExecutor);
    else next.delete("executor");
    if (draftSchedule) next.set("kind", "schedule");
    else next.delete("kind");
    next.delete("ticketId");
    setParams(next, { replace: true });
    setFilterOpen(false);
  }

  function clearFilters() {
    setDraftSource("");
    setDraftExecutor("");
    setDraftSchedule(false);
    const next = new URLSearchParams(params);
    next.delete("source");
    next.delete("executor");
    next.delete("kind");
    next.delete("ticketId");
    setParams(next, { replace: true });
    setFilterOpen(false);
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    try {
      const created = await createTicket.mutateAsync({
        title: title.trim(),
        content: brief.trim() || undefined,
      });
      setCreating(false);
      setTitle("");
      setBrief("");
      setParams({ ticketId: created.ticketId });
      await ticketsQuery.refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
    }
  }

  const executors = Array.from(
    new Set(allRows.map((row) => row.executor || "builtin")),
  );
  const activeFilterCount =
    (sourceParam ? 1 : 0) + (executorParam ? 1 : 0) + (scheduleOnly ? 1 : 0);

  return (
    <div className={styles.root}>
      <TaskSidebar
        rows={allRows}
        todayCount={todayCount}
        attentionCount={attentionCount}
        sources={sources}
        query={query}
        onQuery={setQuery}
        sourceId={sourceParam}
        onSource={(id) => setParam("source", id || null)}
        executor={executorParam}
        onExecutor={(value) => setParam("executor", value || null)}
        onAttention={() => setParam("bucket", "attention")}
      />

      <section className={styles.main}>
        <header className={styles.head}>
          <div className={styles.heading}>
            <h1 className={styles.title}>任务</h1>
            <p className={styles.sub}>
              Agent 正在处理的工作；需要你决定的事会出现在最上面。
            </p>
          </div>
          <div className={styles.actions}>
            <Link to="/automation" className={styles.linkBtn}>
              ◷ 自动化
            </Link>
            <Button
              size="sm"
              variant="secondary"
              data-testid="task-filter"
              onClick={() => {
                setDraftSource(sourceParam);
                setDraftExecutor(executorParam);
                setDraftSchedule(scheduleOnly);
                setFilterOpen(true);
              }}
            >
              ⚲ 筛选{activeFilterCount ? ` · ${activeFilterCount}` : ""}
            </Button>
            <Button
              size="sm"
              data-testid="new-ticket"
              disabled={!canWrite}
              onClick={() => setCreating(true)}
            >
              ＋ 新建任务
            </Button>
          </div>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="任务桶">
          {BUCKETS.map(([bucket, label]) => (
            <button
              key={bucket}
              type="button"
              role="tab"
              aria-selected={filter === bucket}
              className={`${styles.tab} ${filter === bucket ? styles.tabActive : ""}`}
              data-testid={bucket === "all" ? undefined : `bucket-${bucket}`}
              onClick={() => setParam("bucket", bucket === "all" ? null : bucket)}
            >
              {label}
              <span
                className={`${styles.count} ${
                  bucket === "attention" ? styles.countRed : ""
                }`}
              >
                {bucket === "all" ? baseFiltered.length : counts[bucket as Bucket]}
              </span>
            </button>
          ))}
        </div>

        <div className={styles.split}>
          <div className={styles.listPane}>
            <TicketList
              rows={rows}
              loading={ticketsQuery.isLoading}
              error={ticketsQuery.isError}
              selectedId={selectedId}
              onOpen={(id) => {
                const next = new URLSearchParams(params);
                next.set("ticketId", id);
                setParams(next, { replace: true });
              }}
              onCreate={() => setCreating(true)}
              creating={createTicket.isPending}
              onRetry={() => void ticketsQuery.refetch()}
            />
          </div>
          <div className={styles.detailPane}>
            <TicketDetailPanel ticketId={selectedId} />
          </div>
        </div>
      </section>

      <Dialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        title="筛选任务"
        footer={
          <>
            <Button variant="ghost" onClick={clearFilters}>清除筛选</Button>
            <Button data-testid="filter-apply" onClick={applyFilters}>应用</Button>
          </>
        }
      >
        <div className={styles.filterForm}>
          <label className={styles.field}>
            来源
            <select
              data-testid="filter-source"
              value={draftSource}
              onChange={(event) => setDraftSource(event.target.value)}
            >
              <option value="">全部来源</option>
              {sources.map((source) => (
                <option key={source.sourceId} value={source.sourceId}>
                  {source.name}（{source.kind}）
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            执行器
            <select
              data-testid="filter-executor"
              value={draftExecutor}
              onChange={(event) => setDraftExecutor(event.target.value)}
            >
              <option value="">全部执行器</option>
              {executors.map((value) => (
                <option key={value} value={value}>
                  {value === "builtin" ? "内置" : value}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={draftSchedule}
              onChange={(event) => setDraftSchedule(event.target.checked)}
            />
            仅定时任务
          </label>
        </div>
      </Dialog>

      <Dialog
        open={creating}
        onOpenChange={(open) => { if (!open) setCreating(false); }}
        title="新建任务"
        description="手动任务与来源任务同权：都会拿到 mandate 和执行线程。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>取消</Button>
            <Button
              data-testid="new-ticket-submit"
              type="submit"
              form="new-ticket-form"
              loading={createTicket.isPending}
              disabled={!title.trim()}
            >
              创建
            </Button>
          </>
        }
      >
        <form id="new-ticket-form" onSubmit={(event) => void submitCreate(event)}>
          {createError ? (
            <div role="alert" className={styles.formError}>{createError}</div>
          ) : null}
          <label className={styles.field}>
            标题
            <input
              data-testid="new-ticket-title"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：整理本周工作日志"
            />
          </label>
          <label className={styles.field}>
            任务说明（可选，作为首条人工消息）
            <textarea
              data-testid="new-ticket-brief"
              maxLength={4000}
              rows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="要做什么、产出是什么、有什么约束"
            />
          </label>
        </form>
      </Dialog>
    </div>
  );
}
