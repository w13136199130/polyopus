import { Button, Dialog } from "@/components/ui";
import type { AgentRow } from "@/lib/api/wire";
import styles from "./AgentDialogs.module.css";

export interface AgentDialogProps {
  agent: AgentRow | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DialogPublish({ agent, loading, onCancel, onConfirm }: AgentDialogProps) {
  return (
    <Dialog
      open={agent !== null}
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title="发布新版本"
      description={agent ? `将把「${agent.name}」的当前草稿发布为不可变新版本。` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button
            data-testid="confirm-agent-publish"
            loading={loading}
            onClick={onConfirm}
          >
            确认发布
          </Button>
        </>
      }
    >
      <p className={styles.note}>
        已发布版本不可修改；正在进行的会话继续使用其锁定的旧版本。
      </p>
    </Dialog>
  );
}

export function DialogDelete({ agent, loading, onCancel, onConfirm }: AgentDialogProps) {
  return (
    <Dialog
      open={agent !== null}
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title="确认删除专家"
      description={agent ? `将删除「${agent.name}」及其草稿。` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button
            variant="danger"
            data-testid="confirm-agent-delete"
            loading={loading}
            onClick={onConfirm}
          >
            确认删除
          </Button>
        </>
      }
    >
      <p className={styles.note}>
        已发布的历史版本记录将一并删除；此操作不可撤销。
      </p>
    </Dialog>
  );
}
