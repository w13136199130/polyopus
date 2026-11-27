import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import icons from "@/layouts/icons";
import styles from "./ThreadRail.module.css";

export type SortMode = "recent" | "created" | "oldest";

const OPTIONS: ReadonlyArray<readonly [SortMode, string, string]> = [
  ["recent", "最近对话", "rail-sort-recent"],
  ["created", "最近创建", "rail-sort-created"],
  ["oldest", "最早创建", "rail-sort-oldest"],
];

/**
 * Conversation ordering for the rail. Expert groups stay in their stable
 * order; this only changes how conversations inside a group are listed.
 * Rendered through a portal so the scrolling rail cannot clip the menu.
 */
export function RailSortMenu({
  value, onChange,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    function close(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest("[data-rail-sort]")) {
        setPos(null);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPos(null);
    }
    function onResize() {
      setPos(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [pos]);

  function open(event: React.MouseEvent) {
    event.stopPropagation();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 148;
    const height = OPTIONS.length * 34 + 8;
    setPos({
      x: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)),
    });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.sortTrigger}
        aria-label="排序会话"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        data-testid="rail-sort"
        onClick={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={icons.sort} />
        </svg>
      </button>
      {pos
        ? createPortal(
            <div
              className={styles.sortMenu}
              role="menu"
              data-rail-sort
              style={{ left: pos.x, top: pos.y }}
            >
              {OPTIONS.map(([key, label, testId]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === key}
                  className={`${styles.sortItem} ${value === key ? styles.sortActive : ""}`}
                  data-testid={testId}
                  onClick={() => {
                    onChange(key);
                    setPos(null);
                  }}
                >
                  <span>{label}</span>
                  {value === key ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
