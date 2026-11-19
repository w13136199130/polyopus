import { memo } from "react";
import type { ChatStreamSnapshot } from "../streamStore";
import { mergeHistory } from "../merge-history";
import type { Message } from "@/lib/api/wire";
import styles from "./MessageList.module.css";

interface Props {
  messages: Message[] | undefined;
  snapshot: ChatStreamSnapshot;
  onScrollRef: (node: HTMLDivElement | null) => void;
  /** Welcome quick-start card was clicked (prototype 欢迎页). */
  onQuickPrompt?: (prompt: string) => void;
}

const QUICK_PROMPTS: Array<[string, string, string]> = [
  ["排查一个登录超时", "从问题描述开始，先读代码再改", "◤"],
  ["整理本周发布记录", "从来源消息和工单汇总", "≡"],
  ["回答发布流程问题", "先查知识库运维手册再回答", "◇"],
  ["写一个导出接口", "从一句话需求创建任务", "＋"],
];

interface Bubble {
  key: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
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
  const bubbles: Bubble[] = merged.messages.map((message) => ({
    key: message.messageId,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
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
    });
  }

  return bubbles;
}

const Row = memo(function Row({ bubble }: { bubble: Bubble }) {
  return (
    <div
      data-testid={`bubble-${bubble.role}`}
      className={`${styles.bubble} ${styles[bubble.role]} ${bubble.streaming ? styles.streaming : ""}`}
    >
      {bubble.content}
    </div>
  );
});

export function MessageList({
  messages, snapshot, onScrollRef, onQuickPrompt,
}: Props) {
  const bubbles = buildBubbles(messages, snapshot);
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
          bubbles.map((bubble) => <Row key={bubble.key} bubble={bubble} />)
        )}
      </div>
    </div>
  );
}
