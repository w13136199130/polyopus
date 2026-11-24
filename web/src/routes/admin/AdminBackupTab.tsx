/** Admin → 应用设置 / 备份与恢复: auto snapshot, backup list, data jobs. */

import { useEffect, useState } from "react";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import type { BackupRow } from "@/lib/api/wire";
import {
  useBackupAuto,
  useBackups,
  useCreateBackup,
  useDataJobs,
  useRemoveBackup,
  useRestoreBackup,
  useRunBackupAuto,
  useUpdateBackupAuto,
} from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function statusBadge(status: string): string {
  if (status === "ready" || status === "done" || status === "restored") return styles.badgeOk;
  if (status === "failed") return styles.badgeErr;
  if (status === "creating" || status === "running" || status === "restoring") {
    return styles.badgeWarn;
  }
  return styles.badgeIdle;
}

function fmtTime(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleString("zh-CN") : "—";
}

export function AdminBackupTab({
  onNotice, onError,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const canWrite = useCan("admin:write");
  const query = useBackups();
  const auto = useBackupAuto();
  const updateAuto = useUpdateBackupAuto();
  const runAuto = useRunBackupAuto();
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const removeBackup = useRemoveBackup();
  const jobs = useDataJobs();

  const [pendingRestore, setPendingRestore] = useState<BackupRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupRow | null>(null);
  const [form, setForm] = useState({
    autoEnabled: false, intervalHours: "24", retentionCount: "7",
    db: true, workspace: true, artifacts: true,
  });

  useEffect(() => {
    if (!auto.data) return;
    setForm({
      autoEnabled: auto.data.autoEnabled,
      intervalHours: String(auto.data.intervalHours),
      retentionCount: String(auto.data.retentionCount),
      db: auto.data.includes.db !== false,
      workspace: auto.data.includes.workspace !== false,
      artifacts: auto.data.includes.artifacts !== false,
    });
  }, [auto.data]);

  const rows = query.data?.items ?? [];
  const jobRows = jobs.data?.items ?? [];

  function saveAuto() {
    const interval = Number(form.intervalHours);
    const retention = Number(form.retentionCount);
    if (!Number.isFinite(interval) || interval <= 0
      || !Number.isFinite(retention) || retention <= 0) {
      onError("备份间隔与保留数量必须大于 0");
      return;
    }
    updateAuto.mutate(
      {
        autoEnabled: form.autoEnabled,
        intervalHours: interval,
        retentionCount: retention,
        includes: { db: form.db, workspace: form.workspace, artifacts: form.artifacts },
      },
      {
        onSuccess: () => onNotice("已保存自动备份设置"),
        onError: (error) => onError(messageOf(error)),
      },
    );
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    try {
      await restoreBackup.mutateAsync(pendingRestore.backupId);
      onNotice(`已从 ${pendingRestore.backupId.slice(0, 14)}… 恢复`);
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setPendingRestore(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await removeBackup.mutateAsync(pendingDelete.backupId);
      onNotice("备份已删除");
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.head}>
          <h2>自动备份</h2>
          <span>服务端定时快照；保留数量超出后轮转删除</span>
          <span className={styles.spacer} />
          <Button
            size="sm"
            variant="secondary"
            data-testid="backup-auto-run"
            loading={runAuto.isPending}
            onClick={() => runAuto.mutate(undefined, {
              onSuccess: (result) => onNotice(`已创建备份 ${result.backupId}`),
              onError: (error) => onError(messageOf(error)),
            })}
          >
            立即备份
          </Button>
          <Button size="sm" loading={updateAuto.isPending} onClick={saveAuto}>
            保存设置
          </Button>
        </div>
        {auto.isLoading ? <Loading label="载入备份设置…" /> : auto.isError ? (
          <ErrorState message="备份设置加载失败" onRetry={() => void auto.refetch()} />
        ) : (
          <div className={styles.filterForm}>
            <label className={styles.check}>
              <input
                type="checkbox"
                data-testid="backup-auto-enabled"
                checked={form.autoEnabled}
                onChange={(event) => setForm({ ...form, autoEnabled: event.target.checked })}
              />
              启用自动备份
            </label>
            <label>间隔（小时）
              <input
                type="number"
                min="1"
                value={form.intervalHours}
                onChange={(event) => setForm({ ...form, intervalHours: event.target.value })}
              />
            </label>
            <label>保留数量
              <input
                type="number"
                min="1"
                value={form.retentionCount}
                onChange={(event) => setForm({ ...form, retentionCount: event.target.value })}
              />
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.db}
                onChange={(event) => setForm({ ...form, db: event.target.checked })} />
              数据库
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.workspace}
                onChange={(event) => setForm({ ...form, workspace: event.target.checked })} />
              工作区
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.artifacts}
                onChange={(event) => setForm({ ...form, artifacts: event.target.checked })} />
              产物
            </label>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.head}>
          <h2>备份快照</h2>
          <span>SQLite 一致性快照；恢复前校验 checksum 与 schema 版本</span>
          <span className={styles.spacer} />
          <Button size="sm" data-testid="backup-create"
            disabled={!canWrite} loading={createBackup.isPending}
            onClick={() => createBackup.mutate(undefined, {
              onSuccess: (made) => onNotice(`备份已创建：${made.backupId.slice(0, 14)}…`),
              onError: (err) => onError(messageOf(err)),
            })}>
            创建备份
          </Button>
        </div>
        {query.isLoading ? <Loading label="载入备份…" /> : query.isError ? (
          <ErrorState message="备份加载失败" onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <Empty title="暂无备份" hint="创建第一个快照。" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>备份</th><th>大小</th><th>状态</th><th>创建时间</th><th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.backupId} data-testid="backup-row">
                    <td className={styles.mono}>
                      {row.backupId.slice(0, 18)}…
                      <div className={styles.muted}>{row.checksum.slice(0, 12)}</div>
                    </td>
                    <td>{(row.sizeBytes / 1024).toFixed(0)} KB</td>
                    <td>
                      <span className={`${styles.badge} ${statusBadge(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className={styles.muted}>{fmtTime(row.createdAt)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button size="sm" variant="ghost" disabled={!canWrite}
                          data-testid="backup-restore"
                          onClick={() => setPendingRestore(row)}>
                          恢复
                        </Button>
                        <Button size="sm" variant="ghost" className={styles.danger}
                          disabled={!canWrite}
                          onClick={() => setPendingDelete(row)}>
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
      </section>

      <section className={styles.panel}>
        <div className={styles.head}>
          <h2>数据任务</h2>
          <span>导出 / 租户清理；进度与产物路径</span>
        </div>
        {jobs.isLoading ? <Loading label="载入任务…" /> : jobs.isError ? (
          <ErrorState message="任务加载失败" onRetry={() => void jobs.refetch()} />
        ) : jobRows.length === 0 ? (
          <Empty title="暂无任务" hint="在「设置 → 账户安全」发起数据导出，或由管理员清理租户。" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>任务</th><th>类型</th><th>状态</th><th>进度</th><th>产物</th><th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {jobRows.map((row) => (
                  <tr key={row.jobId} data-testid="job-row">
                    <td className={styles.mono}>{row.jobId}</td>
                    <td>{row.kind === "export" ? "导出" : "清理"}</td>
                    <td>
                      <span className={`${styles.badge} ${statusBadge(row.status)}`}>
                        {row.status}
                      </span>
                      {row.error ? <div className={styles.muted}>{row.error.slice(0, 60)}</div> : null}
                    </td>
                    <td>{Math.round(row.progress * 100)}%</td>
                    <td className={styles.muted}>
                      {row.storageRef ? row.storageRef.split(/[\\/]/).pop() : "—"}
                    </td>
                    <td className={styles.muted}>{fmtTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={pendingRestore !== null}
        onOpenChange={(open) => { if (!open) setPendingRestore(null); }}
        title="确认恢复备份"
        description="当前数据库将被快照内容整体替换（校验通过后执行）。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRestore(null)}>取消</Button>
            <Button data-testid="confirm-backup-restore"
              loading={restoreBackup.isPending}
              onClick={() => void confirmRestore()}>
              确认恢复
            </Button>
          </>
        }
      >
        <p className={styles.muted}>恢复后建议重启服务，使缓存与连接状态一致。</p>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="确认删除备份"
        description={pendingDelete ? `${pendingDelete.backupId.slice(0, 18)}… 将被移除。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button variant="danger" loading={removeBackup.isPending}
              onClick={() => void confirmDelete()}>
              确认删除
            </Button>
          </>
        }
      >
        <p className={styles.muted}>删除后不可恢复；请确认存在其他可用备份。</p>
      </Dialog>
    </div>
  );
}
