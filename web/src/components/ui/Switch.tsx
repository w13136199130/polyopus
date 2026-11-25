import styles from "./Switch.module.css";

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  testId?: string;
  onChange: (next: boolean) => void;
}

/** Native checkbox behind a switch track: keeps form/a11y semantics. */
export function Switch({ checked, disabled, label, testId, onChange }: SwitchProps) {
  return (
    <label className={styles.switch}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.track} aria-hidden="true" />
    </label>
  );
}
