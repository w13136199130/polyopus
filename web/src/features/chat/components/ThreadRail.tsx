import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Button, Empty, Loading, Tabs } from "@/components/ui";
import icons from "@/layouts/icons";
import type { AgentRow, TeamRow, Thread } from "@/lib/api/wire";
import { SessionMenu } from "./SessionMenu";
import { RailSortMenu, type SortMode } from "./RailSortMenu";
import styles from "./ThreadRail.module.css";

type RailTab = "expert" | "team" | "cloud";

/** Threads shown per expert before "展开更多". */
const MAX_VISIBLE_THREADS = 8;

interface Props {
  threads: Thread[] | undefined;
  loading: boolean;
  activeId: string | null;
  error: boolean;
  agents: AgentRow[];
  teams?: TeamRow[];
  teamsLoading?: boolean;
  onSelect: (threadId: string) => void;
  onCreate: (agentId: string | null) => void;
  /** Selected expert for the next chat; controlled by the URL (?agent=). */
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  /** Teams run their tasks on the experts page (v1.1 orchestration). */
  onOpenTeam?: () => void;
  onRetry: () => void;
  onRename: (thread: Thread) => void;
  onPin: (thread: Thread) => void;
  onBranch: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
  className?: string;
  /** Render inside the mobile session drawer (full width, not hidden). */
  embedded?: boolean;
}

