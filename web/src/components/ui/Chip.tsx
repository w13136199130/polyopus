import type { ReactNode } from "react";
import styles from "./Chip.module.css";

export interface ChipProps {
  children: ReactNode;
  active?: boolean;
  /** Count shown after the label, e.g. 全部 12. */
  count?: number;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  /** Native tooltip, e.g. why a chip is disabled. */
  title?: string;
}

/** Pill filter/segment. Uses a button when interactive, otherwise a span. */
export function Chip({ children, active, count, onClick, disabled, testId, title }: ChipProps) {
  const content = (
    <>
      <span>{children}</span>
      {typeof count === "number" ? <em className={styles.count}>{count}</em> : null}
    </>
  );
  if (!onClick) {
    return (
      <span
        className={`${styles.chip} ${active ? styles.active : ""}`}
        data-testid={testId}
        title={title}
      >
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.chip} ${active ? styles.active : ""}`}
      aria-pressed={Boolean(active)}
      disabled={disabled}
      data-testid={testId}
      title={title}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
