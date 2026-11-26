/**
 * Tasks page (docs/52 §8): 页头 + 桶 Tab + 工具条（来源/执行器胶囊）+
 * 列表/详情双栏. The old 216px filter rail and the filter modal are gone.
 */

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Button, Dialog, Tabs } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
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
import { TicketDetailPanel } from "@/features/tasks/components/TicketDetailPanel";
import { TicketList } from "@/features/tasks/components/TicketList";
import { TaskToolbar, type TaskSort } from "@/features/tasks/components/TaskToolbar";
import styles from "./TasksPage.module.css";

const BUCKETS: Array<[BucketFilter, string]> = [
  ["all", "全部"],
  ["attention", "待我决定"],
  ["running", "进行中"],
  ["queued", "已排队"],
  ["done", "已完成"],
];

function sortRows<T extends { createdAt: number; costMicros?: number; ticketId: string }>(
  rows: T[],
  sort: TaskSort,
): T[] {
  return [...rows].sort((left, right) => {
    if (sort === "cost") {
      return (right.costMicros ?? 0) - (left.costMicros ?? 0);
    }
    if (sort === "oldest") return left.createdAt - right.createdAt;
    return right.createdAt - left.createdAt;
  });
}

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const bucketParam = params.get("bucket");
  const filter: BucketFilter = (["attention", "running", "queued", "done"] as const).includes(
    bucketParam as never,
  )
    ? (bucketParam as BucketFilter)
    : "all";
  const { ticketId: pathTicketId } = useParams();
  const ticketId = params.get("ticketId") ?? pathTicketId ?? null;
  const sourceParam = params.get("source") ?? "";
  const executorParam = params.get("executor") ?? "";
  const scheduleOnly = params.get("kind") === "schedule";
  const query = params.get("q") ?? "";
  const sortParam = params.get("sort");
  const sort: TaskSort = sortParam === "oldest" || sortParam === "cost" ? sortParam : "newest";

  const ticketsQuery = useTickets();
  const countsQuery = useTicketCounts();
  const sourcesQuery = useSources();
  const createTicket = useCreateTicket();
  const canWrite = useCan("ticket:write");

  const [creating, setCreating] = useState(false);
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

  const baseFiltered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (sourceParam === "__manual") {
        if (row.sourceId) return false;
      } else if (sourceParam && row.sourceId !== sourceParam) return false;
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

  const rows = sortRows(inBucket(baseFiltered, filter), sort);
  const localCounts = bucketCounts(baseFiltered);
  const counts = sourceParam || executorParam || scheduleOnly || query
    ? localCounts
    : (countsQuery.data ?? localCounts);

  const selectedId = ticketId && rows.some((row) => row.ticketId === ticketId)
    ? ticketId
    : rows[0]?.ticketId ?? null;


  const hasFilters = Boolean(sourceParam || executorParam || scheduleOnly || query);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  function clearFilters() {
    const next = new URLSearchParams(params);
    for (const key of ["source", "executor", "kind", "q", "ticketId"]) next.delete(key);
    setParams(next, { replace: true });
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

  return (
    <PageShell
      title="任务"
      subtitle="Agent 正在处理的工作；来源、执行器与状态都在同一屏里。"
      actions={
        <Button
          size="sm"
          data-testid="new-ticket"
          disabled={!canWrite}
          onClick={() => setCreating(true)}
        >
          ＋ 新建任务
        </Button>
      }
      tabs={
        <Tabs
          ariaLabel="任务桶"
          value={filter}
          onChange={(next) => setParam("bucket", next === "all" ? null : next)}
          items={BUCKETS.map(([key, label]) => ({
            key,
            label,
            badge: key === "all" ? baseFiltered.length : counts[key as Bucket],
            testId: key === "all" ? undefined : `bucket-${key}`,
          }))}
        />
      }
    >
      <div className={styles.page}>
        <TaskToolbar
          rows={allRows}
          filteredCount={baseFiltered.length}
          sources={sources}
          sourceId={sourceParam}
          executor={executorParam}
          scheduleOnly={scheduleOnly}
          query={query}
          sort={sort}
          hasFilters={hasFilters}
          onParam={setParam}
          onClear={clearFilters}
        />

        <div className={`${styles.split} ${ticketId ? styles.mobileDetail : ""}`}>
          <div className={styles.listPane}>
            <TicketList
              rows={rows}
              loading={ticketsQuery.isLoading}
              error={ticketsQuery.isError}
              selectedId={selectedId}
              onOpen={(id) => setParam("ticketId", id)}
              onCreate={() => setCreating(true)}
              creating={createTicket.isPending}
              onRetry={() => void ticketsQuery.refetch()}
            />
          </div>
          <div className={styles.detailPane}>
            <TicketDetailPanel
              ticketId={selectedId}
              onBack={() => setParam("ticketId", null)}
              onDeleted={() => setParam("ticketId", null)}
            />
          </div>
        </div>
      </div>

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
    </PageShell>
  );
}
