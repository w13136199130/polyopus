/**
 * Admin console (P2-7): 用户 / 配额 / 审计 / 备份 / 数据任务 tabs.
 * Every tab talks to APIs that already exist; tabs the session cannot read
 * are hidden by permission instead of erroring.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import { AdminModelsTab } from "./AdminModelsTab";
import { AdminPluginsTab } from "./AdminPluginsTab";
import { AdminOverviewTab } from "./AdminOverviewTab";
import { AdminSecurityTab } from "./AdminSecurityTab";
import { AdminStorageTab } from "./AdminStorageTab";
import { AdminUsersPage } from "./AdminUsersPage";
import {
  useAudit,
  useBackups,
  useCreateBackup,
  useCreateQuota,
  useDataJobs,
  useQuotas,
  useRemoveBackup,
  useRestoreBackup,
  useUpdateQuota,
} from "@/features/admin/api";
import type { BackupRow } from "@/lib/api/wire";
import styles from "./AdminPage.module.css";

type Tab = "overview" | "users" | "quotas" | "models" | "storage" | "plugins" | "security" | "audit" | "backup" | "jobs";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function statusBadge(status: string): string {
  if (status === "ready" || status === "done" || status === "restored")
    return styles.badgeOk;
  if (status === "failed") return styles.badgeErr;
  if (status === "creating" || status === "running" || status === "restoring")
    return styles.badgeWarn;
  return styles.badgeIdle;
}

function QuotasTab({ onNotice, onError }: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const canWrite = useCan("admin:write");
  const query = useQuotas();
  const create = useCreateQuota();
  const update = useUpdateQuota();
  const [form, setForm] = useState({
    scope: "user", scopeId: "", metric: "requests", window: "day", limit: "100",
  });
  const [editing, setEditing] = useState<{ quotaId: string; value: string } | null>(null);

  const rows = query.data?.items ?? [];

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    onError("");
    try {
      const made = await create.mutateAsync({
        scope: form.scope,
        scopeId: form.scopeId.trim(),
        metric: form.metric,
        window: form.window,
        limit: Number(form.limit) || 0,
      });
      onNotice(`已设置配额 ${made.scope}/${made.scopeId} ${made.metric}=${made.limit}`);
      setForm({ ...form, scopeId: "" });
    } catch (err) {
      onError(messageOf(err));
    }
  }

  async function saveLimit() {
    if (!editing) return;
    try {
      await update.mutateAsync({
        quotaId: editing.quotaId, limit: Number(editing.value) || 0,
      });
      onNotice("已更新限额");
      setEditing(null);
    } catch (err) {
      onError(messageOf(err));
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>三层配额</h2>
        <span>租户 / 用户 / 模型 × tokens / cost / requests；0 = 不限</span>
      </div>
      <form className={styles.form} onSubmit={(event) => void submitCreate(event)}>
        <label>范围
          <select value={form.scope}
            onChange={(event) => setForm({ ...form, scope: event.target.value })}>
            <option value="tenant">tenant</option>
            <option value="user">user</option>
            <option value="model">model</option>
          </select>
        </label>
        <label>范围 ID
          <input
            data-testid="quota-scope-id"
            required
            placeholder={form.scope === "tenant" ? "default" : form.scope === "model" ? "deepseek-flash" : "us_…"}
            value={form.scopeId}
            onChange={(event) => setForm({ ...form, scopeId: event.target.value })}
          />
        </label>
        <label>指标
          <select value={form.metric}
            onChange={(event) => setForm({ ...form, metric: event.target.value })}>
            <option value="requests">requests</option>
            <option value="tokens">tokens</option>
            <option value="cost">cost</option>
          </select>
        </label>
        <label>窗口
          <select value={form.window}
            onChange={(event) => setForm({ ...form, window: event.target.value })}>
            <option value="day">day</option>
            <option value="month">month</option>
            <option value="absolute">absolute</option>
          </select>
        </label>
        <label>限额
          <input
            data-testid="quota-limit"
            required
            type="number"
            min={0}
            value={form.limit}
            onChange={(event) => setForm({ ...form, limit: event.target.value })}
          />
        </label>
        <Button type="submit" size="sm" data-testid="quota-create"
          disabled={!canWrite || !form.scopeId.trim()} loading={create.isPending}>
          设置配额
        </Button>
      </form>

      {query.isLoading ? <Loading label="载入配额…" /> : query.isError ? (
        <ErrorState message="配额加载失败" onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <Empty title="暂无配额" hint="上方设置第一条；未配置即不限制。" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>范围</th><th>指标</th><th>窗口</th><th>限额</th><th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.quotaId} data-testid="quota-row">
                  <td className={styles.mono}>{row.scope}/{row.scopeId}</td>
                  <td>{row.metric}</td>
                  <td className={styles.muted}>{row.window}</td>
                  <td>
                    {editing?.quotaId === row.quotaId ? (
                      <input
                        className={styles.limitInput}
                        data-testid="quota-limit-edit"
                        type="number"
                        min={0}
                        value={editing.value}
                        onChange={(event) =>
                          setEditing({ quotaId: row.quotaId, value: event.target.value })}
                      />
                    ) : (
                      <span className={styles.mono}>
                        {row.limit === 0 ? "不限" : row.limit}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      {editing?.quotaId === row.quotaId ? (
                        <>
                          <Button size="sm" data-testid="quota-save"
                            disabled={!canWrite} loading={update.isPending}
                            onClick={() => void saveLimit()}>
                            保存
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            取消
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={!canWrite}
                          data-testid="quota-edit"
                          onClick={() =>
                            setEditing({ quotaId: row.quotaId, value: String(row.limit) })}>
                          改限额
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AuditTab({ onNotice, onError }: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [result, setResult] = useState("");
  const query = useAudit({
    action: action || undefined,
    actorId: actorId || undefined,
    result: result || undefined,
  });
  const rows = query.data?.items ?? [];

  async function exportAs(format: "csv" | "jsonl" | "json") {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (actorId) params.set("actorId", actorId);
    if (result) params.set("result", result);
    params.set("format", format);
    try {
      const response = await fetch(`/api/v1/admin/audit/export?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`导出失败：HTTP ${response.status}`);
      const text = await response.text();
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/plain" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice(`已导出 audit.${format}`);
    } catch (err) {
      onError(messageOf(err));
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>审计日志</h2>
        <span>只追加；删除用户后匿名保留</span>
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" onClick={() => void exportAs("csv")}>导出 CSV</Button>
        <Button size="sm" variant="ghost" onClick={() => void exportAs("jsonl")}>导出 JSONL</Button>
      </div>
      <div className={styles.filters}>
        <label>动作
          <input data-testid="audit-action" placeholder="user.create"
            value={action} onChange={(event) => setAction(event.target.value)} />
        </label>
        <label>操作者
          <input data-testid="audit-actor" placeholder="us_…"
            value={actorId} onChange={(event) => setActorId(event.target.value)} />
        </label>
        <label>结果
          <input data-testid="audit-result" placeholder="ok"
            value={result} onChange={(event) => setResult(event.target.value)} />
        </label>
      </div>
      {query.isLoading ? <Loading label="载入审计…" /> : query.isError ? (
        <ErrorState message="审计加载失败" onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <Empty title="没有匹配的审计记录" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>时间</th><th>动作</th><th>操作者</th><th>结果</th><th>资源</th><th>详情</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.auditId} data-testid="audit-row">
                  <td className={styles.muted}>
                    {new Date(row.createdAt * 1000).toLocaleString("zh-CN")}
                  </td>
                  <td className={styles.mono}>{row.action}</td>
                  <td className={styles.mono}>{row.actorId ?? "—"}</td>
                  <td>
                    <span className={`${styles.badge} ${
                      row.result === "ok" ? styles.badgeOk : styles.badgeErr
                    }`}>{row.result}</span>
                  </td>
                  <td className={styles.mono}>
                    {row.resourceType ? `${row.resourceType}/${row.resourceId ?? ""}` : "—"}
                  </td>
                  <td>
                    <pre className={styles.detail}>
                      {JSON.stringify(row.detail).slice(0, 160)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BackupTab({ onNotice, onError }: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const canWrite = useCan("admin:write");
  const query = useBackups();
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const removeBackup = useRemoveBackup();
  const [pendingRestore, setPendingRestore] = useState<BackupRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupRow | null>(null);

  const rows = query.data?.items ?? [];

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
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>备份</h2>
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
                  <td className={styles.muted}>
                    {new Date(row.createdAt * 1000).toLocaleString("zh-CN")}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <Button size="sm" variant="ghost" disabled={!canWrite}
                        data-testid="backup-restore"
                        onClick={() => setPendingRestore(row)}>
                        恢复
                      </Button>
                      <Button size="sm" variant="danger" disabled={!canWrite}
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
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          恢复后建议重启服务，使缓存与连接状态一致。
        </p>
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
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          删除后不可恢复；请确认存在其他可用备份。
        </p>
      </Dialog>
    </section>
  );
}

function JobsTab() {
  const query = useDataJobs();
  const rows = query.data?.items ?? [];

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>数据任务</h2>
        <span>导出 / 租户清理；进度与产物路径</span>
      </div>
      {query.isLoading ? <Loading label="载入任务…" /> : query.isError ? (
        <ErrorState message="任务加载失败" onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
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
              {rows.map((row) => (
                <tr key={row.jobId} data-testid="job-row">
                  <td className={styles.mono}>{row.jobId}</td>
                  <td>{row.kind === "export" ? "导出" : "清理"}</td>
                  <td>
                    <span className={`${styles.badge} ${statusBadge(row.status)}`}>
                      {row.status}
                    </span>
                    {row.error ? (
                      <div className={styles.muted}>{row.error.slice(0, 60)}</div>
                    ) : null}
                  </td>
                  <td>{Math.round(row.progress * 100)}%</td>
                  <td className={styles.muted}>
                    {row.storageRef ? row.storageRef.split(/[\\/]/).pop() : "—"}
                  </td>
                  <td className={styles.muted}>
                    {new Date(row.createdAt * 1000).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AdminPage() {
  const navigate = useNavigate();
  const canAudit = useCan("audit:read");
  const canAdmin = useCan("admin:write");
  const canUsage = useCan("usage:read");
  const [tab, setTab] = useState<Tab>(canAdmin ? "overview" : "users");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tabs: Array<[Tab, string, boolean]> = [
    ["overview", "概览", canAdmin],
    ["users", "用户", true],
    ["quotas", "配额", canUsage],
    ["models", "模型", canAdmin],
    ["storage", "存储", canAdmin],
    ["plugins", "插件", canAdmin],
    ["security", "安全", canAdmin],
    ["audit", "审计", canAudit],
    ["backup", "备份", canAdmin],
    ["jobs", "数据任务", canAdmin],
  ];
  const visible = tabs.filter(([, , allowed]) => allowed);

  return (
    <PageShell title="管理" subtitle="用户、配额、模型、存储、安全、审计与备份；敏感操作均有确认。">
      <div className={styles.tabs} role="tablist" aria-label="管理视图">
        {visible.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`admin-tab-${key}`}
            className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {tab === "overview" ? (
          <AdminOverviewTab onOpenTab={(next) => setTab(next as Tab)} />
        ) : null}
        {tab === "users" ? <AdminUsersPage embedded onNotice={setNotice} /> : null}
        {tab === "quotas" ? (
          <QuotasTab onNotice={setNotice} onError={setError} />
        ) : null}
        {tab === "models" ? (
          <AdminModelsTab onNotice={setNotice} onError={setError} />
        ) : null}
        {tab === "storage" ? (
          <AdminStorageTab
            onNotice={setNotice}
            onError={setError}
            onOpenBackups={() => setTab("backup")}
          />
        ) : null}
        {tab === "plugins" ? (
          <AdminPluginsTab
            onNotice={(message) => setNotice(message)}
            onError={(message) => setError(message)}
            onOpenExtensions={() => navigate("/extensions")}
          />
        ) : null}

        {tab === "security" ? (
          <AdminSecurityTab onNotice={setNotice} onError={setError} />
        ) : null}
        {tab === "audit" ? (
          <AuditTab onNotice={setNotice} onError={setError} />
        ) : null}
        {tab === "backup" ? (
          <BackupTab onNotice={setNotice} onError={setError} />
        ) : null}
        {tab === "jobs" ? <JobsTab /> : null}
      </div>
    </PageShell>
  );
}
