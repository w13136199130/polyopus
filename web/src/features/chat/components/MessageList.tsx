import { memo, useMemo, useState } from "react";
import type { ChatStreamSnapshot } from "../streamStore";
import { mergeHistory } from "../merge-history";
import { summarizeTrace, traceFor, type TurnTrace } from "../message-trace";
import type { AttentionItem, Message, TraceEvent } from "@/lib/api/wire";
import { ApprovalCard } from "@/components/attention/ApprovalCard";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import icons, { type IconName } from "@/layouts/icons";
import { formatAnswers, parseAskContent, type AskQuestion } from "../ask-format";
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
  /** Pending approvals for this turn live inside the scroll flow. */
  approvals?: AttentionItem[];
  approvalBusy?: boolean;
  onApprovalAnswer?: (
    attentionId: string,
    decision: "approve" | "approve_session" | "deny",
  ) => void;
  /** Ask/Plan cards: skip clarification or execute the plan in Act mode. */
  onModeAction?: (
    action: "skip_ask" | "execute_plan" | "create_ticket" | "answer_ask",
    payload?: string,
  ) => void;
}

const QUICK_PROMPTS: Array<[string, string, IconName]> = [
  ["排查一个登录超时", "从问题描述开始，先读代码再改", "shield"],
  ["整理本周发布记录", "从来源消息和工单汇总", "inbox"],
  ["回答发布流程问题", "先查知识库运维手册再回答", "book"],
  ["写一个导出接口", "从一句话需求创建任务", "puzzle"],
];

