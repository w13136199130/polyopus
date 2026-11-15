/**
 * Tasks page (V05-04): inbox strip + four-bucket board + detail drawer.
 * V05-20 adds source/schedule filters; counts still aggregate client-side
 * until V05-22 ships GET /tickets/counts.
 */

import { useState } from "react";
import { useSearchParams } from "react-router";
import { PageShell } from "@/layouts/PageShell";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
import {
  bucketCounts,
  inBucket,
  seedDemoTicket,
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
  const attentionsQuery = useAttentions();
  const sourcesQuery = useSources();
  const [seeding, setSeeding] = useState(false);

  const sources = sourcesQuery.data?.items ?? [];
  const scheduleIds = new Set(
    sources.filter((source) => source.kind === "schedule").map((source) => source.sourceId),
  );
  const rows = inBucket(ticketsQuery.data?.items, filter).filter((row) => {
    if (sourceParam && row.sourceId !== sourceParam) return false;
    if (scheduleOnly && (!row.sourceId || !scheduleIds.has(row.sourceId))) return false;
    return true;
  });
  const counts = bucketCounts(rows);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  async function handleSeed() {
    setSeeding(true);
    try {
      const id = await seedDemoTicket();
      if (id) setParam("ticketId", id);
      await ticketsQuery.refetch();
    } finally {
      setSeeding(false);
    }
  }

  return (
    <PageShell
      title="任务"
      subtitle="Agent 替你干活的主界面：收件箱待决、四桶看进度。"
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
              background: scheduleOnly ? "var(--accent)" : "var(--surface)",
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
          onSeed={() => void handleSeed()}
          seeding={seeding}
          onRetry={() => void ticketsQuery.refetch()}
        />
      </div>
      <TicketDetailDrawer
        ticketId={ticketId}
        onClose={() => setParam("ticketId", null)}
      />
    </PageShell>
  );
}
