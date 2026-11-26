import type { ReactNode } from "react";
import styles from "./FilterBar.module.css";

export interface FilterBarProps {
  /** Left-side summary, e.g. "共 12 个专家". */
  count?: ReactNode;
  /** Filter controls (chips, segmented switch, selects). */
  children?: ReactNode;
  /** Right-side search, view toggle and primary actions. */
  right?: ReactNode;
  testId?: string;
}

/** The "过滤器行" shared by list pages (docs/52 §2). */
export function FilterBar({ count, children, right, testId }: FilterBarProps) {
  return (
    <div className={styles.bar} data-testid={testId}>
      <div className={styles.left}>
        {count ? <span className={styles.count}>{count}</span> : null}
        {children}
      </div>
      {right ? <div className={styles.right}>{right}</div> : null}
    </div>
  );
}
