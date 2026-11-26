import type { ReactNode } from "react";
import styles from "./Kpi.module.css";

export interface KpiItem {
  label: string;
  value: ReactNode;
  /** Optional unit or secondary hint, e.g. "本轮" / "缓存". */
  hint?: ReactNode;
  testId?: string;
}

export interface KpiProps {
  items: readonly KpiItem[];
  /** Wrap into an outer card surface (default true). */
  framed?: boolean;
}

/** One-row KPI strip (docs/52 §6): 7 segments on desktop, scrolls on narrow. */
export function Kpi({ items, framed = true }: KpiProps) {
  return (
    <div
      className={`${styles.strip} ${framed ? styles.framed : ""}`}
      role="list"
      aria-label="关键指标"
    >
      {items.map((item) => (
        <div key={item.label} className={styles.item} role="listitem">
          <span className={styles.label}>{item.label}</span>
          <span className={styles.value} data-testid={item.testId}>{item.value}</span>
          {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}
