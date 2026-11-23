import { NavLink } from "react-router";
import { useSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
import icons, { type IconName } from "./icons";
import styles from "./MobileNav.module.css";

const ITEMS: Array<[string, string, IconName, string]> = [
  ["/chat", "对话", "chat", "chat:read"],
  ["/tasks", "任务", "inbox", "ticket:read"],
  ["/agents", "专家", "bot", "agent:read"],
  ["/knowledge", "知识", "book", "knowledge:read"],
  ["/settings", "我的", "sliders", "settings:read"],
];

/** Bottom navigation for ≤720px; the primary rail is hidden there. */
export function MobileNav() {
  const { user } = useSession();
  const attentions = useAttentions();
  const count = pendingInbox(attentions.data?.items).length;
  return (
    <nav className={styles.nav} aria-label="移动端导航">
      {ITEMS.map(([path, label, icon, permission]) => {
        if (!hasPermission(user, permission)) return null;
        return (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `${styles.item} ${isActive ? styles.active : ""}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={icons[icon]} />
            </svg>
            <span>{label}</span>
            {path === "/tasks" && count ? (
              <i className={styles.badge} aria-label={`${count} 条待决定`}>
                {count > 9 ? "9+" : count}
              </i>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
