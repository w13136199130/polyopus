import { memo, useMemo, useState } from "react";
import type { ChatStreamSnapshot } from "../streamStore";
import { mergeHistory } from "../merge-history";
import { summarizeTrace, traceFor, type TurnTrace } from "../message-trace";
import type { Message, TraceEvent } from "@/lib/api/wire";
import styles from "./MessageList.module.css";

interface Props {
  messages: Message[] | undefined;
  snapshot: ChatStreamSnapshot;
  onScrollRef: (node: HTMLDivElement | null) => void;
  /** Welcome quick-start card was clicked (prototype 欢迎页). */
  onQuickPrompt?: (prompt: string) => void;
  /** Event tail for tool steps, file changes and KB citations. */
  trace?: TraceEvent[];
  agentName?: string;
  onFollowUp?: (action: "trace" | "share") => void;
  onNotice?: (message: string) => void;
  onRegenerate?: (turnId: string) => void;
  onBranch?: (message: Message) => void;
  onEditMessage?: (message: Message, content: string) => void;
  /** A turn is still running: hide edit/regenerate/branch until it ends. */
  turnActive?: boolean;
  /** Editing/regenerating only makes sense for the newest turn. */
  latestTurnId?: string | null;
}

const QUICK_PROMPTS: Array<[string, string, string]> = [
  ["排查一个登录超时", "从问题描述开始，先读代码再改", "◤"],
  ["整理本周发布记录", "从来源消息和工单汇总", "≡"],
  ["回答发布流程问题", "先查知识库运维手册再回答", "◇"],
  ["写一个导出接口", "从一句话需求创建任务", "＋"],
];

interface Bubble {
  key: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  turnId?: string | null;
  createdAt?: number;
}

function buildBubbles(
  messages: Message[] | undefined,
  snapshot: ChatStreamSnapshot,
): Bubble[] {
  const merged = mergeHistory(messages ?? [], {
    turnId: snapshot.turnId,
    userMessageId: snapshot.userMessageId,
    text: snapshot.text,
    status: snapshot.status,
  });
  const bubbles: Bubble[] = merged.messages
    .map((message) => ({
      key: message.messageId,
      role: message.role === "assistant"
        ? ("assistant" as const)
        : message.role === "system"
          ? ("system" as const)
          : ("user" as const),
      content: message.content,
      turnId: message.turnId,
      createdAt: message.createdAt,
    }))
    // a paused first round can leave an empty assistant projection; the
    // final row carries the text, so hide the placeholder instead of showing
    // a bare avatar + timestamp.
    .filter((bubble) => bubble.role !== "assistant" || bubble.content.trim() !== "");

  // optimistic user bubble until the projection confirms it
  if (snapshot.pendingUser) {
    bubbles.push({
      key: snapshot.pendingUser.id,
      role: "user",
      content: snapshot.pendingUser.content,
    });
  }

  // Live tail: mergeHistory drops this when the same turn already has a
  // projected assistant row (richer side wins), so two streaming bubbles can
  // never render for one turn.
  if (snapshot.turnId && merged.liveText) {
    bubbles.push({
      key: `${snapshot.turnId}-live`,
      role: "assistant",
      content: merged.liveText,
      streaming: true,
      turnId: snapshot.turnId,
    });
  } else if (
    snapshot.status === "waiting_approval" &&
    !merged.messages.some(
      (message) => message.turnId === snapshot.turnId && message.role === "assistant",
    )
  ) {
    bubbles.push({
      key: `${snapshot.turnId ?? "waiting"}-placeholder`,
      role: "assistant",
      content: "已暂停，等待审批…",
      turnId: snapshot.turnId,
    });
  }

  return bubbles;
}

function clock(ts?: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(ms?: number): string {
  if (!ms) return "";
  return ms < 1000 ? "<1s" : `${(ms / 1000).toFixed(1)}s`;
}

function toolLabel(name: string): string {
  if (name === "fs.read") return "读取文件";
  if (name === "fs.write") return "写入文件";
  if (name === "demo.sleep") return "等待任务";
  return name;
}

async function copyText(text: string, onNotice?: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onNotice?.("已复制到剪贴板。");
  } catch {
    onNotice?.("复制失败，请手动选择文本。");
  }
}

