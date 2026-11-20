import { useEffect, useState } from "react";
import { Button, ErrorState, Loading } from "@/components/ui";
import {
  useBackupAuto,
  useRunBackupAuto,
  useStorageSnapshot,
  useUpdateBackupAuto,
} from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function AdminStorageTab({
  onNotice, onError, onOpenBackups,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onOpenBackups: () => void;
}) {
  const snapshot = useStorageSnapshot();
  const auto = useBackupAuto();
  const updateAuto = useUpdateBackupAuto();
  const runAuto = useRunBackupAuto();
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
        includes: {
          db: form.db, workspace: form.workspace, artifacts: form.artifacts,
        },
      },
      {
        onSuccess: () => onNotice("已保存自动备份设置"),
        onError: (error) => onError(messageOf(error)),
      },
    );
  }

  const data = snapshot.data;

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>存储</h2>
        <span>v1.0 固定本地存储；远端后端随 v1.1 接入</span>
        <span className={styles.spacer} />
        <Button size="sm" variant="secondary" onClick={onOpenBackups}>
          备份列表
        </Button>
      </div>

      {snapshot.isLoading ? (
        <Loading label="统计存储…" />
      ) : snapshot.isError ? (
        <ErrorState message="存储信息加载失败" onRetry={() => void snapshot.refetch()} />
      ) : data ? (
        <>
          <div className={styles.storageGrid}>
            {([
              ["控制面数据库", data.db.bytes, data.db.path, ""],
              ["数据目录", data.data.bytes, data.data.path, `${data.data.files} 文件`],
              ["工作区", data.workspace.bytes, data.workspace.path, `${data.workspace.files} 文件`],
              ["备份目录", data.backups.bytes, data.backups.path, `${data.backups.files} 文件`],
            ] as const).map(([label, size, path, meta]) => (
              <div key={label} className={styles.storageCard}>
                <span>{label}</span>
                <b>{bytes(size)}</b>
                <code title={path}>{path}</code>
                {meta ? <small>{meta}</small> : null}
              </div>
            ))}
          </div>
          <div className={styles.backends}>
            <div className={styles.backendOn}>
              <b>本地磁盘</b>
              <span>SQLite + data 目录 + workspace</span>
              <span className={`${styles.badge} ${styles.green}`}>当前</span>
            </div>
            {data.remoteBackends.map((backend) => (
              <div key={backend.kind} className={styles.backendOff}>
                <b>{backend.label}</b>
                <span>对象存储 / 外部数据库</span>
                <span className={`${styles.badge} ${styles.neutral}`}>{backend.status}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className={styles.subhead}>
        <b>自动备份</b>
        <span>服务端定时快照；保留数量超出后轮转删除</span>
      </div>
      {auto.isLoading ? (
        <Loading label="载入备份设置…" />
      ) : auto.isError ? (
        <ErrorState message="备份设置加载失败" onRetry={() => void auto.refetch()} />
      ) : (
        <div className={styles.autoGrid}>
          <label className={styles.check}>
            <input
              type="checkbox"
              data-testid="backup-auto-enabled"
              checked={form.autoEnabled}
              onChange={(event) => setForm({ ...form, autoEnabled: event.target.checked })}
            />
            启用自动备份
          </label>
          <label className={styles.field}>
            间隔（小时）
            <input
              type="number"
              min="1"
              value={form.intervalHours}
              onChange={(event) => setForm({ ...form, intervalHours: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            保留数量
            <input
              type="number"
              min="1"
              value={form.retentionCount}
              onChange={(event) => setForm({ ...form, retentionCount: event.target.value })}
            />
          </label>
          <div className={styles.includes}>
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
          <div className={styles.autoActions}>
            <Button
              size="sm"
              variant="secondary"
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
        </div>
      )}
      <p className={styles.muted}>
        {data?.note ?? "备份包含 SQLite 快照、工作区 tar 与 artifacts 清单。"}
      </p>
    </section>
  );
}
