/**
 * Tasks page (V05-04): inbox strip + four-bucket board + detail drawer.
 * Counts aggregate client-side until V05-22 ships GET /tickets/counts;
 * the timeline section arrives with V05-22 as well.
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

  const ticketsQuery = useTickets();
  const attentionsQuery = useAttentions();
  const [seeding, setSeeding] = useState(false);

  const rows = inBucket(ticketsQuery.data?.items, filter);
  const counts = bucketCounts(ticketsQuery.data?.items);

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
