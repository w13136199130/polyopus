import { Button, Table, type Column } from "@/components/ui";
import type { AgentRow } from "@/lib/api/wire";
import styles from "./AgentsPage.module.css";

export interface AgentsTableProps {
  agents: readonly AgentRow[];
  canWrite: boolean;
  onOpen: (agent: AgentRow) => void;
  onTest: (agent: AgentRow) => void;
  onPublish: (agent: AgentRow) => void;
  onDelete: (agent: AgentRow) => void;
}

function updatedAt(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}

/** Table view for 我的专家, mirroring the card's columns (docs/52 §4). */
export function AgentsTable({
  agents,
  canWrite,
  onOpen,
  onTest,
  onPublish,
  onDelete,
}: AgentsTableProps) {
  const columns: Array<Column<AgentRow>> = [
    {
      key: "name",
      header: "专家",
      render: (agent) => (
        <div className={styles.cellName}>
          <b>{agent.name}</b>
          <small>{agent.agentId}</small>
        </div>
      ),
    },
    {
      key: "status",
      header: "状态",
      width: "110px",
      render: (agent) => (
        <span
          className={`${styles.status} ${
            agent.status === "published" ? styles.statusOn : styles.statusDraft
          }`}
          data-testid="agent-status"
        >
          {agent.status === "published" ? `已发布 v${agent.version}` : "草稿"}
        </span>
      ),
    },
    {
      key: "model",
      header: "模型",
      width: "160px",
      render: (agent) => agent.model || "默认模型",
    },
    {
      key: "tools",
      header: "工具",
      width: "70px",
      render: (agent) => agent.tools.length,
    },
    {
      key: "updated",
      header: "更新时间",
      width: "110px",
      render: (agent) => updatedAt(agent.updatedAt),
    },
    {
      key: "actions",
      header: "操作",
      width: "220px",
      render: (agent) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="ghost" onClick={() => onOpen(agent)}>打开</Button>
          <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => onTest(agent)}>
            试运行
          </Button>
          <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => onPublish(agent)}>
            发布
          </Button>
          <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => onDelete(agent)}>
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.tableWrap}>
      <Table
        caption="专家列表"
        columns={columns}
        rows={agents}
        rowKey={(agent) => agent.agentId}
      />
    </div>
  );
}
