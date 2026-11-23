import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Loading } from "@/components/ui";
import type { AgentRow, Thread } from "@/lib/api/wire";
import { SessionMenu } from "./SessionMenu";
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
  onRename: (thread: Thread) => void;
  onPin: (thread: Thread) => void;
  onBranch: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
  className?: string;
  /** Render inside the mobile session drawer (full width, not hidden). */
  embedded?: boolean;
}

const SELECTED_AGENT_KEY = "poly:new-chat-agent";

function timeLabel(ts: number | null): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** Prototype grouping: 置顶 / 今天 / 昨天 / 更早. */
function groupOf(ts: number | null): string {
  if (!ts) return "更早";
  const date = new Date(ts * 1000);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
  ).getTime();
  const at = date.getTime();
  if (at >= startOfToday) return "今天";
  if (at >= startOfToday - 86_400_000) return "昨天";
  return "更早";
}

function initials(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

/**
 * Session rail (prototype `#/chat` left column):
 * - "对话" header with count + new-session button
 * - search
 * - a visible expert strip (published experts, not a bare dropdown)
 * - pinned / 今天 / 昨天 / 更早 groups, each row with a ⋯ menu
 */
export function ThreadRail({
  threads, loading, activeId, error, agents, onSelect, onCreate, onRetry,
  onRename, onPin, onBranch, onDelete, className, embedded,
}: Props) {
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState(() => {
    try {
      return localStorage.getItem(SELECTED_AGENT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const stripRef = useRef<HTMLDivElement | null>(null);

  const published = useMemo(
    () => agents.filter((agent) => agent.status === "published"),
    [agents],
  );

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_AGENT_KEY, agentId);
    } catch {
      /* private mode: selection simply does not persist */
    }
  }, [agentId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = threads ?? [];
    if (!needle) return list;
    return list.filter((thread) =>
      (thread.title || "未命名会话").toLowerCase().includes(needle),
    );
  }, [threads, query]);

  const groups = useMemo(() => {
    const pinned: Thread[] = [];
    const buckets = new Map<string, Thread[]>([
      ["今天", []], ["昨天", []], ["更早", []],
    ]);
    for (const thread of filtered) {
      if (thread.pinned) {
        pinned.push(thread);
        continue;
      }
      const key = groupOf(thread.lastMessageAt ?? thread.createdAt);
      buckets.get(key)?.push(thread);
    }
    const out: Array<[string, Thread[]]> = [];
    if (pinned.length) out.push(["置顶", pinned]);
    for (const [label, items] of buckets) {
      if (items.length) out.push([label, items]);
    }
    return out;
  }, [filtered]);

  const agentName = (id: string | null | undefined) =>
    agents.find((agent) => agent.agentId === id)?.name;

  const selectedAgent = published.find((agent) => agent.agentId === agentId);
  const createLabel = selectedAgent ? `用「${selectedAgent.name}」新建` : "新建会话";

  return (
    <aside
      className={`${styles.rail} ${embedded ? styles.mobileRail : ""} ${className ?? ""}`}
      aria-label="会话列表"
    >
      <div className={styles.head}>
        <b>对话</b>
        <span className={styles.count}>{threads?.length ?? 0}</span>
        <span className={styles.headSpacer} />
        <Button
          size="sm"
          variant="ghost"
          data-testid="new-chat"
          title={createLabel}
          aria-label={createLabel}
          onClick={() => onCreate(agentId || null)}
        >
          ＋
        </Button>
      </div>

      <div className={styles.searchRow}>
        <input
          className={styles.search}
          type="search"
          placeholder="搜索会话"
          aria-label="搜索会话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.expertsBlock}>
        <div className={styles.expertLabel}>
          <span>选择专家</span>
          {selectedAgent ? (
            <button
              type="button"
              className={styles.clearExpert}
              onClick={() => setAgentId("")}
            >
              改用默认助手
            </button>
          ) : null}
        </div>
        <div
          className={styles.expertStrip}
          ref={stripRef}
          data-testid="new-chat-agent"
          aria-label="新对话使用的专家"
        >
          <button
            type="button"
            className={`${styles.expert} ${agentId === "" ? styles.expertActive : ""}`}
            data-testid="expert-pick"
            aria-pressed={agentId === ""}
            title="默认助手"
            onClick={() => setAgentId("")}
          >
            <span className={`${styles.expertAvatar} ${styles.avatarDefault}`}>P</span>
            <span className={styles.expertName}>默认</span>
          </button>
          {published.map((agent) => (
            <button
              key={agent.agentId}
              type="button"
              className={`${styles.expert} ${agentId === agent.agentId ? styles.expertActive : ""}`}
              data-testid="expert-pick"
              aria-pressed={agentId === agent.agentId}
              title={agent.name}
              onClick={() => setAgentId(agent.agentId)}
            >
              <span className={styles.expertAvatar}>{initials(agent.name)}</span>
              <span className={styles.expertName}>{agent.name}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.create}
          onClick={() => onCreate(agentId || null)}
        >
          ＋ {createLabel}
        </button>
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
            hint="选一位专家，或直接用默认助手开始。"
          />
        ) : (
          groups.map(([group, items]) => (
            <div key={group} className={styles.group}>
              <div className={styles.groupLabel}>{group}</div>
              {items.map((thread) => {
                const name = agentName(thread.agentId);
                const active = thread.threadId === activeId;
                return (
                  <div
                    key={thread.threadId}
                    className={`${styles.item} ${active ? styles.active : ""}`}
                  >
                    <button
                      type="button"
                      className={styles.itemMain}
                      onClick={() => onSelect(thread.threadId)}
                      aria-current={active ? "true" : undefined}
                    >
                      <span className={styles.title}>
                        {thread.title || "未命名会话"}
                      </span>
                      <span className={styles.meta}>
                        {name ? <span className={styles.chip}>{name}</span> : null}
                        {thread.pinned ? <span className={styles.pin}>置顶</span> : null}
                      </span>
                    </button>
                    <div className={styles.itemSide}>
                      <span className={styles.time}>
                        {timeLabel(thread.lastMessageAt ?? thread.createdAt)}
                      </span>
                      <SessionMenu
                        thread={thread}
                        onRename={onRename}
                        onPin={onPin}
                        onBranch={onBranch}
                        onDelete={onDelete}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
