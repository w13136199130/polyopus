/** Admin → 存储管理: storage backends (local now, remote v1.1). */

import { useState } from "react";
import { Button, Dialog, ErrorState, Loading } from "@/components/ui";
import { useStorageSnapshot } from "@/features/admin/api";
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
  onNotice, onError,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const snapshot = useStorageSnapshot();
  const [detailOpen, setDetailOpen] = useState(false);
  const data = snapshot.data;

  const extras = data
    ? [
      ...data.remoteBackends,
      ...(data.remoteBackends.some((item) => item.kind === "docker")
        ? []
        : [{ kind: "docker", label: "Docker 沙箱", status: "v1.1" }]),
    ].sort((left, right) =>
      ["cos", "postgres", "docker", "s3"].indexOf(left.kind)
      - ["cos", "postgres", "docker", "s3"].indexOf(right.kind))
    : [{ kind: "docker", label: "Docker 沙箱", status: "v1.1" }];

  function probeLocal() {
    snapshot.refetch()
      .then((result) => {
        if (result.isError) onError(messageOf(result.error));
        else onNotice("本地存储可用 · 已刷新容量");
      })
      .catch((error) => onError(messageOf(error)));
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.head}>
          <h2>存储后端</h2>
          <span>可供专家读写的工作区与产物</span>
          <span className={styles.spacer} />
          <span className={styles.muted}>v1.0 固定本地存储；远端后端随 v1.1 接入</span>
        </div>

        {snapshot.isLoading ? (
          <Loading label="统计存储…" />
        ) : snapshot.isError ? (
          <ErrorState message="存储信息加载失败" onRetry={() => void snapshot.refetch()} />
        ) : data ? (
          <div className={styles.backendGrid}>
            <article className={styles.backendCard} data-testid="storage-card">
              <div className={styles.backendTop}>
                <span className={styles.backendIcon}>本</span>
                <div className={styles.backendBody}>
                  <b>本地目录</b>
                  <span title={data.data.path}>{data.data.path} · 读写</span>
                </div>
                <span className={`${styles.badge} ${styles.badgeGreen}`}>已配置</span>
              </div>
              <div className={styles.backendFoot}>
                <Button size="sm" variant="outline" onClick={() => setDetailOpen(true)}>
                  配置
                </Button>
                <Button size="sm" variant="ghost" onClick={probeLocal}>
                  探测
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDetailOpen(true)}>
                  浏览
                </Button>
              </div>
            </article>

            {extras.map((backend) => (
              <article key={backend.kind} className={styles.backendCard} data-testid="storage-card">
                <div className={styles.backendTop}>
                  <span className={`${styles.backendIcon} ${styles.backendMuted}`}>
                    {backend.label.slice(0, 1)}
                  </span>
                  <div className={styles.backendBody}>
                    <b>{backend.label}</b>
                    <span>
                      {backend.kind === "cos" ? "对象存储 · 远端"
                        : backend.kind === "postgres" ? "外部数据库 · 结构化存储"
                          : backend.kind === "docker" ? "隔离沙箱 · 临时文件"
                            : "对象存储 · 远端"}
                    </span>
                  </div>
                  <span className={`${styles.badge} ${styles.badgeNeutral}`} title="随 v1.1 接入">
                    未配置
                  </span>
                </div>
                <div className={styles.backendFoot}>
                  <Button size="sm" variant="outline" disabled title="随 v1.1 接入">配置</Button>
                  <Button size="sm" variant="ghost" disabled title="随 v1.1 接入">探测</Button>
                  <Button size="sm" variant="ghost" disabled title="随 v1.1 接入">浏览</Button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className={`${styles.alert} ${styles.alertInfo}`}>
          删除被专家引用的后端会被阻止：先在工作区里解绑。远端后端的凭证将加密保存且只写不读。
        </div>
      </section>

      <Dialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title="本地目录"
        description="当前实例使用的 SQLite、数据目录、工作区与备份目录。"
        width={680}
        footer={<Button variant="secondary" onClick={() => setDetailOpen(false)}>关闭</Button>}
      >
        {data ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>用途</th><th>路径</th><th style={{ textAlign: "right" }}>占用</th></tr></thead>
              <tbody>
                {([
                  ["控制面数据库", data.db.path, data.db.bytes],
                  ["数据目录", data.data.path, data.data.bytes],
                  ["工作区", data.workspace.path, data.workspace.bytes],
                  ["备份目录", data.backups.path, data.backups.bytes],
                ] as const).map(([label, path, size]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className={styles.mono}>{path}</td>
                    <td style={{ textAlign: "right" }}>{bytes(size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