function Steps({ trace }: { trace: TurnTrace }) {
  if (!trace.steps.length) return null;
  return (
    <div className={styles.process}>
      {trace.steps.map((step) => (
        <div key={step.id} className={styles.step}>
          <span
            className={`${styles.stepIcon} ${
              step.status === "failed"
                ? styles.stepFail
                : step.status === "running"
                  ? styles.stepRun
                  : styles.stepOk
            }`}
            aria-hidden="true"
          >
            {step.status === "failed" ? "×" : step.status === "running" ? "◌" : "✓"}
          </span>
          <b>{toolLabel(step.name)}</b>
          <span className={styles.stepArg}>{step.args}</span>
          {step.durationMs ? (
            <span className={styles.stepTime}>{duration(step.durationMs)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ToolCard({ trace }: { trace: TurnTrace }) {
  const last = trace.steps[trace.steps.length - 1];
  if (!last) return null;
  return (
    <details className={styles.toolCard} data-testid="tool-card">
      <summary className={styles.toolHead}>
        <span className={styles.toolIcon} aria-hidden="true">▸</span>
        <b>{last.name}</b>
        <span className={styles.toolArg}>{last.args}</span>
        <span className={styles.spacer} />
        <span
          className={`${styles.toolStatus} ${
            last.status === "failed" ? styles.toolBad : styles.toolOk
          }`}
        >
          {last.status === "failed" ? "失败" : last.status === "running" ? "运行中" : "完成"}
        </span>
      </summary>
      <pre className={styles.toolBody}>{last.output || "（无输出）"}</pre>
    </details>
  );
}

function FileCard({ trace }: { trace: TurnTrace }) {
  if (!trace.files.length) return null;
  return (
    <div className={styles.fileCard} data-testid="file-card">
      <div className={styles.fileHead}>
        <b>文件改动 · {trace.files.length} 个文件</b>
        <span className={styles.spacer} />
        <span className={styles.hint}>已写入工作区</span>
      </div>
      {trace.files.map((file) => (
        <div key={file.path} className={styles.fileRow}>
          <span className={styles.fileBadge}>W</span>
          <span className={styles.fileName}>{file.path}</span>
          <span className={styles.spacer} />
          {file.bytes ? <span className={styles.hint}>{file.bytes} B</span> : null}
        </div>
      ))}
    </div>
  );
}

function Citations({ trace }: { trace: TurnTrace }) {
  if (!trace.citations.length) return null;
  return (
    <div className={styles.citations} data-testid="citations">
      <span className={styles.hint}>引用</span>
      {trace.citations.map((item) => (
        <span
          key={`${item.kb}-${item.doc}-${item.heading ?? ""}`}
          className={styles.citeTag}
          title={item.score !== undefined ? `score ${item.score}` : undefined}
        >
          ◇ {item.kb}
          {item.doc ? ` · ${item.doc}` : ""}
          {item.heading ? ` · ${item.heading}` : ""}
        </span>
      ))}
    </div>
  );
}

const UserRow = memo(function UserRow({
  bubble, onNotice, onEditMessage, turnActive, latestTurnId,
}: {
  bubble: Bubble;
  onNotice?: (message: string) => void;
  onEditMessage?: (message: Message, content: string) => void;
  /** A turn is still running: hide edit/regenerate/branch until it ends. */
  turnActive?: boolean;
  /** Editing/regenerating only makes sense for the newest turn. */
  latestTurnId?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bubble.content);
  const message: Message = {
    messageId: bubble.key,
    threadId: "",
    turnId: bubble.turnId ?? "",
    role: "user",
    content: bubble.content,
    status: "completed",
    seq: 0,
    createdAt: bubble.createdAt ?? 0,
  };
  return (
    <div className={`${styles.row} ${styles.userRow}`} data-testid="bubble-user">
      <span className={`${styles.avatar} ${styles.avatarUser}`} aria-hidden="true">我</span>
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.time}>你 · {clock(bubble.createdAt)}</span>
        </div>
        {editing ? (
          <div className={styles.editBox}>
            <textarea
              aria-label="编辑消息"
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className={styles.editActions}>
              <button type="button" onClick={() => setEditing(false)}>取消</button>
              <button
                type="button"
                className={styles.editSave}
                disabled={!draft.trim()}
                onClick={() => {
                  onEditMessage?.(message, draft.trim());
                  setEditing(false);
                }}
              >
                保存并重新发送
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.userBubble}>{bubble.content}</div>
        )}
        {!editing ? (
          <div className={styles.msgTools}>
            <button
              type="button"
              title="复制"
              onClick={() => void copyText(bubble.content, onNotice)}
            >
              ⧉
            </button>
            {onEditMessage && !turnActive && bubble.turnId === latestTurnId ? (
              <button
                type="button"
                title="编辑并重新发送"
                aria-label="编辑消息"
                onClick={() => {
                  setDraft(bubble.content);
                  setEditing(true);
                }}
              >
                ✎
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const AssistantRow = memo(function AssistantRow({
  bubble, trace, agentName, onNotice, onRegenerate, onBranch, turnActive,
  latestTurnId,
}: {
  bubble: Bubble;
  trace: TurnTrace;
  agentName: string;
  onNotice?: (message: string) => void;
  onRegenerate?: (turnId: string) => void;
  onBranch?: (message: Message) => void;
  turnActive?: boolean;
  latestTurnId?: string | null;
}) {
  const message: Message = {
    messageId: bubble.key,
    threadId: "",
    turnId: bubble.turnId ?? "",
    role: "assistant",
    content: bubble.content,
    status: bubble.streaming ? "streaming" : "completed",
    seq: 0,
    createdAt: bubble.createdAt ?? 0,
  };
  return (
    <div className={styles.row} data-testid="bubble-assistant">
      <span className={styles.avatar} aria-hidden="true">
        {agentName && agentName !== "默认助手"
          ? agentName.slice(0, 1).toUpperCase()
          : "P"}
      </span>
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.name}>{agentName || "助手"}</span>
          <span className={styles.time}>{clock(bubble.createdAt)}</span>
        </div>
        <Steps trace={trace} />
        <div className={`${styles.assistantText} ${bubble.streaming ? styles.streaming : ""}`}>
          {bubble.content}
        </div>
        <ToolCard trace={trace} />
        <FileCard trace={trace} />
        <Citations trace={trace} />
        {!bubble.streaming ? (
          <div className={styles.msgTools}>
            <button
              type="button"
              title="复制"
              aria-label="复制回答"
              onClick={() => void copyText(bubble.content, onNotice)}
            >
              ⧉
            </button>
            {onRegenerate && bubble.turnId === latestTurnId && !turnActive ? (
              <button
                type="button"
                title="重新生成"
                aria-label="重新生成"
                onClick={() => onRegenerate(bubble.turnId as string)}
              >
                ↻
              </button>
            ) : null}
            {onBranch && !turnActive ? (
              <button
                type="button"
                title="从这条回答创建分支"
                aria-label="创建分支"
                onClick={() => onBranch(message)}
              >
                ⑂
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** Chat transcript: history + live tail, tool steps, files, citations and
 * hover actions (copy / edit+resend / regenerate / branch). */
export function MessageList({
  messages, snapshot, onScrollRef, onQuickPrompt, trace, agentName,
  onFollowUp, onNotice, onRegenerate, onBranch, onEditMessage, turnActive,
  latestTurnId,
}: Props) {
  const bubbles = buildBubbles(messages, snapshot);
  const byTurn = useMemo(() => summarizeTrace(trace), [trace]);
  const last = bubbles[bubbles.length - 1];
  // One turn can project more than one assistant row (paused round + final).
  // Decorate only the last one so steps/file cards are not duplicated.
  const lastAssistantOfTurn = new Map<string, string>();
  for (const bubble of bubbles) {
    if (bubble.role === "assistant" && bubble.turnId) {
      lastAssistantOfTurn.set(bubble.turnId, bubble.key);
    }
  }
  const showFollowUps =
    !snapshot.turnId || snapshot.status === "finished" || snapshot.status === "idle";
  const hasAssistant = bubbles.some((bubble) => bubble.role === "assistant");

  return (
    <div className={styles.scroll} ref={onScrollRef}>
      <div className={styles.inner}>
        {bubbles.length === 0 ? (
          <div className={styles.welcome}>
            <div className={styles.welcomeLogo}>P</div>
            <h2>今天想先处理哪件事？</h2>
            <p>从一句话、一个任务或一份文档开始；不确定就直接问。</p>
            <div className={styles.quickGrid}>
              {QUICK_PROMPTS.map(([title, hint, icon]) => (
                <button
                  key={title}
                  type="button"
                  className={styles.quickCard}
                  data-testid="quick-prompt"
                  onClick={() => onQuickPrompt?.(title)}
                >
                  <span className={styles.quickIc} aria-hidden="true">{icon}</span>
                  <b>{title}</b>
                  <span>{hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {bubbles.map((bubble) => {
              if (bubble.role === "system") {
                return (
                  <div key={bubble.key} className={styles.system}>
                    {bubble.content}
                  </div>
                );
              }
              if (bubble.role === "user") {
                return (
                  <UserRow
                    key={bubble.key}
                    bubble={bubble}
                    onNotice={onNotice}
                    onEditMessage={onEditMessage}
                    turnActive={turnActive}
                    latestTurnId={latestTurnId}
                  />
                );
              }
              return (
                <AssistantRow
                  key={bubble.key}
                  bubble={bubble}
                  trace={
                    bubble.turnId && lastAssistantOfTurn.get(bubble.turnId) === bubble.key
                      ? traceFor(byTurn, bubble.turnId)
                      : { steps: [], files: [], citations: [] }
                  }
                  agentName={agentName ?? "默认助手"}
                  onNotice={onNotice}
                  onRegenerate={onRegenerate}
                  onBranch={onBranch}
                  turnActive={turnActive}
                  latestTurnId={latestTurnId}
                />
              );
            })}
            {showFollowUps && last?.role === "assistant" && hasAssistant ? (
              <div className={styles.nextCard} data-testid="next-card">
                <b>接下来</b>
                <button
                  type="button"
                  className={styles.nextChip}
                  onClick={() => onQuickPrompt?.("补一个回归测试")}
                >
                  补一个回归测试
                </button>
                <button
                  type="button"
                  className={styles.nextChip}
                  onClick={() => onFollowUp?.("trace")}
                >
                  查看运行轨迹
                </button>
                <button
                  type="button"
                  className={styles.nextChip}
                  onClick={() => onFollowUp?.("share")}
                >
                  分享结论
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
