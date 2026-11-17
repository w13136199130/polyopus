/** Navigation model (docs/04 §2.2): 8 primary objects + 3 bottom entries. */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Which milestone ships the real page; placeholders say so in the UI. */
  milestone: "v0.5" | "v1.0" | "v1.1";
  /** Required permission for the nav entry (V1-02); undefined = always. */
  permission?: string;
}

export const NAV_PRIMARY: readonly NavItem[] = [
  { path: "/chat", label: "对话", icon: "chat", milestone: "v0.5", permission: "chat:read" },
  { path: "/tasks", label: "任务", icon: "inbox", milestone: "v0.5", permission: "ticket:read" },
  { path: "/agents", label: "专家", icon: "bot", milestone: "v1.0", permission: "agent:read" },
  { path: "/knowledge", label: "知识", icon: "book", milestone: "v1.0", permission: "knowledge:read" },
  { path: "/connections", label: "连接", icon: "plug", milestone: "v0.5", permission: "source:read" },
  { path: "/extensions", label: "扩展", icon: "puzzle", milestone: "v1.0", permission: "extension:read" },
  { path: "/workbench", label: "工作台", icon: "monitor", milestone: "v1.0" },
  { path: "/usage", label: "用量", icon: "chart", milestone: "v0.5", permission: "usage:read" },
];

export const NAV_BOTTOM: readonly NavItem[] = [
  { path: "/settings", label: "设置", icon: "sliders", milestone: "v1.0", permission: "settings:read" },
  { path: "/admin", label: "管理", icon: "shield", milestone: "v1.0", permission: "user:read" },
];
