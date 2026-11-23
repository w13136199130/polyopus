import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAV_BOTTOM, NAV_PRIMARY } from "@/app/nav";
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
  it("renders all 8 primary and 2 bottom entries with labels", () => {
    renderAt("/chat");
    for (const item of [...NAV_PRIMARY, ...NAV_BOTTOM]) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.path,
      );
    }
  });

  it("marks the active route", () => {
    renderAt("/tasks");
    const active = screen.getByRole("link", { name: "任务" });
    expect(active.className).toMatch(/active/);
    const idle = screen.getByRole("link", { name: "对话" });
    expect(idle.className).not.toMatch(/active/);
  });

  it("keeps 任务 active on the automation route", () => {
    renderAt("/automation");
    expect(screen.getByRole("link", { name: "任务" }).className).toMatch(/active/);
  });

  it("shows the pending-attention count on 任务", async () => {
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
