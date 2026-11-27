/**
 * Admin console shell: 概览 / 用户 / 模型 / 存储 / 插件 / 安全 / 应用设置.
 * Header title, subtitle and primary actions follow the active tab; the tab
 * bodies own their sub-tabs and dialogs.
 */

import { useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Tabs } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import { AdminAppTab } from "./AdminAppTab";
import { AdminAuditTab } from "./AdminAuditTab";
import { AdminModelsTab } from "./AdminModelsTab";
import { AdminOverviewTab } from "./AdminOverviewTab";
import { AdminPluginsTab } from "./AdminPluginsTab";
import { AdminSecurityTab } from "./AdminSecurityTab";
import { AdminStorageTab } from "./AdminStorageTab";
import { AdminUsersPage } from "./AdminUsersPage";
import styles from "./AdminPage.module.css";

type Tab = "overview" | "users" | "models" | "storage" | "plugins" | "security" | "app";

const META: Record<Tab, { title: string; subtitle: string }> = {
  overview: {
    title: "管理",
    subtitle: "实例级配置、健康与审计。",
  },
  users: {
    title: "用户管理",
    subtitle: "管理内置账号、角色与配额；当前支持密码登录，OIDC / 飞书 / 企微 / 钉钉随 v1.1 接入。",
  },
  models: {
    title: "模型配置",
    subtitle: "配置对话模型；所有提供商对本实例可用。",
  },
  storage: {
    title: "存储管理",
    subtitle: "配置可供专家使用的存储后端，如本地目录、对象存储、沙箱与数据库。",
  },
  plugins: {
    title: "插件管理",
    subtitle: "服务器插件的安装、启停与权限。",
  },
  security: {
    title: "安全防护",
    subtitle: "配置工具审批、文件访问、敏感信息、命令防护与技能扫描。",
  },
  app: {
    title: "应用设置",
    subtitle: "管理环境变量、备份、HTTPS、系统更新与通行密钥。",
  },
};

export function AdminPage() {
  const navigate = useNavigate();
  const canAdmin = useCan("admin:write");
  const canUsers = useCan("user:read");
  const canAudit = useCan("audit:read");
  const canInvite = useCan("invite:write");
  const canWriteUsers = useCan("user:write");

  const [params, setParams] = useSearchParams();

  const tabs: Array<[Tab, string, boolean]> = [
    ["overview", "概览", canAdmin],
    ["users", "用户", canUsers],
    ["models", "模型", canAdmin],
    ["storage", "存储", canAdmin],
    ["plugins", "插件", canAdmin],
    ["security", "安全", canAdmin || canAudit],
    ["app", "应用设置", canAdmin],
  ];
  const visible = tabs.filter(([, , allowed]) => allowed);
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = visible.some(([key]) => key === requested)
    ? (requested as Tab)
    : (visible[0]?.[0] ?? "users");
  // Tabs are URL-driven so admin nav entries and deep links survive reloads.
  const setTab = (next: Tab) => {
    setParams(
      (prev) => {
        const value = new URLSearchParams(prev);
        value.set("tab", next);
        return value;
      },
      { replace: true },
    );
  };
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Header actions open dialogs owned by the active tab.
  const [createUserSignal, setCreateUserSignal] = useState(0);
  const [inviteSignal, setInviteSignal] = useState(0);
  const [providerSignal, setProviderSignal] = useState(0);
  const [securityEditorSignal, setSecurityEditorSignal] = useState(0);

  const meta = tab === "security" && !canAdmin
    ? { title: "安全防护", subtitle: "审计日志只读；策略配置需要管理员权限。" }
    : META[tab];

  let actions: ReactNode = null;
  if (tab === "users") {
    actions = (
      <>
        <Button
          size="sm"
          variant="outline"
          data-testid="admin-invite-open"
          disabled={!canInvite}
          onClick={() => setInviteSignal((value) => value + 1)}
        >
          邀请用户
        </Button>
        <Button
          size="sm"
          data-testid="admin-new-user"
          disabled={!canWriteUsers}
          onClick={() => setCreateUserSignal((value) => value + 1)}
        >
          ＋ 新建用户
        </Button>
      </>
    );
  } else if (tab === "models" && (params.get("sub") ?? "chat") === "chat") {
    actions = (
      <Button
        size="sm"
        data-testid="provider-new"
        onClick={() => setProviderSignal((value) => value + 1)}
      >
        ＋ 添加供应商
      </Button>
    );
  } else if (tab === "storage") {
    actions = (
      <Button size="sm" disabled title="远端存储后端随 v1.1 接入">
        ＋ 添加存储后端 · v1.1
      </Button>
    );
  } else if (tab === "security" && canAdmin) {
    actions = (
      <Button
        size="sm"
        data-testid="admin-policy-edit"
        onClick={() => setSecurityEditorSignal((value) => value + 1)}
      >
        编辑策略
      </Button>
    );
  }

  return (
    <PageShell
      title={meta.title}
      subtitle={meta.subtitle}
      actions={actions}
      tabs={
        <Tabs
          ariaLabel="管理视图"
          value={tab}
          onChange={setTab}
          items={visible.map(([key, label]) => ({
            key,
            label,
            testId: `admin-tab-${key}`,
          }))}
        />
      }
    >
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {tab === "overview" ? (
          <AdminOverviewTab onOpenTab={(next) => setTab(next)} />
        ) : null}
        {tab === "users" ? (
          <AdminUsersPage
            onNotice={setNotice}
            onError={setError}
            createSignal={createUserSignal}
            inviteSignal={inviteSignal}
          />
        ) : null}
        {tab === "models" ? (
          <AdminModelsTab
            onNotice={setNotice}
            onError={setError}
            createSignal={providerSignal}
          />
        ) : null}
        {tab === "storage" ? (
          <AdminStorageTab onNotice={setNotice} onError={setError} />
        ) : null}
        {tab === "plugins" ? (
          <AdminPluginsTab
            onNotice={setNotice}
            onError={setError}
            onOpenExtensions={() => navigate("/extensions")}
          />
        ) : null}
        {tab === "security" ? (
          canAdmin ? (
            <AdminSecurityTab
              onNotice={setNotice}
              onError={setError}
              editorSignal={securityEditorSignal}
            />
          ) : (
            <AdminAuditTab onNotice={setNotice} onError={setError} />
          )
        ) : null}
        {tab === "app" ? (
          <AdminAppTab onNotice={setNotice} onError={setError} />
        ) : null}
      </div>
    </PageShell>
  );
}
