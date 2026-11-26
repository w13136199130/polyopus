import type { ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Optional footer strip (e.g. card actions or last-run hint). */
  footer?: ReactNode;
  className?: string;
  testId?: string;
}

/** Shared surface for cards, panels and KPI blocks (docs/52 §15). */
export function Card({
  title,
  subtitle,
  actions,
  children,
  footer,
  className,
  testId,
}: CardProps) {
  const hasHead = Boolean(title || subtitle || actions);
  return (
    <article
      className={`${styles.card} ${className ?? ""}`}
      data-testid={testId}
    >
      {hasHead ? (
        <header className={styles.head}>
          <div className={styles.heading}>
            {title ? <h2 className={styles.title}>{title}</h2> : null}
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      ) : null}
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </article>
  );
}
