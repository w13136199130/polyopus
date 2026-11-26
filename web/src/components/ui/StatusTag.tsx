import type { ReactNode } from "react";
import styles from "./StatusTag.module.css";

export type StatusTone = "green" | "amber" | "red" | "blue" | "neutral";

export interface StatusTagProps {
  tone?: StatusTone;
  children: ReactNode;
  testId?: string;
  title?: string;
}

/** Unified status/kind pill; replaces per-page badge/status classes. */
export function StatusTag({ tone = "neutral", children, testId, title }: StatusTagProps) {
  return (
    <span
      className={`${styles.tag} ${styles[tone]}`}
      data-testid={testId}
      title={title}
    >
      {children}
    </span>
  );
}
