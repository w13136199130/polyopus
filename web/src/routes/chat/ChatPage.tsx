/**
 * Chat page (V05-03): thread rail + message stream + composer + approval
 * cards. Scope per docs/48 §0.5 F2: send/stream/approve only — stop,
 * regenerate, attachments are v1.0 (the backend has no endpoints for them).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { ErrorState, PageLoading, StreamConnectingIndicator } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import { useAgents } from "@/features/agents/api";
import { useAdminSettings } from "@/features/settings/api";
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
  const agentsQuery = useAgents();
  const createThread = useCreateThread();
  const messagesQuery = useMessages(threadId);
  const attentionsQuery = useAttentions();
  const answerMutation = useAnswerAttention();

  const [restored, setRestored] = useState<string | null>(null);
  const onRollback = useCallback((content: string) => setRestored(content), []);
  const { store, send } = useChatStream(threadId, onRollback);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canWrite = useCan("chat:write");
  const canReadSettings = useCan("settings:read");
  const settingsQuery = useAdminSettings();
  const modelLabel = canReadSettings && settingsQuery.data
    ? (settingsQuery.data.modelName ?? "FakeModel")
    : "";

  // autoscroll while streaming (follow when near the bottom)
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [messagesQuery.data, snapshot.text, snapshot.status]);

  function handleCreate(agentId: string | null) {
    createThread.mutate(
      { title: "新对话", agentId },
      { onSuccess: (thread) => setParams({ threadId: thread.threadId }) },
    );
  }

  async function handleSend(content: string) {
    const ok = await send(content);
    if (!ok) setRestored(content); // withdrawn: restore the input
  }

  const approvals = pendingApprovalsForTurn(attentionsQuery.data?.items, snapshot.turnId);
  const composerBusy =
    snapshot.status === "optimistic" || snapshot.status === "streaming";

  const activeThread = (threadsQuery.data?.items ?? []).find(
    (thread) => thread.threadId === threadId,
  );
  const activeAgent = (agentsQuery.data?.items ?? []).find(
    (agent) => agent.agentId === activeThread?.agentId,
  );

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <ThreadRail
        threads={threadsQuery.data?.items}
        loading={threadsQuery.isLoading}
        activeId={threadId}
        error={threadsQuery.isError}
        agents={agentsQuery.data?.items ?? []}
        onSelect={(id) => setParams({ threadId: id })}
        onCreate={handleCreate}
        onRetry={() => void threadsQuery.refetch()}
      />
      <PageShell
        title="对话"
        subtitle={
          threadId
            ? activeThread
              ? `${activeThread.title || "未命名会话"}${activeAgent ? ` · ${activeAgent.name}` : ""}`
              : `会话 ${threadId.slice(0, 14)}…`
            : "选择或创建一个会话"
        }
        actions={
          <>
            {activeAgent ? (
              <span
                data-testid="chat-agent-chip"
                style={{
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: "var(--primary-soft)",
                  color: "var(--primary)",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {activeAgent.name}
              </span>
            ) : null}
            {snapshot.connection === "reconnecting" ? <StreamConnectingIndicator /> : null}
          </>
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
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              background: "var(--surface)",
              position: "relative",
            }}
          >
            {!canWrite ? (
              <div
                role="banner"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 24px",
                  fontSize: 12.5,
                  color: "var(--amber)",
                  background: "var(--amber-soft)",
                  borderBottom: "1px solid var(--amber-border)",
                }}
              >
                只读角色：可以查看会话与数据，不能发送消息或修改配置。
              </div>
            ) : null}
            <MessageList
              messages={messagesQuery.data?.items}
              snapshot={snapshot}
              onScrollRef={(node) => {
                scrollRef.current = node;
              }}
              onQuickPrompt={(prompt) => void handleSend(prompt)}
            />
            <button
              type="button"
              aria-label="回到底部"
              data-testid="scroll-bottom"
              onClick={() => {
                const node = scrollRef.current;
                if (node) node.scrollTop = node.scrollHeight;
              }}
              style={{
                position: "absolute",
                right: 24,
                bottom: 132,
                width: 30,
                height: 30,
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--text-3)",
                cursor: "pointer",
                zIndex: 5,
              }}
            >
              ↓
            </button>
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
              modelLabel={modelLabel}
            />
          </div>
        )}
      </PageShell>
    </div>
  );
}
