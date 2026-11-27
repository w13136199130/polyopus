import { useEffect, useMemo, useState } from "react";
import { Button, Chip, Dialog, Drawer, Empty, ErrorState, Loading, StatusTag, Switch } from "@/components/ui";
import type { MemoryAtom, MemoryKind, MemoryStatus } from "@/lib/api/wire";
import {
  memoryKindLabel,
  memoryStatusLabel,
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useMemoryExport,
  useMemoryPause,
  useSetMemoryPause,
  useUpdateMemory,
} from "@/features/memory/api";
import styles from "./PersonalizationPage.module.css";

const STATUSES: Array<["all" | MemoryStatus, string]> = [
  ["all", "全部"],
  ["active", "生效中"],
  ["pending_review", "待复核"],
  ["retired", "已退休"],
];

const KINDS: MemoryKind[] = ["preference", "fact", "episode", "profile", "skill"];

function statusTone(status: string): "green" | "amber" | "neutral" {
  if (status === "active") return "green";
  if (status === "pending_review") return "amber";
  return "neutral";
}

function downloadJson(value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "polyopus-memories.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 个性化 · 记忆：KPI + 暂停写入 + 列表/搜索 + 新增/纠错/退休/删除/导出. */
export function MemoryPanel() {
  const memoriesQuery = useMemories({});
  const pauseQuery = useMemoryPause();
  const setPause = useSetMemoryPause();
  const createMemory = useCreateMemory();
  const updateMemory = useUpdateMemory();
  const deleteMemory = useDeleteMemory();
  const exportMemory = useMemoryExport();

  const [status, setStatus] = useState<"all" | MemoryStatus>("all");
  const [kind, setKind] = useState<"all" | MemoryKind>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MemoryAtom | null>(null);
  const [deleting, setDeleting] = useState<MemoryAtom | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => memoriesQuery.data?.items ?? [], [memoriesQuery.data]);
  const counts = useMemo(() => ({
    active: items.filter((item) => item.status === "active").length,
    pending: items.filter((item) => item.status === "pending_review").length,
    retired: items.filter((item) => item.status === "retired").length,
  }), [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (kind !== "all" && item.kind !== kind) return false;
      if (needle && !item.text.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, status, kind, query]);

  const paused = pauseQuery.data?.paused ?? false;

  return (
    <div className={styles.panel}>
      {notice ? <div className={styles.notice} onClick={() => setNotice(null)}>{notice}</div> : null}
      {error ? <div className={styles.error} onClick={() => setError(null)}>{error}</div> : null}

      <div className={styles.kpis}>
        <div className={styles.kpi}><span>总记忆</span><b>{items.length}</b></div>
        <div className={styles.kpi}><span>生效中</span><b>{counts.active}</b></div>
        <div className={styles.kpi}><span>待复核</span><b>{counts.pending}</b></div>
        <div className={styles.kpi}><span>已退休</span><b>{counts.retired}</b></div>
      </div>

      <div className={styles.memoryBar}>
        <span className={styles.pauseLabel}>暂停写入</span>
        <Switch
          checked={paused}
          disabled={pauseQuery.isLoading || setPause.isPending}
          label="暂停记忆写入"
          testId="memory-pause"
          onChange={(next) =>
            setPause.mutate({ paused: next }, {
              onSuccess: () => setNotice(next ? "已暂停记忆写入" : "已恢复记忆写入"),
              onError: (err) => setError(err instanceof Error ? err.message : "状态更新失败"),
            })}
        />
        <span className={styles.pauseHint}>
          {paused ? "新的对话不会写入记忆；已有记忆仍可检索。" : "记忆会在对话结束后按规则写入。"}
        </span>
        <span className={styles.spacer} />
        <Button
          size="sm"
          variant="ghost"
          loading={exportMemory.isPending}
          onClick={() => exportMemory.mutate("json", {
            onSuccess: (data) => downloadJson(data),
            onError: (err) => setError(err instanceof Error ? err.message : "导出失败"),
          })}
        >
          导出 JSON
        </Button>
        <Button size="sm" data-testid="memory-new" onClick={() => setCreating(true)}>
          ＋ 新增记忆
        </Button>
      </div>

      <div className={styles.filters}>
        <div className={styles.chips}>
          {STATUSES.map(([key, label]) => (
            <Chip key={key} active={status === key} onClick={() => setStatus(key)}>
              {label}
            </Chip>
          ))}
        </div>
        <select
          className={styles.select}
          aria-label="记忆类型"
          value={kind}
          onChange={(event) => setKind(event.target.value as "all" | MemoryKind)}
        >
          <option value="all">全部类型</option>
          {KINDS.map((value) => (
            <option key={value} value={value}>{memoryKindLabel(value)}</option>
          ))}
        </select>
        <span className={styles.spacer} />
        <input
          className={styles.search}
          type="search"
          aria-label="搜索记忆"
          placeholder="搜索记忆内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {memoriesQuery.isLoading ? <Loading label="载入记忆…" /> : memoriesQuery.isError ? (
        <ErrorState message="记忆加载失败" onRetry={() => void memoriesQuery.refetch()} />
      ) : items.length === 0 ? (
        <Empty
          title="还没有记忆"
          hint="在对话里说「记住…」会生成候选记忆；也可以手动新增。"
          action={{ label: "新增记忆", onClick: () => setCreating(true) }}
        />
      ) : filtered.length === 0 ? (
        <Empty
          title="没有匹配的记忆"
          hint="换个状态、类型或关键词。"
          action={{ label: "清除筛选", onClick: () => { setStatus("all"); setKind("all"); setQuery(""); } }}
        />
      ) : (
        <div className={styles.memoryList}>
          {filtered.map((item) => (
            <article key={item.id} className={styles.memoryCard} data-testid="memory-row">
              <div className={styles.memoryHead}>
                <StatusTag tone={statusTone(item.status)}>{memoryStatusLabel(item.status)}</StatusTag>
                <span className={styles.kindTag}>{memoryKindLabel(item.kind)}</span>
                <span className={styles.source}>{item.source}</span>
                <span className={styles.spacer} />
                <span className={styles.confidence}>置信度 {Math.round(item.confidence * 100)}%</span>
              </div>
              <p className={styles.memoryText}>{item.text}</p>
              <div className={styles.memoryMeta}>
                <span>{new Date(item.updatedAt).toLocaleString("zh-CN")}</span>
                <span className={styles.spacer} />
                <Button size="sm" variant="ghost" data-testid="memory-edit" onClick={() => setEditing(item)}>
                  纠错
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="memory-retire"
                  disabled={item.status === "retired" || updateMemory.isPending}
                  onClick={() => updateMemory.mutate(
                    { atomId: item.id, status: "retired", reason: "user_retired" },
                    {
                      onSuccess: () => setNotice("已退休该记忆"),
                      onError: (err) => setError(err instanceof Error ? err.message : "操作失败"),
                    },
                  )}
                >
                  退休
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.danger}
                  data-testid="memory-delete"
                  onClick={() => setDeleting(item)}
                >
                  删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <MemoryDrawer
        open={creating}
        atom={null}
        pending={createMemory.isPending}
        onClose={() => setCreating(false)}
        onSubmit={(values) => {
          createMemory.mutate(
            { kind: values.kind, text: values.text.trim() },
            {
              onSuccess: () => {
                setCreating(false);
                setNotice("已新增记忆");
              },
              onError: (err) => setError(err instanceof Error ? err.message : "新增失败"),
            },
          );
        }}
      />
      <MemoryDrawer
        open={editing !== null}
        atom={editing}
        pending={updateMemory.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          if (!editing) return;
          updateMemory.mutate(
            {
              atomId: editing.id,
              text: values.text.trim(),
              status: values.status,
              reason: "user_edit",
            },
            {
              onSuccess: () => {
                setEditing(null);
                setNotice("已保存记忆");
              },
              onError: (err) => setError(err instanceof Error ? err.message : "保存失败"),
            },
          );
        }}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="删除记忆"
        description={deleting ? deleting.text.slice(0, 120) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="memory-delete-confirm"
              loading={deleteMemory.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteMemory.mutate(deleting.id, {
                  onSuccess: () => {
                    setDeleting(null);
                    setNotice("已删除记忆");
                  },
                  onError: (err) => setError(err instanceof Error ? err.message : "删除失败"),
                });
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className={styles.dialogNote}>删除后不再参与检索；该操作会留审计记录。</p>
      </Dialog>
    </div>
  );
}

interface MemoryValues {
  kind: MemoryKind;
  text: string;
  status: MemoryStatus;
}

function MemoryDrawer({
  open,
  atom,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  atom: MemoryAtom | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: MemoryValues) => void;
}) {
  const [kind, setKind] = useState<MemoryKind>(atom?.kind ?? "preference");
  const [text, setText] = useState(atom?.text ?? "");
  const [status, setStatus] = useState<MemoryStatus>(atom?.status ?? "active");
  useEffect(() => {
    setKind(atom?.kind ?? "preference");
    setText(atom?.text ?? "");
    setStatus(atom?.status ?? "active");
  }, [atom]);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={atom ? "纠错记忆" : "新增记忆"}
      description={atom ? atom.id : "显式写入一条记忆，立即生效"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            data-testid="memory-save"
            loading={pending}
            disabled={!text.trim()}
            onClick={() => onSubmit({ kind, text, status })}
          >
            保存
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          类型
          <select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)}>
            {KINDS.map((value) => (
              <option key={value} value={value}>{memoryKindLabel(value)}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          内容 *
          <textarea
            data-testid="memory-text"
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {atom ? (
          <label className={styles.field}>
            状态
            <select value={status} onChange={(event) => setStatus(event.target.value as MemoryStatus)}>
              <option value="active">生效中</option>
              <option value="pending_review">待复核</option>
              <option value="retired">已退休</option>
            </select>
          </label>
        ) : null}
      </div>
    </Drawer>
  );
}
