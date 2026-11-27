import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAV_ADMIN, NAV_ITEMS, NAV_PRIMARY } from "@/app/nav";
import { AuthProvider } from "@/lib/auth/session";
import { Sidebar } from "./Sidebar";

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Sidebar />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Sidebar", () => {
  it("renders all 21 entries in four groups with labels", () => {
    renderAt("/chat");
    expect(NAV_PRIMARY).toHaveLength(15);
    expect(NAV_ADMIN).toHaveLength(6);
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole("link", { name: new RegExp(`^${item.label}`) })).toHaveAttribute(
        "href",
        `${item.path}${item.search ?? ""}`,
      );
    }
    for (const label of ["设置", "控制", "管理"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the active route", () => {
    renderAt("/tasks");
    expect(screen.getByRole("link", { name: "任务" }).className).toMatch(/active/);
    expect(screen.getByRole("link", { name: "对话" }).className).not.toMatch(/active/);
  });

  it("keeps 自动化 active on its own route", () => {
    renderAt("/automation");
    expect(screen.getByRole("link", { name: "自动化" }).className).toMatch(/active/);
    expect(screen.getByRole("link", { name: "任务" }).className).not.toMatch(/active/);
  });

  it("marks 收件箱 active on its own route", () => {
    renderAt("/inbox");
    expect(screen.getByRole("link", { name: "收件箱" }).className).toMatch(/active/);
    expect(screen.getByRole("link", { name: "任务" }).className).not.toMatch(/active/);
  });

  it("marks a single admin entry by tab query", () => {
    renderAt("/admin?tab=models");
    expect(screen.getByRole("link", { name: "模型配置" }).className).toMatch(/active/);
    expect(screen.getByRole("link", { name: "用户管理" }).className).not.toMatch(/active/);
  });

  it("tags planned v1.1 pages", () => {
    renderAt("/chat");
    expect(screen.getAllByText("规划中").length).toBeGreaterThanOrEqual(5);
  });

  it("shows the pending-attention count on 收件箱", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/attentions")) {
          return Promise.resolve(json({
            items: [
              { attentionId: "at_1", kind: "approval", status: "pending" },
              { attentionId: "at_2", kind: "blocked", status: "pending" },
              { attentionId: "at_3", kind: "question", status: "answered" },
            ],
          }));
        }
        return Promise.resolve(json({
          user: { userId: "u", tenantId: "t", username: "admin", displayName: "Admin", isOwner: true },
        }));
      }),
    );
    renderAt("/chat");
    await waitFor(() =>
      expect(screen.getByTestId("nav-badge")).toHaveTextContent("2"));
  });

  it("opens the account menu with theme and logout controls", async () => {
    renderAt("/chat");
    await userEvent.click(screen.getByTestId("account-menu-trigger"));
    expect(screen.getByRole("menuitem", { name: "个人设置" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "切换明暗主题" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();
  });
});
