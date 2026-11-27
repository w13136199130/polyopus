/**
 * 自动化 (docs/52 §5): 页头 + 状态 Tab + 搜索 + 任务行 + 最近执行卡.
 * One cron job == one schedule source (ADR-004).
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Dialog, Empty, ErrorState, FilterBar, Loading, Tabs } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import type { CronJobView } from "@/lib/api/wire";
import {
  useCronJobs,
  useCreateCron,
  useDeleteCron,
  useRunCron,
  useToggleCron,
  useUpdateCron,
} from "@/features/automation/api";
import { scheduleOf, type FormState } from "@/features/automation/form";
import { CronDrawer } from "./CronDrawer";
import { CronJobRow } from "./CronJobRow";
import { RecentRunsCard } from "./RecentRunsCard";
import styles from "./AutomationPage.module.css";

type Filter = "all" | "on" | "off";

const EXAMPLES: Array<{ name: string; cron: string; text: string }> = [
  {
    name: "每日科技新闻",
    cron: "0 9 * * *",
    text: "/polyopus 汇总今天值得关注的科技新闻，按重要性排序并给出链接",
  },
  {
    name: "工作日站会摘要",
    cron: "0 9 * * 1-5",
    text: "/polyopus 整理昨天完成、今天计划和阻塞项，输出三行摘要",
  },
  {
    name: "每周发布检查",
    cron: "0 17 * * 5",
    text: "/polyopus 汇总本周发布记录，标出未回滚验证的变更",
  },
];

export function AutomationPage() {
  const jobsQuery = useCronJobs();
  const createJob = useCreateCron();
  const updateJob = useUpdateCron();
  const toggleJob = useToggleCron();
  const deleteJob = useDeleteCron();
  const runJob = useRunCron();
  const canWrite = useCan("cron:write");

  const [params, setParams] = useSearchParams();
  const filterParam = params.get("filter");
  const filter: Filter = filterParam === "on" || filterParam === "off" ? filterParam : "all";
  const query = params.get("q") ?? "";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const [editing, setEditing] = useState<CronJobView | null>(null);
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState<Partial<FormState> | null>(null);
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
  const recentJob = historyJob ?? filtered[0] ?? jobs[0] ?? null;

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

  function openCreate(example?: typeof EXAMPLES[number]) {
    setNotice(null);
    setPreset(example
      ? { name: example.name, kind: "cron", cron: example.cron, text: example.text }
      : null);
    setCreating(true);
  }

  return (
    <PageShell
      title="自动化"
      subtitle={`${jobs.length} 个定时任务 · ${enabled} 个启用 · 按服务器时区调度`}
      actions={
        <Button size="sm" data-testid="cron-new" disabled={!canWrite} onClick={() => openCreate()}>
          ＋ 创建定时任务
        </Button>
      }
      tabs={
        <Tabs
          ariaLabel="任务筛选"
          value={filter}
          onChange={(next) => setParam("filter", next === "all" ? null : next)}
          items={[
            { key: "all", label: "全部", badge: jobs.length },
            { key: "on", label: "已启用", badge: enabled },
            { key: "off", label: "已暂停", badge: jobs.length - enabled },
          ]}
        />
      }
      filters={
        <FilterBar
          count={`${enabled} 个任务已启用 · 按服务器时区调度`}
          right={
            <input
              className={styles.search}
              type="search"
              placeholder="搜索任务名、Cron 或指令"
              aria-label="搜索定时任务"
              value={query}
              onChange={(event) => setParam("q", event.target.value || null)}
            />
          }
        />
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

        {jobsQuery.isLoading && !jobsQuery.data ? (
          <Loading label="载入定时任务…" />
        ) : jobsQuery.isError ? (
          <ErrorState message="定时任务加载失败" onRetry={() => void jobsQuery.refetch()} />
        ) : filtered.length === 0 ? (
          <Empty
            title={jobs.length ? "没有匹配的任务" : "开启你的第一个定时任务吧"}
            hint={jobs.length
              ? "换个关键词或切换状态筛选。"
              : "定时让专家执行巡检、汇总或提醒；也可以从下面的示例开始。"}
            action={jobs.length
              ? { label: "清除搜索", onClick: () => { setParam("q", null); setParam("filter", null); } }
              : { label: "创建定时任务", onClick: () => openCreate() }}
          />
        ) : (
          <div className={styles.rows}>
            {filtered.map((job) => (
              <CronJobRow
                key={job.cronJobId}
                job={job}
                canWrite={canWrite}
                runPending={runJob.isPending}
                onRun={() => runNow(job)}
                onToggle={() =>
                  toggleJob.mutate(
                    { jobId: job.cronJobId, enabled: !job.enabled },
                    { onError: reportError },
                  )}
                onHistory={() => setHistoryJob(job)}
                onEdit={() => {
                  setPreset(null);
                  setEditing(job);
                }}
                onDelete={() => setDeleting(job)}
              />
            ))}
          </div>
        )}

        {jobs.length === 0 ? (
          <div className={styles.examples} data-testid="cron-examples">
            <span className={styles.examplesLabel}>从示例开始</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.name}
                type="button"
                className={styles.example}
                onClick={() => openCreate(example)}
              >
                <b>{example.name}</b>
                <code>{example.cron}</code>
                <span>{example.text}</span>
              </button>
            ))}
          </div>
        ) : (
          <RecentRunsCard job={recentJob} />
        )}
      </div>

      <CronDrawer
        open={creating || editing !== null}
        job={editing}
        seed={creating ? preset : null}
        busy={createJob.isPending || updateJob.isPending}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          setPreset(null);
        }}
        onSave={(form) => {
          const body = {
            name: form.name.trim(),
            schedule: scheduleOf(form),
            timezone: form.timezone,
            text: form.text,
          };
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
            createJob.mutate(
              body,
              {
                onSuccess: () => {
                  setCreating(false);
                  setPreset(null);
                  setNotice(`已创建「${body.name}」`);
                },
                onError: reportError,
              },
            );
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
                    if (historyJob?.cronJobId === deleting.cronJobId) setHistoryJob(null);
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
    </PageShell>
  );
}
