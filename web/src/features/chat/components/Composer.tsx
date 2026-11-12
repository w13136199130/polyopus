import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui";
import type { TurnStatus } from "../streamStore";
import styles from "./Composer.module.css";

interface Props {
  disabled: boolean;
  status: TurnStatus;
  /** Restored text after a rollback (docs/49 §4.4: never swallow input). */
  restoredInput: string | null;
  onConsumedRestore: () => void;
  onSend: (content: string) => void;
}

export function Composer({
  disabled, status, restoredInput, onConsumedRestore, onSend,
}: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // rollback restore lands in the box after mount (input is never swallowed)
  useEffect(() => {
    if (restoredInput === null) return;
    setValue((current) => (current === "" ? restoredInput : current));
    onConsumedRestore();
  }, [restoredInput, onConsumedRestore]);

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
      <Button onClick={submit} disabled={disabled || !value.trim()}>
        发送
      </Button>
    </div>
  );
}
