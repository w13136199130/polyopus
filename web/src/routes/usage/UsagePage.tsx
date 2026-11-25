/**
 * Usage analytics (Batch D): 7/30/90-day range with overview, daily, agent
 * and model views. The backend exposes the same totals + three breakdowns in
 * one response, so switching tabs never shows inconsistent numbers.
 */

import { useSearchParams } from "react-router";
import { Button, Empty, ErrorState, Loading, Table, type Column } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
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
import styles from "./UsagePage.module.css";

type View = "overview" | "day" | "agent" | "model";

const VIEWS: Array<[View, string]> = [
  ["overview", "概览"],
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

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const rangeParam = Number(params.get("range"));
  const range: UsageRange = (RANGES as readonly number[]).includes(rangeParam)
    ? (rangeParam as UsageRange)
    : 30;
  const viewParam = params.get("view");
  const view: View = (VIEWS.map(([key]) => key) as string[]).includes(viewParam ?? "")
    ? (viewParam as View)
    : "overview";
  const groupBy = groupOf(view);
  const summary = useUsageSummary({ range, groupBy });

  const data = summary.data;
  const rows: UsageItemRow[] = (data?.items ?? []).map((item) => ({
    ...item,
    costLabel: formatCost(item.costMicros),
  }));
  const totals = data?.totals;
  const totalTokens = (totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0);
  const dailyByKey = new Map((data?.byDay ?? []).map((row) => [row.key, row]));
  const dailySeries = lastDayKeys(range).map((key) => {
    const row = dailyByKey.get(key);
    return { key, tokens: (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0) };
  });
  const maxDayTokens = Math.max(1, ...dailySeries.map((row) => row.tokens));
  const labelStep = range <= 7 ? 1 : range <= 30 ? 5 : 15;

  function setFilter(next: { range?: UsageRange; view?: View }) {
    const query = new URLSearchParams(params);
    const chosenRange = next.range ?? range;
    const chosenView = next.view ?? view;
    if (chosenRange === 30) query.delete("range");
    else query.set("range", String(chosenRange));
    if (chosenView === "overview") query.delete("view");
    else query.set("view", chosenView);
    setParams(query, { replace: true });
  }

  const subtitle = data
    ? `最近 ${range} 天 · ${totals?.turns ?? 0} 轮 · ${formatTokens(totalTokens)} tokens`
    : `最近 ${range} 天 token 与成本`;

  return (
    <PageShell
      title="用量"
      subtitle={subtitle}
      actions={
        <Button
          variant="secondary"
          disabled={summary.isLoading || !data || data.totals.turns === 0}
          onClick={() => void downloadCsv({ range, groupBy })}
        >
          导出 CSV
        </Button>
      }
    >
      <div className={styles.page}>
        <div className={styles.filters}>
          <div className={styles.tabs} role="tablist" aria-label="用量视图">
            {VIEWS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                data-testid={`usage-view-${key}`}
                className={`${styles.tab} ${view === key ? styles.tabOn : ""}`}
                onClick={() => setFilter({ view: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <span className={styles.spacer} />
          <div className={styles.ranges} role="group" aria-label="时间范围">
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={range === option}
                data-testid={`usage-range-${option}`}
                className={`${styles.range} ${range === option ? styles.rangeOn : ""}`}
                onClick={() => setFilter({ range: option })}
              >
                {option} 天
              </button>
            ))}
          </div>
        </div>

        {summary.isLoading ? (
          <Loading label="载入用量…" />
        ) : summary.isError ? (
          <ErrorState message="用量加载失败" onRetry={() => void summary.refetch()} />
        ) : !data || data.totals.turns === 0 ? (
          <Empty title="该范围还没有用量" hint="发几轮对话后，这里会出现 token 与成本统计。" />
        ) : view === "overview" ? (
          <>
            <div className={styles.kpis}>
              {([
                ["Tokens", formatTokens(totalTokens), `${formatTokens(totals?.cachedTokens ?? 0)} 缓存命中`],
                ["轮次", String(totals?.turns ?? 0), `最近 ${range} 天`],
                ["成本", formatCost(totals?.costMicros ?? 0), "0 表示价表未配置"],
                ["专家", String(data.byAgent.length), "有调用的执行者"],
              ] as const).map(([label, value, hint]) => (
                <div key={label} className={styles.kpi} data-testid="usage-kpi">
                  <span>{label}</span>
                  <b>{value}</b>
                  <small>{hint}</small>
                </div>
              ))}
            </div>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>每日 tokens</b>
                <span>按调用日期汇总</span>
              </div>
              <div className={styles.chart} data-testid="usage-chart">
                {dailySeries.map((row, index) => {
                  const showLabel = index % labelStep === 0
                    || index === dailySeries.length - 1;
                  return (
                    <div
                      key={row.key}
                      className={styles.barCol}
                      title={`${row.key} · ${row.tokens} tokens`}
                    >
                      <i
                        style={{
                          height: row.tokens === 0
                            ? 0
                            : `${Math.max(3, (row.tokens / maxDayTokens) * 100)}%`,
                        }}
                      />
                      <span>{showLabel ? row.key.slice(5) : " "}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className={styles.overviewGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <b>专家用量</b>
                  <span>Top {Math.min(5, data.byAgent.length)}</span>
                </div>
                {data.byAgent.slice(0, 5).map((row) => (
                  <div key={row.key} className={styles.rankRow}>
                    <code>{row.key}</code>
                    <span className={styles.spacer} />
                    <span>{formatTokens(row.inputTokens + row.outputTokens)}</span>
                    <b>{formatCost(row.costMicros)}</b>
                  </div>
                ))}
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <b>模型用量</b>
                  <span>Top {Math.min(5, data.byModel.length)}</span>
                </div>
                {data.byModel.slice(0, 5).map((row) => (
                  <div key={row.key} className={styles.rankRow}>
                    <code>{row.key}</code>
                    <span className={styles.spacer} />
                    <span>{formatTokens(row.inputTokens + row.outputTokens)}</span>
                    <b>{formatCost(row.costMicros)}</b>
                  </div>
                ))}
              </section>
            </div>
          </>
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
