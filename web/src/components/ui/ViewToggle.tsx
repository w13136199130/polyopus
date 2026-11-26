import icons from "@/layouts/icons";
import styles from "./ViewToggle.module.css";

export type ViewMode = "card" | "table";

export interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Optional labels; default 卡片 / 表格. */
  labels?: Partial<Record<ViewMode, string>>;
  /** Test-id prefix; buttons become `${prefix}-card` / `${prefix}-table`. */
  testIdPrefix?: string;
}

/** Card/table switch used by 专家、知识库、插件 etc. (docs/52 §4/§9). */
export function ViewToggle({ value, onChange, labels, testIdPrefix = "view" }: ViewToggleProps) {
  const options: Array<[ViewMode, string, string]> = [
    ["card", labels?.card ?? "卡片", icons.grid],
    ["table", labels?.table ?? "表格", icons.table],
  ];
  return (
    <div className={styles.group} role="group" aria-label="视图">
      {options.map(([mode, label, path]) => (
        <button
          key={mode}
          type="button"
          className={`${styles.button} ${value === mode ? styles.active : ""}`}
          aria-label={label}
          aria-pressed={value === mode}
          data-testid={`${testIdPrefix}-${mode}`}
          onClick={() => onChange(mode)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={path} />
          </svg>
        </button>
      ))}
    </div>
  );
}
