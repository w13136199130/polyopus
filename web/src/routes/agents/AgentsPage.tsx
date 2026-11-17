/** Experts page: create drafts from templates, publish immutable versions. */

import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import type { AgentRow } from "@/lib/api/wire";
import {
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  usePublishAgent,
  useTestAgent,
  useUpdateAgent,
} from "@/features/agents/api";
import styles from "./AgentsPage.module.css";

type FormState = {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
};

const EMPTY: FormState = {
  name: "", description: "", model: "", systemPrompt: "",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function AgentsPage() {
  const query = useAgents();
  const canWrite = useCan("agent:write");
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const publishAgent = usePublishAgent();
  const deleteAgent = useDeleteAgent();
  const testAgent = useTestAgent();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState("你好，介绍一下你自己");

  const agents = query.data?.items ?? [];
  const templates = query.data?.templates ?? [];

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setForm({
      name: template.name,
      description: template.description,
      model: template.model,
      systemPrompt: template.systemPrompt,
    });
    setEditing(null);
  }

  function edit(row: AgentRow) {
    setEditing(row.agentId);
    setForm({
      name: row.name,
      description: row.description ?? "",
      model: row.draftModel || row.model || "",
      systemPrompt: row.draftSystemPrompt ?? row.systemPrompt,
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (editing) {
        await updateAgent.mutateAsync({
          agentId: editing,
          body: {
            name: form.name,
            description: form.description,
            model: form.model,
            systemPrompt: form.systemPrompt,
          },
        });
        setNotice(`已保存 ${form.name} 草稿`);
      } else {
        await createAgent.mutateAsync(form);
        setNotice(`已创建草稿 ${form.name}`);
      }
      setForm(EMPTY);
      setEditing(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function publish(row: AgentRow) {
    setError(null);
    try {
      const published = await publishAgent.mutateAsync(row.agentId);
      setNotice(`已发布 ${published.name} v${published.version}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function remove(row: AgentRow) {
    setError(null);
    try {
      await deleteAgent.mutateAsync(row.agentId);
      setNotice(`已删除 ${row.name}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function test(row: AgentRow) {
    setError(null);
    try {
      const turn = await testAgent.mutateAsync({
        agentId: row.agentId, message: testMessage,
      });
      setNotice(`测试对话已创建：${turn.threadId}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <PageShell title="专家" subtitle="草稿可改；发布后的版本不可变，旧会话继续锁定旧版本。">
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.head}><h2>专家</h2><span>{agents.length} 个</span></div>
          {query.isLoading ? <Loading label="载入专家…" /> : query.isError ? (
            <ErrorState message="专家加载失败" onRetry={() => void query.refetch()} />
          ) : agents.length === 0 ? <Empty title="暂无专家，从模板创建一个" /> : (
            <ul className={styles.rows}>
              {agents.map((row) => (
                <li key={row.agentId} className={styles.row} data-testid="agent-row">
                  <div className={styles.who}>
                    <strong>{row.name}</strong>
                    <span>{row.description || "无描述"}</span>
                    <span>
                      <span className={styles.badge} data-testid="agent-status">
                        {row.status}
                      </span>{" "}
                      v{row.version}{row.model ? ` · ${row.model}` : ""}
                    </span>
                  </div>
                  <div className={styles.actions}>
                    <Button size="sm" variant="ghost" disabled={!canWrite}
                      data-testid="agent-edit" onClick={() => edit(row)}>
                      编辑草稿
                    </Button>
                    <Button size="sm" disabled={!canWrite}
                      data-testid="agent-publish" onClick={() => void publish(row)}>
                      发布
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!canWrite}
                      onClick={() => void test(row)}>
                      测试
                    </Button>
                    <Button size="sm" variant="danger" disabled={!canWrite}
                      onClick={() => void remove(row)}>
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label>模板
              <select data-testid="agent-template" defaultValue=""
                onChange={(event) => applyTemplate(event.target.value)}>
                <option value="">（空白）</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <label>名称<input data-testid="agent-name" required value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>描述<input data-testid="agent-description" value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label>模型<input value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })} /></label>
            <label>系统提示词
              <textarea data-testid="agent-prompt" value={form.systemPrompt}
                onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} />
            </label>
            <Button type="submit" disabled={!canWrite} loading={createAgent.isPending}
              data-testid="agent-create">
              {editing ? "保存草稿" : "创建专家"}
            </Button>
            {editing ? (
              <Button type="button" variant="ghost"
                onClick={() => { setEditing(null); setForm(EMPTY); }}>
                取消编辑
              </Button>
            ) : null}
            <label>测试消息<input data-testid="agent-test-message" value={testMessage}
              onChange={(event) => setTestMessage(event.target.value)} /></label>
          </form>
        </section>
      </div>
    </PageShell>
  );
}
