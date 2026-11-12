import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import styles from "./interactive.module.css";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: Radix warns without an accessible name. */
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Content width in px (default 480). */
  width?: number;
}

/**
 * Modal dialog on Radix primitives: focus trap, Esc/overlay close, aria
 * wiring and scroll lock all come from @radix-ui/react-dialog.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 480,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={styles.dialog}
          style={{ maxWidth: width }}
          aria-describedby={description ? undefined : undefined}
        >
          <div className={styles.dialogHeader}>
            <RadixDialog.Title className={styles.dialogTitle}>{title}</RadixDialog.Title>
            <RadixDialog.Close
              className={styles.dialogClose}
              aria-label="关闭"
            >
              ×
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className={styles.dialogDescription}>
              {description}
            </RadixDialog.Description>
          ) : null}
          <div className={styles.dialogBody}>{children}</div>
          {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
