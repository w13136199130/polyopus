import { ErrorState, Loading } from "@/components/ui";
import type { CronJobView } from "@/lib/api/wire";
import { useCronRuns } from "@/features/automation/api";
import { describe, fmt } from "@/features/automation/form";
import styles from "./AutomationPage.module.css";

/** 列表下方独立“最近执行”卡；跟随当前选中的任务。 */
export function RecentRunsCard({ job }: { job: CronJobView | null }) {
  const runs = useCronRuns(job?.cronJobId ?? null);

  return (
    <section className={styles.recent} data-testid="cron-recent">
      <header className={styles.recentHead}>
        <b>最近执行</b>
        <span>{job ? `${job.name} · ${describe(job.schedule)}` : "选择一个任务查看运行历史"}</span>
      </header>
      {!job ? null : runs.isLoading ? (
        <Loading label="载入运行记录…" />
      ) : runs.isError ? (
        <ErrorState message="运行记录加载失败" onRetry={() => void runs.refetch()} />
      ) : !runs.data?.items.length ? (
        <p className={styles.recentEmpty}>还没有运行记录；到点或点「立即执行」后出现。</p>
      ) : (
        <ul className={styles.runs}>
          {runs.data.items.slice(0, 8).map((run) => (
            <li key={run.runId} className={styles.runRow}>
              <span className={`${styles.runDot} ${run.status === "succeeded" ? styles.on : styles.off}`} />
              <span className={styles.runStatus}>
                {run.status === "succeeded" ? "成功" : run.status === "running" ? "运行中" : "失败"}
              </span>
              <span className={styles.runTime}>{fmt(run.startedAt ?? run.scheduledAt)}</span>
              <span className={styles.runMeta}>
                {run.error ? run.error : run.triggerId ? `trigger ${run.triggerId}` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
