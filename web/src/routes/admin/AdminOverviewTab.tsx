import { Link } from "react-router";
import { Button, ErrorState, Loading } from "@/components/ui";
import {
  useAdminOverview,
  useStorageSnapshot,
} from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

type AdminTab = "models" | "storage" | "security" | "backup" | "jobs";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function money(micros: number): string {
  return `¥${(micros / 1_000_000).toFixed(2)}`;
}

function timeOf(ts: number): string {
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function AdminOverviewTab({
  onOpenTab,
}: {
  onOpenTab: (tab: AdminTab) => void;
}) {
  const query = useAdminOverview();
  const storage = useStorageSnapshot();
  const data = query.data;

  if (query.isLoading) return <Loading label="汇总实例状态…" />;
  if (query.isError) {
    return (
      <ErrorState
        message="总览加载失败"
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!data) return null;

  return (
    <div className={styles.overview}>
      <section className={styles.hero}>
        <div>
          <h2>实例概览</h2>
          <p>健康、队列、用量与数据地图；每 15 秒刷新。</p>
        </div>
        <span className={styles.heroMeta}>
          更新于 {new Date(data.generatedAt * 1000).toLocaleTimeString("zh-CN")}
        </span>
      </section>

      <div className={styles.kpiGrid}>
        {([
          ["活跃会话", data.health.activeSessions, ""],
          ["排队 turn", data.health.queueDepth, data.health.queueDepth ? "amber" : ""],
          ["运行中 turn", data.health.runningTurns, ""],
          ["待决 Attention", data.health.openAttentions,
            data.health.openAttentions ? "red" : ""],
          ["今日 token", tokens(data.usage.todayTokens), ""],
          ["今日成本", money(data.usage.todayCostMicros), ""],
          ["24h 错误率", `${(data.health.errorRate * 100).toFixed(1)}%`,
            data.health.errorRate > 0.05 ? "red" : "green"],
          ["P95 延迟", data.health.p95LatencyMs === null ? "—"
            : `${data.health.p95LatencyMs} ms`, ""],
        ] as const).map(([label, value, tone]) => (
          <div key={label} className={`${styles.kpi} ${tone ? styles[`kpi_${tone}`] : ""}`}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>

      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.head}>
            <h2>任务桶</h2>
            <span>attention / running / queued / done</span>
          </div>
          <div className={styles.bucketRow}>
            {([
              ["attention", "待我决定", styles.badgeRed],
              ["running", "进行中", styles.badgeGreen],
              ["queued", "已排队", styles.badgeNeutral],
              ["done", "已完成", styles.badgeGreen],
            ] as const).map(([key, label, tone]) => (
              <div key={key} className={styles.bucketItem}>
                <span>{label}</span>
                <b>{data.tickets[key]}</b>
                <span className={`${styles.badge} ${tone}`}>{key}</span>
              </div>
            ))}
          </div>
          <div className={styles.quickRow}>
            <span className={styles.muted}>最近需要处理</span>
            <span className={styles.spacer} />
            <Link to="/tasks?bucket=attention" className={styles.link}>查看任务中心 →</Link>
          </div>
          {data.recentTickets.length ? (
            <ul className={styles.ticketList}>
              {data.recentTickets.map((ticket) => (
                <li key={ticket.ticketId}>
                  <Link to={`/tasks?ticketId=${encodeURIComponent(ticket.ticketId)}`}>
                    <span className={`${styles.badge} ${
                      ticket.bucket === "attention" ? styles.badgeRed
                        : ticket.bucket === "running" ? styles.badgeGreen
                          : styles.badgeNeutral
                    }`}>
                      {ticket.bucket}
                    </span>
                    <span className={styles.ticketTitle}>{ticket.title}</span>
                    <span className={styles.muted}>{timeOf(ticket.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className={styles.muted}>当前没有待处理任务。</p>}
        </section>

        <section className={styles.panel}>
          <div className={styles.head}>
            <h2>数据地图</h2>
            <span>{storage.data?.note ?? "本地存储"}</span>
          </div>
          {storage.isLoading ? <Loading label="统计容量…" /> : storage.data ? (
            <div className={styles.mapGrid}>
              {([
                ["控制面数据库", storage.data.db.bytes],
                ["数据目录", storage.data.data.bytes],
                ["工作区", storage.data.workspace.bytes],
                ["备份", storage.data.backups.bytes],
              ] as const).map(([label, size]) => (
                <div key={label} className={styles.mapItem}>
                  <span>{label}</span>
                  <b>{bytes(size)}</b>
                </div>
              ))}
            </div>
          ) : <p className={styles.muted}>存储信息暂不可用。</p>}
          <div className={styles.quickRow}>
            <Button size="sm" variant="secondary" onClick={() => onOpenTab("storage")}>
              存储与备份设置
            </Button>
          </div>
          <div className={styles.backupLine}>
            {data.backup ? (
              <>
                <span>最近备份</span>
                <b>{timeOf(data.backup.createdAt)}</b>
                <span className={`${styles.badge} ${
                  data.backup.status === "ready" ? styles.badgeGreen : styles.badgeRed
                }`}>{data.backup.status}</span>
                <span className={styles.muted}>{bytes(data.backup.sizeBytes)}</span>
              </>
            ) : <span className={styles.muted}>还没有备份。</span>}
            <span className={styles.spacer} />
            <Button size="sm" variant="ghost" onClick={() => onOpenTab("backup")}>
              备份列表
            </Button>
          </div>
        </section>
      </div>

      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.head}>
            <h2>最近审计</h2>
            <span>追加写日志，不可修改</span>
            <span className={styles.spacer} />
            <Button size="sm" variant="ghost" onClick={() => onOpenTab("audit" as never)}>
              全部审计
            </Button>
          </div>
          {data.recentAudit.length ? (
            <ul className={styles.auditList}>
              {data.recentAudit.map((row, index) => (
                <li key={`${row.action}-${row.createdAt}-${index}`}>
                  <span className={`${styles.badge} ${
                    row.result === "ok" ? styles.badgeGreen
                      : row.result === "denied" ? styles.badgeRed : styles.badgeAmber
                  }`}>{row.result}</span>
                  <code>{row.action}</code>
                  <span className={styles.muted}>
                    {row.actorId ?? "system"} · {timeOf(row.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className={styles.muted}>还没有审计记录。</p>}
        </section>

        <section className={styles.panel}>
          <div className={styles.head}>
            <h2>快捷入口</h2>
            <span>实例级配置</span>
          </div>
          <div className={styles.shortcutGrid}>
            {([
              ["models", "模型配置", "Provider / 模型 / 探活"],
              ["storage", "存储", "容量 / 自动备份"],
              ["security", "安全", "策略 / 工具 / 审计"],
              ["backup", "备份", "快照 / 恢复 / 导入"],
              ["jobs", "数据任务", "导出 / 租户清理"],
            ] as const).map(([tab, label, hint]) => (
              <button
                key={tab}
                type="button"
                className={styles.shortcut}
                onClick={() => onOpenTab(tab)}
              >
                <b>{label}</b>
                <span>{hint}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
