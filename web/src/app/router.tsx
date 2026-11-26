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
import { ExtensionsPage } from "@/routes/extensions/ExtensionsPage";
import { KnowledgePage } from "@/routes/knowledge/KnowledgePage";
import { NotificationsPage } from "@/routes/notifications/NotificationsPage";
import { SettingsPage } from "@/routes/settings/SettingsPage";
import { KitPage } from "@/routes/kit/KitPage";
import { TasksPage } from "@/routes/tasks/TasksPage";
import { TeamsPage } from "@/routes/teams/TeamsPage";
import { UsagePage } from "@/routes/usage/UsagePage";
import { RouteError } from "./route-error";
import { RequirePermission } from "@/routes/RequirePermission";

/**
 * v0.5 ships three real pages (chat/tasks/usage, filled in by V05-03..05);
 * the rest of the 8+3 navigation is an explicit ComingSoon placeholder so the
 * sidebar never lies about what exists (docs/48 §0.5 F2).
 *
 * `/__kit` renders the UI kit gallery for Playwright/visual checks; it is
 * public (no data) and intentionally absent from the nav model — nav.test
 * pins 8+3 and must not learn about it.
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
      { path: "tasks", element: <RequirePermission permission="ticket:read"><TasksPage /></RequirePermission> },
      { path: "automation", element: <RequirePermission permission="cron:read"><AutomationPage /></RequirePermission> },
      { path: "usage", element: <RequirePermission permission="usage:read"><UsagePage /></RequirePermission> },
      { path: "agents", element: <RequirePermission permission="agent:read"><AgentsPage /></RequirePermission> },
      { path: "teams", element: <RequirePermission permission="team:read"><TeamsPage /></RequirePermission> },
      { path: "knowledge", element: <RequirePermission permission="knowledge:read"><KnowledgePage /></RequirePermission> },
      { path: "connections", element: <RequirePermission anyOf={["source:read", "connector:read"]}><ConnectionsPage /></RequirePermission> },
      { path: "extensions", element: <RequirePermission permission="extension:read"><ExtensionsPage /></RequirePermission> },
      { path: "workbench", element: <ComingSoonPage title="工作台" milestone="v1.1" /> },
      { path: "settings", element: <RequirePermission permission="settings:read"><SettingsPage /></RequirePermission> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "admin", element: <RequirePermission permission="user:read"><AdminPage /></RequirePermission> },
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
