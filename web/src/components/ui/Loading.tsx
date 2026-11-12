import styles from "./states.module.css";

export interface LoadingProps {
  label?: string;
}

/** Inline/loading-area spinner. Announces politely to screen readers. */
export function Loading({ label = "加载中…" }: LoadingProps) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.spinnerLg} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function PageLoading({ label }: LoadingProps) {
  return (
    <div className={styles.pageLoading}>
      <Loading label={label} />
    </div>
  );
}
