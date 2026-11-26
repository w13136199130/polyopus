/**
 * Usage data hooks (docs/49 §4.2): window-scoped summary + CSV export that
 * always matches the active filter. costMicros==0 renders as "未计价"
 * (unpriced) until V05-18 seeds model_prices — never as ¥0.
 */

import { useQuery } from "@tanstack/react-query";
import { usage } from "@/lib/api/endpoints";
import type { UsageSummaryItem } from "@/lib/api/wire";

export const RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof RANGES)[number];
export const GROUPS = ["day", "agent", "model"] as const;
export type UsageGroup = (typeof GROUPS)[number];

export interface UsageQuery {
  range: UsageRange;
  groupBy: UsageGroup;
  asUser?: string;
  agentId?: string;
}

export const usageKeys = {
  summary: (query: UsageQuery) =>
    ["usage", "summary", query.range, query.groupBy, query.asUser ?? "", query.agentId ?? ""] as const,
};

export function useUsageSummary(query: UsageQuery) {
  return useQuery({
    queryKey: usageKeys.summary(query),
    queryFn: () => usage.summary(query),
    staleTime: 30_000, // docs/49 §4.2
  });
}

/** Summary item + its display-ready cost label (未计价 vs ¥). */
export interface UsageItemRow extends UsageSummaryItem {
  costLabel: string;
}

export function formatCost(micros: number): string {
  if (micros === 0) return "未计价"; // unpriced until V05-18 seeds model_prices
  return `¥${(micros / 1_000_000).toFixed(4)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** CSV download honoring the current range/group (keeps the filter honest). */
export async function downloadCsv(query: UsageQuery): Promise<void> {
  const csv = await usage.exportCsv(query);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `polyopus-usage-${query.range}d-${query.groupBy}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function totalTokens(items: UsageSummaryItem[]): number {
  return items.reduce(
    (sum, item) => sum + item.inputTokens + item.outputTokens,
    0,
  );
}
