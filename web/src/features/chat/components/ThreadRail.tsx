import { useMemo, useState } from "react";
import { Button, Empty, Loading } from "@/components/ui";
import type { AgentRow, Thread } from "@/lib/api/wire";
import styles from "./ThreadRail.module.css";

interface Props {
  threads: Thread[] | undefined;
  loading: boolean;
  activeId: string | null;
  error: boolean;
  agents: AgentRow[];
  onSelect: (threadId: string) => void;
  onCreate: (agentId: string | null) => void;
  onRetry: () => void;
}

function timeLabel(ts: number | null): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function groupOf(ts: number | null): string {
  if (!ts) return "更早";
  const date = new Date(ts * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "今天";
  const week = 7 * 86400 * 1000;
  if (now.getTime() - date.getTime() < week) return "本周";
  return "更早";
}

export function ThreadRail({
  threads, loading, activeId, error, agents, onSelect, onCreate, onRetry,
}: Props) {
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState("");

  const published = useMemo(
    () => agents.filter((agent) => agent.status === "published"),
    [agents],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = threads ?? [];
    if (!needle) return list;
    return list.filter((thread) =>
      (thread.title || "未命名会话").toLowerCase().includes(needle),
    );
  }, [threads, query]);

  const groups = useMemo(() => {
    const buckets = new Map<string, Thread[]>();
    for (const thread of filtered) {
      const key = groupOf(thread.lastMessageAt ?? thread.createdAt);
      const bucket = buckets.get(key) ?? [];
      bucket.push(thread);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()];
  }, [filtered]);

  const agentName = (id: string | null | undefined) =>
    agents.find((agent) => agent.agentId === id)?.name;

  return (
    <aside className={styles.rail} aria-label="会话列表">
      <div className={styles.top}>
        <div className={styles.newRow}>
          <Button
            size="sm"
            data-testid="new-chat"
            onClick={() => onCreate(agentId || null)}
          >
            ＋ 新对话
          </Button>
          <select
            className={styles.agentSelect}
            data-testid="new-chat-agent"
            value={agentId}
            aria-label="新对话使用的专家"
            onChange={(event) => setAgentId(event.target.value)}
            title="新对话使用的专家"
          >
            <option value="">默认助手</option>
            {published.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        <input
          className={styles.search}
          type="search"
          placeholder="搜索会话"
          aria-label="搜索会话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className={styles.list}>
        {loading && !threads ? (
          <Loading label="载入会话…" />
        ) : error ? (
          <div className={styles.error}>
            会话列表加载失败
            <Button size="sm" variant="ghost" onClick={onRetry}>重试</Button>
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            title={query ? "没有匹配的会话" : "还没有会话"}
            hint="点上方按钮开始第一段对话。"
          />
        ) : (
          groups.map(([group, items]) => (
            <div key={group} className={styles.group}>
              <div className={styles.groupLabel}>{group}</div>
              {items.map((thread) => {
                const name = agentName(thread.agentId);
                return (
                  <button
                    key={thread.threadId}
                    type="button"
                    className={`${styles.item} ${thread.threadId === activeId ? styles.active : ""}`}
                    onClick={() => onSelect(thread.threadId)}
                    aria-current={thread.threadId === activeId ? "true" : undefined}
                  >
                    <span className={styles.title}>{thread.title || "未命名会话"}</span>
                    <span className={styles.meta}>
                      {name ? <span className={styles.chip}>{name}</span> : null}
                      <span className={styles.time}>
                        {timeLabel(thread.lastMessageAt ?? thread.createdAt)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
