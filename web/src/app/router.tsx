import { Navigate, createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "@/layouts/AppShell";
import { AgentsPage } from "@/routes/agents/AgentsPage";
import { LoginPage } from "@/routes/auth/LoginPage";
import { ComingSoonPage } from "@/routes/ComingSoonPage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { ChatPage } from "@/routes/chat/ChatPage";
import { AdminUsersPage } from "@/routes/admin/AdminUsersPage";
import { ConnectionsPage } from "@/routes/connections/ConnectionsPage";
import { KitPage } from "@/routes/kit/KitPage";
import { TasksPage } from "@/routes/tasks/TasksPage";
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
      { path: "usage", element: <RequirePermission permission="usage:read"><UsagePage /></RequirePermission> },
      { path: "agents", element: <RequirePermission permission="agent:read"><AgentsPage /></RequirePermission> },
      { path: "knowledge", element: <ComingSoonPage title="知识" milestone="v1.0" /> },
      { path: "connections", element: <RequirePermission permission="source:read"><ConnectionsPage /></RequirePermission> },
      { path: "extensions", element: <ComingSoonPage title="扩展" milestone="v1.0" /> },
      { path: "workbench", element: <ComingSoonPage title="工作台" milestone="v1.0" /> },
      { path: "settings", element: <ComingSoonPage title="设置" milestone="v1.0" /> },
      { path: "admin", element: <RequirePermission permission="user:read"><AdminUsersPage /></RequirePermission> },
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
