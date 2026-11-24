/** Admin → audit log (inside 安全防护 / 审计). */

import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { useAudit } from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function AdminAuditTab({
  onNotice, onError,
}: {
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
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
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
      <div className={styles.filterForm}>
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
