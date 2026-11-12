import styles from "./states.module.css";

export interface StreamIndicatorProps {
  label?: string;
}

/**
 * Stream status pill (docs/33 §5.2): shown while reconnecting so the stream
 * never looks dead without explanation.
 */
export function StreamConnectingIndicator({
  label = "连接中断，正在重连…",
}: StreamIndicatorProps) {
  return (
    <div className={styles.streamPill} role="status" aria-live="polite">
      <span className={styles.spinnerSm} aria-hidden="true" />
      {label}
    </div>
  );
}
