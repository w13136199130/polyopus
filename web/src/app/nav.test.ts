import { describe, expect, it } from "vitest";
import { NAV_ADMIN, NAV_GROUPS, NAV_ITEMS, NAV_PRIMARY, isNavActive, navHref } from "./nav";
import { appRoutes, flattenPaths } from "./router";

describe("navigation model (four groups / 21 entries)", () => {
  it("has 21 entries in four groups", () => {
    expect(NAV_ITEMS).toHaveLength(21);
    const counts = Object.fromEntries(
      NAV_GROUPS.map(({ key }) => [key, NAV_ITEMS.filter((item) => item.group === key).length]),
    );
    expect(counts).toEqual({ main: 6, setup: 6, control: 3, admin: 6 });
    expect(NAV_PRIMARY).toHaveLength(15);
    expect(NAV_ADMIN).toHaveLength(6);
  });

  it("keeps the prototype order and labels", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "对话", "任务", "收件箱", "专家", "自动化", "Token 统计",
      "个性化", "通道", "连接器", "技能包", "知识库", "云端协同",
      "工作台", "远程桌面", "智能体协作",
      "用户管理", "模型配置", "存储管理", "插件管理", "安全防护", "应用设置",
    ]);
  });

  it("targets are unique (path + query) and absolute", () => {
    const all = NAV_ITEMS.map(navHref);
    expect(new Set(all).size).toBe(all.length);
    for (const target of all) expect(target.startsWith("/")).toBe(true);
  });

  it("every nav path has a matching route", () => {
    const routed = new Set(flattenPaths(appRoutes));
    for (const item of NAV_ITEMS) {
      expect(routed.has(item.path), `route missing for ${item.path}`).toBe(true);
    }
  });

  it("every icon resolves to a known glyph", async () => {
    const icons = (await import("@/layouts/icons")).default;
    const names = Object.keys(icons) as string[];
    for (const item of NAV_ITEMS) {
      expect(names, `icon missing for ${item.icon}`).toContain(item.icon);
    }
  });

  it("distinguishes 任务 from 收件箱", () => {
    const tasks = NAV_ITEMS.find((item) => item.label === "任务")!;
    const inbox = NAV_ITEMS.find((item) => item.label === "收件箱")!;
    expect(isNavActive(tasks, "/tasks", "")).toBe(true);
    expect(isNavActive(inbox, "/tasks", "")).toBe(false);
    expect(isNavActive(tasks, "/tasks", "?bucket=attention")).toBe(false);
    expect(isNavActive(inbox, "/tasks", "?bucket=attention")).toBe(false);
    expect(isNavActive(inbox, "/inbox", "")).toBe(true);
  });

  it("matches admin entries by the tab query", () => {
    const models = NAV_ITEMS.find((item) => item.label === "模型配置")!;
    const users = NAV_ITEMS.find((item) => item.label === "用户管理")!;
    expect(isNavActive(models, "/admin", "?tab=models")).toBe(true);
    expect(isNavActive(users, "/admin", "?tab=models")).toBe(false);
    expect(isNavActive(users, "/admin", "")).toBe(false);
  });

  it("marks only the v1.1 pages as planning placeholders", () => {
    expect(NAV_ITEMS.filter((item) => item.soon).map((item) => item.label)).toEqual([
      "技能包", "云端协同", "工作台", "远程桌面", "智能体协作",
    ]);
  });
});
