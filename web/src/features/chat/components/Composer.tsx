import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type {
  AgentRow,
  ConnectorInstanceRow,
  KnowledgeBaseRow,
  ModelRow,
  WorkspaceEntry,
} from "@/lib/api/wire";
import styles from "./Composer.module.css";

type MenuKey =
  | "plus"
  | "model"
  | "mode"
  | "kb"
  | "connector"
  | "subagent"
  | "approval"
  | "mention"
  | "slash"
  | null;

interface Attachment {
  name: string;
  content: string;
}

export interface ComposerProps {
  disabled: boolean;
  status: string;
  restoredInput: string | null;
  onConsumedRestore: () => void;
  onSend: (content: string) => void;
  modelLabel: string;
  models: ModelRow[];
  modelValue: string;
  onModelChange: (model: string) => void;
  kbs: KnowledgeBaseRow[];
  kbIds: string[];
  onToggleKb: (kbId: string) => void;
  connectors: ConnectorInstanceRow[];
  connectorIds: string[];
  onToggleConnector: (instanceId: string) => void;
  subagents: AgentRow[];
  subagentIds: string[];
  onToggleSubagent: (agentId: string) => void;
  approvalPolicy: "ask" | "auto";
  onApprovalPolicyChange: (policy: "ask" | "auto") => void;
  mode: "act" | "ask" | "plan";
  onModeChange: (mode: "act" | "ask" | "plan") => void;
  /** Workspace files offered by the @ menu (first entries are enough). */
  mentionFiles?: WorkspaceEntry[];
  onNewThread: () => void;
  onExport: () => void;
  onNotice?: (message: string) => void;
  /** A turn is streaming: the send button becomes Stop, Enter queues. */
  streaming?: boolean;
  onStop?: () => void;
  queued?: string[];
  onQueue?: (content: string) => void;
  onRemoveQueued?: (index: number) => void;
}

const MAX_HEIGHT = 180;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 200_000;

const COMMANDS = [
  { name: "new", hint: "新建一个会话" },
  { name: "plan", hint: "先给出执行计划，再动手" },
  { name: "export", hint: "导出当前对话为 Markdown" },
  { name: "help", hint: "查看可用命令" },
];

function flattenFiles(
  items: WorkspaceEntry[], out: WorkspaceEntry[] = [],
): WorkspaceEntry[] {
  for (const item of items) {
    if (out.length >= 40) break;
    if (item.type === "file") out.push(item);
    else if (item.children?.length) flattenFiles(item.children, out);
  }
  return out;
}

/**
 * Prototype composer: card with chips row, attachment queue, toolbar menus
 * (mode/model/KB/connector/sub-agent/approval), `@` and `/` menus.
 *
 * Attachments are read in the browser and appended to the turn text — the
 * backend has no upload endpoint in v1.0, so this is honest text context,
 * not a fake file card.
 */
