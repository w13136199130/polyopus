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

export function AdminUsersPage() {
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
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [newUser, setNewUser] = useState({
    username: "", displayName: "", password: "", role: "member",
  });
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [inviteToken, setInviteToken] = useState<string | null>(null);

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

  return (
    <PageShell title="管理" subtitle="用户、角色与邀请；最后一名管理员不可降级或删除。">
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.head}><h2>用户</h2><span>{users.length} 人</span></div>
          {usersQuery.isLoading ? <Loading label="载入用户…" /> : usersQuery.isError ? (
            <ErrorState message="用户加载失败" onRetry={() => void usersQuery.refetch()} />
          ) : users.length === 0 ? <Empty title="暂无用户" /> : (
            <ul className={styles.rows}>
              {users.map((row) => (
                <li key={row.userId} className={styles.row} data-testid="admin-user-row">
                  <div className={styles.who}>
                    <strong>{row.displayName}</strong>
                    <code>{row.username}</code>
                    <span className={styles.status}>{row.status}</span>
                  </div>
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
    </PageShell>
  );
}
