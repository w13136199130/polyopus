/**
 * Admin → Users + invites (V1-04). Read-only for auditors; mutation controls
 * are disabled unless the session carries the matching write permission.
 */

import { useState } from "react";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import {
  useAdminUsers,
  useCreateInvite,
  useCreateUser,
  useDeleteUser,
  useInvites,
  useRevokeInvite,
  useRoles,
  useUpdateUser,
} from "@/features/admin/api";
import styles from "./AdminUsersPage.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function AdminUsersPage({ embedded = false, onNotice }: {
  embedded?: boolean;
  onNotice?: (message: string) => void;
}) {
  const usersQuery = useAdminUsers();
  const rolesQuery = useRoles();
  const invitesQuery = useInvites();
  const canWrite = useCan("user:write");
  const canInvite = useCan("invite:write");
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();

  const [error, setError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const notice = onNotice ? null : localNotice;
  const setNotice = onNotice ?? setLocalNotice;
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [newUser, setNewUser] = useState({
    username: "", displayName: "", password: "", role: "member",
  });
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // admin-bulk 原型：批量选择 + 逐项结果
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // CSV dry-run：列 username,display_name,role,email；逐行校验，预览后才导入
  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<Array<{
    line: number; username: string; displayName: string; role: string;
    verdict: "create" | "skip" | "fail"; reason: string;
  }>>([]);

  const roles = rolesQuery.data?.items ?? [];
  const users = usersQuery.data?.items ?? [];
  const invites = invitesQuery.data?.items ?? [];
  const roleNames = roles.length ? roles.map((role) => role.name) : ["admin", "member", "auditor"];

  async function submitUser(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createUser.mutateAsync({
        username: newUser.username.trim(),
        displayName: newUser.displayName.trim() || undefined,
        password: newUser.password,
        roles: [newUser.role],
      });
      setNotice(`已创建用户 ${newUser.username}`);
      setNewUser({ username: "", displayName: "", password: "", role: "member" });
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function submitInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createInvite.mutateAsync({
        email: invite.email.trim(), role: invite.role,
      });
      setInviteToken(created.token ?? null);
      setNotice(`已创建邀请 ${invite.email}`);
      setInvite({ email: "", role: "member" });
    } catch (err) {
      setError(messageOf(err));
    }
  }

  function changeRole(userId: string, role: string) {
    updateUser.mutate({ userId, roles: [role] }, {
      onError: (err) => setError(messageOf(err)),
    });
  }

  function toggleStatus(userId: string, status: string) {
    updateUser.mutate(
      { userId, status: status === "active" ? "disabled" : "active" },
      { onError: (err) => setError(messageOf(err)) },
    );
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    deleteUser.mutate(pendingDelete.id, {
      onError: (err) => setError(messageOf(err)),
    });
    setPendingDelete(null);
  }

  // ---- 批量操作（admin-bulk 原型）：逐项返回成功/失败，不半途而废 ----
  async function bulkStatus(status: "active" | "disabled") {
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const userId of selected) {
      try {
        await updateUser.mutateAsync({ userId, status });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setNotice(`批量${status === "active" ? "启用" : "禁用"}：成功 ${ok} · 失败 ${fail}`);
  }

  async function bulkDelete() {
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const userId of selected) {
      try {
        await deleteUser.mutateAsync(userId);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    setNotice(`批量删除：成功 ${ok} · 失败 ${fail}`);
  }

  // ---- CSV dry-run：客户端校验 → 预览 → 逐行创建 ----
  function parseCsv(text: string) {
    const existing = new Set(users.map((row) => row.username));
    let lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines[0]?.toLowerCase().startsWith("username,")) lines = lines.slice(1);
    const out: typeof csvRows = [];
    lines.forEach((line, index) => {
      const [username = "", displayName = "", role = ""] =
        line.split(",").map((cell) => cell.trim());
      const lineNo = index + 2; // +1 表头 +1 1 基
      if (!username) {
        out.push({ line: lineNo, username, displayName, role,
          verdict: "fail", reason: "username 为空" });
      } else if (existing.has(username)
          || out.some((row) => row.username === username)) {
        out.push({ line: lineNo, username, displayName, role,
          verdict: "skip", reason: "用户名已存在" });
      } else if (!roleNames.includes(role)) {
        out.push({ line: lineNo, username, displayName, role,
          verdict: "fail", reason: `角色 ${role || "（空）"} 不存在` });
      } else {
        out.push({ line: lineNo, username, displayName, role,
          verdict: "create", reason: "—" });
      }
    });
    setCsvRows(out);
  }

  async function importCsv() {
    const toCreate = csvRows.filter((row) => row.verdict === "create");
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const row of toCreate) {
      try {
        await createUser.mutateAsync({
          username: row.username,
          displayName: row.displayName || undefined,
          password: `poly-${Date.now()}-${ok}`, // 首登改密；dry-run 表已提示
          roles: [row.role],
        });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setCsvRows([]);
    setCsvName(null);
    setNotice(`CSV 导入：成功 ${ok} · 失败 ${fail}（初始密码见服务端日志）`);
  }

  const body = (
    <>
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.head}><h2>用户</h2><span>{users.length} 人</span></div>

          {selected.size > 0 ? (
            <div className={styles.bulkbar} data-testid="admin-bulkbar">
              已选 {selected.size} 项
              <Button size="sm" disabled={!canWrite || bulkBusy}
                onClick={() => void bulkStatus("active")}>
                启用
              </Button>
              <Button size="sm" disabled={!canWrite || bulkBusy}
                onClick={() => void bulkStatus("disabled")}>
                禁用
              </Button>
              <Button size="sm" variant="danger" disabled={!canWrite || bulkBusy}
                onClick={() => void bulkDelete()}>
                删除
              </Button>
              <span className={styles.bulkNote}>逐项返回成功/失败</span>
            </div>
          ) : null}

          {usersQuery.isLoading ? <Loading label="载入用户…" /> : usersQuery.isError ? (
            <ErrorState message="用户加载失败" onRetry={() => void usersQuery.refetch()} />
          ) : users.length === 0 ? <Empty title="暂无用户" /> : (
            <ul className={styles.rows}>
              <li className={styles.row} style={{ cursor: "default", background: "var(--surface-2)" }}>
                <label className={styles.who} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    aria-label="全选用户"
                    data-testid="admin-select-all"
                    disabled={!canWrite}
                    checked={selected.size === users.length && users.length > 0}
                    onChange={(event) =>
                      setSelected(event.target.checked
                        ? new Set(users.map((row) => row.userId))
                        : new Set())}
                  />
                  <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>全选（{users.length}）</span>
                </label>
              </li>
              {users.map((row) => (
                <li key={row.userId} className={styles.row} data-testid="admin-user-row">
                  <label className={styles.who} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${row.username}`}
                      data-testid="admin-user-check"
                      disabled={!canWrite}
                      checked={selected.has(row.userId)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(row.userId);
                          else next.delete(row.userId);
                          return next;
                        })}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <strong>{row.displayName}</strong>
                      <code>{row.username}</code>
                      <span className={styles.status}>{row.status}</span>
                    </div>
                  </label>
                  <div className={styles.actions}>
                    <select
                      data-testid="admin-role-select"
                      value={row.role}
                      disabled={!canWrite}
                      onChange={(event) => changeRole(row.userId, event.target.value)}
                    >
                      {roleNames.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="ghost" disabled={!canWrite}
                      onClick={() => toggleStatus(row.userId, row.status)}>
                      {row.status === "active" ? "禁用" : "启用"}
                    </Button>
                    <Button size="sm" variant="danger" disabled={!canWrite || row.isOwner}
                      data-testid="admin-delete-user"
                      onClick={() => setPendingDelete({ id: row.userId, name: row.username })}>
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* CSV 导入 · dry-run（admin-bulk 原型） */}
          <div className={styles.importbox}>
            <h4>CSV 导入 · dry-run</h4>
            <p className={styles.importNote}>
              列：username,display_name,role,email；重复/非法行不写入，先给预览。
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="选择 CSV"
                data-testid="admin-csv-file"
                disabled={!canWrite}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setCsvName(file.name);
                  parseCsv(await file.text());
                }}
              />
              {csvName ? <span className={styles.importNote}>{csvName}</span> : null}
            </div>
            {csvRows.length > 0 ? (
              <>
                <div className={styles.resultHead} data-testid="admin-csv-summary">
                  Dry-run 结果：可创建 {csvRows.filter((r) => r.verdict === "create").length}
                  {" · "}跳过 {csvRows.filter((r) => r.verdict === "skip").length}（重复）
                  {" · "}失败 {csvRows.filter((r) => r.verdict === "fail").length}（非法）
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>行</th><th>用户</th><th>角色</th><th>结果</th><th>原因</th></tr>
                    </thead>
                    <tbody>
                      {csvRows.map((row) => (
                        <tr key={row.line} data-testid="admin-csv-row">
                          <td>{row.line}</td>
                          <td className={styles.mono}>{row.username || "—"}</td>
                          <td>{row.role || "—"}</td>
                          <td>
                            <span className={`${styles.bulkChip} ${
                              row.verdict === "create" ? styles.bulkOk
                                : row.verdict === "skip" ? styles.bulkSkip
                                  : styles.bulkFail
                            }`}>
                              {row.verdict}
                            </span>
                          </td>
                          <td className={styles.muted}>{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Button size="sm" disabled={!canWrite || bulkBusy}
                    data-testid="admin-csv-import"
                    loading={bulkBusy}
                    onClick={() => void importCsv()}>
                    确认导入（{csvRows.filter((r) => r.verdict === "create").length}）
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCsvRows([]); setCsvName(null); }}>
                    取消
                  </Button>
                </div>
              </>
            ) : null}
          </div>

          <form className={styles.form} onSubmit={(event) => void submitUser(event)}>
            <label>用户名<input data-testid="admin-new-username" required
              value={newUser.username}
              onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} /></label>
            <label>显示名<input data-testid="admin-new-display"
              value={newUser.displayName}
              onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })} /></label>
            <label>初始密码<input data-testid="admin-new-password" required type="password"
              value={newUser.password}
              onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} /></label>
            <label>角色<select data-testid="admin-new-role" value={newUser.role}
              onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
              {["member", "auditor", "admin"].map((role) => <option key={role}>{role}</option>)}
            </select></label>
            <Button type="submit" disabled={!canWrite} loading={createUser.isPending}
              data-testid="admin-create-user">创建用户</Button>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>邀请</h2><span>{invites.length} 条</span></div>
          {inviteToken ? (
            <div className={styles.token} data-testid="admin-invite-token">
              <strong>邀请 token 只显示一次</strong>
              <code>{inviteToken}</code>
            </div>
          ) : null}
          {invitesQuery.isLoading ? <Loading label="载入邀请…" /> : invitesQuery.isError ? (
            <ErrorState message="邀请加载失败" onRetry={() => void invitesQuery.refetch()} />
          ) : invites.length === 0 ? <Empty title="暂无邀请" /> : (
            <ul className={styles.rows}>
              {invites.map((row) => (
                <li key={row.inviteId} className={styles.row} data-testid="admin-invite-row">
                  <div className={styles.who}>
                    <strong>{row.email}</strong>
                    <span>{row.role} · {row.status}</span>
                  </div>
                  <Button size="sm" variant="danger"
                    disabled={!canInvite || row.status !== "pending"}
                    data-testid="admin-invite-revoke"
                    onClick={() => revokeInvite.mutate(row.inviteId, {
                      onError: (err) => setError(messageOf(err)),
                    })}>
                    撤销
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form className={styles.form} onSubmit={(event) => void submitInvite(event)}>
            <label>邮箱<input data-testid="admin-invite-email" type="email" required
              value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label>
            <label>角色<select data-testid="admin-invite-role" value={invite.role}
              onChange={(event) => setInvite({ ...invite, role: event.target.value })}>
              {["member", "auditor", "admin"].map((role) => <option key={role}>{role}</option>)}
            </select></label>
            <Button type="submit" disabled={!canInvite} loading={createInvite.isPending}
              data-testid="admin-create-invite">创建邀请</Button>
          </form>
        </section>
      </div>

      <Dialog open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="确认删除用户"
        description={pendingDelete ? `将软删除 ${pendingDelete.name} 并撤销其会话。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button variant="danger" data-testid="confirm-admin-delete" onClick={confirmDelete}>
              确认删除
            </Button>
          </>
        }>
        <p>最后一名管理员不可删除。</p>
      </Dialog>
    </>
  );
  if (embedded) return body;
  return (
    <PageShell title="管理" subtitle="用户、角色与邀请；最后一名管理员不可降级或删除。">
      {body}
    </PageShell>
  );
}
