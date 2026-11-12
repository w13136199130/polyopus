import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import styles from "./interactive.module.css";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: Radix warns without an accessible name. */
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Panel width in px (default 480). */
  width?: number;
}

/** Right-side panel; same Radix Dialog a11y core (focus/Esc/overlay). */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 480,
}: DrawerProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={styles.drawer}
          style={{ width }}
          aria-describedby={description ? undefined : undefined}
        >
          <div className={styles.dialogHeader}>
            <RadixDialog.Title className={styles.dialogTitle}>{title}</RadixDialog.Title>
            <RadixDialog.Close className={styles.dialogClose} aria-label="关闭">
              ×
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className={styles.dialogDescription}>
              {description}
            </RadixDialog.Description>
          ) : null}
          <div className={styles.drawerBody}>{children}</div>
          {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
