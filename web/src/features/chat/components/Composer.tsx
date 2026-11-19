import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TurnStatus } from "../streamStore";
import styles from "./Composer.module.css";

interface Props {
  disabled: boolean;
  status: TurnStatus;
  /** Restored text after a rollback (docs/49 §4.4: never swallow input). */
  restoredInput: string | null;
  onConsumedRestore: () => void;
  onSend: (content: string) => void;
  /** Resolved model name for the toolbar chip (prototype 模型 chip). */
  modelLabel?: string;
}

const MAX_HEIGHT = 200;

export function Composer({
  disabled, status, restoredInput, onConsumedRestore, onSend, modelLabel,
}: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // rollback restore lands in the box after mount (input is never swallowed)
  useEffect(() => {
    if (restoredInput === null) return;
    setValue((current) => (current === "" ? restoredInput : current));
    onConsumedRestore();
  }, [restoredInput, onConsumedRestore]);

  // autogrow: 2 rows minimum, capped so long drafts scroll instead of pushing
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function submit() {
    const content = value.trim();
    if (!content || disabled) return;
    setValue("");
    onSend(content);
    ref.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.composer}>
        <textarea
          ref={ref}
          className={styles.input}
          rows={2}
          placeholder={disabled ? "回复生成中…" : "输入消息，Enter 发送，Shift+Enter 换行"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="消息输入框"
          disabled={disabled && status !== "waiting_approval"}
        />
        <div className={styles.toolbar}>
          <span className={styles.tool} title="附件（v1.1）">＋</span>
          <span className={styles.tool} title="知识库引用（v1.1）">@</span>
          {modelLabel ? (
            <span className={styles.modelChip} title="当前模型" data-testid="composer-model">
              {modelLabel}
            </span>
          ) : null}
          <span className={styles.hint}>Enter 发送</span>
          <button
            type="button"
            className={styles.send}
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label="发送"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
