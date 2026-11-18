import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import {
  NAV_BOTTOM,
  NAV_GROUP_LABELS,
  NAV_PRIMARY,
  type NavGroup,
  type NavItem,
} from "@/app/nav";
import { useSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { toggleTheme } from "@/lib/theme";
import icons, { type IconName } from "./icons";
import styles from "./Sidebar.module.css";

const COLLAPSE_KEY = "poly:rail-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function NavButton({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ""}`}
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d={icons[item.icon as IconName]} />
      </svg>
      <span className={styles.label}>{item.label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const { user, logout } = useSession();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode: collapse still works for this tab */
    }
  }, [collapsed]);

  const visiblePrimary = NAV_PRIMARY.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const visibleBottom = NAV_BOTTOM.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const groups: Array<[NavGroup, NavItem[]]> = [
    ["work", visiblePrimary.filter((item) => item.group === "work")],
    ["capability", visiblePrimary.filter((item) => item.group === "capability")],
    ["system", visibleBottom],
  ];
  const role = user?.roles?.includes("admin")
    ? "管理员"
    : user?.roles?.includes("auditor")
      ? "只读审计"
      : "成员";
  const initial = (user?.displayName || user?.username || "?").slice(0, 1).toUpperCase();

  return (
    <nav
      className={`${styles.rail} ${collapsed ? styles.collapsed : ""}`}
      aria-label="主导航"
    >
      <div className={styles.brand}>
        <span className={styles.logo}>P</span>
        <span className={styles.brandText}>
          <b>PolyOpus</b>
          <span>v1.0 底座</span>
        </span>
        <button
          type="button"
          className={styles.collapse}
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          data-testid="rail-collapse"
          onClick={() => setCollapsed((value) => !value)}
        >
          <svg className={styles.collapseIcon} viewBox="0 0 24 24" aria-hidden="true">
            <path d={icons.chev} />
          </svg>
        </button>
      </div>

      <div className={styles.nav}>
        {groups.map(([group, items]) => (
          items.length === 0 ? null : (
            <div key={group} className={styles.group}>
              <div className={styles.groupLabel}>{NAV_GROUP_LABELS[group]}</div>
              {items.map((item) => (
                <NavButton key={item.path} item={item} collapsed={collapsed} />
              ))}
            </div>
          )
        ))}
      </div>

      <div className={styles.foot}>
        <div className={styles.user}>
          <span className={styles.avatar}>{initial}</span>
          <span className={styles.userMeta}>
            <span className={styles.userName} title={user?.displayName}>
              {user?.displayName ?? user?.username ?? ""}
            </span>
            <span className={styles.userRole}>{role}</span>
          </span>
          <button
            type="button"
            className={styles.mini}
            onClick={toggleTheme}
            aria-label="切换明暗主题"
            title="切换明暗主题"
          >
            ◐
          </button>
          <button
            type="button"
            className={styles.mini}
            onClick={() => void logout()}
            aria-label="退出登录"
            title="退出登录"
          >
            退出
          </button>
        </div>
      </div>
    </nav>
  );
}
