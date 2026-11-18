/**
 * Tasks page: inbox strip + four-bucket board + detail drawer.
 * P0-3 adds manual ticket creation (POST /tickets) so a fresh install has a
 * real entry point instead of a demo-webhook seed.
 */

import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Dialog } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
import {
  bucketCounts,
  inBucket,
  useCreateTicket,
  useTicketCounts,
  useTickets,
  type BucketFilter,
} from "@/features/tasks/api";
import { useSources } from "@/features/sources/api";
import { InboxStrip } from "@/features/tasks/components/InboxStrip";
import { TicketBoard } from "@/features/tasks/components/TicketBoard";
import { TicketDetailDrawer } from "@/features/tasks/components/TicketDetailDrawer";

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
  const scheduleOnly = params.get("kind") === "schedule";

  const ticketsQuery = useTickets();
  const countsQuery = useTicketCounts();
  const attentionsQuery = useAttentions();
  const sourcesQuery = useSources();
  const createTicket = useCreateTicket();
  const canWrite = useCan("ticket:write");

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const sources = sourcesQuery.data?.items ?? [];
  const scheduleIds = new Set(
    sources.filter((source) => source.kind === "schedule").map((source) => source.sourceId),
  );
  const filtered = (ticketsQuery.data?.items ?? []).filter((row) => {
    if (sourceParam && row.sourceId !== sourceParam) return false;
    if (scheduleOnly && (!row.sourceId || !scheduleIds.has(row.sourceId))) return false;
    return true;
  });
  const rows = inBucket(filtered, filter);
  // Server counts are global; with a source/schedule filter we aggregate the
  // filtered set locally so the tabs stay truthful.
  const localCounts = bucketCounts(filtered);
  const counts = sourceParam || scheduleOnly
    ? localCounts
    : (countsQuery.data ?? localCounts);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
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
      setParam("ticketId", created.ticketId);
      await ticketsQuery.refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
    }
  }

  return (
    <PageShell
      title="任务"
      subtitle="Agent 替你干活的主界面：收件箱待决、四桶看进度。"
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
    >
      <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <InboxStrip
          items={pendingInbox(attentionsQuery.data?.items)}
          loading={attentionsQuery.isLoading}
          error={attentionsQuery.isError}
          onRetry={() => void attentionsQuery.refetch()}
        />
        <div
          style={{
            display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
            padding: "8px 0",
          }}
        >
          <label htmlFor="source-filter" style={{ fontSize: 12, color: "var(--text-2)" }}>
            来源
          </label>
          <select
            id="source-filter"
            data-testid="source-filter"
            value={sourceParam}
            onChange={(event) => setParam("source", event.target.value || null)}
            style={{ padding: "5px 8px", fontSize: 12 }}
          >
            <option value="">全部来源</option>
            {sources.map((source) => (
              <option key={source.sourceId} value={source.sourceId}>
                {source.name}（{source.kind}）
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="kind-schedule"
            aria-pressed={scheduleOnly}
            onClick={() => setParam("kind", scheduleOnly ? null : "schedule")}
            style={{
              padding: "5px 10px",
              fontSize: 12,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: scheduleOnly ? "var(--primary)" : "var(--surface)",
              color: scheduleOnly ? "#fff" : "var(--text)",
              cursor: "pointer",
            }}
          >
            仅定时任务
          </button>
        </div>
        <TicketBoard
          rows={rows}
          loading={ticketsQuery.isLoading}
          error={ticketsQuery.isError}
          counts={counts}
          filter={filter}
          onFilter={(next) => setParam("bucket", next === "all" ? null : next)}
          onOpen={(id) => setParam("ticketId", id)}
          onCreate={() => setCreating(true)}
          creating={createTicket.isPending}
          onRetry={() => void ticketsQuery.refetch()}
        />
      </div>
      <TicketDetailDrawer
        ticketId={ticketId}
        onClose={() => setParam("ticketId", null)}
      />

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
            <div role="alert" style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>
              {createError}
            </div>
          ) : null}
          <label style={{ display: "block", fontSize: 12, color: "var(--text-2)", marginBottom: 4 }}>
            标题
            <input
              data-testid="new-ticket-title"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              style={{ width: "100%", marginTop: 4 }}
              placeholder="例如：整理本周工作日志"
            />
          </label>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-2)", marginTop: 12 }}>
            任务说明（可选，作为首条人工消息）
            <textarea
              data-testid="new-ticket-brief"
              maxLength={4000}
              rows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              style={{ width: "100%", marginTop: 4, resize: "vertical" }}
              placeholder="要做什么、产出是什么、有什么约束"
            />
          </label>
        </form>
      </Dialog>
    </PageShell>
  );
}
