import type { ReactNode } from "react";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import styles from "./PageShell.module.css";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** One page = one header (title/actions) + scrollable content (docs/04 §1). */
export function PageShell({ title, subtitle, actions, children }: Props) {
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        <div className={styles.actions}>
          {actions}
          <NotificationBell />
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
