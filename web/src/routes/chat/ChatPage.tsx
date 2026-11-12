/**
 * Chat page (V05-03): thread rail + message stream + composer + approval
 * cards. Scope per docs/48 §0.5 F2: send/stream/approve only — stop,
 * regenerate, attachments are v1.0 (the backend has no endpoints for them).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { ErrorState, PageLoading, StreamConnectingIndicator } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import {
  useCreateThread,
  useMessages,
  useThreads,
} from "@/features/chat/api";
import {
  pendingApprovalsForTurn,
  useAnswerAttention,
  useAttentions,
} from "@/lib/api/hooks";
import { useChatStream } from "@/features/chat/useChatStream";
import { ApprovalCard } from "@/components/attention/ApprovalCard";
import { Composer } from "@/features/chat/components/Composer";
import { MessageList } from "@/features/chat/components/MessageList";
import { ThreadRail } from "@/features/chat/components/ThreadRail";

export function ChatPage() {
  const [params, setParams] = useSearchParams();
  const threadId = params.get("threadId");

  const threadsQuery = useThreads();
  const createThread = useCreateThread();
  const messagesQuery = useMessages(threadId);
  const attentionsQuery = useAttentions();
  const answerMutation = useAnswerAttention();

  const [restored, setRestored] = useState<string | null>(null);
  const onRollback = useCallback((content: string) => setRestored(content), []);
  const { store, send } = useChatStream(threadId, onRollback);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // autoscroll while streaming (follow when near the bottom)
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [messagesQuery.data, snapshot.text, snapshot.status]);

  function handleCreate() {
    createThread.mutate("新对话", {
      onSuccess: (thread) => setParams({ threadId: thread.threadId }),
    });
  }

  async function handleSend(content: string) {
    const ok = await send(content);
    if (!ok) setRestored(content); // withdrawn: restore the input
  }

  const approvals = pendingApprovalsForTurn(attentionsQuery.data?.items, snapshot.turnId);
  const composerBusy =
    snapshot.status === "optimistic" || snapshot.status === "streaming";

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <ThreadRail
        threads={threadsQuery.data?.items}
        loading={threadsQuery.isLoading}
        activeId={threadId}
        error={threadsQuery.isError}
        onSelect={(id) => setParams({ threadId: id })}
        onCreate={handleCreate}
        onRetry={() => void threadsQuery.refetch()}
      />
      <PageShell
        title="对话"
        subtitle={threadId ? `会话 ${threadId.slice(0, 14)}…` : "选择或创建一个会话"}
        actions={
          snapshot.connection === "reconnecting" ? <StreamConnectingIndicator /> : null
        }
      >
        {!threadId ? (
          <p style={{ color: "var(--text-3)" }}>从左侧选择会话，或新建一个开始对话。</p>
        ) : messagesQuery.isLoading ? (
          <PageLoading label="载入消息…" />
        ) : messagesQuery.isError ? (
          <ErrorState
            message="消息加载失败"
            onRetry={() => void messagesQuery.refetch()}
          />
        ) : (
          <>
            <MessageList
              messages={messagesQuery.data?.items}
              snapshot={snapshot}
              onScrollRef={(node) => {
                scrollRef.current = node;
              }}
            />
            {approvals.map((attention) => (
              <ApprovalCard
                key={attention.attentionId}
                attention={attention}
                busy={answerMutation.isPending}
                onAnswer={(attentionId, decision) =>
                  answerMutation.mutate({ attentionId, decision })
                }
              />
            ))}
            <Composer
              disabled={composerBusy}
              status={snapshot.status}
              restoredInput={restored}
              onConsumedRestore={() => setRestored(null)}
              onSend={(content) => void handleSend(content)}
            />
          </>
        )}
      </PageShell>
    </div>
  );
}
