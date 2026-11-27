/**
 * Agent edit drawer (P1-4): sectioned editing over the real agent draft.
 * Files/skills/workspace/heartbeat/personality remain v1.1 placeholders;
 * subagents are real v1.1 defaults used when a new conversation starts.
 */

import { useEffect, useState } from "react";
import { Button, Dialog, Drawer } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import type { AgentRow, AgentToolBinding } from "@/lib/api/wire";
import {
  useAgentFiles,
  useAgentSubagents,
  useAgents,
  useAgentVersion,
  useAgentVersions,
  useDeleteAgentFile,
  useRollbackAgent,
  useSaveAgentFile,
  useSetAgentSubagents,
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
  | "files"
  | "subagents"
  | "versions"
  | "test";

interface Props {
  agent: AgentRow | null;
  open: boolean;
  /** Card "试运行" opens directly on the test section. */
  initialSection?: "basic" | "test";
  onOpenChange: (open: boolean) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export function AgentEditDrawer({
  agent, open, initialSection, onOpenChange, onNotice, onError,
}: Props) {
  const canWrite = useCan("agent:write");
  const update = useUpdateAgent();
  const test = useTestAgent();
  const toolsQuery = useAgentTools(agent?.agentId ?? null);
  const saveTools = useSetAgentTools(agent?.agentId ?? "");
  const agentsQuery = useAgents();
  const subagentsQuery = useAgentSubagents(agent?.agentId ?? null);
  const saveSubagents = useSetAgentSubagents(agent?.agentId ?? "");
  const filesQuery = useAgentFiles(agent?.agentId ?? null);
  const saveFile = useSaveAgentFile(agent?.agentId ?? "");
  const deleteFile = useDeleteAgentFile(agent?.agentId ?? "");
  const versionsQuery = useAgentVersions(agent?.agentId ?? null);
  const rollback = useRollbackAgent(agent?.agentId ?? "");

  const [section, setSection] = useState<Section>("basic");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [draftTools, setDraftTools] = useState<AgentToolBinding[]>([]);
  const [draftSubagents, setDraftSubagents] = useState<string[]>([]);
  const [testMessage, setTestMessage] = useState("你好，介绍一下你自己");
  const [baseline, setBaseline] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileDraft, setFileDraft] = useState("");
  const [fileBaseline, setFileBaseline] = useState("");
  const [newFile, setNewFile] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [pendingRollback, setPendingRollback] = useState<number | null>(null);
  const versionQuery = useAgentVersion(agent?.agentId ?? null, selectedVersion);

  useEffect(() => {
    if (!agent) return;
    const next = {
      name: agent.name,
      description: agent.description ?? "",
      model: agent.draftModel || agent.model || "",
      prompt: agent.draftSystemPrompt ?? agent.systemPrompt,
    };
    setName(next.name);
    setDescription(next.description);
    setModel(next.model);
    setPrompt(next.prompt);
    setBaseline(JSON.stringify(next));
  }, [agent]);

  useEffect(() => {
    if (open) setSection(initialSection ?? "basic");
    setActiveFile(null);
    setFileDraft("");
    setFileBaseline("");
    setSelectedVersion(null);
    setPendingRollback(null);
  }, [open, initialSection, agent?.agentId]);

  useEffect(() => {
    const items = filesQuery.data?.items ?? [];
    if (activeFile === null && items.length > 0) {
      setActiveFile(items[0].name);
      setFileDraft(items[0].content);
      setFileBaseline(items[0].content);
      return;
    }
    const current = items.find((item) => item.name === activeFile);
    // Refresh the editor after an external change (rollback, another tab) when
    // there are no unsaved edits.
    if (current && fileDraft === fileBaseline && current.content !== fileBaseline) {
      setFileDraft(current.content);
      setFileBaseline(current.content);
    }
  }, [filesQuery.data, activeFile, fileDraft, fileBaseline]);

  const draft = JSON.stringify({ name, description, model, prompt });
  const savedSubagents = (subagentsQuery.data?.items ?? [])
    .map((item) => item.agentId).sort().join("|");
  const draftSubagentsKey = [...draftSubagents].sort().join("|");
  const subagentsDirty = subagentsQuery.data !== undefined
    && savedSubagents !== draftSubagentsKey;
  const fileDirty = activeFile !== null && fileDraft !== fileBaseline;
  const dirty = (baseline !== "" && draft !== baseline) || subagentsDirty || fileDirty;

  function handleOpenChange(next: boolean) {
    if (!next && dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (toolsQuery.data?.items) setDraftTools(toolsQuery.data.items);
  }, [toolsQuery.data]);

  useEffect(() => {
    if (subagentsQuery.data?.items) {
      setDraftSubagents(subagentsQuery.data.items.map((item) => item.agentId));
    }
  }, [subagentsQuery.data]);

  if (!agent) return null;

  async function saveDraft() {
    if (!agent) return;
    try {
      await update.mutateAsync({
        agentId: agent.agentId,
        body: { name, description, model, systemPrompt: prompt },
      });
      setBaseline(JSON.stringify({ name, description, model, prompt }));
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

  async function saveSubagentBindings() {
    try {
      await saveSubagents.mutateAsync(draftSubagents);
      onNotice("已保存子智能体默认配置");
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存失败");
    }
  }

  function selectFile(name: string, content: string) {
    setActiveFile(name);
    setFileDraft(content);
    setFileBaseline(content);
  }

  async function saveFileNow() {
    if (!activeFile) return;
    try {
      const saved = await saveFile.mutateAsync({ name: activeFile, content: fileDraft });
      setFileBaseline(saved.content);
      setFileDraft(saved.content);
      onNotice(`已保存 ${activeFile}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存文件失败");
    }
  }

  async function removeActiveFile() {
    if (!activeFile) return;
    try {
      await deleteFile.mutateAsync(activeFile);
      setActiveFile(null);
      setFileDraft("");
      setFileBaseline("");
      onNotice(`已删除 ${activeFile}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "删除文件失败");
    }
  }

  async function confirmRollback() {
    if (pendingRollback === null) return;
    try {
      await rollback.mutateAsync(pendingRollback);
      onNotice(`已回滚到 v${pendingRollback}（草稿），发布后生效`);
      setPendingRollback(null);
      setSelectedVersion(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "回滚失败");
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
    ["files", "配置文件"],
    ["subagents", "子智能体"],
    ["versions", "版本"],
    ["test", "测试对话"],
  ];
  const planned: Array<[string, string]> = [
    ["skills", "技能"],
    ["workspace", "工作区"],
    ["heartbeat", "心跳与主动"],
    ["personality", "人格与记忆"],
  ];

  return (
    <>
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
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
        ) : section === "files" ? (
          <Button
            data-testid="agent-save-file"
            disabled={!canWrite || !activeFile}
            loading={saveFile.isPending}
            onClick={() => void saveFileNow()}
          >
            保存文件
          </Button>
        ) : section === "subagents" ? (
          <Button
            data-testid="agent-save-subagents"
            disabled={!canWrite}
            loading={saveSubagents.isPending}
            onClick={() => void saveSubagentBindings()}
          >
            保存子智能体
          </Button>
        ) : section === "versions" || section === "test" ? null : (
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
          {dirty ? (
            <div className={styles.dirtyBar} data-testid="agent-dirty">
              未保存的修改 · 关闭前会确认
            </div>
          ) : null}
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

          {section === "files" ? (
            filesQuery.isLoading ? (
              <p style={{ color: "var(--text-3)", fontSize: 12 }}>载入配置文件…</p>
            ) : filesQuery.isError ? (
              <p style={{ color: "var(--red)", fontSize: 12 }}>配置文件加载失败</p>
            ) : (
              <div className={styles.filePane}>
                <div className={styles.fileList}>
                  {(filesQuery.data?.items ?? []).map((file) => (
                    <button
                      key={file.name}
                      type="button"
                      className={`${styles.fileItem} ${
                        activeFile === file.name ? styles.fileActive : ""
                      }`}
                      data-testid="agent-file-row"
                      onClick={() => selectFile(file.name, file.content)}
                    >
                      {file.name}
                    </button>
                  ))}
                  {(filesQuery.data?.items ?? []).length === 0 ? (
                    <span className={styles.muted}>还没有配置文件</span>
                  ) : null}
                  <form
                    className={styles.fileNew}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = newFile.trim();
                      if (!name) return;
                      selectFile(name, "");
                      setNewFile("");
                    }}
                  >
                    <input
                      data-testid="agent-file-new-name"
                      value={newFile}
                      maxLength={100}
                      placeholder="新文件名，如 USER.md"
                      onChange={(event) => setNewFile(event.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      type="submit"
                      data-testid="agent-file-create"
                      disabled={!newFile.trim()}
                    >
                      新建
                    </Button>
                  </form>
                </div>
                <div className={styles.fileEditor}>
                  {activeFile ? (
                    <>
                      <div className={styles.fileHeader}>
                        <b>{activeFile}</b>
                        <span className={styles.spacer} />
                        <Button
                          size="sm"
                          variant="ghost"
                          className={styles.danger}
                          data-testid="agent-file-delete"
                          disabled={!canWrite}
                          onClick={() => void removeActiveFile()}
                        >
                          删除
                        </Button>
                      </div>
                      <textarea
                        className={styles.fileTextarea}
                        data-testid="agent-file-content"
                        value={fileDraft}
                        disabled={!canWrite}
                        onChange={(event) => setFileDraft(event.target.value)}
                      />
                    </>
                  ) : (
                    <p className={styles.muted}>选择左侧文件，或新建一个配置文件。</p>
                  )}
                </div>
              </div>
            )
          ) : null}

          {section === "subagents" ? (
            subagentsQuery.isLoading ? (
              <p style={{ color: "var(--text-3)", fontSize: 12 }}>载入子智能体…</p>
            ) : (
              <>
                <p className={styles.versionNote}>
                  新会话默认带上这些子智能体；对话里仍可临时增删。
                  只能选择已发布的其他专家，最多 8 个。
                </p>
                {(() => {
                  const selected = subagentsQuery.data?.items ?? [];
                  const candidates = (agentsQuery.data?.items ?? [])
                    .filter((item) => item.status === "published"
                      && item.agentId !== agent.agentId
                      && !selected.some((row) => row.agentId === item.agentId));
                  const options = [...selected, ...candidates];
                  if (!options.length) {
                    return <p className={styles.muted}>还没有其他已发布专家。</p>;
                  }
                  return options.map((item) => (
                    <label
                      key={item.agentId}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "7px 0", fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        data-testid="agent-subagent-option"
                        checked={draftSubagents.includes(item.agentId)}
                        disabled={!canWrite}
                        onChange={(event) => {
                          setDraftSubagents((current) =>
                            event.target.checked
                              ? [...current, item.agentId]
                              : current.filter((id) => id !== item.agentId));
                        }}
                      />
                      <span style={{ flex: 1 }}>{item.name}</span>
                      <span style={{ color: "var(--text-4)", fontSize: 11 }}>
                        {item.status !== "published"
                          ? `${item.status} · 保存时会被拒绝`
                          : item.model || "默认模型"}
                      </span>
                    </label>
                  ));
                })()}
              </>
            )
          ) : null}

          {section === "versions" ? (
            <>
              <p className={styles.versionNote}>
                当前已发布版本：<b>v{agent.version}</b>
                {agent.version === 0 ? "（尚未发布）" : ""}
                <br />
                已发布版本不可变；回滚只更新草稿，发布后才影响新会话。
              </p>
              {versionsQuery.isLoading ? (
                <p className={styles.muted}>载入版本…</p>
              ) : versionsQuery.isError ? (
                <p className={styles.muted}>版本加载失败</p>
              ) : (versionsQuery.data?.items ?? []).length === 0 ? (
                <p className={styles.muted}>还没有已发布版本。</p>
              ) : (
                <div className={styles.versionList}>
                  {(versionsQuery.data?.items ?? []).map((item) => (
                    <button
                      key={item.version}
                      type="button"
                      className={`${styles.versionRow} ${
                        selectedVersion === item.version ? styles.versionActive : ""
                      }`}
                      data-testid="agent-version-row"
                      onClick={() => setSelectedVersion(item.version)}
                    >
                      <b>v{item.version}</b>
                      {item.isCurrent ? <span className={styles.tag}>当前</span> : null}
                      <span className={styles.versionMeta}>
                        {new Date(item.publishedAt * 1000).toLocaleString("zh-CN")}
                        {item.publishedBy ? ` · ${item.publishedBy}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {selectedVersion !== null ? (
                versionQuery.isLoading ? (
                  <p className={styles.muted}>载入版本快照…</p>
                ) : versionQuery.data ? (
                  <div className={styles.versionNote}>
                    <b>v{versionQuery.data.version} 快照</b>
                    <br />
                    提示词：{String(versionQuery.data.config?.systemPrompt ?? "（空）").slice(0, 160)}
                    <br />
                    配置文件：{Object.keys(versionQuery.data.files ?? {}).join("、") || "无"}
                    <br />
                    发布人：{versionQuery.data.publishedBy ?? "—"}
                    <div className={styles.versionActions}>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="agent-rollback"
                        disabled={!canWrite || versionQuery.data.isCurrent}
                        onClick={() => setPendingRollback(versionQuery.data?.version ?? null)}
                      >
                        回滚到此版本（草稿）
                      </Button>
                    </div>
                  </div>
                ) : null
              ) : null}
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

      <Dialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="放弃未保存的修改？"
        description="当前草稿的修改尚未保存；关闭抽屉会丢失这些修改。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
              继续编辑
            </Button>
            <Button
              variant="danger"
              data-testid="agent-discard"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              放弃修改
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          已保存的版本不受影响；只丢弃当前未保存的草稿。
        </p>
      </Dialog>

      <Dialog
        open={pendingRollback !== null}
        onOpenChange={(open) => { if (!open) setPendingRollback(null); }}
        title="回滚版本"
        description={pendingRollback !== null
          ? `将 v${pendingRollback} 的提示词与配置文件恢复到草稿。`
          : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRollback(null)}>取消</Button>
            <Button
              data-testid="agent-rollback-confirm"
              loading={rollback.isPending}
              onClick={() => void confirmRollback()}
            >
              回滚到草稿
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          已发布版本不会被修改；回滚后需要再次发布，才会影响新会话。
        </p>
      </Dialog>
    </>
  );
}
