import { Navigate, createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "@/layouts/AppShell";
import { LoginPage } from "@/routes/auth/LoginPage";
import { ComingSoonPage } from "@/routes/ComingSoonPage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { ChatPage } from "@/routes/chat/ChatPage";
import { TasksPage } from "@/routes/tasks/TasksPage";
import { UsagePage } from "@/routes/usage/UsagePage";

/**
 * v0.5 ships three real pages (chat/tasks/usage, filled in by V05-03..05);
 * the rest of the 8+3 navigation is an explicit ComingSoon placeholder so the
 * sidebar never lies about what exists (docs/48 §0.5 F2).
 */
export const appRoutes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "chat", element: <ChatPage /> },
      { path: "tasks", element: <TasksPage /> },
      { path: "usage", element: <UsagePage /> },
      { path: "agents", element: <ComingSoonPage title="专家" milestone="v1.0" /> },
      { path: "knowledge", element: <ComingSoonPage title="知识" milestone="v1.0" /> },
      { path: "connections", element: <ComingSoonPage title="连接" milestone="v1.0" /> },
      { path: "extensions", element: <ComingSoonPage title="扩展" milestone="v1.0" /> },
      { path: "workbench", element: <ComingSoonPage title="工作台" milestone="v1.0" /> },
      { path: "settings", element: <ComingSoonPage title="设置" milestone="v1.0" /> },
      { path: "admin", element: <ComingSoonPage title="管理" milestone="v1.0" /> },
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
