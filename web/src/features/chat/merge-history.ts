/**
 * History + live-tail merge (V05-23).
 *
 * The projection is authoritative, but during a refresh it can be one beat
 * behind the stream. The rule: only merge when the cached user-message id is
 * actually the last user message in history, and take the richer content for
 * the same turn. An active stream never replaces the whole history.
 */

import type { Message } from "@/lib/api/wire";

export interface LiveTail {
  turnId: string | null;
  userMessageId: string | null;
  text: string;
  status: string;
}

export interface MergedHistory {
  messages: Message[];
  /** Non-empty only when history has no assistant row for the live turn. */
  liveText: string;
}

function isActive(status: string): boolean {
  return status === "streaming" || status === "waiting_approval";
}

export function mergeHistory(
  messages: Message[],
  live: LiveTail,
): MergedHistory {
  if (!live.turnId || !live.text || !isActive(live.status)) {
    return { messages, liveText: "" };
  }

  const users = messages.filter((message) => message.role === "user");
  const lastUser = users[users.length - 1];
  const cachedUserInHistory = live.userMessageId
    ? users.some((message) => message.messageId === live.userMessageId)
    : false;
  // The cache must describe the latest user turn. If the cached user row is
  // already projected but a newer user exists, the cache is stale.
  if (
    live.userMessageId &&
    cachedUserInHistory &&
    lastUser &&
    lastUser.messageId !== live.userMessageId
  ) {
    return { messages, liveText: "" };
  }

  const index = messages.findIndex(
    (message) => message.turnId === live.turnId && message.role === "assistant",
  );
  if (index < 0) {
    return { messages, liveText: live.text };
  }

  // Same turn: richer side wins; never render two assistant bubbles.
  if (live.text.length > messages[index].content.length) {
    const merged = [...messages];
    merged[index] = {
      ...messages[index],
      content: live.text,
      status: "streaming",
    };
    return { messages: merged, liveText: "" };
  }
  return { messages, liveText: "" };
}
