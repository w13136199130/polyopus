/**
 * 专家 (docs/52 §4): 页头 + 我的专家/我的团队/发现专家 Tab + 过滤器行 +
 * 卡片/表格视图 + 右侧编辑抽屉. Teams and the market are real/placeholder
 * respectively — no fake cloud scopes.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Button,
  Chip,
  Empty,
  ErrorState,
  FilterBar,
  Loading,
  Tabs,
  ViewToggle,
} from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { TeamPanel } from "@/features/teams/components/TeamPanel";
import { useCan } from "@/lib/auth/permissions";
import type { AgentRow } from "@/lib/api/wire";
import { useAgents, useDeleteAgent, usePublishAgent } from "@/features/agents/api";
import { AgentCard } from "./AgentCard";
import { AgentCreateDrawer } from "./AgentCreateDrawer";
import { DialogDelete, DialogPublish } from "./AgentDialogs";
import { AgentEditDrawer } from "./AgentEditDrawer";
import { AgentsTable } from "./AgentsTable";
import styles from "./AgentsPage.module.css";

type Tab = "mine" | "team" | "discover";
type Scope = "all" | "local" | "cloud" | "shared";
type View = "card" | "table";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function AgentsPage() {
  const query = useAgents();
  const canWrite = useCan("agent:write");
  const publishAgent = usePublishAgent();
  const deleteAgent = useDeleteAgent();
  const [params, setParams] = useSearchParams();

  const tabParam = params.get("tab");
  const tab: Tab = tabParam === "team" || tabParam === "discover" ? tabParam : "mine";
  const scopeParam = params.get("scope");
  const scope: Scope =
    scopeParam === "local" || scopeParam === "cloud" || scopeParam === "shared"
      ? scopeParam
      : "all";
  const view: View = params.get("view") === "table" ? "table" : "card";
  const search = params.get("q") ?? "";

  function setParam(key: string, value: string, fallback: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<"basic" | "test">("basic");
  const [pendingPublish, setPendingPublish] = useState<AgentRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AgentRow | null>(null);

  const agents = useMemo(() => query.data?.items ?? [], [query.data]);
  const templates = query.data?.templates ?? [];
  const editing = useMemo(
    () => agents.find((agent) => agent.agentId === editingId) ?? null,
    [agents, editingId],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((agent) =>
      `${agent.name} ${agent.agentId} ${agent.description ?? ""} ${agent.model ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [agents, search]);

  function openAgent(agentId: string, section: "basic" | "test" = "basic") {
    setEditingSection(section);
    setEditingId(agentId);
  }

  async function confirmPublish() {
    if (!pendingPublish) return;
    setError(null);
    try {
      const published = await publishAgent.mutateAsync(pendingPublish.agentId);
      setNotice(`已发布 ${published.name} v${published.version}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPendingPublish(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setError(null);
    try {
      await deleteAgent.mutateAsync(pendingDelete.agentId);
      setNotice(`已删除 ${pendingDelete.name}`);
      if (editingId === pendingDelete.agentId) setEditingId(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <PageShell
      title="专家"
      subtitle="草稿可改；发布后的版本不可变，旧会话继续锁定旧版本。"
      actions={
        <Button size="sm" variant="outline" disabled title="云端托管专家随 v1.1 接入">
          添加云端专家 · v1.1
        </Button>
      }
      tabs={
        <Tabs
          ariaLabel="专家视图"
          value={tab}
          onChange={(next) => setParam("tab", next, "mine")}
          items={[
            { key: "mine", label: "我的专家" },
            { key: "team", label: "我的团队" },
            { key: "discover", label: "发现专家" },
          ]}
        />
      }
    >
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {tab === "mine" ? (
          <>
            <FilterBar
              count={`共 ${filtered.length} 个专家`}
              testId="agents-filter"
              right={
                <>
                  <input
                    className={styles.search}
                    type="search"
                    aria-label="搜索专家"
                    placeholder="搜索名称、ID 或模型"
                    value={search}
                    onChange={(event) => setParam("q", event.target.value, "")}
                  />
                  <ViewToggle value={view} onChange={(next) => setParam("view", next, "card")} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void query.refetch()}
                    loading={query.isFetching}
                  >
                    刷新
                  </Button>
                  <Button size="sm" data-testid="agent-new" disabled={!canWrite} onClick={() => setCreateOpen(true)}>
                    ＋ 新建专家
                  </Button>
                </>
              }
            >
              <Chip active={scope === "all"} onClick={() => setParam("scope", "all", "all")} count={agents.length}>
                全部
              </Chip>
              <Chip active={scope === "local"} onClick={() => setParam("scope", "local", "all")} count={agents.length}>
                本地
              </Chip>
              <Chip disabled title="云端专家随 v1.1 接入">云端</Chip>
              <Chip disabled title="共享专家随 v1.1 接入">共享</Chip>
            </FilterBar>

            {query.isLoading ? (
              <Loading label="载入专家…" />
            ) : query.isError ? (
              <ErrorState message="专家加载失败" onRetry={() => void query.refetch()} />
            ) : agents.length === 0 ? (
              <Empty
                title="暂无专家"
                hint="从模板创建一个，或直接输入名称新建。"
                action={canWrite ? { label: "新建专家", onClick: () => setCreateOpen(true) } : undefined}
              />
            ) : filtered.length === 0 ? (
              <Empty
                title="没有匹配的专家"
                hint="换个关键词，或清空搜索。"
                action={{ label: "清空搜索", onClick: () => setParam("q", "", "") }}
              />
            ) : view === "table" ? (
              <AgentsTable
                agents={filtered}
                canWrite={canWrite}
                onOpen={(agent) => openAgent(agent.agentId)}
                onTest={(agent) => openAgent(agent.agentId, "test")}
                onPublish={setPendingPublish}
                onDelete={setPendingDelete}
              />
            ) : (
              <div className={styles.grid} data-testid="agents-grid">
                {filtered.map((agent) => (
                  <AgentCard
                    key={agent.agentId}
                    agent={agent}
                    canWrite={canWrite}
                    onOpen={() => openAgent(agent.agentId)}
                    onTest={() => openAgent(agent.agentId, "test")}
                    onPublish={() => setPendingPublish(agent)}
                    onDelete={() => setPendingDelete(agent)}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "team" ? <TeamPanel agents={agents} /> : null}

        {tab === "discover" ? (
          <Empty
            title="专家市场尚未接入"
            hint="发现、预览并安装市场专家的能力随 v1.1 提供；当前实例只展示本地专家。"
          />
        ) : null}
      </div>

      <AgentCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        canWrite={canWrite}
        onCreated={(name) => setNotice(`已创建草稿 ${name}`)}
      />

      <AgentEditDrawer
        agent={editing}
        open={editing !== null}
        initialSection={editingSection}
        onOpenChange={(open) => { if (!open) setEditingId(null); }}
        onNotice={setNotice}
        onError={setError}
      />

      <DialogPublish
        agent={pendingPublish}
        loading={publishAgent.isPending}
        onCancel={() => setPendingPublish(null)}
        onConfirm={() => void confirmPublish()}
      />
      <DialogDelete
        agent={pendingDelete}
        loading={deleteAgent.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </PageShell>
  );
}
