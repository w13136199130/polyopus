/**
 * Chat page (prototype `#/chat`): session rail + header + message column +
 * composer + Dock. Also owns session actions (rename/pin/branch/delete) and
 * the per-session composer settings (model/KB/connector/sub-agent/approval).
 *
 * URL is the source of truth for the open thread (`?threadId=`), so reload,
 * share links and branch navigation all restore the same view.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "react-router";
import { Button, Dialog, ErrorState, PageLoading, StreamConnectingIndicator } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import { useAgents } from "@/features/agents/api";
import { useAdminSettings } from "@/features/settings/api";
import { useKnowledgeBases } from "@/features/knowledge/api";
import { useConnectorInstances } from "@/features/connectors/api";
import {
  useBranchMessage,
  useBranchThread,
  useCreateThread,
  useDeleteThread,
  useEditTurn,
  useMessages,
  useModels,
  useRegenerateTurn,
  useStopTurn,
  useThreadTrace,
  useThreads,
  useUpdateThread,
  useWorkspaceTree,
} from "@/features/chat/api";
import {
  pendingApprovalsForTurn,
  useAnswerAttention,
  useAttentions,
} from "@/lib/api/hooks";
import type { Message, Thread, ThreadSettings } from "@/lib/api/wire";
import { useChatStream } from "@/features/chat/useChatStream";
import { ApprovalCard } from "@/components/attention/ApprovalCard";
import { ChatHeader } from "@/features/chat/components/ChatHeader";
import { Composer } from "@/features/chat/components/Composer";
import { Dock, type DockTab } from "@/features/chat/components/Dock";
import { TraceExplorer } from "@/features/chat/components/TraceExplorer";
import { MessageList } from "@/features/chat/components/MessageList";
import { ThreadRail } from "@/features/chat/components/ThreadRail";
import styles from "./ChatPage.module.css";

const DOCK_KEY = "poly:chat-dock";
const DOCK_TAB_KEY = "poly:chat-dock-tab";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function readTab(): DockTab {
  try {
    const raw = localStorage.getItem(DOCK_TAB_KEY);
    if (
      raw === "files" || raw === "workspace" || raw === "browser"
      || raw === "trace" || raw === "terminal"
    ) {
      return raw;
    }
  } catch {
    /* private mode */
  }
  return "files";
}

