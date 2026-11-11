import { NavLink } from "react-router";
import { NAV_BOTTOM, NAV_PRIMARY, type NavItem } from "@/app/nav";
import { useSession } from "@/lib/auth/session";
import icons, { type IconName } from "./icons";
import styles from "./Sidebar.module.css";

const THEME_KEY = "poly:theme";

function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private mode: visual toggle still works for this tab */
  }
}

function NavButton({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.path}
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
  return (
    <nav className={styles.rail} aria-label="主导航">
      <div className={styles.brand}>
        <span className={styles.brandName}>PolyOpus</span>
      </div>
      <div className={styles.group}>
        {NAV_PRIMARY.map((item) => (
          <NavButton key={item.path} item={item} />
        ))}
      </div>
      <div className={styles.bottom}>
        {NAV_BOTTOM.map((item) => (
          <NavButton key={item.path} item={item} />
        ))}
        <div className={styles.userRow}>
          <span className={styles.userName} title={user?.displayName}>
            {user?.displayName ?? user?.username ?? ""}
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
