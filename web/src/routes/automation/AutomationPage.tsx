/**
 * Automation page (prototype `#/automation`): scheduled jobs backed by the
 * existing cron intake source — create/edit, pause/resume, run now, inspect
 * run history and delete. One cron job == one schedule source (ADR-004).
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Drawer, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import type { CronJobView } from "@/lib/api/wire";
import {
  useCronJobs,
  useCronRuns,
  useCreateCron,
  useDeleteCron,
  useRunCron,
  useToggleCron,
  useUpdateCron,
} from "@/features/automation/api";
import styles from "./AutomationPage.module.css";

type Filter = "all" | "on" | "off";
type ScheduleKind = "cron" | "interval" | "once";

const TIMEZONES = [
  "Asia/Shanghai", "UTC", "Asia/Tokyo", "Asia/Singapore",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
];

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

function splitSchedule(schedule: string): { kind: ScheduleKind; value: string } {
  if (schedule.startsWith("interval:")) {
    return { kind: "interval", value: schedule.slice("interval:".length) };
  }
  if (schedule.startsWith("once:")) {
    return { kind: "once", value: schedule.slice("once:".length) };
  }
  return {
    kind: "cron",
    value: schedule.startsWith("cron:") ? schedule.slice("cron:".length) : schedule,
  };
}

function describe(schedule: string): string {
  const { kind, value } = splitSchedule(schedule);
  if (kind === "interval") {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return schedule;
    if (seconds % 3600 === 0) return `每 ${seconds / 3600} 小时`;
    if (seconds % 60 === 0) return `每 ${seconds / 60} 分钟`;
    return `每 ${seconds} 秒`;
  }
  if (kind === "once") {
    const ts = Number(value);
    return Number.isFinite(ts) && ts > 0
      ? `单次 · ${new Date(ts * 1000).toLocaleString("zh-CN")}`
      : schedule;
  }
  const fields = value.trim().split(/\s+/);
  if (fields.length === 5) {
    const [minute, hour, dom, month, dow] = fields;
    if (minute === "0" && hour !== "*" && dom === "*" && month === "*" && dow === "*") {
      return `每天 ${hour.padStart(2, "0")}:00`;
    }
    if (minute === "0" && hour !== "*" && dow === "1-5") {
      return `工作日 ${hour.padStart(2, "0")}:00`;
    }
    if (minute === "0" && hour !== "*" && dow !== "*") {
      return `每周 ${dow} ${hour.padStart(2, "0")}:00`;
    }
    if (minute.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
      return `每 ${minute.slice(2)} 分钟`;
    }
  }
  return `Cron ${value}`;
}

function fmt(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function inputDate(epoch: string): string {
  const ts = Number(epoch);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const date = new Date(ts * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface FormState {
  name: string;
  kind: ScheduleKind;
  cron: string;
  interval: string;
  once: string;
  timezone: string;
  text: string;
  enabled: boolean;
}

function formOf(job: CronJobView | null): FormState {
  if (!job) {
    return {
      name: "", kind: "cron", cron: "0 9 * * *", interval: "3600",
      once: "", timezone: defaultTimezone(), text: "/polyopus 定时任务",
      enabled: true,
    };
  }
  const { kind, value } = splitSchedule(job.schedule);
  return {
    name: job.name,
    kind,
    cron: kind === "cron" ? value : "0 9 * * *",
    interval: kind === "interval" ? value : "3600",
    once: kind === "once" ? inputDate(value) : "",
    timezone: job.timezone,
    text: job.text,
    enabled: job.enabled,
  };
}

function scheduleOf(form: FormState): string {
  if (form.kind === "interval") return `interval:${Math.max(1, Number(form.interval) || 3600)}`;
  if (form.kind === "once") {
    const ms = new Date(form.once).getTime();
    return `once:${Number.isFinite(ms) ? Math.floor(ms / 1000) : 0}`;
  }
  return `cron:${form.cron.trim()}`;
}

export function AutomationPage() {
  const jobsQuery = useCronJobs();
  const createJob = useCreateCron();
  const updateJob = useUpdateCron();
  const toggleJob = useToggleCron();
  const deleteJob = useDeleteCron();
  const runJob = useRunCron();
  const canWrite = useCan("cron:write");

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CronJobView | null>(null);
  const [creating, setCreating] = useState(false);
  const [historyJob, setHistoryJob] = useState<CronJobView | null>(null);
  const [deleting, setDeleting] = useState<CronJobView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data]);
  const enabled = jobs.filter((job) => job.enabled).length;
  const filtered = jobs.filter((job) => {
    if (filter === "on" && !job.enabled) return false;
    if (filter === "off" && job.enabled) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${job.name} ${job.schedule} ${job.text}`.toLowerCase().includes(needle);
  });

  function reportError(err: unknown) {
    setError(err instanceof Error ? err.message : "操作失败，请重试");
  }

  function runNow(job: CronJobView) {
    setError(null);
    runJob.mutate(job.cronJobId, {
      onSuccess: (result) =>
        setNotice(
          result.status === "succeeded"
            ? `已立即执行「${job.name}」${result.ticketId ? ` · 任务 ${result.ticketId}` : ""}`
            : `执行失败：${result.error ?? "未知错误"}`,
        ),
      onError: reportError,
    });
  }

  return (
    <PageShell
      title="自动化"
      subtitle={`${jobs.length} 个定时任务 · ${enabled} 个启用 · 按服务器时区调度`}
      actions={
        <Button
          size="sm"
          data-testid="cron-new"
          disabled={!canWrite}
          onClick={() => {
            setNotice(null);
            setCreating(true);
          }}
        >
          ＋ 创建定时任务
        </Button>
      }
    >
      <div className={styles.page}>
        {notice ? (
          <button type="button" className={styles.notice} onClick={() => setNotice(null)}>
            {notice}
          </button>
        ) : null}
        {error ? (
          <button type="button" className={styles.error} onClick={() => setError(null)}>
            {error}
          </button>
        ) : null}

        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="任务筛选">
            {([
              ["all", `全部 ${jobs.length}`],
              ["on", `已启用 ${enabled}`],
              ["off", `已暂停 ${jobs.length - enabled}`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={`${styles.tab} ${filter === value ? styles.tabOn : ""}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className={styles.spacer} />
          <input
            className={styles.search}
            type="search"
            placeholder="搜索任务名、Cron 或指令"
            aria-label="搜索定时任务"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {jobsQuery.isLoading && !jobsQuery.data ? (
          <Loading label="载入定时任务…" />
        ) : jobsQuery.isError ? (
          <ErrorState message="定时任务加载失败" onRetry={() => void jobsQuery.refetch()} />
        ) : filtered.length === 0 ? (
          <Empty
            title={jobs.length ? "没有匹配的任务" : "还没有定时任务"}
            hint="创建一个 Cron/间隔/单次任务，让专家按计划自动执行。"
            action={{
              label: "创建定时任务",
              onClick: () => setCreating(true),
            }}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>调度</th>
                  <th>时区</th>
                  <th>下次运行</th>
                  <th>上次运行</th>
                  <th>状态</th>
                  <th style={{ textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((job) => (
                  <tr key={job.cronJobId} data-testid="cron-row">
                    <td>
                      <b className={styles.name}>{job.name}</b>
                      <div className={styles.instruction}>{job.text || "—"}</div>
                    </td>
                    <td>
                      <div>{describe(job.schedule)}</div>
                      <code className={styles.schedule}>{job.schedule}</code>
                    </td>
                    <td className={styles.mono}>{job.timezone}</td>
                    <td className={styles.mono}>{fmt(job.nextRunAt)}</td>
                    <td className={styles.mono}>{fmt(job.lastRunAt)}</td>
                    <td>
                      <span className={`${styles.status} ${job.enabled ? styles.on : styles.off}`}>
                        {job.enabled ? "已启用" : "已暂停"}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="cron-run"
                          disabled={!canWrite || runJob.isPending}
                          onClick={() => runNow(job)}
                        >
                          立即执行
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="cron-toggle"
                          disabled={!canWrite}
                          onClick={() =>
                            toggleJob.mutate(
                              { jobId: job.cronJobId, enabled: !job.enabled },
                              { onError: reportError },
                            )}
                        >
                          {job.enabled ? "暂停" : "恢复"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="cron-history"
                          onClick={() => setHistoryJob(job)}
                        >
                          运行记录
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="cron-edit"
                          disabled={!canWrite}
                          onClick={() => setEditing(job)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={styles.danger}
                          data-testid="cron-delete"
                          disabled={!canWrite}
                          onClick={() => setDeleting(job)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CronDrawer
        open={creating || editing !== null}
        job={editing}
        busy={createJob.isPending || updateJob.isPending}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={(form) => {
          const body = {
            name: form.name.trim(),
            schedule: scheduleOf(form),
            timezone: form.timezone,
            text: form.text,
          };
          if (!body.name) {
            setError("任务名称不能为空");
            return;
          }
          if (editing) {
            updateJob.mutate(
              { jobId: editing.cronJobId, ...body, enabled: form.enabled },
              {
                onSuccess: () => {
                  setEditing(null);
                  setNotice(`已更新「${body.name}」`);
                },
                onError: reportError,
              },
            );
          } else {
            createJob.mutate(body, {
              onSuccess: () => {
                setCreating(false);
                setNotice(`已创建「${body.name}」`);
              },
              onError: reportError,
            });
          }
        }}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="删除定时任务"
        description="任务及其历史执行记录会一并删除，此操作不可撤销。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="cron-delete-confirm"
              loading={deleteJob.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteJob.mutate(deleting.cronJobId, {
                  onSuccess: () => {
                    setNotice(`已删除「${deleting.name}」`);
                    setDeleting(null);
                  },
                  onError: reportError,
                });
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <p>确定删除「{deleting?.name}」？</p>
      </Dialog>

      <RunHistory
        job={historyJob}
        onClose={() => setHistoryJob(null)}
      />
    </PageShell>
  );
}

function CronDrawer({
  open, job, busy, onClose, onSave,
}: {
  open: boolean;
  job: CronJobView | null;
  busy: boolean;
  onClose: () => void;
  onSave: (form: FormState) => void;
}) {
  const [form, setForm] = useState<FormState>(() => formOf(job));
  useEffect(() => {
    if (open) setForm(formOf(job));
  }, [open, job]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={job ? "编辑定时任务" : "创建定时任务"}
      description="任务由服务端调度；错过执行时间会在容忍窗口内补跑一次。"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button data-testid="cron-save" loading={busy} onClick={() => onSave(form)}>
            保存
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          任务名称
          <input
            data-testid="cron-name"
            value={form.name}
            maxLength={100}
            placeholder="例如：每日科技新闻"
            onChange={(event) => set("name", event.target.value)}
          />
        </label>

        <label className={styles.field}>
          调度方式
          <select
            data-testid="cron-kind"
            value={form.kind}
            onChange={(event) => set("kind", event.target.value as ScheduleKind)}
          >
            <option value="cron">Cron 表达式</option>
            <option value="interval">固定间隔</option>
            <option value="once">单次执行</option>
          </select>
        </label>

        {form.kind === "cron" ? (
          <label className={styles.field}>
            Cron（分 时 日 月 周）
            <input
              data-testid="cron-expr"
              className={styles.monoInput}
              value={form.cron}
              onChange={(event) => set("cron", event.target.value)}
            />
            <span className={styles.hint}>
              示例：<code>0 9 * * *</code> 每天 09:00 · <code>0 10 * * 1</code> 每周一
              10:00 · <code>*/30 * * * *</code> 每 30 分钟
            </span>
          </label>
        ) : null}

        {form.kind === "interval" ? (
          <label className={styles.field}>
            间隔（秒）
            <input
              data-testid="cron-interval"
              type="number"
              min="1"
              value={form.interval}
              onChange={(event) => set("interval", event.target.value)}
            />
            <span className={styles.hint}>3600 = 每小时；86400 = 每天。</span>
          </label>
        ) : null}

        {form.kind === "once" ? (
          <label className={styles.field}>
            执行时间
            <input
              data-testid="cron-once"
              type="datetime-local"
              value={form.once}
              onChange={(event) => set("once", event.target.value)}
            />
          </label>
        ) : null}

        <label className={styles.field}>
          时区
          <input
            data-testid="cron-timezone"
            list="cron-timezones"
            value={form.timezone}
            onChange={(event) => set("timezone", event.target.value)}
          />
          <datalist id="cron-timezones">
            {TIMEZONES.map((zone) => <option key={zone} value={zone} />)}
          </datalist>
        </label>

        <label className={styles.field}>
          指令（触发后发送给专家）
          <textarea
            data-testid="cron-text"
            rows={4}
            maxLength={500}
            value={form.text}
            onChange={(event) => set("text", event.target.value)}
          />
        </label>

        {job ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
            />
            启用该任务
          </label>
        ) : null}
      </div>
    </Drawer>
  );
}

function RunHistory({ job, onClose }: { job: CronJobView | null; onClose: () => void }) {
  const runs = useCronRuns(job?.cronJobId ?? null);
  return (
    <Drawer
      open={job !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="运行记录"
      description={job ? `${job.name} · ${describe(job.schedule)}` : undefined}
      width={520}
    >
      {runs.isLoading ? (
        <Loading label="载入运行记录…" />
      ) : runs.isError ? (
        <ErrorState message="运行记录加载失败" onRetry={() => void runs.refetch()} />
      ) : !runs.data?.items.length ? (
        <Empty title="还没有运行记录" hint="到达下次运行时间或点击「立即执行」后会出现。" />
      ) : (
        <ul className={styles.runs}>
          {runs.data.items.map((run) => (
            <li key={run.runId} className={styles.runRow}>
              <span className={`${styles.status} ${run.status === "succeeded" ? styles.on : styles.off}`}>
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
    </Drawer>
  );
}
