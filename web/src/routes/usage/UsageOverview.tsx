import { Donut, Kpi, type DonutSegment } from "@/components/ui";
import {
  formatCost,
  formatTokens,
} from "@/features/usage/api";
import type { UsageSummaryItem } from "@/lib/api/wire";
import styles from "./UsageOverview.module.css";

const COLORS = [
  "var(--primary)",
  "var(--green)",
  "var(--amber)",
  "var(--purple)",
  "var(--red)",
  "var(--text-4)",
] as const;

/** Top-N rows as donut segments; the tail folds into 其他. */
function topSegments<T extends { inputTokens: number; outputTokens: number }>(
  rows: T[],
  label: (row: T) => string,
  limit = 5,
): DonutSegment[] {
  const sorted = [...rows].sort(
    (left, right) =>
      right.inputTokens + right.outputTokens - (left.inputTokens + left.outputTokens),
  );
  const top = sorted.slice(0, limit).map((row, index) => ({
    label: label(row),
    value: row.inputTokens + row.outputTokens,
    color: COLORS[index % COLORS.length],
  }));
  const rest = sorted.slice(limit).reduce(
    (sum, row) => sum + row.inputTokens + row.outputTokens,
    0,
  );
  if (rest > 0) top.push({ label: "其他", value: rest, color: COLORS[5] });
  return top;
}

export interface UsageOverviewProps {
  range: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  turns: number;
  costMicros: number;
  byAgent: readonly UsageSummaryItem[];
  byModel: readonly UsageSummaryItem[];
  dailySeries: ReadonlyArray<{ key: string; tokens: number }>;
  maxDayTokens: number;
  labelStep: number;
}

/** 汇总视图：7 段 KPI + 4 张环形图 + 每日趋势 (docs/52 §6). */
export function UsageOverview({
  range,
  inputTokens,
  outputTokens,
  cachedTokens,
  turns,
  costMicros,
  byAgent,
  byModel,
  dailySeries,
  maxDayTokens,
  labelStep,
}: UsageOverviewProps) {
  const totalTokens = inputTokens + outputTokens;
  const cacheRate = inputTokens > 0 ? cachedTokens / inputTokens : 0;

  return (
    <>
      <Kpi
        items={[
          { label: "TOTAL TOKENS", value: formatTokens(totalTokens), hint: `最近 ${range} 天`, testId: "usage-kpi" },
          { label: "输入", value: formatTokens(inputTokens), hint: `占 ${totalTokens ? Math.round((inputTokens / totalTokens) * 100) : 0}%`, testId: "usage-kpi" },
          { label: "输出", value: formatTokens(outputTokens), hint: `占 ${totalTokens ? Math.round((outputTokens / totalTokens) * 100) : 0}%`, testId: "usage-kpi" },
          { label: "缓存输入", value: formatTokens(cachedTokens), hint: "命中缓存的输入", testId: "usage-kpi" },
          { label: "缓存命中率", value: `${Math.round(cacheRate * 100)}%`, hint: "缓存 / 输入", testId: "usage-kpi" },
          { label: "对话轮数", value: String(turns), hint: `最近 ${range} 天`, testId: "usage-kpi" },
          { label: "均值 / 轮", value: formatTokens(turns ? Math.round(totalTokens / turns) : 0), hint: "tokens / turn", testId: "usage-kpi" },
        ]}
      />

      <div className={styles.donuts}>
        <Donut
          title="输入 / 输出"
          testId="usage-donut-io"
          segments={[
            { label: "输入", value: inputTokens, color: COLORS[0] },
            { label: "输出", value: outputTokens, color: COLORS[1] },
          ]}
        />
        <Donut
          title="缓存命中"
          testId="usage-donut-cache"
          segments={[
            { label: "缓存输入", value: cachedTokens, color: COLORS[2] },
            { label: "未缓存", value: Math.max(0, inputTokens - cachedTokens), color: COLORS[5] },
          ]}
        />
        <Donut
          title="专家分布"
          testId="usage-donut-agent"
          segments={topSegments([...byAgent], (row) => row.agentId ?? row.key)}
        />
        <Donut
          title="模型分布"
          testId="usage-donut-model"
          segments={topSegments([...byModel], (row) => row.model ?? row.key)}
        />
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <b>每日消耗趋势</b>
          <span>按调用日期汇总 · tokens</span>
          <span className={styles.spacer} />
          <span>{formatCost(costMicros)}</span>
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
                <span>{showLabel ? row.key.slice(5) : " "}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
