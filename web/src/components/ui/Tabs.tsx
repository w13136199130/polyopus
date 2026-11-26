import { useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  /** Optional count rendered after the label (e.g. 待我决定 3). */
  badge?: number;
  testId?: string;
  disabled?: boolean;
}

export interface TabsProps<K extends string = string> {
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
  /** `page` = underline row under the page header; `segmented` = pill switch. */
  variant?: "page" | "segmented";
}

/**
 * Shared tab row for "页头 + 页内 Tab" pages (docs/52 §2). Controlled,
 * URL-agnostic: pages keep the selected key in search params themselves.
 */
export function Tabs<K extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  variant = "page",
}: TabsProps<K>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const enabled = items
      .map((item, position) => ({ item, position }))
      .filter(({ item }) => !item.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex(({ position }) => position === index);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % enabled.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else return;
    event.preventDefault();
    const target = enabled[next];
    onChange(target.item.key);
    refs.current[target.position]?.focus();
  }

  return (
    <div
      className={`${styles.tabs} ${variant === "segmented" ? styles.segmented : ""}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item, index) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            data-testid={item.testId}
            className={`${styles.tab} ${selected ? styles.active : ""}`}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{item.label}</span>
            {typeof item.badge === "number" ? (
              <span className={styles.badge}>{item.badge > 99 ? "99+" : item.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
