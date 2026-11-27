/**
 * Navigation model (docs/04 §2.2, prototype v7): four groups / 21 entries.
 *
 * Settings (/settings) is deliberately absent: the personal settings page is
 * reached from the account menu, exactly like prototype/app.js RAIL_GROUPS.
 */

export type NavGroup = "main" | "setup" | "control" | "admin";

export interface NavItem {
  path: string;
  /** Query string appended to `path` (admin tabs, inbox bucket). */
  search?: string;
  label: string;
  icon: string;
  /** Which milestone ships the real page; placeholders say so in the UI. */
  milestone: "v0.5" | "v1.0" | "v1.1";
  group: NavGroup;
  /** Required permission for the nav entry; undefined = signed-in only. */
  permission?: string;
  /** Dedicated page is not built yet: show a "规划中" tag. */
  soon?: boolean;
  /** Which attention counter this entry displays. */
  badge?: "inbox";
  /** Route match, including query-level tabs (admin/inbox). */
  match: (pathname: string, search: string) => boolean;
}

export const NAV_GROUPS: ReadonlyArray<{ key: NavGroup; label: string }> = [
  { key: "main", label: "" },
  { key: "setup", label: "设置" },
  { key: "control", label: "控制" },
  { key: "admin", label: "管理" },
];

const tabOf = (search: string) =>
  new URLSearchParams(search).get("tab") ?? "overview";
const bucketOf = (search: string) => new URLSearchParams(search).get("bucket");

const under = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

const adminTab = (tab: string) => (pathname: string, search: string) =>
  pathname === "/admin" && tabOf(search) === tab;

function item(
  value: Omit<NavItem, "match"> & { match?: NavItem["match"] },
): NavItem {
  return {
    ...value,
    match: value.match ?? ((pathname) => under(pathname, value.path)),
  };
}

/** Four groups, 21 entries, in prototype order (app.js RAIL_GROUPS). */
export const NAV_ITEMS: readonly NavItem[] = [
  item({
    path: "/chat",
    label: "对话",
    icon: "chat",
    milestone: "v0.5",
    group: "main",
    permission: "chat:read",
  }),
  item({
    path: "/tasks",
    label: "任务",
    icon: "checks",
    milestone: "v0.5",
    group: "main",
    permission: "ticket:read",
    match: (pathname, search) =>
      under(pathname, "/tasks") && bucketOf(search) !== "attention",
  }),
  item({
    path: "/inbox",
    label: "收件箱",
    icon: "inbox",
    milestone: "v0.5",
    group: "main",
    permission: "attention:read",
    badge: "inbox",
    match: (pathname) => pathname === "/inbox",
  }),
  item({
    path: "/agents",
    label: "专家",
    icon: "bot",
    milestone: "v1.0",
    group: "main",
    permission: "agent:read",
  }),
  item({
    path: "/automation",
    label: "自动化",
    icon: "clock",
    milestone: "v1.0",
    group: "main",
    permission: "cron:read",
  }),
  item({
    path: "/usage",
    label: "Token 统计",
    icon: "chart",
    milestone: "v0.5",
    group: "main",
    permission: "usage:read",
  }),

  item({
    path: "/personalization",
    label: "个性化",
    icon: "spark",
    milestone: "v1.1",
    group: "setup",
    permission: "settings:read",
  }),
  item({
    path: "/channels",
    label: "通道",
    icon: "send",
    milestone: "v1.0",
    group: "setup",
    permission: "source:read",
  }),
  item({
    path: "/connections",
    label: "连接器",
    icon: "plug",
    milestone: "v0.5",
    group: "setup",
    permission: "connector:read",
  }),
  item({
    path: "/skills",
    label: "技能包",
    icon: "package",
    milestone: "v1.1",
    group: "setup",
    permission: "extension:read",
    soon: true,
  }),
  item({
    path: "/knowledge",
    label: "知识库",
    icon: "book",
    milestone: "v1.0",
    group: "setup",
    permission: "knowledge:read",
  }),
  item({
    path: "/bridge",
    label: "云端协同",
    icon: "cloud",
    milestone: "v1.1",
    group: "setup",
    soon: true,
  }),

  item({
    path: "/workbench",
    label: "工作台",
    icon: "monitor",
    milestone: "v1.1",
    group: "control",
    soon: true,
  }),
  item({
    path: "/remote",
    label: "远程桌面",
    icon: "terminal",
    milestone: "v1.1",
    group: "control",
    soon: true,
  }),
  item({
    path: "/acp",
    label: "智能体协作",
    icon: "cpu",
    milestone: "v1.1",
    group: "control",
    soon: true,
  }),

  item({
    path: "/admin",
    search: "?tab=users",
    label: "用户管理",
    icon: "users",
    milestone: "v1.0",
    group: "admin",
    permission: "user:read",
    match: adminTab("users"),
  }),
  item({
    path: "/admin",
    search: "?tab=models",
    label: "模型配置",
    icon: "key",
    milestone: "v1.0",
    group: "admin",
    permission: "admin:write",
    match: adminTab("models"),
  }),
  item({
    path: "/admin",
    search: "?tab=storage",
    label: "存储管理",
    icon: "database",
    milestone: "v1.0",
    group: "admin",
    permission: "admin:write",
    match: adminTab("storage"),
  }),
  item({
    path: "/admin",
    search: "?tab=plugins",
    label: "插件管理",
    icon: "puzzle",
    milestone: "v1.0",
    group: "admin",
    permission: "admin:write",
    match: adminTab("plugins"),
  }),
  item({
    path: "/admin",
    search: "?tab=security",
    label: "安全防护",
    icon: "shield",
    milestone: "v1.0",
    group: "admin",
    permission: "audit:read",
    match: adminTab("security"),
  }),
  item({
    path: "/admin",
    search: "?tab=app",
    label: "应用设置",
    icon: "sliders",
    milestone: "v1.0",
    group: "admin",
    permission: "admin:write",
    match: adminTab("app"),
  }),
];

/** Backwards-compatible slices used by tests and the command palette. */
export const NAV_PRIMARY = NAV_ITEMS.filter((entry) => entry.group !== "admin");
export const NAV_ADMIN = NAV_ITEMS.filter((entry) => entry.group === "admin");

export function navHref(entry: NavItem): string {
  return `${entry.path}${entry.search ?? ""}`;
}

export function isNavActive(
  entry: NavItem,
  pathname: string,
  search: string,
): boolean {
  return entry.match(pathname, search);
}
