/**
 * Usage page (V05-05): window-scoped model usage + CSV export.
 * Per-ticket cost stays "—" until V05-18 wires model_prices (docs/48 F2).
 */

import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { Table, type Column } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useSearchParams } from "react-router";
import {
  downloadCsv,
  formatCost,
  formatTokens,
  totalTokens,
  useUsageSummary,
  WINDOWS,
  type UsageItemRow,
  type UsageWindow,
} from "@/features/usage/api";
const WINDOW_LABEL: Record<UsageWindow, string> = {
  day: "今天",
  week: "本周",
  month: "本月",
};

const COLUMNS: Array<Column<UsageItemRow>> = [
  { key: "model", header: "模型", render: (row) => <code>{row.model}</code> },
  { key: "turns", header: "轮次", render: (row) => row.turns, width: "70px" },
  {
    key: "input",
    header: "输入 tokens",
    render: (row) => formatTokens(row.inputTokens),
    width: "110px",
  },
  {
    key: "output",
    header: "输出 tokens",
    render: (row) => formatTokens(row.outputTokens),
    width: "110px",
  },
  {
    key: "cached",
    header: "缓存命中",
    render: (row) => formatTokens(row.cachedTokens),
    width: "100px",
  },
  { key: "cost", header: "成本", render: (row) => row.costLabel, width: "90px" },
];

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const windowParam = params.get("window");
  const window: UsageWindow = (WINDOWS as readonly string[]).includes(windowParam ?? "")
    ? (windowParam as UsageWindow)
    : "week"; // default omitted from the URL (docs/49 §8)

  const summary = useUsageSummary(window);

  const items: UsageItemRow[] = (summary.data?.items ?? []).map((item) => ({
    ...item,
    costLabel: formatCost(item.costMicros),
  }));

  return (
    <PageShell
      title="用量"
      subtitle={
        summary.data
          ? `共 ${items.length} 个模型 · ${formatTokens(totalTokens(summary.data.items))} tokens`
          : "按窗口查看 token 与成本"
      }
      actions={
        <Button
          variant="secondary"
          disabled={summary.isLoading || items.length === 0}
          onClick={() => void downloadCsv(window)}
        >
          导出 CSV
        </Button>
      }
    >
      <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16, flex: 1, minHeight: 0 }}>
        <div role="tablist" aria-label="统计窗口" style={{ display: "flex", gap: 8 }}>
          {WINDOWS.map((option) => (
            <Button
              key={option}
              variant={option === window ? "primary" : "secondary"}
              size="sm"
              aria-selected={option === window}
              role="tab"
              onClick={() => {
                const next = new URLSearchParams(params);
                if (option === "week") next.delete("window");
                else next.set("window", option);
                setParams(next, { replace: true });
              }}
            >
              {WINDOW_LABEL[option]}
            </Button>
          ))}
        </div>

        {summary.isLoading ? (
          <Loading label="载入用量…" />
        ) : summary.isError ? (
          <ErrorState message="用量加载失败" onRetry={() => void summary.refetch()} />
        ) : items.length === 0 ? (
          <Empty title="该窗口还没有用量" hint="发几轮对话后，这里会出现 token 与成本统计。" />
        ) : (
          <Table
            caption={`${WINDOW_LABEL[window]}用量（成本 0 表示价表未配置，见 V05-18）`}
            columns={COLUMNS}
            rows={items}
            rowKey={(row) => row.model}
          />
        )}
      </div>
    </PageShell>
  );
}
