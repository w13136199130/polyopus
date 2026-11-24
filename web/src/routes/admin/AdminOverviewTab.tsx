/** Admin → 概览: health KPIs, quick entries and the data map. */

import paths, { type IconName } from "@/layouts/icons";
import { ErrorState, Loading } from "@/components/ui";
import { useAdminOverview, useStorageSnapshot } from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

type AdminTab = "users" | "models" | "storage" | "plugins" | "security" | "app";

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

function latency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms} ms`;
}

function percent(value: number): string {
  const pct = value * 100;
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

function Glyph({ name, size = 15 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

const QUICK: ReadonlyArray<readonly [AdminTab, string, string, IconName]> = [
  ["users", "用户管理", "账号、角色与用户分组", "users"],
  ["models", "模型配置", "对话模型与 Provider", "cpu"],
  ["storage", "存储管理", "本地目录、备份与容量", "database"],
  ["plugins", "插件管理", "服务器插件与权限", "puzzle"],
  ["security", "安全防护", "审批、文件、命令与审计", "shield"],
  ["app", "应用设置", "备份、运行参数与更新", "sliders"],
];

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
    return <ErrorState message="总览加载失败" onRetry={() => void query.refetch()} />;
  }
  if (!data) return null;

  const health = data.health;

  return (
    <div className={styles.page}>
      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <span>活跃会话</span>
          <b>{health.activeSessions}</b>
          <small>当前打开的对话</small>
        </div>
        <div className={styles.kpiCard}>
          <span>队列深度</span>
          <b className={health.queueDepth ? styles.kpiAmber : ""}>{health.queueDepth}</b>
          <small>等待执行的 turn</small>
        </div>
        <div className={styles.kpiCard}>
          <span>错误率</span>
          <b className={health.errorRate > 0.05 ? styles.kpiRed : ""}>
            {percent(health.errorRate)}
          </b>
          <small>最近 24 小时</small>
        </div>
        <div className={styles.kpiCard}>
          <span>P95 延迟</span>
          <b>{latency(health.p95LatencyMs)}</b>
          <small>最近 24 小时</small>
        </div>
      </div>

      <div className={styles.statStrip}>
        <div><span>运行中 turn</span><b>{health.runningTurns}</b></div>
        <div><span>待决 Attention</span><b>{health.openAttentions}</b></div>
        <div><span>今日 token</span><b>{tokens(data.usage.todayTokens)}</b></div>
        <div><span>今日成本</span><b>{money(data.usage.todayCostMicros)}</b></div>
      </div>

      <div className={styles.quickGrid}>
        {QUICK.map(([tab, label, hint, icon]) => (
          <button
            key={tab}
            type="button"
            className={styles.quickCard}
            onClick={() => onOpenTab(tab)}
          >
            <span className={styles.quickIcon}><Glyph name={icon} /></span>
            <span className={styles.quickBody}>
              <b>{label}</b>
              <span>{hint}</span>
            </span>
            <span className={styles.quickArrow}>进入 →</span>
          </button>
        ))}
      </div>

      <section className={styles.panel}>
        <div className={styles.head}>
          <h2>数据地图</h2>
          <span>存储与容量</span>
        </div>
        {storage.isLoading ? <Loading label="统计容量…" /> : storage.isError ? (
          <ErrorState message="存储信息加载失败" onRetry={() => void storage.refetch()} />
        ) : storage.data ? (
          <div className={styles.mapTable} data-testid="admin-data-map">
            {([
              ["控制面数据库", "SQLite", storage.data.db.bytes],
              ["数据目录", storage.data.data.path, storage.data.data.bytes],
              ["工作区", storage.data.workspace.path, storage.data.workspace.bytes],
              ["备份目录", storage.data.backups.path, storage.data.backups.bytes],
            ] as const).map(([label, meta, size]) => (
              <div key={label} className={styles.mapRow}>
                <div className={styles.mapMain}>
                  <b>{label}</b>
                  <span title={meta}>{meta}</span>
                </div>
                <span className={styles.mapSize}>{bytes(size)}</span>
                <span className={`${styles.badge} ${styles.badgeGreen}`}>正常</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
