import { useEffect, useState } from "react";
import { Button, Drawer } from "@/components/ui";
import { useCreateAgent } from "@/features/agents/api";
import type { AgentTemplate } from "@/lib/api/wire";
import styles from "./AgentsPage.module.css";

export interface AgentCreateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly AgentTemplate[];
  canWrite: boolean;
  onCreated: (name: string) => void;
}

/** 新建专家 drawer: template + name; created agents start as drafts. */
export function AgentCreateDrawer({
  open,
  onOpenChange,
  templates,
  canWrite,
  onCreated,
}: AgentCreateDrawerProps) {
  const createAgent = useCreateAgent();
  const [template, setTemplate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTemplate("");
    setName("");
    setError(null);
  }, [open]);

  function applyTemplate(id: string) {
    setTemplate(id);
    const found = templates.find((item) => item.id === id);
    if (found) setName(found.name);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const selected = templates.find((item) => item.id === template);
      const created = await createAgent.mutateAsync({
        name: name.trim(),
        description: selected?.description,
        model: selected?.model,
        systemPrompt: selected?.systemPrompt,
      });
      onCreated(created.name);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="新建专家"
      description="创建后为草稿，发布前不会进入对话选择器。"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type="submit"
            form="agent-create-form"
            data-testid="agent-create"
            loading={createAgent.isPending}
            disabled={!canWrite || !name.trim()}
          >
            创建专家
          </Button>
        </>
      }
    >
      <form id="agent-create-form" className={styles.form} onSubmit={(event) => void submit(event)}>
        {error ? <div className={styles.error}>{error}</div> : null}
        <label className={styles.field}>
          <span>模板</span>
          <select
            data-testid="agent-template"
            value={template}
            onChange={(event) => applyTemplate(event.target.value)}
          >
            <option value="">（空白）</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>名称 *</span>
          <input
            data-testid="agent-name"
            required
            maxLength={100}
            autoFocus
            placeholder="例如：发布检查员"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </form>
    </Drawer>
  );
}
