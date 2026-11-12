import { memo } from "react";
import type { ChatStreamSnapshot } from "../streamStore";
import type { Message } from "@/lib/api/wire";
import styles from "./MessageList.module.css";

interface Props {
  messages: Message[] | undefined;
  snapshot: ChatStreamSnapshot;
  onScrollRef: (node: HTMLDivElement | null) => void;
}

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
  const bubbles: Bubble[] = (messages ?? []).map((message) => ({
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

  // live assistant text for the active turn (cleared once finished —
  // the messages projection is authoritative from then on)
  if (
    snapshot.turnId &&
    (snapshot.status === "streaming" ||
      snapshot.status === "waiting_approval") &&
    snapshot.text
  ) {
    bubbles.push({
      key: `${snapshot.turnId}-live`,
      role: "assistant",
      content: snapshot.text,
      streaming: true,
    });
  } else if (snapshot.status === "waiting_approval") {
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

export function MessageList({ messages, snapshot, onScrollRef }: Props) {
  const bubbles = buildBubbles(messages, snapshot);
  return (
    <div className={styles.scroll} ref={onScrollRef}>
      <div className={styles.inner}>
        {bubbles.length === 0 ? (
          <p className={styles.empty}>发送第一条消息开始对话。</p>
        ) : (
          bubbles.map((bubble) => <Row key={bubble.key} bubble={bubble} />)
        )}
      </div>
    </div>
  );
}
