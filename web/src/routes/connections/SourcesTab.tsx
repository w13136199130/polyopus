/**
 * Connections → Sources (V05-20). v0.5 only exposes webhook and schedule
 * sources; the secret is rendered once, immediately after creation, and is
 * never read back from the API.
 */

import { useState } from "react";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import {
  sendTestWebhook,
  useCreateCronJob,
  useCreateSource,
  useCronJobs,
  useDeleteCronJob,
  useDeleteSource,
  useSources,
  useTestReply,
  useToggleCronJob,
  useToggleSource,
} from "@/features/sources/api";
import type { CronJobView, SourceView } from "@/lib/api/wire";
import styles from "./SourcesTab.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

type PendingDelete =
  | { kind: "source"; id: string; name: string }
  | { kind: "cron"; id: string; name: string }
  | null;

export function SourcesTab() {
  const sourcesQuery = useSources();
  const jobsQuery = useCronJobs();
  const createSource = useCreateSource();
  const toggleSource = useToggleSource();
  const deleteSource = useDeleteSource();
  const testReply = useTestReply();
  const createJob = useCreateCronJob();
  const toggleJob = useToggleCronJob();
  const deleteJob = useDeleteCronJob();

  const [name, setName] = useState("");
  const [actor, setActor] = useState("alice");
  const [pattern, setPattern] = useState("/polyopus");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [generateSecret, setGenerateSecret] = useState(false);
  const [replyStyle, setReplyStyle] = useState<"structured" | "full">("structured");
  const [secretNotice, setSecretNotice] = useState<{ name: string; secret: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const [jobName, setJobName] = useState("");
  const [jobSchedule, setJobSchedule] = useState("cron:0 9 * * *");
  const [jobTimezone, setJobTimezone] = useState("Asia/Shanghai");
  const [jobText, setJobText] = useState("/polyopus 定时任务");

  const webhookSources = (sourcesQuery.data?.items ?? []).filter(
    (source) => source.kind !== "schedule",
  );
  const jobs = jobsQuery.data?.items ?? [];

  function resetError() {
    setError(null);
  }

  async function submitWebhook(event: React.FormEvent) {
    event.preventDefault();
    resetError();
    setNotice(null);
    try {
      const created = await createSource.mutateAsync({
        name: name.trim(),
        allowActors: actor.trim() ? [actor.trim()] : [],
        explicitPatterns: pattern.trim() ? [pattern.trim()] : [],
        defaultScope: ["workspace:default", "fs:write"],
        callbackUrl: callbackUrl.trim() || undefined,
        generateSecret,
        replyStyle,
      });
      setSecretNotice(
        created.secret ? { name: created.name, secret: created.secret } : null,
      );
      setNotice(`已创建来源「${created.name}」`);
      setName("");
      setCallbackUrl("");
      setGenerateSecret(false);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function submitSchedule(event: React.FormEvent) {
    event.preventDefault();
    resetError();
    setNotice(null);
    try {
      const job = await createJob.mutateAsync({
        name: jobName.trim(),
        schedule: jobSchedule.trim(),
        timezone: jobTimezone.trim(),
        text: jobText.trim(),
      });
      setNotice(`已创建定时任务「${job.name}」，下次 ${fmtTime(job.nextRunAt)}`);
      setJobName("");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function fireTest(source: SourceView) {
    resetError();
    try {
      const ticketId = await sendTestWebhook(source);
      setNotice(ticketId ? `已触发任务 ${ticketId}` : "已发送 webhook");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function probeCallback(source: SourceView) {
    resetError();
    try {
      const result = await testReply.mutateAsync(source.sourceId);
      setNotice(
        result.delivered
          ? `回调成功（HTTP ${result.statusCode ?? 200}）`
          : `回调失败：${result.error ?? `HTTP ${result.statusCode ?? "?"}`}`,
      );
    } catch (err) {
      setError(messageOf(err));
    }
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const action = pendingDelete;
    setPendingDelete(null);
    if (action.kind === "source") {
      deleteSource.mutate(action.id, {
        onError: (err) => setError(messageOf(err)),
      });
    } else {
      deleteJob.mutate(action.id, {
        onError: (err) => setError(messageOf(err)),
      });
    }
  }

  return (
    <div className={styles.page}>
        {secretNotice ? (
          <div className={styles.secret} data-testid="source-secret-once">
            <strong>密钥只显示一次</strong>
            <span>{secretNotice.name}</span>
            <code>{secretNotice.secret}</code>
            <Button size="sm" variant="secondary" onClick={() => setSecretNotice(null)}>
              我已保存
            </Button>
          </div>
        ) : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Webhook 通道</h2>
            <span className={styles.hint}>
              外部系统向此地址推送事件；Gate 通过后自动建单，密钥只在创建时显示一次。
            </span>
          </div>
          <form className={styles.form} onSubmit={(event) => void submitWebhook(event)}>
            <label>
              名称
              <input
                data-testid="source-name-input"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI 通知"
              />
            </label>
            <label>
              允许 actor
              <input
                data-testid="source-actor-input"
                value={actor}
                onChange={(event) => setActor(event.target.value)}
                placeholder="alice"
              />
            </label>
            <label>
              显式触发模式
              <input
                data-testid="source-pattern-input"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                placeholder="/polyopus"
              />
            </label>
            <label>
              回调 URL（可选）
              <input
                data-testid="source-callback-input"
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                placeholder="https://example.com/hook"
              />
            </label>
            <label>
              回复风格
              <select
                value={replyStyle}
                onChange={(event) => setReplyStyle(event.target.value as "structured" | "full")}
              >
                <option value="structured">structured（webhook JSON）</option>
                <option value="full">full（Web Markdown）</option>
              </select>
            </label>
            <label className={styles.check}>
              <input
                data-testid="source-secret-checkbox"
                type="checkbox"
                checked={generateSecret}
                onChange={(event) => setGenerateSecret(event.target.checked)}
              />
              生成签名 secret
            </label>
            <Button
              type="submit"
              data-testid="source-create-submit"
              loading={createSource.isPending}
            >
              创建来源
            </Button>
          </form>

          {sourcesQuery.isLoading ? (
            <Loading label="载入来源…" />
          ) : sourcesQuery.isError ? (
            <ErrorState message="来源加载失败" onRetry={() => void sourcesQuery.refetch()} />
          ) : webhookSources.length === 0 ? (
            <Empty title="还没有 webhook 来源" hint="填上面的表单创建第一个来源。" />
          ) : (
            <ul className={styles.rows}>
              {webhookSources.map((source) => (
                <li key={source.sourceId} className={styles.row} data-testid="source-row">
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>
                      <span className={styles.badge}>webhook</span>
                      <strong>{source.name}</strong>
                      <span className={styles.status}>{source.status}</span>
                    </div>
                    <div className={styles.meta}>
                      <code>{source.sourceId}</code>
                      {source.callbackUrl ? <span>回调 {source.callbackUrl}</span> : null}
                      <span>actors: {(source.allowActors ?? []).join(", ") || "—"}</span>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="source-test-webhook"
                      onClick={() => void fireTest(source)}
                    >
                      发测试事件
                    </Button>
                    {source.callbackUrl ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={testReply.isPending}
                        onClick={() => void probeCallback(source)}
                      >
                        测试回调
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="source-toggle"
                      loading={toggleSource.isPending}
                      onClick={() => toggleSource.mutate(source)}
                    >
                      {source.status === "active" ? "暂停" : "恢复"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={styles.dangerText}
                      data-testid="source-delete"
                      onClick={() =>
                        setPendingDelete({ kind: "source", id: source.sourceId, name: source.name })
                      }
                    >
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>定时任务</h2>
            <span className={styles.hint}>
              cron/interval/once 走同一个 intake 管线；时区显式。
            </span>
          </div>
          <form className={styles.form} onSubmit={(event) => void submitSchedule(event)}>
            <label>
              名称
              <input
                data-testid="schedule-name-input"
                required
                value={jobName}
                onChange={(event) => setJobName(event.target.value)}
                placeholder="每日巡检"
              />
            </label>
            <label>
              Schedule
              <input
                data-testid="schedule-spec-input"
                required
                value={jobSchedule}
                onChange={(event) => setJobSchedule(event.target.value)}
                placeholder="cron:0 9 * * * / interval:300 / once:..."
              />
            </label>
            <label>
              时区
              <input
                data-testid="schedule-timezone-input"
                required
                value={jobTimezone}
                onChange={(event) => setJobTimezone(event.target.value)}
              />
            </label>
            <label>
              触发文本
              <input
                data-testid="schedule-text-input"
                value={jobText}
                onChange={(event) => setJobText(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              data-testid="schedule-create-submit"
              loading={createJob.isPending}
            >
              创建定时任务
            </Button>
          </form>

          {jobsQuery.isLoading ? (
            <Loading label="载入定时任务…" />
          ) : jobsQuery.isError ? (
            <ErrorState message="定时任务加载失败" onRetry={() => void jobsQuery.refetch()} />
          ) : jobs.length === 0 ? (
            <Empty title="还没有定时任务" hint="用 cron/interval/once 创建第一个。" />
          ) : (
            <ul className={styles.rows}>
              {jobs.map((job: CronJobView) => (
                <li key={job.cronJobId} className={styles.row} data-testid="cron-row">
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>
                      <span className={styles.badge}>schedule</span>
                      <strong>{job.name}</strong>
                      <span className={styles.status}>{job.enabled ? "active" : "paused"}</span>
                    </div>
                    <div className={styles.meta}>
                      <code>{job.schedule}</code>
                      <span>{job.timezone}</span>
                      <span>下次 {fmtTime(job.nextRunAt)}</span>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="cron-toggle"
                      loading={toggleJob.isPending}
                      onClick={() => toggleJob.mutate(job)}
                    >
                      {job.enabled ? "暂停" : "启用"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={styles.dangerText}
                      data-testid="cron-delete"
                      onClick={() =>
                        setPendingDelete({ kind: "cron", id: job.cronJobId, name: job.name })
                      }
                    >
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="确认删除"
        description={
          pendingDelete
            ? `将删除「${pendingDelete.name}」及其配置，历史工单与审计保留。`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="danger" data-testid="confirm-delete" onClick={confirmDelete}>
              确认删除
            </Button>
          </>
        }
      >
        <p>此操作不可撤销。</p>
      </Dialog>
    </div>
  );
}
