import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Thread } from "@/lib/api/wire";
import styles from "./SessionMenu.module.css";

export interface SessionMenuProps {
  thread: Thread;
  onRename: (thread: Thread) => void;
  onPin: (thread: Thread) => void;
  onBranch: (thread: Thread) => void;
  onDelete: (thread: Thread) => void;
  /** "rail" hides the share entry; the header owns sharing. */
  variant?: "rail" | "header";
  onShare?: (thread: Thread) => void;
}

/**
 * The ⋯ menu shared by the session rail and the chat header
 * (prototype: 重命名 / 置顶 / 创建分支 / 删除会话 / 分享).
 *
 * Rendered through a portal with fixed coordinates so an overflowing rail
 * cannot clip it. Closes on outside click, Escape, scroll and resize.
 */
export function SessionMenu({
  thread, onRename, onPin, onBranch, onDelete, variant = "rail", onShare,
}: SessionMenuProps) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    function close(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest("[data-session-menu]")) {
        setPos(null);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPos(null);
    }
    function onScroll() {
      setPos(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [pos]);

  function open(event: React.MouseEvent) {
    event.stopPropagation();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 188;
    const height = variant === "header" && onShare ? 212 : 176;
    setPos({
      x: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)),
    });
  }

  function run(action: (thread: Thread) => void) {
    setPos(null);
    action(thread);
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label="会话操作"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        data-testid="thread-menu"
        onClick={open}
      >
        ⋯
      </button>
      {pos
        ? createPortal(
            <div
              className={styles.menu}
              role="menu"
              data-session-menu
              style={{ left: pos.x, top: pos.y }}
            >
              <button type="button" role="menuitem" onClick={() => run(onRename)}>
                重命名
              </button>
              <button type="button" role="menuitem" onClick={() => run(onPin)}>
                {thread.pinned ? "取消置顶" : "置顶"}
              </button>
              <button type="button" role="menuitem" onClick={() => run(onBranch)}>
                创建分支
              </button>
              {variant === "header" && onShare ? (
                <button type="button" role="menuitem" onClick={() => run(onShare)}>
                  分享链接
                </button>
              ) : null}
              <div className={styles.sep} />
              <button
                type="button"
                role="menuitem"
                className={styles.danger}
                onClick={() => run(onDelete)}
              >
                删除会话
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
