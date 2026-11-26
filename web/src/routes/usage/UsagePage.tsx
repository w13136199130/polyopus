/**
 * Token 统计 (docs/52 §6): 7 段 KPI + 4 张环形图 + 每日趋势 + 三维明细.
 * Filters (user/agent/range) are URL state and apply to KPIs, charts, tables
 * and the CSV export alike.
 */

import { useSearchParams } from "react-router";
import {
  Button,
  Chip,
  Empty,
  ErrorState,
  FilterBar,
  Loading,
  Table,
  Tabs,
  type Column,
} from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import { useAgents } from "@/features/agents/api";
import { useAdminUsers } from "@/features/admin/api";
import {
  downloadCsv,
  formatCost,
  formatTokens,
  useUsageSummary,
  RANGES,
  type UsageGroup,
  type UsageItemRow,
  type UsageRange,
} from "@/features/usage/api";
import { UsageOverview } from "./UsageOverview";
import styles from "./UsagePage.module.css";

type View = "overview" | "day" | "agent" | "model";

const VIEWS: Array<[View, string]> = [
  ["overview", "汇总"],
  ["day", "按天"],
  ["agent", "按专家"],
  ["model", "按模型"],
];

function lastDayKeys(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    out.push(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-`
      + `${String(day.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function groupOf(view: View): UsageGroup {
  if (view === "day") return "day";
  if (view === "agent") return "agent";
  return "model";
}

function labelOf(row: UsageItemRow, view: View): string {
  if (view === "day") return row.day ?? row.key;
  if (view === "agent") return row.agentId ?? row.key;
  return row.model ?? row.key;
}

function columnsFor(view: View): Array<Column<UsageItemRow>> {
  return [
    {
      key: "group",
      header: view === "day" ? "日期" : view === "agent" ? "专家" : "模型",
      render: (row) => <code>{labelOf(row, view)}</code>,
    },
    { key: "turns", header: "轮次", render: (row) => row.turns, width: "70px" },
    {
      key: "input",
      header: "输入",
      render: (row) => formatTokens(row.inputTokens),
      width: "90px",
    },
    {
      key: "output",
      header: "输出",
      render: (row) => formatTokens(row.outputTokens),
      width: "90px",
    },
    {
      key: "cached",
      header: "缓存",
      render: (row) => formatTokens(row.cachedTokens),
      width: "90px",
    },
    { key: "cost", header: "成本", render: (row) => row.costLabel, width: "96px" },
  ];
}

function UserFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const users = useAdminUsers();
  return (
    <select
      className={styles.select}
      aria-label="用户"
      data-testid="usage-user"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">全部用户</option>
      {(users.data?.items ?? []).map((user) => (
        <option key={user.userId} value={user.userId}>
          {user.displayName || user.username}
        </option>
      ))}
    </select>
  );
}

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const canUsers = useCan("user:read");
  const agentsQuery = useAgents();

  const rangeParam = Number(params.get("range"));
  const range: UsageRange = (RANGES as readonly number[]).includes(rangeParam)
    ? (rangeParam as UsageRange)
    : 30;
  const viewParam = params.get("view");
  const view: View = (VIEWS.map(([key]) => key) as string[]).includes(viewParam ?? "")
    ? (viewParam as View)
    : "overview";
  const asUser = params.get("user") ?? "";
  const agentId = params.get("agent") ?? "";
  const groupBy = groupOf(view);
  const summary = useUsageSummary({ range, groupBy, asUser: asUser || undefined, agentId: agentId || undefined });

  const data = summary.data;
  const rows: UsageItemRow[] = (data?.items ?? []).map((item) => ({
    ...item,
    costLabel: formatCost(item.costMicros),
  }));
  const totals = data?.totals;
  const inputTokens = totals?.inputTokens ?? 0;
  const outputTokens = totals?.outputTokens ?? 0;
  const cachedTokens = totals?.cachedTokens ?? 0;
  const turns = totals?.turns ?? 0;

  const dailyByKey = new Map((data?.byDay ?? []).map((row) => [row.key, row]));
  const dailySeries = lastDayKeys(range).map((key) => {
    const row = dailyByKey.get(key);
    return { key, tokens: (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0) };
  });
  const maxDayTokens = Math.max(1, ...dailySeries.map((row) => row.tokens));
  const labelStep = range <= 7 ? 1 : range <= 30 ? 5 : 15;

  const agents = agentsQuery.data?.items ?? [];

  function setFilter(next: {
    range?: UsageRange;
    view?: View;
    asUser?: string;
    agentId?: string;
  }) {
    const query = new URLSearchParams(params);
    const chosenRange = next.range ?? range;
    const chosenView = next.view ?? view;
    const chosenUser = next.asUser ?? asUser;
    const chosenAgent = next.agentId ?? agentId;
    if (chosenRange === 30) query.delete("range");
    else query.set("range", String(chosenRange));
    if (chosenView === "overview") query.delete("view");
    else query.set("view", chosenView);
    if (chosenUser) query.set("user", chosenUser);
    else query.delete("user");
    if (chosenAgent) query.set("agent", chosenAgent);
    else query.delete("agent");
    setParams(query, { replace: true });
  }

  const updatedAt = summary.dataUpdatedAt
    ? new Date(summary.dataUpdatedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <PageShell
      title="Token 统计"
      subtitle="页面展示的 Token 用量仅供参考；部分消耗尚未纳入统计。"
      actions={
        <Button
          variant="secondary"
          disabled={summary.isLoading || !data || turns === 0}
          onClick={() => void downloadCsv({
            range,
            groupBy,
            asUser: asUser || undefined,
            agentId: agentId || undefined,
          })}
        >
          导出 CSV
        </Button>
      }
      tabs={
        <Tabs
          ariaLabel="用量视图"
          value={view}
          onChange={(next) => setFilter({ view: next })}
          items={VIEWS.map(([key, label]) => ({
            key,
            label,
            testId: `usage-view-${key}`,
          }))}
        />
      }
    >
      <div className={styles.page}>
        <FilterBar
          testId="usage-filters"
          right={<span className={styles.updated}>更新于 {updatedAt}</span>}
        >
          {canUsers ? (
            <UserFilter value={asUser} onChange={(value) => setFilter({ asUser: value })} />
          ) : (
            <select className={styles.select} aria-label="用户" disabled title="用户维度筛选需要管理员权限">
              <option>全部用户</option>
            </select>
          )}
          <select
            className={styles.select}
            aria-label="专家"
            data-testid="usage-agent"
            value={agentId}
            onChange={(event) => setFilter({ agentId: event.target.value })}
          >
            <option value="">全部专家</option>
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>
            ))}
          </select>
          <span className={styles.rangeLabel}>时间范围</span>
          {RANGES.map((option) => (
            <Chip
              key={option}
              active={range === option}
              testId={`usage-range-${option}`}
              onClick={() => setFilter({ range: option })}
            >
              {option} 天
            </Chip>
          ))}
        </FilterBar>

        {summary.isLoading ? (
          <Loading label="载入用量…" />
        ) : summary.isError ? (
          <ErrorState message="用量加载失败" onRetry={() => void summary.refetch()} />
        ) : !data || turns === 0 ? (
          <Empty title="该范围还没有用量" hint="发几轮对话后，这里会出现 token 与成本统计。" />
        ) : view === "overview" ? (
          <UsageOverview
            range={range}
            inputTokens={inputTokens}
            outputTokens={outputTokens}
            cachedTokens={cachedTokens}
            turns={turns}
            costMicros={totals?.costMicros ?? 0}
            byAgent={data.byAgent}
            byModel={data.byModel}
            dailySeries={dailySeries}
            maxDayTokens={maxDayTokens}
            labelStep={labelStep}
          />
        ) : (
          <Table
            caption={`最近 ${range} 天 · ${
              view === "day" ? "按天" : view === "agent" ? "按专家" : "按模型"
            }`}
            columns={columnsFor(view)}
            rows={rows}
            rowKey={(row) => row.key}
          />
        )}
      </div>
    </PageShell>
  );
}
