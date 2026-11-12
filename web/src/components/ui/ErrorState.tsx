import styles from "./states.module.css";

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** Server trace id — shown so users can report it (docs/49 §7.3). */
  traceId?: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "出错了", message, traceId, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.stateBox} role="alert">
      <p className={`${styles.stateTitle} ${styles.stateTitleDanger}`}>{title}</p>
      <p className={styles.stateHint}>{message}</p>
      {traceId ? (
        <p className={styles.traceId}>
          trace: <code>{traceId}</code>
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className={styles.stateAction} onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