interface Bubble {
  key: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  turnId?: string | null;
  createdAt?: number;
  reasoning?: string;
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
      reasoning: message.blocks
        ?.filter((block) => block.type === "reasoning")
        .map((block) => block.text ?? "")
        .join(""),
    }));

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
      reasoning: snapshot.reasoning,
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
  if (!trace.model && !trace.steps.length) return null;
  return (
    <div className={styles.process}>
      {trace.model ? (
        <div className={styles.step}>
          <span
            className={`${styles.stepIcon} ${
              trace.finished ? styles.stepOk : styles.stepRun
            }`}
            aria-hidden="true"
          >
            {trace.finished ? "✓" : "◌"}
          </span>
          <b>模型</b>
          <span className={styles.stepArg}>{trace.model}</span>
          {trace.durationMs ? (
            <span className={styles.stepTime}>{duration(trace.durationMs)}</span>
          ) : null}
        </div>
      ) : null}
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

/** One compact row per tool call (prototype tool row), each expandable. */
function ToolCard({ trace }: { trace: TurnTrace }) {
  if (!trace.steps.length) return null;
  return (
    <div className={styles.toolList} data-testid="tool-card">
      {trace.steps.map((step) => (
        <details key={step.id} className={styles.toolCard}>
          <summary className={styles.toolHead}>
            <span className={styles.toolIcon} aria-hidden="true">▸</span>
            <b>{step.name}</b>
            <span className={styles.toolArg}>{step.args}</span>
            <span className={styles.spacer} />
            {step.durationMs ? (
              <span className={styles.toolTime}>{duration(step.durationMs)}</span>
            ) : null}
            <span
              className={`${styles.toolStatus} ${
                step.status === "failed"
                  ? styles.toolBad
                  : step.status === "running" ? styles.toolRun : styles.toolOk
              }`}
            >
              {step.status === "failed" ? "失败" : step.status === "running" ? "运行中" : "完成"}
            </span>
          </summary>
          <pre className={styles.toolBody}>{step.output || "（无输出）"}</pre>
        </details>
      ))}
    </div>
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

function AskQuestions({
  questions, onSubmit, onSkip,
}: {
  questions: AskQuestion[];
  onSubmit: (text: string) => void;
  onSkip: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const any = Object.values(answers).some((value) => value.trim());
  return (
    <div className={styles.askCard} data-testid="ask-questions">
      <div className={styles.askHead}>
        <b>请确认</b>
        <span>回答后继续；也可以跳过直接执行</span>
      </div>
      {questions.map((question) => (
        <div key={question.id} className={styles.askQuestion}>
          <span className={styles.askLabel}>{question.question}</span>
          {question.options.length ? (
            <div className={styles.askOptions}>
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`${styles.askOption} ${
                    answers[question.id] === option ? styles.askOptionOn : ""
                  }`}
                  onClick={() =>
                    setAnswers((current) => ({ ...current, [question.id]: option }))}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          <input
            className={styles.askInput}
            aria-label={`回答：${question.question}`}
            placeholder="其他补充…"
            value={answers[question.id] ?? ""}
            onChange={(event) =>
              setAnswers((current) => ({
                ...current, [question.id]: event.target.value,
              }))}
          />
        </div>
      ))}
      <div className={styles.askActions}>
        <button type="button" className={styles.modeActionSecondary} onClick={onSkip}>
          跳过并执行
        </button>
        <button
          type="button"
          className={styles.modeAction}
          disabled={!any}
          data-testid="ask-submit"
          onClick={() => onSubmit(formatAnswers(questions, answers))}
        >
          提交回答
        </button>
      </div>
    </div>
  );
}

function ModeCard({
  mode, content, onAction,
}: {
  mode: "ask" | "plan";
  content: string;
  onAction?: (
    action: "skip_ask" | "execute_plan" | "create_ticket",
    payload?: string,
  ) => void;
}) {
  return (
    <div className={styles.modeCard} data-testid={`mode-card-${mode}`}>
      <span className={styles.modeIcon} aria-hidden="true">
        {mode === "plan" ? "◇" : "?"}
      </span>
      <div className={styles.modeText}>
        <b>{mode === "plan" ? "计划已生成" : "需要先澄清"}</b>
        <span>
          {mode === "plan"
            ? "Plan 模式只输出计划，未执行工具或修改工作区。"
            : "Ask 模式先向你确认需求，未执行工具；可直接在输入框补充。"}
        </span>
      </div>
      {mode === "plan" ? (
        <button
          type="button"
          className={styles.modeActionSecondary}
          data-testid="mode-ticket"
          onClick={() => onAction?.("create_ticket", content)}
        >
          转为任务
        </button>
      ) : null}
      <button
        type="button"
        className={styles.modeAction}
        data-testid={mode === "plan" ? "mode-execute" : "mode-skip"}
        onClick={() => onAction?.(
          mode === "plan" ? "execute_plan" : "skip_ask",
          content,
        )}
      >
        {mode === "plan" ? "执行计划" : "跳过并执行"}
      </button>
    </div>
  );
}

function Thinking({ text, streaming }: { text?: string; streaming?: boolean }) {
  if (!text?.trim() && !streaming) return null;
  return (
    <details className={styles.thinking} open={streaming || undefined}>
      <summary>
        <span className={styles.thinkingDot} aria-hidden="true" />
        {streaming ? "思考中…" : "思考过程"}
      </summary>
      <pre className={styles.thinkingBody}>
        {text?.trim() ? text : "模型正在阅读上下文并生成…"}
      </pre>
    </details>
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
  latestTurnId, onModeAction,
}: {
  bubble: Bubble;
  trace: TurnTrace;
  agentName: string;
  onNotice?: (message: string) => void;
  onRegenerate?: (turnId: string) => void;
  onBranch?: (message: Message) => void;
  turnActive?: boolean;
  latestTurnId?: string | null;
  onModeAction?: (
    action: "skip_ask" | "execute_plan" | "create_ticket" | "answer_ask",
    payload?: string,
  ) => void;
}) {
  const ask = !bubble.streaming && trace.mode === "ask"
    ? parseAskContent(bubble.content)
    : null;
  const body = ask?.questions.length ? ask.cleanText : bubble.content;
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
        <Thinking text={bubble.reasoning} streaming={bubble.streaming} />
        <Steps trace={trace} />
        <div
          className={`${styles.assistantText} ${bubble.streaming ? styles.streaming : ""}`}
          data-testid="assistant-text"
        >
          {body.trim() ? (
            <MarkdownView content={body} compact />
          ) : bubble.streaming ? (
            <span className={styles.streamingDot} aria-label="生成中" />
          ) : null}
        </div>
        {!bubble.streaming && ask?.questions.length ? (
          <AskQuestions
            questions={ask.questions}
            onSubmit={(text) => onModeAction?.("answer_ask", text)}
            onSkip={() => onModeAction?.("skip_ask")}
          />
        ) : !bubble.streaming && trace.mode && trace.mode !== "act" ? (
          <ModeCard
            mode={trace.mode}
            content={bubble.content}
            onAction={onModeAction}
          />
        ) : null}
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
  latestTurnId, approvals = [], approvalBusy = false, onApprovalAnswer,
  onModeAction,
}: Props) {
  const rawBubbles = buildBubbles(messages, snapshot);
  const byTurn = useMemo(() => summarizeTrace(trace), [trace]);
  // One turn can project more than one assistant row (paused round + final).
  // Only the last row of a turn carries the steps/file cards.
  const lastAssistantOfTurn = new Map<string, string>();
  for (const bubble of rawBubbles) {
    if (bubble.role === "assistant" && bubble.turnId) {
      lastAssistantOfTurn.set(bubble.turnId, bubble.key);
    }
  }
  // A paused round leaves an empty assistant projection (bare avatar + name):
  // drop it. The only exception is the turn's last row when the turn produced
  // tool steps, files or citations — a tool-only turn would otherwise lose
  // its cards.
  const bubbles = rawBubbles.filter((bubble) => {
    if (bubble.role !== "assistant" || bubble.streaming || bubble.content.trim()) {
      return true;
    }
    if (bubble.turnId && lastAssistantOfTurn.get(bubble.turnId) !== bubble.key) {
      return false;
    }
    const turnTrace = traceFor(byTurn, bubble.turnId);
    return turnTrace.steps.length > 0
      || turnTrace.files.length > 0
      || turnTrace.citations.length > 0;
  });
  const last = bubbles[bubbles.length - 1];
  const showFollowUps =
    !snapshot.turnId || snapshot.status === "finished" || snapshot.status === "idle";
  const hasAssistant = bubbles.some((bubble) => bubble.role === "assistant");

  return (
    <div className={styles.scroll} ref={onScrollRef} data-testid="message-scroll">
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
                  <span className={styles.quickIc} aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d={icons[icon]} /></svg>
                  </span>
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
                  onModeAction={onModeAction}
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

        {approvals.map((attention) => (
          <ApprovalCard
            key={attention.attentionId}
            attention={attention}
            busy={approvalBusy}
            onAnswer={(attentionId, decision) =>
              onApprovalAnswer?.(attentionId, decision)}
          />
        ))}
      </div>
    </div>
  );
}
