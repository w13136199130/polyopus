import { Button } from "@/components/ui";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import type { AgentRow, Thread } from "@/lib/api/wire";
import { SessionMenu } from "./SessionMenu";
import styles from "./ChatHeader.module.css";

interface Props {
  thread: Thread | undefined;
  /** Title used when no thread exists yet (welcome state). */
  fallbackTitle?: string;
  agent: AgentRow | undefined;
  modelLabel: string;
  mode?: string;
  dockOpen: boolean;
  onToggleDock: () => void;
  onShare: (thread: Thread) => void;
  onRename: (thread: Thread) => void;
  onPin: (thread: Thread) => void;
  onBranch: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
  onOpenSessions: () => void;
}

function initials(name: string | undefined): string {
  return (name || "P").trim().slice(0, 1).toUpperCase();
}

/**
 * Chat top bar (prototype `.topbar`): expert identity on the left, then the
 * session title with its ⋯ menu, then share / Dock actions on the right.
 */
export function ChatHeader({
  thread, fallbackTitle, agent, modelLabel, mode = "Act", dockOpen,
  onToggleDock, onShare, onRename, onPin, onBranch, onDelete, onOpenSessions,
}: Props) {
  const agentName = agent?.name ?? "默认助手";
  const title = thread?.title || fallbackTitle || "新对话";
  return (
    <header className={styles.bar} data-testid="chat-header">
      <Button
        size="sm"
        variant="ghost"
        className={styles.mobileSessions}
        data-testid="mobile-sessions"
        onClick={onOpenSessions}
      >
        会话
      </Button>
      <div className={styles.who}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(agent?.name)}
        </span>
        <div className={styles.whoText}>
          <span className={styles.whoName} data-testid="chat-agent-chip">
            {agentName}
          </span>
          <span className={styles.whoSub}>
            {modelLabel || "默认模型"} · {mode} 模式
          </span>
        </div>
      </div>

      <span className={styles.modeTag}>
        <span aria-hidden="true">✦</span> {mode}
      </span>

      <div className={styles.titleBlock}>
        <b className={styles.title} title={title}>{title}</b>
        <span className={styles.stateTag}>
          {thread ? "当前会话" : "新会话"}
        </span>
        {thread ? (
          <SessionMenu
            thread={thread}
            variant="header"
            onRename={onRename}
            onPin={onPin}
            onBranch={onBranch}
            onDelete={onDelete}
            onShare={onShare}
          />
        ) : null}
      </div>

      <div className={styles.spacer} />

      <NotificationBell />
      {thread ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onShare(thread)}
          title="复制当前会话链接"
        >
          ↗ 分享
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        data-testid="dock-toggle"
        onClick={onToggleDock}
        aria-pressed={dockOpen}
        title={dockOpen ? "收起右侧 Dock" : "打开右侧 Dock（文件/轨迹/终端）"}
      >
        {dockOpen ? "▤ 收起 Dock" : "▤ 打开 Dock"}
      </Button>
    </header>
  );
}
