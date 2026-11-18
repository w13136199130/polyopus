/**
 * Agent edit drawer (P1-4): sectioned editing over the real agent draft.
 * Files/skills/subagents/workspace/heartbeat/personality have no backend in
 * v1.0 — they render as disabled sections tagged v1.1, never fake inputs.
 */

import { useEffect, useState } from "react";
import { Button, Drawer } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import type { AgentRow, AgentToolBinding } from "@/lib/api/wire";
import {
  useTestAgent,
  useUpdateAgent,
} from "@/features/agents/api";
import { useAgentTools, useSetAgentTools } from "@/features/tools/api";
import styles from "./AgentsPage.module.css";

type Section =
  | "basic"
  | "model"
  | "prompt"
  | "tools"
  | "versions"
  | "test";

interface Props {
  agent: AgentRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export function AgentEditDrawer({
  agent, open, onOpenChange, onNotice, onError,
}: Props) {
  const canWrite = useCan("agent:write");
  const update = useUpdateAgent();
  const test = useTestAgent();
  const toolsQuery = useAgentTools(agent?.agentId ?? null);
  const saveTools = useSetAgentTools(agent?.agentId ?? "");

  const [section, setSection] = useState<Section>("basic");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [draftTools, setDraftTools] = useState<AgentToolBinding[]>([]);
  const [testMessage, setTestMessage] = useState("你好，介绍一下你自己");

  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setDescription(agent.description ?? "");
    setModel(agent.draftModel || agent.model || "");
    setPrompt(agent.draftSystemPrompt ?? agent.systemPrompt);
  }, [agent]);

  useEffect(() => {
    if (toolsQuery.data?.items) setDraftTools(toolsQuery.data.items);
  }, [toolsQuery.data]);

  if (!agent) return null;

  async function saveDraft() {
    if (!agent) return;
    try {
      await update.mutateAsync({
        agentId: agent.agentId,
        body: { name, description, model, systemPrompt: prompt },
      });
      onNotice(`已保存 ${name} 草稿`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function saveBindings() {
    try {
      await saveTools.mutateAsync(
        draftTools.map((item) => ({
          toolKey: item.toolKey, enabled: item.enabled,
        })),
      );
      onNotice("已保存工具设置");
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function runTest() {
    if (!agent) return;
    try {
      const turn = await test.mutateAsync({
        agentId: agent.agentId, message: testMessage,
      });
      onNotice(`测试对话已创建：${turn.threadId.slice(0, 14)}…`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "测试失败");
    }
  }

  const editable: Array<[Section, string]> = [
    ["basic", "基本信息"],
    ["model", "模型与运行"],
    ["prompt", "系统提示词"],
    ["tools", "工具"],
    ["versions", "版本"],
    ["test", "测试对话"],
  ];
  const planned: Array<[string, string]> = [
    ["skills", "技能"],
    ["subagents", "子智能体"],
    ["workspace", "工作区"],
    ["heartbeat", "心跳与主动"],
    ["personality", "人格与记忆"],
  ];

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={`编辑专家 · ${agent.name}`}
      description="草稿可改；发布生成不可变新版本，旧会话继续锁定旧版本。"
      width={720}
      footer={
        section === "tools" ? (
          <Button
            data-testid="agent-save-tools"
            disabled={!canWrite}
            loading={saveTools.isPending}
            onClick={() => void saveBindings()}
          >
            保存工具设置
          </Button>
        ) : section === "test" ? null : (
          <Button
            data-testid="agent-save-draft"
            disabled={!canWrite}
            loading={update.isPending}
            onClick={() => void saveDraft()}
          >
            保存草稿
          </Button>
        )
      }
    >
      <div className={styles.drawerLayout}>
        <nav className={styles.sectionNav} aria-label="编辑分区">
          {editable.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.sectionItem} ${section === key ? styles.sectionItemActive : ""}`}
              onClick={() => setSection(key)}
              data-testid={`agent-section-${key}`}
            >
              {label}
            </button>
          ))}
          <div style={{ height: 8 }} />
          {planned.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={styles.sectionItem}
              disabled
              title="该分区将在 v1.1 提供"
            >
              {label}
              <span className={styles.tag}>v1.1</span>
            </button>
          ))}
        </nav>

        <div className={styles.sectionBody}>
          {section === "basic" ? (
            <>
              <label className={styles.field}>
                名称
                <input
                  data-testid="agent-drawer-name"
                  value={name}
                  disabled={!canWrite}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                描述
                <textarea
                  data-testid="agent-drawer-desc"
                  value={description}
                  disabled={!canWrite}
                  rows={3}
                  style={{ minHeight: 80 }}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </>
          ) : null}

          {section === "model" ? (
            <label className={styles.field}>
              模型（留空使用实例默认模型）
              <input
                data-testid="agent-drawer-model"
                value={model}
                disabled={!canWrite}
                placeholder="例如 deepseek-flash"
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
          ) : null}

          {section === "prompt" ? (
            <label className={styles.field}>
              系统提示词（保存进草稿，发布后生效）
              <textarea
                data-testid="agent-drawer-prompt"
                value={prompt}
                disabled={!canWrite}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
          ) : null}

          {section === "tools" ? (
            toolsQuery.isLoading ? (
              <p style={{ color: "var(--text-3)", fontSize: 12 }}>载入工具…</p>
            ) : (
              draftTools.map((item) => (
                <div key={item.toolKey} className={styles.toolRow}>
                  <span>{item.toolKey}</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      data-testid="agent-tool-toggle"
                      checked={item.enabled}
                      disabled={!canWrite}
                      onChange={(event) =>
                        setDraftTools((rows) =>
                          rows.map((row) =>
                            row.toolKey === item.toolKey
                              ? { ...row, enabled: event.target.checked }
                              : row,
                          ),
                        )}
                    />
                    启用
                  </label>
                </div>
              ))
            )
          ) : null}

          {section === "versions" ? (
            <>
              <p className={styles.versionNote}>
                当前已发布版本：<b>v{agent.version}</b>
                {agent.version === 0 ? "（尚未发布）" : ""}
                <br />
                已发布版本不可变；新会话创建时锁定当时的最新版本，
                之后发布新版本不会影响已有会话（`agentVersionId` 不漂移）。
              </p>
            </>
          ) : null}

          {section === "test" ? (
            <>
              <p style={{ color: "var(--text-3)", fontSize: 12, margin: 0 }}>
                用草稿配置创建一个测试会话，在对话页查看效果。
              </p>
              <div className={styles.testRow}>
                <input
                  data-testid="agent-drawer-test-message"
                  value={testMessage}
                  disabled={!canWrite}
                  onChange={(event) => setTestMessage(event.target.value)}
                />
                <Button
                  data-testid="agent-drawer-test-run"
                  disabled={!canWrite || !testMessage.trim()}
                  loading={test.isPending}
                  onClick={() => void runTest()}
                >
                  发起测试
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
