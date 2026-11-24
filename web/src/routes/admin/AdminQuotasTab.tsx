/** Admin → quotas (three scopes × tokens/cost/requests). */

import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import {
  useCreateQuota,
  useQuotas,
  useUpdateQuota,
} from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function AdminQuotasTab({
  onNotice, onError,
}: {
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
      <form className={styles.filterForm} onSubmit={(event) => void submitCreate(event)}>
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
