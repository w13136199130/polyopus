import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { NAV_BOTTOM, NAV_PRIMARY } from "@/app/nav";
import { AuthProvider } from "@/lib/auth/session";
import { Sidebar } from "./Sidebar";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Sidebar />
      </AuthProvider>
    </MemoryRouter>,
  );
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

  it("exposes theme toggle and logout controls", () => {
    renderAt("/chat");
    expect(screen.getByRole("button", { name: "切换明暗主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });
});
