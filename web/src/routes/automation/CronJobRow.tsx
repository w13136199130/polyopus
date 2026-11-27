import { Button, StatusTag, Switch } from "@/components/ui";
import type { CronJobView } from "@/lib/api/wire";
import { describe, fmt } from "@/features/automation/form";
import styles from "./AutomationPage.module.css";

export interface CronJobRowProps {
  job: CronJobView;
  canWrite: boolean;
  runPending: boolean;
  onRun: () => void;
  onToggle: () => void;
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** 任务行：名称 + 类型/状态 + cron/上次 + 下次 + 开关 + 动作 (docs/52 §5). */
export function CronJobRow({
  job,
  canWrite,
  runPending,
  onRun,
  onToggle,
  onHistory,
  onEdit,
  onDelete,
}: CronJobRowProps) {
  const kind = job.schedule.startsWith("interval:")
    ? "间隔"
    : job.schedule.startsWith("once:") ? "单次" : "Cron";

  return (
    <article className={styles.row} data-testid="cron-row">
      <div className={styles.rowMain}>
        <div className={styles.rowTitle}>
          <b className={styles.name}>{job.name}</b>
          <StatusTag tone={job.enabled ? "green" : "neutral"}>
            {job.enabled ? "已启用" : "已暂停"}
          </StatusTag>
          <span className={styles.kind}>{kind}</span>
        </div>
        <div className={styles.rowMeta}>
          <code className={styles.schedule}>{job.schedule.replace(/^[a-z]+:/, "")}</code>
          <span>·</span>
          <span>{describe(job.schedule)}</span>
          <span>·</span>
          <span>上次 {fmt(job.lastRunAt)}</span>
        </div>
        <div className={styles.instruction}>{job.text || "—"}</div>
      </div>

      <div className={styles.next}>
        <span className={styles.nextLabel}>下次执行</span>
        <b>{fmt(job.nextRunAt)}</b>
        <span className={styles.timezone}>{job.timezone}</span>
      </div>

      <div className={styles.rowActions}>
        <Switch
          checked={job.enabled}
          disabled={!canWrite}
          label={job.enabled ? "暂停任务" : "启用任务"}
          testId="cron-toggle"
          onChange={onToggle}
        />
        <Button
          size="sm"
          variant="secondary"
          data-testid="cron-run"
          disabled={!canWrite || runPending}
          loading={runPending}
          onClick={onRun}
        >
          立即执行
        </Button>
        <Button size="sm" variant="ghost" data-testid="cron-history" onClick={onHistory}>
          运行记录
        </Button>
        <Button size="sm" variant="ghost" data-testid="cron-edit" disabled={!canWrite} onClick={onEdit}>
          编辑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={styles.danger}
          data-testid="cron-delete"
          disabled={!canWrite}
          onClick={onDelete}
        >
          删除
        </Button>
      </div>
    </article>
  );
}