export function Composer({
  disabled, status, restoredInput, onConsumedRestore, onSend,
  modelLabel, models, modelValue, onModelChange,
  kbs, kbIds, onToggleKb,
  connectors, connectorIds, onToggleConnector,
  subagents, subagentIds, onToggleSubagent,
  approvalPolicy, onApprovalPolicyChange,
  mode, onModeChange,
  mentionFiles = [], onNewThread, onExport, onNotice, streaming = false, onStop,
  queued = [], onQueue, onRemoveQueued,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState<MenuKey>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // rollback restore lands in the box after mount (input is never swallowed)
  useEffect(() => {
    if (restoredInput === null) return;
    setValue((current) => (current === "" ? restoredInput : current));
    onConsumedRestore();
  }, [restoredInput, onConsumedRestore]);

  // autogrow: 2 rows minimum, capped so long drafts scroll instead of pushing
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  // close menus on outside click / Escape
  useEffect(() => {
    if (!menu) return;
    function onDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setMenu(null);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function insert(text: string) {
    const node = ref.current;
    if (!node) {
      setValue((current) => current + text);
      return;
    }
    const start = node.selectionStart ?? value.length;
    const end = node.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      node.focus();
      const caret = start + text.length;
      node.setSelectionRange(caret, caret);
    });
  }

  function submit() {
    const text = value.trim();
    if ((!text && attachments.length === 0) || disabled) return;
    let content = text;
    for (const file of attachments) {
      content += `\n\n--- 附件：${file.name} ---\n${file.content}`;
    }
    setValue("");
    setAttachments([]);
    setMenu(null);
    if (streaming && onQueue) {
      onQueue(content.trim());
    } else {
      onSend(content.trim());
    }
    ref.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      setMenu(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    setValue(next);
    // prototype: typing `/` or `@` at the end opens the respective menu
    if (next === "/") setMenu("slash");
    else if (next.endsWith("@")) setMenu("mention");
    else if (menu === "slash" || menu === "mention") setMenu(null);
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const picked = Array.from(files).slice(0, MAX_FILES);
    const problems: string[] = [];
    const loaded = await Promise.all(
      picked.map(async (file) => {
        if (file.size > MAX_FILE_BYTES) {
          problems.push(`${file.name} 超过 200KB，未加入`);
          return null;
        }
        try {
          const content = await file.text();
          if (content.includes("\u0000")) {
            problems.push(`${file.name} 不是文本文件，未加入`);
            return null;
          }
          return { name: file.name, content };
        } catch {
          problems.push(`${file.name} 读取失败`);
          return null;
        }
      }),
    );
    const good = loaded.filter((item): item is Attachment => item !== null);
    if (good.length) setAttachments((current) => [...current, ...good]);
    setFileError(problems.length ? problems.join("；") : null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function runCommand(name: string) {
    setMenu(null);
    if (name === "new") {
      onNewThread();
      return;
    }
    if (name === "export") {
      onExport();
      return;
    }
    if (name === "plan") {
      onModeChange("plan");
      onNotice?.("已切换到 Plan 模式：先出计划，不执行工具。");
      return;
    }
    onNotice?.(
      "可用命令：/new 新建、/plan 先出计划、/export 导出；输入 @ 可引用专家、知识库或文件。",
    );
  }

  const files = flattenFiles(mentionFiles);
  const modelText = modelValue || modelLabel || "默认模型";
  const busy = disabled;

  return (
    <div className={styles.wrap} ref={root}>
      {queued.length ? (
        <div className={styles.queueRow} data-testid="composer-queue">
          <span className={styles.queueLabel}>队列 {queued.length}</span>
          {queued.map((item, index) => (
            <span key={`${item}-${index}`} className={styles.queueChip}>
              {item.length > 32 ? `${item.slice(0, 32)}…` : item}
              <button
                type="button"
                aria-label={`撤回队列消息 ${index + 1}`}
                onClick={() => onRemoveQueued?.(index)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachments.length ? (
        <div className={styles.attachRow}>
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} className={styles.attachChip}>
              <span aria-hidden="true">▤</span> {file.name}
              <button
                type="button"
                aria-label={`移除附件 ${file.name}`}
                onClick={() =>
                  setAttachments((current) => current.filter((_, i) => i !== index))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {fileError ? <p className={styles.fileError}>{fileError}</p> : null}

      <div className={styles.composer}>
        {menu ? (
          <div className={styles.popover} role="dialog" aria-label="输入选项">
            {menu === "plus" ? (
              <div className={styles.plusGrid}>
                {[
                  ["附件", "＋", () => fileInput.current?.click()],
                  ["知识库", "◇", () => setMenu("kb")],
                  ["连接器", "⇄", () => setMenu("connector")],
                  ["子智能体", "◈", () => setMenu("subagent")],
                  ["模型", "✦", () => setMenu("model")],
                ].map(([label, icon, action]) => (
                  <button
                    key={label as string}
                    type="button"
                    className={styles.plusItem}
                    onClick={() => {
                      (action as () => void)();
                    }}
                  >
                    <span aria-hidden="true">{icon as string}</span>
                    {label as string}
                  </button>
                ))}
              </div>
            ) : null}

            {menu === "mode" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>运行模式（本会话）</div>
                {([
                  ["act", "Act", "直接执行；写操作仍按策略审批"],
                  ["ask", "Ask", "先澄清问题，不执行工具"],
                  ["plan", "Plan", "只输出计划，不执行工具"],
                ] as const).map(([key, label, hint]) => (
                  <button
                    key={key}
                    type="button"
                    className={`${styles.menuItem} ${mode === key ? styles.menuItemOn : ""}`}
                    data-testid={`composer-mode-${key}`}
                    onClick={() => {
                      onModeChange(key);
                      setMenu(null);
                    }}
                  >
                    <span>{label}</span>
                    <span className={styles.menuMeta}>{hint}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {menu === "model" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>选择模型（本会话）</div>
                {models.length === 0 ? (
                  <p className={styles.menuEmpty}>
                    还没有可用模型，当前使用 FakeModel 演示；请在「管理 → 模型配置」接入提供商。
                  </p>
                ) : (
                  models.map((model) => (
                    <button
                      key={model.modelId}
                      type="button"
                      className={`${styles.menuItem} ${modelValue === model.name ? styles.menuItemOn : ""}`}
                      onClick={() => {
                        onModelChange(model.name);
                        setMenu(null);
                      }}
                    >
                      <span>{model.name}</span>
                      <span className={styles.menuMeta}>{model.provider}</span>
                    </button>
                  ))
                )}
                {modelValue ? (
                  <button
                    type="button"
                    className={styles.menuClear}
                    onClick={() => {
                      onModelChange("");
                      setMenu(null);
                    }}
                  >
                    恢复默认模型
                  </button>
                ) : null}
              </div>
            ) : null}

            {menu === "kb" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>知识库（可多选）</div>
                {kbs.length === 0 ? (
                  <p className={styles.menuEmpty}>
                    还没有知识库。到「知识」页创建并上传文档后即可在这里启用。
                  </p>
                ) : (
                  kbs.map((kb) => (
                    <label key={kb.kbId} className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={kbIds.includes(kb.kbId)}
                        onChange={() => onToggleKb(kb.kbId)}
                      />
                      <span className={styles.checkName}>{kb.name}</span>
                      <span className={styles.menuMeta}>{kb.docCount} 文档</span>
                    </label>
                  ))
                )}
                {kbIds.length ? (
                  <button
                    type="button"
                    className={styles.menuClear}
                    onClick={() => kbIds.forEach((id) => onToggleKb(id))}
                  >
                    全部关闭
                  </button>
                ) : null}
                <p className={styles.menuHint}>
                  启用的库会在每轮对话前检索，并把命中的片段作为依据交给模型。
                </p>
              </div>
            ) : null}

            {menu === "connector" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>连接器（可多选）</div>
                {connectors.length === 0 ? (
                  <p className={styles.menuEmpty}>
                    还没有连接器实例。到「连接」页添加 MCP 或内置连接器。
                  </p>
                ) : (
                  connectors.map((connector) => (
                    <label key={connector.instanceId} className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={connectorIds.includes(connector.instanceId)}
                        onChange={() => onToggleConnector(connector.instanceId)}
                      />
                      <span className={styles.checkName}>{connector.displayName}</span>
                      <span className={styles.menuMeta}>
                        {connector.status === "authorized" || connector.configured
                          ? "已连接"
                          : "待配置"}
                      </span>
                    </label>
                  ))
                )}
                <p className={styles.menuHint}>
                  选择会记录在本会话；连接器工具的执行委派在 v1.1 接入。
                </p>
              </div>
            ) : null}

            {menu === "subagent" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>子智能体（可多选）</div>
                {subagents.length === 0 ? (
                  <p className={styles.menuEmpty}>
                    还没有已发布的专家。到「专家」页创建并发布后即可作为子智能体。
                  </p>
                ) : (
                  subagents.map((agent) => (
                    <label key={agent.agentId} className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={subagentIds.includes(agent.agentId)}
                        onChange={() => onToggleSubagent(agent.agentId)}
                      />
                      <span className={styles.checkName}>{agent.name}</span>
                      <span className={styles.menuMeta}>
                        {agent.model || "默认模型"}
                      </span>
                    </label>
                  ))
                )}
                <p className={styles.menuHint}>
                  编排与委派能力随 v1.1 子智能体运行时开放；当前记录选择便于复用。
                </p>
              </div>
            ) : null}

            {menu === "approval" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>工具审批策略（本会话）</div>
                <button
                  type="button"
                  className={`${styles.menuItem} ${approvalPolicy === "ask" ? styles.menuItemOn : ""}`}
                  onClick={() => {
                    onApprovalPolicyChange("ask");
                    setMenu(null);
                  }}
                >
                  <span>每次询问</span>
                  <span className={styles.menuMeta}>写操作弹审批卡</span>
                </button>
                <button
                  type="button"
                  className={`${styles.menuItem} ${approvalPolicy === "auto" ? styles.menuItemOn : ""}`}
                  onClick={() => {
                    onApprovalPolicyChange("auto");
                    setMenu(null);
                  }}
                >
                  <span>本会话全允许</span>
                  <span className={styles.menuMeta}>仅升级 ask，deny 仍生效</span>
                </button>
                <p className={styles.menuHint}>
                  全允许不会绕过策略拒绝（critical、未授权插件、禁用工具）。
                </p>
              </div>
            ) : null}

            {menu === "slash" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>命令</div>
                {COMMANDS.map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    className={styles.menuItem}
                    onClick={() => runCommand(command.name)}
                  >
                    <span>/{command.name}</span>
                    <span className={styles.menuMeta}>{command.hint}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {menu === "mention" ? (
              <div className={styles.menuList}>
                <div className={styles.menuTitle}>引用</div>
                {subagents.length ? (
                  <div className={styles.menuSection}>专家</div>
                ) : null}
                {subagents.map((agent) => (
                  <button
                    key={agent.agentId}
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      insert(`@${agent.name} `);
                      setMenu(null);
                    }}
                  >
                    <span>◈ {agent.name}</span>
                    <span className={styles.menuMeta}>子智能体</span>
                  </button>
                ))}
                {kbs.length ? <div className={styles.menuSection}>知识库</div> : null}
                {kbs.map((kb) => (
                  <button
                    key={kb.kbId}
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      insert(`@${kb.name} `);
                      setMenu(null);
                    }}
                  >
                    <span>◇ {kb.name}</span>
                    <span className={styles.menuMeta}>{kb.docCount} 文档</span>
                  </button>
                ))}
                {files.length ? (
                  <div className={styles.menuSection}>工作区文件</div>
                ) : null}
                {files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      insert(`@${file.path} `);
                      setMenu(null);
                    }}
                  >
                    <span>▤ {file.name}</span>
                    <span className={styles.menuMeta}>{file.path}</span>
                  </button>
                ))}
                {!subagents.length && !kbs.length && !files.length ? (
                  <p className={styles.menuEmpty}>
                    暂无可引用项：发布专家、创建知识库或往工作区放文件后再试。
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <textarea
          ref={ref}
          className={styles.input}
          rows={2}
          placeholder={streaming ? "回复生成中；Enter 加入队列…" : "回复，或输入 / 命令、@ 文件…"}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          aria-label="消息输入框"
          disabled={disabled && status !== "waiting_approval"}
        />

        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.iconBtn}
            title="添加：附件、知识库、连接器、子智能体、模型"
            aria-label="添加上下文"
            data-testid="composer-plus"
            onClick={() => setMenu(menu === "plus" ? null : "plus")}
          >
            ＋
          </button>
          <button
            type="button"
            className={`${styles.chip} ${mode === "act" ? styles.chipOn : ""}`}
            title="运行模式"
            data-testid="composer-mode"
            onClick={() => setMenu(menu === "mode" ? null : "mode")}
          >
            {mode === "ask" ? "? Ask" : mode === "plan" ? "◇ Plan" : "✦ Act"}
          </button>
          <button
            type="button"
            className={styles.chip}
            data-testid="composer-model"
            onClick={() => setMenu(menu === "model" ? null : "model")}
            title="选择本会话模型"
          >
            {modelText} <span className={styles.chev}>⌄</span>
          </button>
          <button
            type="button"
            className={styles.chip}
            data-testid="composer-kb"
            onClick={() => setMenu(menu === "kb" ? null : "kb")}
            title="选择知识库"
          >
            知识库 · {kbIds.length || "关"}
          </button>
          <button
            type="button"
            className={styles.chip}
            data-testid="composer-connectors"
            onClick={() => setMenu(menu === "connector" ? null : "connector")}
            title="选择连接器"
          >
            连接器 · {connectorIds.length}
          </button>
          <button
            type="button"
            className={styles.chip}
            data-testid="composer-subagents"
            onClick={() => setMenu(menu === "subagent" ? null : "subagent")}
            title="选择子智能体"
          >
            子智能体 · {subagentIds.length}
          </button>
          <button
            type="button"
            className={styles.chip}
            data-testid="composer-approval"
            onClick={() => setMenu(menu === "approval" ? null : "approval")}
            title="工具审批策略"
          >
            审批 · {approvalPolicy === "auto" ? "全允许" : "每次"}
          </button>

          <div className={styles.right}>
            <button
              type="button"
              className={styles.iconBtn}
              title="添加附件（文本类，≤200KB）"
              aria-label="添加附件"
              data-testid="composer-attach"
              onClick={() => fileInput.current?.click()}
            >
              📎
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title="提及专家、知识库或文件"
              aria-label="提及"
              onClick={() => {
                setMenu(menu === "mention" ? null : "mention");
                if (value.endsWith("@")) setValue(value.slice(0, -1));
              }}
            >
              @
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title="命令"
              aria-label="命令"
              onClick={() => setMenu(menu === "slash" ? null : "slash")}
            >
              /
            </button>
            <span
              className={styles.ring}
              title="上下文用量统计随 v1.1 开放"
              aria-hidden="true"
            >
              —
            </span>
            {streaming ? (
              <button
                type="button"
                className={`${styles.send} ${styles.stop}`}
                onClick={onStop}
                aria-label="停止生成"
                data-testid="composer-stop"
                title="停止生成"
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                className={styles.send}
                onClick={submit}
                disabled={busy || (!value.trim() && attachments.length === 0)}
                aria-label="发送"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".md,.markdown,.txt,.csv,.json,.log,.ts,.tsx,.js,.py,.sql,.yaml,.yml"
        data-testid="composer-file"
        onChange={(event) => void addFiles(event.target.files)}
      />
    </div>
  );
}
