/** Navigation model (docs/04 §2.2): 8 primary objects + 3 bottom entries. */
export type NavGroup = "work" | "capability" | "system";

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Which milestone ships the real page; placeholders say so in the UI. */
  milestone: "v0.5" | "v1.0" | "v1.1";
  /** Rail grouping, mirroring prototype/styles.css. */
  group: NavGroup;
  /** Required permission for the nav entry (V1-02); undefined = always. */
  permission?: string;
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  work: "工作",
  capability: "能力",
  system: "系统",
};

export const NAV_PRIMARY: readonly NavItem[] = [
  { path: "/chat", label: "对话", icon: "chat", milestone: "v0.5", group: "work", permission: "chat:read" },
  { path: "/tasks", label: "任务", icon: "inbox", milestone: "v0.5", group: "work", permission: "ticket:read" },
  { path: "/agents", label: "专家", icon: "bot", milestone: "v1.0", group: "work", permission: "agent:read" },
  { path: "/knowledge", label: "知识", icon: "book", milestone: "v1.0", group: "work", permission: "knowledge:read" },
  { path: "/connections", label: "连接", icon: "plug", milestone: "v0.5", group: "capability", permission: "source:read" },
  { path: "/extensions", label: "扩展", icon: "puzzle", milestone: "v1.0", group: "capability", permission: "extension:read" },
  { path: "/workbench", label: "工作台", icon: "monitor", milestone: "v1.0", group: "capability" },
  { path: "/usage", label: "用量", icon: "chart", milestone: "v0.5", group: "capability", permission: "usage:read" },
];

export const NAV_BOTTOM: readonly NavItem[] = [
  { path: "/settings", label: "设置", icon: "sliders", milestone: "v1.0", group: "system", permission: "settings:read" },
  { path: "/admin", label: "管理", icon: "shield", milestone: "v1.0", group: "system", permission: "user:read" },
];