interface ExpertGroup {
  key: string;
  agent: AgentRow | null;
  threads: Thread[];
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

function initials(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

function lastAt(thread: Thread): number {
  return thread.lastMessageAt ?? thread.createdAt ?? 0;
}

function compareThreads(mode: SortMode) {
  return (left: Thread, right: Thread): number => {
    if (mode === "created") return right.createdAt - left.createdAt;
    if (mode === "oldest") return left.createdAt - right.createdAt;
    return lastAt(right) - lastAt(left);
  };
}

function sortThreads(list: Thread[], mode: SortMode): Thread[] {
  const compare = compareThreads(mode);
  const pinned = list.filter((thread) => thread.pinned).sort(compare);
  const rest = list.filter((thread) => !thread.pinned).sort(compare);
  return [...pinned, ...rest];
}

/**
 * Session rail (prototype v7): search, 专家/团队/云端 switch, then one group
 * per expert with its conversations nested underneath. Selecting an expert
 * decides who the next conversation talks to.
 */
export function ThreadRail({
  threads, loading, activeId, error, agents, teams = [], teamsLoading,
  onSelect, onCreate, onRetry, onRename, onPin, onBranch, onDelete,
  selectedAgentId, onSelectAgent, onOpenTeam, className, embedded,
}: Props) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<RailTab>("expert");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>(() => {
    try {
      const saved = localStorage.getItem("poly:chat-sort");
      if (saved === "created" || saved === "oldest" || saved === "recent") return saved;
    } catch {
      /* private mode: fall through to the default */
    }
    return "recent";
  });

  useEffect(() => {
    try {
      localStorage.setItem("poly:chat-sort", sort);
    } catch {
      /* ignore */
    }
  }, [sort]);

  const published = useMemo(
    () => agents.filter((agent) => agent.status === "published"),
    [agents],
  );
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent])),
    [agents],
  );

  const groups = useMemo<ExpertGroup[]>(() => {
    const byAgent = new Map<string, Thread[]>();
    for (const thread of threads ?? []) {
      const key = thread.agentId ?? "";
      const list = byAgent.get(key);
      if (list) list.push(thread);
      else byAgent.set(key, [thread]);
    }
    const keys = new Set<string>(byAgent.keys());
    for (const agent of published) keys.add(agent.agentId);

    const needle = query.trim().toLowerCase();
    const all: ExpertGroup[] = [];
    for (const key of keys) {
      const agent = key ? agentById.get(key) ?? null : null;
      const items = sortThreads(byAgent.get(key) ?? [], sort);
      if (!needle) {
        all.push({ key: key || "__default", agent, threads: items });
        continue;
      }
      const agentHit = key === ""
        ? "默认助手".includes(needle)
        : `${agent?.name ?? ""} ${agent?.description ?? ""}`.toLowerCase().includes(needle);
      const matching = items.filter((thread) =>
        `${thread.title ?? ""} ${thread.preview ?? ""}`.toLowerCase().includes(needle),
      );
      if (agentHit || matching.length) {
        all.push({ key: key || "__default", agent, threads: agentHit ? items : matching });
      }
    }
    // Stable order: 默认助手 first, then experts by name. Chat activity must
    // never reorder the rail — starting a conversation would otherwise hoist
    // that expert to the top.
    const rank = (group: ExpertGroup) => (
      group.key === "__default" ? 0 : group.agent ? 1 : 2
    );
    return all.sort((left, right) => {
      const delta = rank(left) - rank(right);
      if (delta !== 0) return delta;
      if (!left.agent || !right.agent) return 0;
      return left.agent.name.localeCompare(right.agent.name, "zh-Hans-CN");
    });
  }, [threads, published, agentById, query, sort]);

  const selectedAgent = published.find((agent) => agent.agentId === selectedAgentId);
  const selectedTeamRow = teams.find((team) => team.teamId === selectedTeam);

  function footer() {
    if (tab === "team") {
      return (
        <Button
          className={styles.footerBtn}
          variant="outline"
          data-testid="rail-team-open"
          onClick={() => onOpenTeam?.()}
        >
          {selectedTeamRow ? `打开「${selectedTeamRow.name}」派工` : "打开团队页"}
        </Button>
      );
    }
    if (tab === "cloud") {
      return (
        <Button
          className={styles.footerBtn}
          variant="outline"
          disabled
          title="云端协同随 v1.1 提供"
        >
          云端协同 · v1.1
        </Button>
      );
    }
    return (
      <Button
        className={styles.footerBtn}
        variant="outline"
        data-testid="new-chat"
        onClick={() => onCreate(selectedAgentId || null)}
      >
        ＋ {selectedAgent ? `用「${selectedAgent.name}」新建` : "新建对话"}
      </Button>
    );
  }

  return (
    <aside
      className={`${styles.rail} ${embedded ? styles.mobileRail : ""} ${className ?? ""}`}
      aria-label="会话列表"
    >
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          type="search"
          placeholder="搜索专家或会话"
          aria-label="搜索专家或会话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.railTabs}>
        <Tabs
          ariaLabel="会话范围"
          variant="segmented"
          value={tab}
          onChange={(next) => setTab(next)}
          items={[
            { key: "expert", label: "专家", testId: "rail-tab-expert" },
            { key: "team", label: "团队", testId: "rail-tab-team" },
            { key: "cloud", label: "云端", testId: "rail-tab-cloud" },
          ]}
        />
      </div>

      {tab === "expert" ? (
        <div className={styles.createExpertRow}>
          <Link
            to="/agents?new=1"
            className={styles.createExpert}
            data-testid="rail-create-expert"
          >
            ＋ 创建专家
          </Link>
          <RailSortMenu value={sort} onChange={setSort} />
        </div>
      ) : null}

      <div className={styles.list} data-testid="new-chat-agent">
        {tab === "expert" ? (
          <>
            {loading && !threads ? (
              <Loading label="载入会话…" />
            ) : error ? (
              <div className={styles.error}>
                会话列表加载失败
                <Button size="sm" variant="ghost" onClick={onRetry}>重试</Button>
              </div>
            ) : groups.length === 0 ? (
              <Empty
                title={query ? "没有匹配的专家或会话" : "还没有会话"}
                hint="从上方创建专家，或直接开始默认对话。"
              />
            ) : (
              groups.map((group) => {
                const agent = group.agent;
                const isDefault = group.key === "__default";
                const agentId = agent?.agentId ?? "";
                const activeGroup = isDefault
                  ? selectedAgentId === ""
                  : agentId === selectedAgentId;
                const name = agent?.name ?? (isDefault ? "默认助手" : "已删除专家");
                const isExpanded = expanded.has(group.key);
                // A group with many conversations collapses to keep the rail
                // scannable; search and the active thread always reveal all.
                const activeInside = group.threads.some(
                  (thread) => thread.threadId === activeId,
                );
                const showAll = isExpanded || Boolean(query.trim()) || activeInside;
                const visibleThreads = showAll
                  ? group.threads
                  : group.threads.slice(0, MAX_VISIBLE_THREADS);
                const hiddenCount = group.threads.length - visibleThreads.length;
                const description = agent
                  ? agent.description || "已发布专家"
                  : isDefault
                    ? "未选择专家，使用实例默认模型"
                    : "专家不可用";
                return (
                  <section
                    key={group.key}
                    className={styles.expertGroup}
                    data-testid="expert-group"
                  >
                    <div className={`${styles.expertRow} ${activeGroup ? styles.expertRowActive : ""}`}>
                      <button
                        type="button"
                        className={styles.expertMain}
                        data-testid="expert-pick"
                        aria-pressed={activeGroup}
                        title={agent || isDefault ? `选择「${name}」作为新对话的专家` : "专家不可用"}
                        disabled={!agent && !isDefault}
                        onClick={() => onSelectAgent(agentId)}
                      >
                        <span className={`${styles.expertAvatar} ${agent ? "" : styles.avatarDefault}`}>
                          {initials(name)}
                        </span>
                        <span className={styles.expertMeta}>
                          <b>{name}</b>
                          <small>{description}</small>
                        </span>
                        {agent && agent.status === "published" ? (
                          <span className={styles.onlineDot} aria-label="已发布" />
                        ) : null}
                      </button>
                      <span className={styles.expertActions}>
                        <button
                          type="button"
                          className={styles.expertAction}
                          title={`用「${name}」新建对话`}
                          aria-label={`用「${name}」新建对话`}
                          data-testid="expert-new-chat"
                          onClick={() => onCreate(agent ? agent.agentId : null)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round">
                            <path d={icons.plus} />
                          </svg>
                        </button>
                        {agent ? (
                          <Link
                            to={`/agents?agent=${encodeURIComponent(agent.agentId)}`}
                            className={styles.expertAction}
                            title="编辑专家"
                            aria-label={`编辑专家 ${name}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round">
                              <path d={icons.edit} />
                            </svg>
                          </Link>
                        ) : null}
                      </span>
                    </div>

                    {group.threads.length ? (
                      <div className={styles.threads}>
                        {visibleThreads.map((thread) => {
                          const active = thread.threadId === activeId;
                          return (
                            <div
                              key={thread.threadId}
                              className={`${styles.item} ${active ? styles.active : ""}`}
                              data-testid="thread-row"
                            >
                              <button
                                type="button"
                                className={styles.itemMain}
                                onClick={() => onSelect(thread.threadId)}
                                aria-current={active ? "true" : undefined}
                              >
                                {thread.pinned ? <span className={styles.pin}>置顶</span> : null}
                                <span className={styles.title}>
                                  {thread.title || "未命名会话"}
                                </span>
                                {thread.preview ? (
                                  <span className={styles.meta}>
                                    <span className={styles.preview}>{thread.preview}</span>
                                  </span>
                                ) : null}
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
                        {hiddenCount > 0 ? (
                          <button
                            type="button"
                            className={styles.moreThreads}
                            data-testid="expert-more"
                            onClick={() => setExpanded((current) => {
                              const next = new Set(current);
                              next.add(group.key);
                              return next;
                            })}
                          >
                            展开更多（还有 {hiddenCount} 条）
                          </button>
                        ) : null}
                        {isExpanded && !activeInside && !query.trim()
                          && group.threads.length > MAX_VISIBLE_THREADS ? (
                            <button
                              type="button"
                              className={styles.moreThreads}
                              onClick={() => setExpanded((current) => {
                                const next = new Set(current);
                                next.delete(group.key);
                                return next;
                              })}
                            >
                              收起
                            </button>
                          ) : null}
                      </div>
                    ) : (
                      <p className={styles.emptyHint}>还没有对话</p>
                    )}
                  </section>
                );
              })
            )}
          </>
        ) : null}

        {tab === "team" ? (
          teamsLoading ? <Loading label="载入团队…" /> : teams.length === 0 ? (
            <Empty
              title="还没有团队"
              hint="在专家页创建团队；团队任务从专家页派工，会话栏展示团队入口。"
            />
          ) : (
            teams.map((team) => {
              const lead = team.members.find((member) => member.role === "lead");
              const active = team.teamId === selectedTeam;
              return (
                <button
                  key={team.teamId}
                  type="button"
                  className={`${styles.teamCard} ${active ? styles.teamActive : ""}`}
                  data-testid="rail-team"
                  aria-pressed={active}
                  onClick={() => setSelectedTeam(team.teamId)}
                  onDoubleClick={() => onOpenTeam?.()}
                >
                  <span className={styles.teamAvatar}>{initials(team.name)}</span>
                  <span className={styles.teamMeta}>
                    <b>{team.name}</b>
                    <small>
                      {team.memberCount} 位成员
                      {lead ? ` · 负责人 ${lead.name}` : ""}
                    </small>
                  </span>
                </button>
              );
            })
          )
        ) : null}

        {tab === "cloud" ? (
          <Empty
            title="云端协同随 v1.1 提供"
            hint="跨实例连接需要控制器与端到端鉴权；接入后这里可选择云端专家并发起对话。"
          />
        ) : null}
      </div>

      <div className={styles.footer}>{footer()}</div>
    </aside>
  );
}
