import styles from "./states.module.css";

export interface EmptyProps {
  title: string;
  hint?: string;
  /** Primary action for the empty state (docs/04: empty states carry one). */
  action?: { label: string; onClick: () => void };
}

export function Empty({ title, hint, action }: EmptyProps) {
  return (
    <div className={styles.stateBox} role="status">
      <p className={styles.stateTitle}>{title}</p>
      {hint ? <p className={styles.stateHint}>{hint}</p> : null}
      {action ? (
        <button type="button" className={styles.stateAction} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
