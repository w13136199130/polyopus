import { Button, Card, StatusTag } from "@/components/ui";
import type { AgentRow } from "@/lib/api/wire";
import styles from "./AgentCard.module.css";

function statusLabel(agent: AgentRow): string {
  if (agent.status === "published") return `已发布 v${agent.version}`;
  if (agent.status === "disabled") return "已停用";
  return "草稿";
}

export interface AgentCardProps {
  agent: AgentRow;
  canWrite: boolean;
  onOpen: () => void;
  onTest: () => void;
  onPublish: () => void;
  onDelete: () => void;
}

/** 专家卡：头像 + 名称/ID、状态·模型·版本、两行描述、动作条 (docs/52 §4). */
export function AgentCard({
  agent,
  canWrite,
  onOpen,
  onTest,
  onPublish,
  onDelete,
}: AgentCardProps) {
  return (
    <Card
      testId="agent-row"
      className={styles.card}
      title={
        <span className={styles.identity}>
          <span className={styles.avatar}>{agent.name.slice(0, 1).toUpperCase()}</span>
          <span className={styles.names}>
            <b className={styles.name}>{agent.name}</b>
            <small className={styles.id}>{agent.agentId}</small>
          </span>
        </span>
      }
      footer={
        <div className={styles.actions}>
          <Button size="sm" data-testid="agent-open" onClick={onOpen}>
            打开
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="agent-try"
            disabled={!canWrite}
            onClick={onTest}
          >
            试运行
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="agent-publish"
            disabled={!canWrite}
            onClick={onPublish}
          >
            发布
          </Button>
          <details className={styles.more}>
            <summary aria-label="更多操作" data-testid="agent-more">⋯</summary>
            <div className={styles.moreMenu}>
              <button
                type="button"
                className={styles.moreDanger}
                disabled={!canWrite}
                onClick={onDelete}
              >
                删除
              </button>
            </div>
          </details>
        </div>
      }
    >
      <p className={styles.desc}>{agent.description || "无描述"}</p>
      <div className={styles.tags}>
        <StatusTag
          tone={agent.status === "published" ? "green" : "amber"}
          testId="agent-status"
        >
          {statusLabel(agent)}
        </StatusTag>
        <span className={styles.tag}>{agent.model || "默认模型"}</span>
        <span className={styles.tag}>{agent.tools.length} 工具</span>
      </div>
    </Card>
  );
}
