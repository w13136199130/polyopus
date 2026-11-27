import { Navigate, createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "@/layouts/AppShell";
import { AgentsPage } from "@/routes/agents/AgentsPage";
import { AutomationPage } from "@/routes/automation/AutomationPage";
import { LoginPage } from "@/routes/auth/LoginPage";
import { ComingSoonPage } from "@/routes/ComingSoonPage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { ChatPage } from "@/routes/chat/ChatPage";
import { AdminPage } from "@/routes/admin/AdminPage";
import { ConnectionsPage } from "@/routes/connections/ConnectionsPage";
import { ChannelsPage } from "@/routes/connections/ChannelsPage";
import { SourcesPage } from "@/routes/connections/SourcesPage";
import { ExtensionsPage } from "@/routes/extensions/ExtensionsPage";
import { KnowledgePage } from "@/routes/knowledge/KnowledgePage";
import { NotificationsPage } from "@/routes/notifications/NotificationsPage";
import { PersonalizationPage } from "@/routes/personalization/PersonalizationPage";
import { SettingsPage } from "@/routes/settings/SettingsPage";
import { KitPage } from "@/routes/kit/KitPage";
import { TasksPage } from "@/routes/tasks/TasksPage";
import { InboxPage } from "@/routes/tasks/InboxPage";
import { UsagePage } from "@/routes/usage/UsagePage";
import { RouteError } from "./route-error";
import { RequirePermission } from "@/routes/RequirePermission";

/**
 * Four-group / 21-entry navigation (docs/04 §2.2, docs/52 §2). Pages whose
 * backend domain has not shipped yet are explicit ComingSoon placeholders, so
 * the rail never lies about what exists (docs/48 §0.5 F2).
 *
 * `/settings`, `/teams`, `/notifications` and `/extensions` stay as
 * compatibility routes but are absent from the nav model. `/__kit` renders the
 * UI kit gallery for Playwright/visual checks and is public (no data).
 */
export const appRoutes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/__kit", element: <KitPage /> },
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "chat", element: <RequirePermission permission="chat:read"><ChatPage /></RequirePermission> },
      { path: "chat/:threadId", element: <RequirePermission permission="chat:read"><ChatPage /></RequirePermission> },
      { path: "tasks", element: <RequirePermission permission="ticket:read"><TasksPage /></RequirePermission> },
      { path: "tasks/:ticketId", element: <RequirePermission permission="ticket:read"><TasksPage /></RequirePermission> },
      { path: "inbox", element: <RequirePermission permission="attention:read"><InboxPage /></RequirePermission> },
      { path: "automation", element: <RequirePermission permission="cron:read"><AutomationPage /></RequirePermission> },
      { path: "usage", element: <RequirePermission permission="usage:read"><UsagePage /></RequirePermission> },
      { path: "agents", element: <RequirePermission permission="agent:read"><AgentsPage /></RequirePermission> },
      { path: "teams", element: <RequirePermission permission="team:read"><Navigate to="/agents?tab=team" replace /></RequirePermission> },
      { path: "knowledge", element: <RequirePermission permission="knowledge:read"><KnowledgePage /></RequirePermission> },
      { path: "connections", element: <RequirePermission permission="connector:read"><ConnectionsPage /></RequirePermission> },
      { path: "channels", element: <RequirePermission permission="source:read"><ChannelsPage /></RequirePermission> },
      { path: "sources", element: <RequirePermission permission="source:read"><SourcesPage /></RequirePermission> },
      { path: "skills", element: <RequirePermission permission="extension:read"><ComingSoonPage title="技能包" milestone="v1.1" note="技能包的安装、创建与技能市场依赖技能域接口，随 v1.1 提供。" /></RequirePermission> },
      { path: "personalization", element: <RequirePermission permission="settings:read"><PersonalizationPage /></RequirePermission> },
      { path: "bridge", element: <ComingSoonPage title="云端协同" milestone="v1.1" note="跨实例共享专家与会话需要控制器和端到端鉴权，随 v1.1 提供。" /> },
      { path: "remote", element: <ComingSoonPage title="远程桌面" milestone="v1.1" note="服务器/手机远程控制需要配对与串流通道，随 v1.1 提供。" /> },
      { path: "acp", element: <ComingSoonPage title="智能体协作" milestone="v1.1" note="外部 ACP Runner 的注册、权限与委派随 v1.1 提供。" /> },
      { path: "extensions", element: <RequirePermission permission="extension:read"><ExtensionsPage /></RequirePermission> },
      { path: "workbench", element: <ComingSoonPage title="工作台" milestone="v1.1" /> },
      { path: "settings", element: <RequirePermission permission="settings:read"><SettingsPage /></RequirePermission> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "admin", element: <RequirePermission anyOf={["user:read", "admin:write", "audit:read"]}><AdminPage /></RequirePermission> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);

/** Flatten routes into their full paths (index children count as the parent). */
export function flattenPaths(routes: RouteObject[], prefix = ""): string[] {
  const out: string[] = [];
  for (const route of routes) {
    const path = route.path;
    if (typeof path !== "string") continue;
    const full = path.startsWith("/")
      ? path
      : prefix === ""
        ? path
        : prefix === "/"
          ? `/${path}`
          : `${prefix}/${path}`;
    out.push(full);
    if (route.children) out.push(...flattenPaths(route.children, full));
  }
  return out;
}
