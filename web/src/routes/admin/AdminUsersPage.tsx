/**
 * Admin → 用户管理: users / roles / groups / quotas.
 * Header actions (新建用户 / 邀请用户 / 批量导入) live on the admin shell and
 * arrive here as counters; the dialogs themselves stay in this tab.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Dialog, Empty, ErrorState, Loading, Tabs } from "@/components/ui";
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
import type { AdminUserRow, RoleRow } from "@/lib/api/wire";
import { AdminQuotasTab } from "./AdminQuotasTab";
import styles from "./AdminConfig.module.css";

type SubTab = "users" | "roles" | "groups" | "quotas";

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  member: "成员",
  auditor: "只读审计",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "完整权限，不受资源范围限制",
  member: "可使用所有专家与工作区，无管理后台权限",
  auditor: "仅查看审计日志与用量",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}

function roleTone(name: string): string {
  if (name === "admin") return styles.badgeBlue;
  if (name === "auditor") return styles.badgeAmber;
  return styles.badgeNeutral;
}

function SearchIcon() {
  return (
    <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

interface CsvRow {
  line: number;
  username: string;
  displayName: string;
  role: string;
  verdict: "create" | "skip" | "fail";
  reason: string;
}

export function AdminUsersPage({
  onNotice, onError, createSignal, inviteSignal,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  createSignal: number;
  inviteSignal: number;
}) {
  const usersQuery = useAdminUsers();
  const rolesQuery = useRoles();
  const invitesQuery = useInvites();
  const canWrite = useCan("user:write");
  const canInvite = useCan("invite:write");
  const canQuota = useCan("usage:read");
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();

  const [params, setParams] = useSearchParams();
  const subParam = params.get("sub");
  const sub: SubTab =
    subParam === "roles" || subParam === "groups" || (subParam === "quotas" && canQuota)
      ? subParam
      : "users";
  const setSub = (next: SubTab) => {
    const query = new URLSearchParams(params);
    if (next === "users") query.delete("sub");
    else query.set("sub", next);
    setParams(query, { replace: true });
  };
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [permsRole, setPermsRole] = useState<RoleRow | null>(null);

  const [newUser, setNewUser] = useState({
    username: "", displayName: "", email: "", password: "", role: "member",
  });
  const [editForm, setEditForm] = useState({ displayName: "", role: "member", status: "active" });
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);

  // Header actions: open once per click; a later remount does not reopen.
  const seenCreate = useRef(createSignal);
  useEffect(() => {
    if (createSignal === seenCreate.current) return;
    seenCreate.current = createSignal;
    setCreateOpen(true);
  }, [createSignal]);
  const seenInvite = useRef(inviteSignal);
  useEffect(() => {
    if (inviteSignal === seenInvite.current) return;
    seenInvite.current = inviteSignal;
    setInviteOpen(true);
  }, [inviteSignal]);

  const roles = rolesQuery.data?.items ?? [];
  const users = usersQuery.data?.items ?? [];
  const invites = invitesQuery.data?.items ?? [];
  const roleNames = roles.length ? roles.map((role) => role.name) : ["admin", "member", "auditor"];

  const filtered = users.filter((row) => {
    if (roleFilter && row.role !== roleFilter) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [row.username, row.displayName, row.email ?? ""]
      .some((value) => value.toLowerCase().includes(needle));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allPageSelected = pageRows.length > 0
    && pageRows.every((row) => selected.has(row.userId));

  function switchSub(next: SubTab) {
    setSub(next);
    setRoleFilter(null);
  }

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of pageRows) {
        if (checked) next.add(row.userId);
        else next.delete(row.userId);
      }
      return next;
    });
  }

  async function submitUser(event: React.FormEvent) {
    event.preventDefault();
    onError("");
    try {
      await createUser.mutateAsync({
        username: newUser.username.trim(),
        displayName: newUser.displayName.trim() || undefined,
        email: newUser.email.trim() || undefined,
        password: newUser.password,
        roles: [newUser.role],
      });
      onNotice(`已创建用户 ${newUser.username}`);
      setNewUser({ username: "", displayName: "", email: "", password: "", role: "member" });
      setCreateOpen(false);
    } catch (err) {
      onError(messageOf(err));
    }
  }

  async function submitInvite(event: React.FormEvent) {
    event.preventDefault();
    onError("");
    try {
      const created = await createInvite.mutateAsync({
        email: invite.email.trim(), role: invite.role,
      });
      setInviteToken(created.token ?? null);
      onNotice(`已创建邀请 ${invite.email}`);
      setInvite({ email: "", role: "member" });
    } catch (err) {
      onError(messageOf(err));
    }
  }

  function openEdit(row: AdminUserRow) {
    setEditForm({
      displayName: row.displayName,
      role: row.role,
      status: row.status,
    });
    setEditUser(row);
  }

  function saveEdit() {
    if (!editUser) return;
    const row = editUser;
    updateUser.mutate(
      {
        userId: row.userId,
        displayName: editForm.displayName.trim() || undefined,
        roles: [editForm.role],
        status: editForm.status,
      },
      {
        onSuccess: () => {
          onNotice(`已保存用户 ${row.username}`);
          setEditUser(null);
        },
        onError: (err) => onError(messageOf(err)),
      },
    );
  }

  function toggleStatus(row: AdminUserRow) {
    updateUser.mutate(
      { userId: row.userId, status: row.status === "active" ? "disabled" : "active" },
      { onError: (err) => onError(messageOf(err)) },
    );
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    deleteUser.mutate(pendingDelete.id, {
      onSuccess: () => onNotice(`已删除用户 ${pendingDelete.name}`),
      onError: (err) => onError(messageOf(err)),
    });
    setPendingDelete(null);
  }

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
    onNotice(`批量${status === "active" ? "启用" : "禁用"}：成功 ${ok} · 失败 ${fail}`);
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
    onNotice(`批量删除：成功 ${ok} · 失败 ${fail}`);
  }

  function parseCsv(text: string) {
    const existing = new Set(users.map((row) => row.username));
    let lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines[0]?.toLowerCase().startsWith("username,")) lines = lines.slice(1);
    const out: CsvRow[] = [];
    lines.forEach((line, index) => {
      const [username = "", displayName = "", role = ""] =
        line.split(",").map((cell) => cell.trim());
      const lineNo = index + 2;
      if (!username) {
        out.push({ line: lineNo, username, displayName, role,
          verdict: "fail", reason: "username 为空" });
      } else if (existing.has(username) || out.some((row) => row.username === username)) {
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
          password: `poly-${Date.now()}-${ok}`,
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
    setCsvOpen(false);
    onNotice(`CSV 导入：成功 ${ok} · 失败 ${fail}（初始密码见服务端日志）`);
  }

  return (
    <div className={styles.page}>
      <Tabs
        ariaLabel="用户管理视图"
        variant="segmented"
        value={sub}
        onChange={switchSub}
        items={[
          { key: "users", label: "用户", testId: "admin-subtab-users" },
          { key: "roles", label: "角色", testId: "admin-subtab-roles" },
          { key: "groups", label: "分组", testId: "admin-subtab-groups" },
          ...(canQuota
            ? [{ key: "quotas" as const, label: "配额", testId: "admin-subtab-quotas" }]
            : []),
        ]}
      />

      {sub === "users" ? (
        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <SearchIcon />
              <input
                data-testid="admin-user-search"
                placeholder="搜索用户名、显示名、邮箱"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              />
            </div>
            <span className={styles.count}>共 {filtered.length} 条</span>
            {roleFilter ? (
              <button
                type="button"
                className={styles.chip}
                onClick={() => { setRoleFilter(null); setPage(1); }}
              >
                角色：{roleLabel(roleFilter)} ×
              </button>
            ) : null}
            <span className={styles.spacer} />
            <Button size="sm" variant="outline" disabled title="列设置随 v1.1">
              列
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="admin-csv-open"
              disabled={!canWrite}
              onClick={() => setCsvOpen(true)}
            >
              批量导入
            </Button>
          </div>

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
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        aria-label="全选用户"
                        data-testid="admin-select-all"
                        disabled={!canWrite}
                        checked={allPageSelected}
                        onChange={(event) => toggleAll(event.target.checked)}
                      />
                    </th>
                    <th>用户名</th>
                    <th>显示名称</th>
                    <th>邮箱</th>
                    <th>账号类型</th>
                    <th>登录方式</th>
                    <th>状态</th>
                    <th style={{ textAlign: "right" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.userId} data-testid="admin-user-row">
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${row.username}`}
                          data-testid="admin-user-check"
                          disabled={!canWrite}
                          checked={selected.has(row.userId)}
                          onChange={(event) => setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(row.userId);
                            else next.delete(row.userId);
                            return next;
                          })}
                        />
                      </td>
                      <td><b>{row.username}</b></td>
                      <td>{row.displayName}</td>
                      <td className={styles.muted}>{row.email ?? "—"}</td>
                      <td>
                        <span className={`${styles.badge} ${roleTone(row.role)}`}>
                          {roleLabel(row.role)}
                        </span>
                      </td>
                      <td className={styles.muted}>密码</td>
                      <td>
                        <span className={`${styles.badge} ${
                          row.status === "active" ? styles.badgeGreen : styles.badgeRed
                        }`}>
                          {row.status === "active" ? "已启用" : "已禁用"}
                        </span>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <Button size="sm" variant="ghost" disabled={!canWrite}
                            data-testid="admin-edit-user"
                            onClick={() => openEdit(row)}>
                            编辑
                          </Button>
                          <Button size="sm" variant="ghost" disabled title="密码重置随 v1.1"
                            data-testid="admin-reset-password">
                            重置密码
                          </Button>
                          <Button size="sm" variant="ghost" disabled={!canWrite}
                            data-testid="admin-user-status"
                            onClick={() => toggleStatus(row)}>
                            {row.status === "active" ? "禁用" : "启用"}
                          </Button>
                          <Button size="sm" variant="ghost" className={styles.danger}
                            disabled={!canWrite || row.isOwner}
                            data-testid="admin-delete-user"
                            onClick={() => setPendingDelete({ id: row.userId, name: row.username })}>
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.pager}>
                <span>第 {currentPage} / {totalPages} 页</span>
                <span className={styles.spacer} />
                <select value={pageSize}
                  data-testid="admin-page-size"
                  onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                  <option value={6}>6</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
                <span>条 / 页</span>
                <Button size="sm" variant="ghost" disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}>
                  上一页
                </Button>
                <Button size="sm" variant="ghost" disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {sub === "roles" ? (
        <section className={styles.panel}>
          {rolesQuery.isLoading ? <Loading label="载入角色…" /> : rolesQuery.isError ? (
            <ErrorState message="角色加载失败" onRetry={() => void rolesQuery.refetch()} />
          ) : (
            <div className={styles.roleGrid}>
              {roles.map((role) => {
                const members = users.filter((row) => row.roles.includes(role.name)).length;
                const description = ROLE_DESCRIPTIONS[role.name]
                  ?? role.description ?? "自定义角色";
                return (
                  <article key={role.id} className={styles.roleCard} data-testid="admin-role-card">
                    <div className={styles.roleHead}>
                      <b>{roleLabel(role.name)}</b>
                      <span className={`${styles.badge} ${styles.badgeNeutral}`}>{members} 人</span>
                    </div>
                    <p>{description}</p>
                    <div className={styles.roleActions}>
                      <Button size="sm" variant="outline" onClick={() => setPermsRole(role)}>
                        编辑权限
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRoleFilter(role.name);
                          setSearch("");
                          setPage(1);
                          setSub("users");
                        }}
                      >
                        查看成员
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {sub === "groups" ? (
        <section className={styles.panel}>
          <div className={styles.empty}>
            <span className={styles.emptyGlyph}>v1.1</span>
            <b>还没有分组</b>
            <p>组织分组与按分组授权随 v1.1 接入；当前用角色控制管理权限，用专家可见范围控制使用范围。</p>
          </div>
        </section>
      ) : null}

      {sub === "quotas" && canQuota ? (
        <AdminQuotasTab onNotice={onNotice} onError={onError} />
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建用户"
        description="创建后立即生效；初始密码请通过安全渠道转交。"
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              data-testid="admin-create-user"
              type="submit"
              form="admin-create-form"
              loading={createUser.isPending}
              disabled={!canWrite}
            >
              创建用户
            </Button>
          </>
        }
      >
        <form id="admin-create-form" className={styles.form}
          onSubmit={(event) => void submitUser(event)}>
          <label className={styles.field}>用户名
            <input data-testid="admin-new-username" required value={newUser.username}
              onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} />
          </label>
          <label className={styles.field}>显示名称
            <input data-testid="admin-new-display" value={newUser.displayName}
              onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })} />
          </label>
          <label className={styles.field}>邮箱
            <input data-testid="admin-new-email" type="email" value={newUser.email}
              onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} />
          </label>
          <label className={styles.field}>初始密码
            <input data-testid="admin-new-password" required type="password"
              value={newUser.password}
              onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} />
          </label>
          <label className={styles.field}>角色
            <select data-testid="admin-new-role" value={newUser.role}
              onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
              {roleNames.map((role) => (
                <option key={role} value={role}>{roleLabel(role)}</option>
              ))}
            </select>
          </label>
        </form>
      </Dialog>

      <Dialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="邀请用户"
        description="邀请链接只显示一次；对方接受后按角色创建账号。"
        width={600}
        footer={<Button variant="secondary" onClick={() => setInviteOpen(false)}>关闭</Button>}
      >
        <form className={styles.form} onSubmit={(event) => void submitInvite(event)}>
          <label className={styles.field}>邮箱
            <input data-testid="admin-invite-email" type="email" required
              value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })} />
          </label>
          <label className={styles.field}>角色
            <select data-testid="admin-invite-role" value={invite.role}
              onChange={(event) => setInvite({ ...invite, role: event.target.value })}>
              {roleNames.map((role) => (
                <option key={role} value={role}>{roleLabel(role)}</option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={!canInvite} loading={createInvite.isPending}
            data-testid="admin-create-invite">
            创建邀请
          </Button>
        </form>

        {inviteToken ? (
          <div className={styles.token} data-testid="admin-invite-token">
            <strong>邀请 token 只显示一次</strong>
            <code>{inviteToken}</code>
          </div>
        ) : null}

        {invitesQuery.isLoading ? <Loading label="载入邀请…" /> : invites.length === 0 ? (
          <p className={styles.muted}>还没有待处理邀请。</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th /></tr></thead>
              <tbody>
                {invites.map((row) => (
                  <tr key={row.inviteId} data-testid="admin-invite-row">
                    <td>{row.email}</td>
                    <td>{roleLabel(row.role)}</td>
                    <td className={styles.muted}>{row.status}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button size="sm" variant="ghost" className={styles.danger}
                          disabled={!canInvite || row.status !== "pending"}
                          data-testid="admin-invite-revoke"
                          onClick={() => revokeInvite.mutate(row.inviteId, {
                            onError: (err) => onError(messageOf(err)),
                          })}>
                          撤销
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Dialog>

      <Dialog
        open={editUser !== null}
        onOpenChange={(open) => { if (!open) setEditUser(null); }}
        title="编辑用户"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditUser(null)}>取消</Button>
            <Button data-testid="admin-save-user" loading={updateUser.isPending}
              onClick={saveEdit}>
              保存
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <label className={styles.field}>显示名称
            <input data-testid="admin-edit-display" value={editForm.displayName}
              onChange={(event) => setEditForm({ ...editForm, displayName: event.target.value })} />
          </label>
          <label className={styles.field}>邮箱
            <input value={editUser?.email ?? ""} readOnly placeholder="邮箱暂不支持修改" />
          </label>
          <label className={styles.field}>角色
            <select data-testid="admin-edit-role" value={editForm.role}
              onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}>
              {roleNames.map((role) => (
                <option key={role} value={role}>{roleLabel(role)}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>状态
            <select data-testid="admin-edit-status" value={editForm.status}
              onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}>
              <option value="active">已启用</option>
              <option value="disabled">已禁用</option>
            </select>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={permsRole !== null}
        onOpenChange={(open) => { if (!open) setPermsRole(null); }}
        title={permsRole ? `${roleLabel(permsRole.name)}权限` : "角色权限"}
        description="内置角色权限只读；自定义角色随 v1.1 支持。"
        footer={<Button variant="secondary" onClick={() => setPermsRole(null)}>关闭</Button>}
      >
        <div className={styles.permGrid}>
          {(permsRole?.permissions ?? []).map((permission) => (
            <span key={permission} className={`${styles.badge} ${styles.badgeNeutral}`}>
              {permission}
            </span>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        title="批量导入用户"
        description="列：username,display_name,role,email；先 dry-run 预览，重复或非法行不写入。"
        width={680}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCsvOpen(false)}>取消</Button>
            <Button
              data-testid="admin-csv-import"
              disabled={!canWrite || bulkBusy
                || csvRows.filter((row) => row.verdict === "create").length === 0}
              loading={bulkBusy}
              onClick={() => void importCsv()}
            >
              确认导入（{csvRows.filter((row) => row.verdict === "create").length}）
            </Button>
          </>
        }
      >
        <div className={styles.importbox}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                              : row.verdict === "skip" ? styles.bulkSkip : styles.bulkFail
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
            </>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
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
        }
      >
        <p className={styles.muted}>最后一名管理员不可删除。</p>
      </Dialog>
    </div>
  );
}
