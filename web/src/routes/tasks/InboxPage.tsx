/**
 * 收件箱 (docs/52 §8): 待我决定的一级入口. Rows are tickets with a pending
 * Attention; type chips split approval / question / blocked / failed.
 */

import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Chip, Empty, ErrorState, FilterBar, Loading } from "@/components/ui";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
import { PageShell } from "@/layouts/PageShell";
import { useTickets } from "@/features/tasks/api";
import { TicketDetailPanel } from "@/features/tasks/components/TicketDetailPanel";
import { TicketList } from "@/features/tasks/components/TicketList";
import styles from "./TasksPage.module.css";

type Kind = "all" | "approval" | "question" | "blocked" | "failed";

const KINDS: Array<[Kind, string]> = [
  ["all", "全部"],
  ["approval", "审批"],
  ["question", "提问"],
  ["blocked", "受阻"],
  ["failed", "失败"],
];

const KIND_LABEL: Record<string, string> = {
  approval: "审批",
  question: "提问",
  blocked: "受阻",
  failed: "失败",
};

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const ticketsQuery = useTickets();
  const attentionsQuery = useAttentions();

  const kindParam = params.get("kind");
  const kind: Kind = (KINDS.map(([key]) => key) as string[]).includes(kindParam ?? "")
    ? (kindParam as Kind)
    : "all";
  const query = params.get("q") ?? "";
  const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
  const ticketId = params.get("ticketId");

  const tickets = useMemo(
    () => ticketsQuery.data?.items ?? [],
    [ticketsQuery.data],
  );
  const pending = useMemo(
    () => pendingInbox(attentionsQuery.data?.items),
    [attentionsQuery.data],
  );
  const attentionOf = useMemo(() => {
    const map = new Map<string, (typeof pending)[number]>();
    for (const item of pending) {
      if (item.ticketId) map.set(item.ticketId, item);
    }
    return map;
  }, [pending]);

  const counts = useMemo(() => {
    const next: Record<Kind, number> = {
      all: 0, approval: 0, question: 0, blocked: 0, failed: 0,
    };
    for (const item of pending) {
      if (!item.ticketId) continue;
      next.all += 1;
      if (item.kind in next) next[item.kind as Kind] += 1;
    }
    return next;
  }, [pending]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tickets
      .filter((row) => {
        const attention = attentionOf.get(row.ticketId);
        if (!attention) return false;
        if (kind !== "all" && attention.kind !== kind) return false;
        if (!needle) return true;
        return [
          row.title,
          row.ticketId,
          row.actor?.name ?? "",
          row.summary ?? "",
          row.sourceName ?? "",
        ].join(" ").toLowerCase().includes(needle);
      })
      .sort((left, right) =>
        sort === "oldest"
          ? left.createdAt - right.createdAt
          : right.createdAt - left.createdAt,
      );
  }, [tickets, attentionOf, kind, query, sort]);

  const selectedId = ticketId && rows.some((row) => row.ticketId === ticketId)
    ? ticketId
    : rows[0]?.ticketId ?? null;


  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const loading = ticketsQuery.isLoading || attentionsQuery.isLoading;
  const error = ticketsQuery.isError || attentionsQuery.isError;

  return (
    <PageShell
      title="收件箱"
      subtitle="已读与决策分离：审批、提问、受阻、失败都在这里处理。"
    >
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <FilterBar
            count={`${counts.all} 条待决定`}
            testId="inbox-filters"
            right={
              <>
                <input
                  className={styles.search}
                  type="search"
                  aria-label="搜索收件箱"
                  placeholder="搜索标题、发起人或来源"
                  value={query}
                  onChange={(event) => setParam("q", event.target.value || null)}
                />
                <select
                  className={styles.sort}
                  aria-label="排序"
                  value={sort}
                  onChange={(event) => setParam("sort", event.target.value === "newest" ? null : event.target.value)}
                >
                  <option value="newest">最新优先</option>
                  <option value="oldest">最早优先</option>
                </select>
              </>
            }
          >
            {KINDS.map(([key, label]) => (
              <Chip
                key={key}
                active={kind === key}
                count={counts[key]}
                testId={`inbox-kind-${key}`}
                onClick={() => setParam("kind", key === "all" ? null : key)}
              >
                {label}
              </Chip>
            ))}
          </FilterBar>
        </div>

        {loading && rows.length === 0 ? (
          <Loading label="载入收件箱…" />
        ) : error ? (
          <ErrorState
            message="收件箱加载失败"
            onRetry={() => {
              void ticketsQuery.refetch();
              void attentionsQuery.refetch();
            }}
          />
        ) : counts.all === 0 ? (
          <Empty
            title="收件箱是空的"
            hint="需要你审批、回答或处理的任务会自动出现在这里。"
          />
        ) : rows.length === 0 ? (
          <Empty
            title="这个分类是空的"
            hint={kind === "all" ? "换个关键词试试。" : `没有「${KIND_LABEL[kind]}」类型的待决项。`}
            action={{ label: "查看全部", onClick: () => setParam("kind", null) }}
          />
        ) : (
          <div className={`${styles.split} ${ticketId ? styles.mobileDetail : ""}`}>
            <div className={styles.listPane}>
              <TicketList
                rows={rows}
                loading={loading}
                error={error}
                selectedId={selectedId}
                onOpen={(id) => {
                  const next = new URLSearchParams(params);
                  next.set("ticketId", id);
                  setParams(next, { replace: true });
                }}
                onCreate={() => setParam("kind", null)}
                creating={false}
                onRetry={() => void ticketsQuery.refetch()}
              />
            </div>
            <div className={styles.detailPane}>
              <TicketDetailPanel
                ticketId={selectedId}
                onBack={() => {
                  const next = new URLSearchParams(params);
                  next.delete("ticketId");
                  setParams(next, { replace: true });
                }}
                onDeleted={() => {
                  const next = new URLSearchParams(params);
                  next.delete("ticketId");
                  setParams(next, { replace: true });
                }}
              />
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
