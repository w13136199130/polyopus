import { Button, Empty, Loading } from "@/components/ui";
import type { Thread } from "@/lib/api/wire";
import styles from "./ThreadRail.module.css";

interface Props {
  threads: Thread[] | undefined;
  loading: boolean;
  activeId: string | null;
  error: boolean;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
  onRetry: () => void;
}

export function ThreadRail({
  threads, loading, activeId, error, onSelect, onCreate, onRetry,
}: Props) {
  return (
    <aside className={styles.rail} aria-label="会话列表">
      <div className={styles.top}>
        <Button size="sm" onClick={onCreate}>＋ 新对话</Button>
      </div>
      <div className={styles.list}>
        {loading && !threads ? (
          <Loading label="载入会话…" />
        ) : error ? (
          <div className={styles.error}>
            会话列表加载失败
            <Button size="sm" variant="ghost" onClick={onRetry}>重试</Button>
          </div>
        ) : !threads || threads.length === 0 ? (
          <Empty title="还没有会话" hint="点上方按钮开始第一段对话。" />
        ) : (
          threads.map((thread) => (
            <button
              key={thread.threadId}
              type="button"
              className={`${styles.item} ${thread.threadId === activeId ? styles.active : ""}`}
              onClick={() => onSelect(thread.threadId)}
              aria-current={thread.threadId === activeId ? "true" : undefined}
            >
              <span className={styles.title}>{thread.title || "未命名会话"}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
