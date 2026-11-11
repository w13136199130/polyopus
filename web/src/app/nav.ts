/** Navigation model (docs/04 §2.2): 8 primary objects + 3 bottom entries. */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Which milestone ships the real page; placeholders say so in the UI. */
  milestone: "v0.5" | "v1.0";
}

export const NAV_PRIMARY: readonly NavItem[] = [
  { path: "/chat", label: "对话", icon: "chat", milestone: "v0.5" },
  { path: "/tasks", label: "任务", icon: "inbox", milestone: "v0.5" },
  { path: "/agents", label: "专家", icon: "bot", milestone: "v1.0" },
  { path: "/knowledge", label: "知识", icon: "book", milestone: "v1.0" },
  { path: "/connections", label: "连接", icon: "plug", milestone: "v1.0" },
  { path: "/extensions", label: "扩展", icon: "puzzle", milestone: "v1.0" },
  { path: "/workbench", label: "工作台", icon: "monitor", milestone: "v1.0" },
  { path: "/usage", label: "用量", icon: "chart", milestone: "v0.5" },
];

export const NAV_BOTTOM: readonly NavItem[] = [
  { path: "/settings", label: "设置", icon: "sliders", milestone: "v1.0" },
  { path: "/admin", label: "管理", icon: "shield", milestone: "v1.0" },
];
