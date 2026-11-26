import type { ReactNode } from "react";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import styles from "./PageShell.module.css";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Page-tab row rendered directly under the header. */
  tabs?: ReactNode;
  /**
   * Sticky filter/toolbar row. Kept outside the scroll container so filters do
   * not scroll away while the list/table moves.
   */
  filters?: ReactNode;
  /** Hide the global notification bell (full-screen pages only). */
  bell?: boolean;
  children: ReactNode;
}

/**
 * One page = header (title/actions) + optional tabs + optional filter row +
 * one scrollable content area (docs/04 §3.2). This is the page contract; page
 * bodies should not re-implement their own header/tab rows.
 */
export function PageShell({
  title,
  subtitle,
  actions,
  tabs,
  filters,
  bell = true,
  children,
}: Props) {
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        <div className={styles.actions}>
          {actions}
          {bell ? <NotificationBell /> : null}
        </div>
      </header>
      {tabs ? <div className={styles.tabs}>{tabs}</div> : null}
      {filters ? <div className={styles.filters}>{filters}</div> : null}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
