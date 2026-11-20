import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Empty, Loading } from "@/components/ui";
import type { TraceEvent } from "@/lib/api/wire";
import { buildTrace, type TraceItem, type TraceKind } from "../trace-model";
import styles from "./TraceExplorer.module.css";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadTitle?: string;
  trace: TraceEvent[] | undefined;
  loading: boolean;
}

const FILTERS: Array<[TraceKind | "all", string]> = [
  ["all", "全部"],
  ["user", "用户"],
  ["model", "模型"],
  ["assistant", "回答"],
  ["tool", "工具"],
  ["approval", "审批"],
  ["context", "上下文"],
];

const STATUS_LABEL: Record<TraceItem["status"], string> = {
  ok: "完成",
  failed: "失败",
  running: "运行中",
  waiting: "等待",
  neutral: "记录",
};

type DetailTab = "overview" | "input" | "output" | "raw";

function format(value: unknown): string {
  if (value === undefined || value === null || value === "") return "（无）";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function duration(ms?: number): string {
  if (!ms) return "—";
  return ms < 1000 ? "<1 秒" : `${(ms / 1000).toFixed(1)} 秒`;
}

/**
 * Full-width trace explorer (Octop/DSH-style): turn-grouped list on the left,
 * selected record's overview/input/output/raw JSON on the right.
 */
export function TraceExplorer({
  open, onOpenChange, threadTitle, trace, loading,
}: Props) {
  const { groups, items } = useMemo(() => buildTrace(trace), [trace]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TraceKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");

  useEffect(() => {
    if (!open) return;
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[items.length - 1].id);
    }
  }, [open, items, selectedId]);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (filter !== "all" && item.kind !== filter) return false;
          if (!needle) return true;
          return `${item.label} ${item.title} ${item.detail}`.toLowerCase().includes(needle);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, filter, query]);

  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedGroup = selected
    ? groups.find((group) => group.items.some((item) => item.id === selected.id))
    : null;
  const step = selectedGroup && selected
    ? selectedGroup.items.findIndex((item) => item.id === selected.id) + 1
    : 0;

  function select(item: TraceItem) {
    setSelectedId(item.id);
    setTab("overview");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="运行轨迹"
      description={`${threadTitle ?? "当前会话"} · 全部回合、模型、工具、审批与上下文记录`}
      width={1180}
      footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>关闭</Button>}
    >
      {loading && !trace ? (
        <Loading label="读取轨迹…" />
      ) : items.length === 0 ? (
        <Empty title="还没有轨迹" hint="发送消息后，这里会记录用户输入、模型回合、工具调用与审批。" />
      ) : (
        <div className={styles.explorer} data-testid="trace-explorer">
          <section className={styles.left}>
            <div className={styles.toolbar}>
              <input
                className={styles.search}
                type="search"
                placeholder="搜索事件、工具或内容"
                aria-label="搜索轨迹"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className={styles.count}>{visibleCount} / {items.length} 条</span>
            </div>
            <div className={styles.filters} role="tablist" aria-label="轨迹类型">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  className={`${styles.chip} ${filter === value ? styles.chipOn : ""}`}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.list}>
              {visibleGroups.length === 0 ? (
                <div className={styles.emptyFilter}>
                  <p className={styles.muted}>该分类没有匹配的记录。</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                  >
                    查看全部轨迹
                  </Button>
                </div>
              ) : visibleGroups.map((group) => (
                <section key={group.key} className={styles.group}>
                  <div className={styles.groupHead}>
                    <span>第 {group.index} 轮</span>
                    <span className={styles.groupTime}>{clock(group.startedAt)}</span>
                    <span className={styles.spacer} />
                    <span className={styles.muted}>{group.items.length} 步</span>
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.row} ${item.id === selectedId ? styles.rowOn : ""}`}
                      data-testid="trace-item"
                      onClick={() => select(item)}
                    >
                      <span className={`${styles.badge} ${styles[`badge_${item.kind}`]}`}>
                        {item.label}
                      </span>
                      <span className={styles.rowMain}>
                        <span className={styles.rowTitle}>{item.title}</span>
                        {item.detail ? (
                          <span className={styles.rowDetail}>{item.detail}</span>
                        ) : null}
                      </span>
                      <span className={styles.rowSide}>
                        <span className={styles.rowTime}>{clock(item.ts)}</span>
                        <span className={`${styles.status} ${styles[`status_${item.status}`]}`}>
                          {STATUS_LABEL[item.status]}
                        </span>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </section>

          <section className={styles.right} data-testid="trace-detail">
            {!selected ? (
              <p className={styles.muted}>选择左侧一条记录查看详情。</p>
            ) : (
              <>
                <header className={styles.detailHead}>
                  <div>
                    <div className={styles.detailTitle}>{selected.title}</div>
                    <div className={styles.detailSub}>
                      第 {selectedGroup?.index ?? "—"} 轮 · 第 {step} 步 · {selected.label}
                    </div>
                  </div>
                  <span className={`${styles.status} ${styles[`status_${selected.status}`]}`}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                </header>
                <div className={styles.tabs} role="tablist" aria-label="轨迹详情">
                  {([
                    ["overview", "概览"], ["input", "输入"],
                    ["output", "输出"], ["raw", "原始内容"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      className={`${styles.tab} ${tab === value ? styles.tabOn : ""}`}
                      onClick={() => setTab(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.detailBody}>
                  {tab === "overview" ? (
                    <dl className={styles.meta}>
                      <dt>类型</dt><dd>{selected.label} · {selected.raw.type}</dd>
                      <dt>状态</dt><dd>{STATUS_LABEL[selected.status]}</dd>
                      <dt>时间</dt><dd>{clock(selected.ts)}</dd>
                      <dt>耗时</dt><dd>{duration(selected.durationMs)}</dd>
                      <dt>turn</dt><dd>{selected.turnId ?? "—"}</dd>
                      <dt>run</dt><dd>{selected.runId ?? "—"}</dd>
                      <dt>预览</dt><dd>{selected.detail || selected.title}</dd>
                    </dl>
                  ) : null}
                  {tab === "input" ? (
                    <pre className={styles.pre}>{format(selected.input)}</pre>
                  ) : null}
                  {tab === "output" ? (
                    <pre className={styles.pre}>{format(selected.output ?? selected.detail)}</pre>
                  ) : null}
                  {tab === "raw" ? (
                    <pre className={styles.pre}>{format(selected.raw.payload)}</pre>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