export function ChatPage() {
  const [params, setParams] = useSearchParams();
  const threadId = params.get("threadId");

  const threadsQuery = useThreads();
  const agentsQuery = useAgents();
  const createThread = useCreateThread();
  const updateThread = useUpdateThread();
  const deleteThread = useDeleteThread();
  const branchThread = useBranchThread();
  const branchMessage = useBranchMessage();
  const stopTurn = useStopTurn();
  const regenerateTurn = useRegenerateTurn();
  const editTurn = useEditTurn();
  const messagesQuery = useMessages(threadId);
  const attentionsQuery = useAttentions();
  const answerMutation = useAnswerAttention();
  const modelsQuery = useModels();
  const kbsQuery = useKnowledgeBases();
  const connectorsQuery = useConnectorInstances();

  const [restored, setRestored] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showScroll, setShowScroll] = useState(false);
  const [queued, setQueued] = useState<string[]>([]);
  const [dockOpen, setDockOpen] = useState(() => readBool(DOCK_KEY, false));
  const [traceOpen, setTraceOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>(readTab);
  const [renameTarget, setRenameTarget] = useState<Thread | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Thread | null>(null);

  const onRollback = useCallback((content: string) => setRestored(content), []);
  const { store, send, trackTurn } = useChatStream(threadId, onRollback);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canWrite = useCan("chat:write");
  const canReadSettings = useCan("settings:read");
  const settingsQuery = useAdminSettings();
  const modelLabel = canReadSettings && settingsQuery.data
    ? (settingsQuery.data.modelName ?? "FakeModel")
    : "";

  // The transcript decorates messages with tool steps/citations, and the
  // Dock reuses the same tail; one poller for both.
  const traceQuery = useThreadTrace(threadId, threadId !== null);
  const workspaceQuery = useWorkspaceTree(Boolean(threadId));

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_KEY, dockOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [dockOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_TAB_KEY, dockTab);
    } catch {
      /* ignore */
    }
  }, [dockTab]);

  // auto-dismiss toasts; a click also clears them
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // flush the queue one message at a time once the active turn ends
  useEffect(() => {
    if (!threadId || queued.length === 0) return;
    if (snapshot.status !== "finished" && snapshot.status !== "idle") return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void send(next).then((ok) => {
      if (!ok) setRestored(next);
    });
  }, [threadId, queued, snapshot.status, send]);

  // autoscroll while streaming (follow when near the bottom)
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [messagesQuery.data, snapshot.text, snapshot.status]);

  // prototype: the "回到底部" pill only shows when the reader scrolled away
  const updateScrollHint = useCallback(() => {
    const node = scrollRef.current;
    if (!node) {
      setShowScroll(false);
      return;
    }
    setShowScroll(
      node.scrollHeight - node.scrollTop - node.clientHeight > 240,
    );
  }, []);

  useEffect(() => {
    updateScrollHint();
  }, [messagesQuery.data, snapshot.text, updateScrollHint]);  // `/new`-style send from the welcome state: create, then flush the draft.
  useEffect(() => {
    if (!threadId || !pendingSend) return;
    const content = pendingSend;
    setPendingSend(null);
    void send(content).then((ok) => {
      if (!ok) setRestored(content);
    });
  }, [threadId, pendingSend, send]);

  const activeThread = (threadsQuery.data?.items ?? []).find(
    (thread) => thread.threadId === threadId,
  );
  const activeAgent = (agentsQuery.data?.items ?? []).find(
    (agent) => agent.agentId === activeThread?.agentId,
  );
  const session: ThreadSettings = activeThread?.settings ?? {};
  const kbIds = session.kbIds ?? [];
  const connectorIds = session.connectorIds ?? [];
  const subagentIds = session.subagentIds ?? [];
  const approvalPolicy = session.approvalPolicy ?? "ask";

  function handleCreate(agentId: string | null) {
    createThread.mutate(
      { title: "新对话", agentId },
      { onSuccess: (thread) => setParams({ threadId: thread.threadId }) },
    );
  }

  async function handleSend(content: string) {
    if (threadId && composerBusy) {
      // prototype: sending while a turn runs queues the text instead of
      // racing a second turn; the next send flushes after turn.finished.
      setQueued((current) => [...current.slice(-4), content]);
      return;
    }
    if (!threadId) {
      setPendingSend(content);
      createThread.mutate(
        { title: content.slice(0, 24) || "新对话", agentId: null },
        {
          onSuccess: (thread) => setParams({ threadId: thread.threadId }),
          onError: () => {
            setPendingSend(null);
            setRestored(content);
            setNotice("会话创建失败，草稿已保留。");
          },
        },
      );
      return;
    }
    const ok = await send(content);
    if (!ok) setRestored(content); // withdrawn: restore the input
  }

  /** Patch the session object; requires an open thread. */
  function patchSession(patch: Partial<ThreadSettings>) {
    if (!threadId) {
      setNotice("先新建会话，再选择模型、知识库或连接器。");
      return;
    }
    updateThread.mutate({ threadId, settings: { ...session, ...patch } });
  }

  function toggleIn(key: "kbIds" | "connectorIds" | "subagentIds", id: string) {
    const list = (session[key] ?? []) as string[];
    const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    patchSession({ [key]: next });
  }

  function handleShare(thread: Thread) {
    const url = `${window.location.origin}/chat?threadId=${encodeURIComponent(thread.threadId)}`;
    if (!navigator.clipboard) {
      setNotice(url);
      return;
    }
    void navigator.clipboard
      .writeText(url)
      .then(() => setNotice("会话链接已复制（需登录后访问）。"))
      .catch(() => setNotice(url));
  }

  function openRename(thread: Thread) {
    setRenameTarget(thread);
    setRenameValue(thread.title || "");
  }

  function saveRename() {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) return;
    updateThread.mutate(
      { threadId: renameTarget.threadId, title },
      {
        onSuccess: () => {
          setRenameTarget(null);
          setNotice("会话已重命名。");
        },
        onError: () => setNotice("重命名失败，请重试。"),
      },
    );
  }

  function togglePin(thread: Thread) {
    updateThread.mutate(
      { threadId: thread.threadId, pinned: !thread.pinned },
      {
        onSuccess: () =>
          setNotice(thread.pinned ? "已取消置顶。" : "已置顶该会话。"),
        onError: () => setNotice("操作失败，请重试。"),
      },
    );
  }

  function handleBranch(thread: Thread) {
    branchThread.mutate(thread.threadId, {
      onSuccess: (clone) => {
        setParams({ threadId: clone.threadId });
        setNotice("已从当前会话创建分支。");
      },
      onError: () => setNotice("创建分支失败，请重试。"),
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteThread.mutate(target.threadId, {
      onSuccess: () => {
        setDeleteTarget(null);
        if (threadId === target.threadId) setParams({});
        setNotice("会话已删除。");
      },
      onError: () => setNotice("删除失败，请重试。"),
    });
  }

  function exportTranscript() {
    const items = messagesQuery.data?.items ?? [];
    if (!items.length) {
      setNotice("当前会话还没有消息可导出。");
      return;
    }
    const title = activeThread?.title || "对话";
    const body = items
      .map((message) => `## ${message.role === "user" ? "我" : "助手"}\n\n${message.content}`)
      .join("\n\n");
    const blob = new Blob([`# ${title}\n\n${body}\n`], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/[/\\?%*:|"<>]/g, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function newThreadFromComposer() {
    handleCreate(activeThread?.agentId ?? null);
  }

  function handleStop() {
    if (!threadId || !snapshot.turnId) return;
    stopTurn.mutate({ threadId, turnId: snapshot.turnId });
  }

  /**
   * A server-started turn (regenerate/edit) may finish before the SSE client
   * is tracking it. Track it for live painting, then fall back to the
   * projection if no delta ever arrives.
   */
  function trackServerTurn(turnId: string) {
    trackTurn(turnId);
    window.setTimeout(() => {
      void messagesQuery.refetch().then(() => {
        const snap = store.getSnapshot();
        if (snap.turnId === turnId && snap.status === "streaming" && !snap.text) {
          store.resetToIdle();
        }
      });
    }, 1_500);
  }

  function handleRegenerate(turnId: string) {
    if (!threadId) return;
    regenerateTurn.mutate(
      { threadId, turnId },
      {
        onSuccess: (result) => trackServerTurn(result.turnId),
        onError: (error) => setNotice(`重新生成失败：${error instanceof Error ? error.message : "请稍后重试"}`),
      },
    );
  }

  function handleEditMessage(message: Message, content: string) {
    if (!threadId || !message.turnId) return;
    editTurn.mutate(
      { threadId, turnId: message.turnId, content },
      {
        onSuccess: (result) => trackServerTurn(result.turnId),
        onError: (error) => setNotice(`编辑失败：${error instanceof Error ? error.message : "请稍后重试"}`),
      },
    );
  }

  function handleBranchMessage(message: Message) {
    if (!threadId) return;
    branchMessage.mutate(
      { threadId, messageId: message.messageId },
      {
        onSuccess: (clone) => {
          setParams({ threadId: clone.threadId });
          setNotice("已从该回答创建分支。");
        },
      },
    );
  }

  function handleFollowUp(action: "trace" | "share") {
    if (action === "trace") {
      setTraceOpen(true);
      return;
    }
    const last = [...(messagesQuery.data?.items ?? [])]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!last) return;
    if (!navigator.clipboard) {
      setNotice("当前环境不支持剪贴板。");
      return;
    }
    void navigator.clipboard
      .writeText(last.content)
      .then(() => setNotice("结论已复制到剪贴板。"))
      .catch(() => setNotice("复制失败，请手动选择文本。"));
  }

  const approvals = pendingApprovalsForTurn(
    attentionsQuery.data?.items, snapshot.turnId,
  );
  const composerBusy =
    snapshot.status === "optimistic" || snapshot.status === "streaming";
  const latestTurnId = [...(messagesQuery.data?.items ?? [])]
    .reverse()
    .find((message) => message.turnId)?.turnId ?? null;
  const publishedAgents = (agentsQuery.data?.items ?? []).filter(
    (agent) =>
      agent.status === "published"
      && agent.agentId !== activeThread?.agentId,
  );

  return (
    <div className={styles.root}>
      <ThreadRail
        threads={threadsQuery.data?.items}
        loading={threadsQuery.isLoading}
        activeId={threadId}
        error={threadsQuery.isError}
        agents={agentsQuery.data?.items ?? []}
        onSelect={(id) => setParams({ threadId: id })}
        onCreate={handleCreate}
        onRetry={() => void threadsQuery.refetch()}
        onRename={openRename}
        onPin={togglePin}
        onBranch={handleBranch}
        onDelete={setDeleteTarget}
      />

      <section className={styles.main}>
        <ChatHeader
          thread={activeThread}
          agent={activeAgent}
          modelLabel={session.model || modelLabel}
          dockOpen={dockOpen}
          onToggleDock={() => setDockOpen((open) => !open)}
          onShare={handleShare}
          onRename={openRename}
          onPin={togglePin}
          onBranch={handleBranch}
          onDelete={setDeleteTarget}
        />

        <div className={styles.bodyRow}>
          <div className={styles.chatCol}>
            {snapshot.connection === "reconnecting" ? (
              <div className={styles.connecting}><StreamConnectingIndicator /></div>
            ) : null}
            {!canWrite ? (
              <div role="banner" className={styles.readonly}>
                只读角色：可以查看会话与数据，不能发送消息或修改配置。
              </div>
            ) : null}

            {threadId && messagesQuery.isLoading ? (
              <PageLoading label="载入消息…" />
            ) : threadId && messagesQuery.isError ? (
              <ErrorState
                message="消息加载失败"
                onRetry={() => void messagesQuery.refetch()}
              />
            ) : (
              <MessageList
                messages={threadId ? messagesQuery.data?.items : undefined}
                snapshot={snapshot}
                onScrollRef={(node) => {
                  scrollRef.current = node;
                  if (node) {
                    node.onscroll = updateScrollHint;
                    updateScrollHint();
                  }
                }}
                onQuickPrompt={(prompt) => void handleSend(prompt)}
                trace={traceQuery.data?.items}
                agentName={activeAgent?.name}
                onFollowUp={handleFollowUp}
                onNotice={setNotice}
                onRegenerate={handleRegenerate}
                onBranch={handleBranchMessage}
                onEditMessage={handleEditMessage}
                turnActive={composerBusy || snapshot.status === "waiting_approval"}
                latestTurnId={latestTurnId}
              />
            )}

            {threadId && showScroll ? (
              <button
                type="button"
                aria-label="回到底部"
                data-testid="scroll-bottom"
                className={styles.scrollBtn}
                onClick={() => {
                  const node = scrollRef.current;
                  if (node) {
                    node.scrollTop = node.scrollHeight;
                    setShowScroll(false);
                  }
                }}
              >
                ↓
              </button>
            ) : null}

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
              disabled={!canWrite}
              status={snapshot.status}
              restoredInput={restored}
              onConsumedRestore={() => setRestored(null)}
              onSend={(content) => void handleSend(content)}
              modelLabel={modelLabel}
              models={modelsQuery.data?.items ?? []}
              modelValue={session.model ?? ""}
              onModelChange={(model) => patchSession({ model })}
              kbs={kbsQuery.data?.items ?? []}
              kbIds={kbIds}
              onToggleKb={(kbId) => toggleIn("kbIds", kbId)}
              connectors={connectorsQuery.data?.items ?? []}
              connectorIds={connectorIds}
              onToggleConnector={(id) => toggleIn("connectorIds", id)}
              subagents={publishedAgents}
              subagentIds={subagentIds}
              onToggleSubagent={(id) => toggleIn("subagentIds", id)}
              approvalPolicy={approvalPolicy}
              onApprovalPolicyChange={(policy) =>
                patchSession({ approvalPolicy: policy })
              }
              mentionFiles={workspaceQuery.data?.items ?? []}
              onNewThread={newThreadFromComposer}
              onExport={exportTranscript}
              onNotice={setNotice}
              streaming={composerBusy}
              onStop={handleStop}
              queued={queued}
              onQueue={(content) => setQueued((current) => [...current.slice(-4), content])}
              onRemoveQueued={(index) =>
                setQueued((current) => current.filter((_, i) => i !== index))}
            />
          </div>

          {dockOpen ? (
            <Dock
              threadId={threadId}
              tab={dockTab}
              onTab={setDockTab}
              onClose={() => setDockOpen(false)}
              trace={traceQuery.data?.items}
              traceLoading={traceQuery.isLoading}
              onOpenTrace={() => setTraceOpen(true)}
              tree={workspaceQuery.data}
              treeLoading={workspaceQuery.isLoading}
            />
          ) : null}
        </div>
      </section>

      <TraceExplorer
        open={traceOpen}
        onOpenChange={setTraceOpen}
        threadTitle={activeThread?.title}
        trace={traceQuery.data?.items}
        loading={traceQuery.isLoading}
      />

      {notice ? (
        <button
          type="button"
          className={styles.toast}
          onClick={() => setNotice(null)}
        >
          {notice}
        </button>
      ) : null}

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title="重命名会话"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button
              loading={updateThread.isPending}
              onClick={saveRename}
              disabled={!renameValue.trim()}
            >
              保存
            </Button>
          </>
        }
      >
        <label className={styles.dialogLabel}>
          会话名称
          <input
            autoFocus
            value={renameValue}
            maxLength={200}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveRename();
            }}
          />
        </label>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除会话"
        description="会话会从列表隐藏，事件与审计记录保留。此操作不可撤销。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={deleteThread.isPending}
              onClick={confirmDelete}
            >
              删除
            </Button>
          </>
        }
      >
        <p className={styles.dialogText}>
          确定删除「{deleteTarget?.title || "未命名会话"}」？
        </p>
      </Dialog>
    </div>
  );
}
