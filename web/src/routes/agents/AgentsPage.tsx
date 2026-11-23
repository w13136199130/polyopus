/** Experts page (P1-4): card grid + sectioned edit drawer, prototype style. */

import { useMemo, useState } from "react";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import type { AgentRow } from "@/lib/api/wire";
import {
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  usePublishAgent,
} from "@/features/agents/api";
import { AgentEditDrawer } from "./AgentEditDrawer";
import styles from "./AgentsPage.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function AgentsPage() {
  const query = useAgents();
  const canWrite = useCan("agent:write");
  const createAgent = useCreateAgent();
  const publishAgent = usePublishAgent();
  const deleteAgent = useDeleteAgent();

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState("");
  const [newName, setNewName] = useState("");
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

  function openAgent(agentId: string, section: "basic" | "test" = "basic") {
    setEditingSection(section);
    setEditingId(agentId);
  }

  function applyTemplate(id: string) {
    setTemplate(id);
    const found = templates.find((item) => item.id === id);
    if (found) setNewName(found.name);
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const selected = templates.find((item) => item.id === template);
      const created = await createAgent.mutateAsync({
        name: newName.trim(),
        description: selected?.description,
        model: selected?.model,
        systemPrompt: selected?.systemPrompt,
      });
      setNotice(`已创建草稿 ${created.name}`);
      setNewName("");
      setTemplate("");
    } catch (err) {
      setError(messageOf(err));
    }
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
    >
      <div className={styles.layout}>
        <aside className={styles.side} aria-label="专家列表">
          <div className={styles.sideHead}>
            <b>专家</b>
            <span>{agents.length} 个 · {agents.filter((agent) => agent.status === "published").length} 已发布</span>
          </div>
          <div className={styles.sideList}>
            {agents.map((agent) => (
              <button
                key={agent.agentId}
                type="button"
                className={styles.sideRow}
                data-testid="agent-side-row"
                onClick={() => openAgent(agent.agentId)}
              >
                <span className={styles.sideAvatar}>{agent.name.slice(0, 1).toUpperCase()}</span>
                <span className={styles.sideMeta}>
                  <b>{agent.name}</b>
                  <span>{agent.model || "默认模型"}</span>
                </span>
                <i
                  className={`${styles.sideDot} ${
                    agent.status === "published" ? styles.sideDotOn : ""
                  }`}
                  aria-label={agent.status === "published" ? "已发布" : "草稿"}
                />
              </button>
            ))}
          </div>
        </aside>

        <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <form className={styles.toolbar} onSubmit={(event) => void submitCreate(event)}>
          <select
            data-testid="agent-template"
            value={template}
            aria-label="从模板创建"
            onChange={(event) => applyTemplate(event.target.value)}
          >
            <option value="">（空白）</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <input
            data-testid="agent-name"
            required
            maxLength={100}
            placeholder="新专家名称"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            data-testid="agent-create"
            disabled={!canWrite || !newName.trim()}
            loading={createAgent.isPending}
          >
            创建专家
          </Button>
        </form>

        {query.isLoading ? (
          <Loading label="载入专家…" />
        ) : query.isError ? (
          <ErrorState message="专家加载失败" onRetry={() => void query.refetch()} />
        ) : agents.length === 0 ? (
          <Empty title="暂无专家" hint="从模板创建一个，或直接输入名称新建。" />
        ) : (
          <div className={styles.grid}>
            {agents.map((agent) => (
              <div
                key={agent.agentId}
                className={styles.card}
                data-testid="agent-row"
                onClick={() => openAgent(agent.agentId)}
              >
                <div className={styles.cardHead}>
                  <span className={styles.avatar}>
                    {agent.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.name}>{agent.name}</div>
                    <span
                      className={`${styles.badge} ${
                        agent.status === "published"
                          ? styles.badgePublished
                          : styles.badgeDraft
                      }`}
                      data-testid="agent-status"
                    >
                      {agent.status === "published" ? `已发布 v${agent.version}` : "草稿"}
                    </span>
                  </div>
                </div>
                <p className={styles.desc}>{agent.description || "无描述"}</p>
                <div className={styles.meta}>
                  {agent.model ? <span>{agent.model}</span> : <span>默认模型</span>}
                  <span>· {agent.tools.length} 工具</span>
                </div>
                <div
                  className={styles.cardActions}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Button
                    size="sm"
                    data-testid="agent-open"
                    onClick={() => openAgent(agent.agentId)}
                  >
                    打开
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="agent-try"
                    disabled={!canWrite}
                    onClick={() => openAgent(agent.agentId, "test")}
                  >
                    试运行
                  </Button>
                  <Button
                    size="sm"
                    data-testid="agent-publish"
                    disabled={!canWrite}
                    onClick={() => setPendingPublish(agent)}
                  >
                    发布
                  </Button>
                  <details className={styles.more} onClick={(event) => event.stopPropagation()}>
                    <summary aria-label="更多操作" data-testid="agent-more">⋯</summary>
                    <div className={styles.moreMenu}>
                      <button
                        type="button"
                        className={styles.moreDanger}
                        disabled={!canWrite}
                        onClick={() => setPendingDelete(agent)}
                      >
                        删除
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      <AgentEditDrawer
        agent={editing}
        open={editing !== null}
        initialSection={editingSection}
        onOpenChange={(open) => { if (!open) setEditingId(null); }}
        onNotice={setNotice}
        onError={setError}
      />

      <Dialog
        open={pendingPublish !== null}
        onOpenChange={(open) => { if (!open) setPendingPublish(null); }}
        title="发布新版本"
        description={pendingPublish ? `将把「${pendingPublish.name}」的当前草稿发布为不可变新版本。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingPublish(null)}>取消</Button>
            <Button
              data-testid="confirm-agent-publish"
              loading={publishAgent.isPending}
              onClick={() => void confirmPublish()}
            >
              确认发布
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          已发布版本不可修改；正在进行的会话继续使用其锁定的旧版本。
        </p>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="确认删除专家"
        description={pendingDelete ? `将删除「${pendingDelete.name}」及其草稿。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="confirm-agent-delete"
              loading={deleteAgent.isPending}
              onClick={() => void confirmDelete()}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          已发布的历史版本记录将一并删除；此操作不可撤销。
        </p>
      </Dialog>
    </PageShell>
  );
}
