import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  NAV_GROUPS,
  NAV_ITEMS,
  isNavActive,
  navHref,
  type NavItem,
} from "@/app/nav";
import { useSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
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

function NavButton({
  item,
  collapsed,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  badge?: number;
}) {
  const location = useLocation();
  const active = isNavActive(item, location.pathname, location.search);
  // Collapsed mode hides the label, so the title carries the accessible name.
  const title = collapsed
    ? `${item.label}${item.soon ? "（规划中）" : ""}`
    : undefined;
  return (
    <Link
      to={navHref(item)}
      title={title}
      className={`${styles.item} ${active ? styles.active : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d={icons[item.icon as IconName]} />
      </svg>
      <span className={styles.label}>{item.label}</span>
      {item.soon ? <span className={styles.soon}>规划中</span> : null}
      {badge ? (
        <span
          className={styles.badge}
          data-testid="nav-badge"
          aria-label={`${badge} 条待决定`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar() {
  const { user, logout } = useSession();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const attentionsQuery = useAttentions();
  const pendingCount = pendingInbox(attentionsQuery.data?.items).length;

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode: collapse still works for this tab */
    }
  }, [collapsed]);

  const visible = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const role = user?.roles?.includes("admin")
    ? "管理员"
    : user?.roles?.includes("auditor")
      ? "只读审计"
      : "成员";
  const canAdmin = hasPermission(user, "admin:write");

  useEffect(() => {
    if (!accountOpen) return;
    function onPointer(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);
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
        {NAV_GROUPS.map(({ key, label }) => {
          const items = visible.filter((entry) => entry.group === key);
          if (items.length === 0) return null;
          return (
            <div key={key} className={styles.group}>
              {label ? <div className={styles.groupLabel}>{label}</div> : null}
              {items.map((entry) => (
                <NavButton
                  key={`${entry.path}${entry.search ?? ""}`}
                  item={entry}
                  collapsed={collapsed}
                  badge={entry.badge === "inbox" ? pendingCount : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>

      <div className={styles.foot}>
        <div className={styles.user} ref={accountRef}>
          <button
            type="button"
            className={styles.userTrigger}
            aria-label="账户菜单"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            data-testid="account-menu-trigger"
            onClick={() => setAccountOpen((open) => !open)}
          >
            <span className={styles.avatar}>{initial}</span>
            <span className={styles.userMeta}>
              <span className={styles.userName} title={user?.displayName}>
                {user?.displayName ?? user?.username ?? ""}
              </span>
              <span className={styles.userRole}>{role} · 个人账户</span>
            </span>
            <span className={`${styles.chev} ${accountOpen ? styles.chevOpen : ""}`} aria-hidden="true">⌃</span>
          </button>

          {accountOpen ? (
            <div className={styles.accountMenu} role="menu" data-testid="account-menu">
              <div className={styles.accountHead}>
                <b>{user?.displayName ?? user?.username}</b>
                <span>@{user?.username} · {role}</span>
              </div>
              <Link to="/settings" role="menuitem" onClick={() => setAccountOpen(false)}>
                个人设置
              </Link>
              {canAdmin ? (
                <Link to="/admin" role="menuitem" onClick={() => setAccountOpen(false)}>
                  管理控制台
                </Link>
              ) : null}
              <button type="button" role="menuitem" onClick={() => toggleTheme()}>
                切换明暗主题
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.accountDanger}
                onClick={() => {
                  setAccountOpen(false);
                  void logout();
                }}
              >
                退出登录
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
