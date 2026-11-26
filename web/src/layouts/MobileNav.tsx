import { useState } from "react";
import { Link, useLocation } from "react-router";
import { NAV_GROUPS, NAV_ITEMS, isNavActive, navHref } from "@/app/nav";
import { useSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
import icons, { type IconName } from "./icons";
import styles from "./MobileNav.module.css";

const QUICK = ["/chat", "/tasks", "/agents"] as const;

/** Bottom navigation for ≤720px; the rest of the 21 entries live in 更多. */
export function MobileNav() {
  const { user } = useSession();
  const location = useLocation();
  const attentions = useAttentions();
  const count = pendingInbox(attentions.data?.items).length;
  const [moreOpen, setMoreOpen] = useState(false);

  const visible = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const quick = QUICK.map((path) => visible.find((item) => item.path === path))
    .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));
  const inbox = visible.find((item) => item.badge === "inbox");

  const link = (
    item: (typeof NAV_ITEMS)[number],
    className = styles.item,
  ) => {
    const active = isNavActive(item, location.pathname, location.search);
    const badge = item.badge === "inbox" ? count : 0;
    return (
      <Link
        key={`${item.path}${item.search ?? ""}`}
        to={navHref(item)}
        className={`${className} ${active ? styles.active : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={() => setMoreOpen(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={icons[item.icon as IconName]} />
        </svg>
        <span>{item.label}</span>
        {badge ? (
          <i className={styles.badge} aria-label={`${badge} 条待决定`}>
            {badge > 9 ? "9+" : badge}
          </i>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {moreOpen ? (
        <div className={styles.sheet} role="dialog" aria-label="更多导航">
          <div className={styles.sheetHead}>
            <b>全部功能</b>
            <button
              type="button"
              className={styles.sheetClose}
              onClick={() => setMoreOpen(false)}
            >
              关闭
            </button>
          </div>
          <div className={styles.sheetBody}>
            {NAV_GROUPS.map(({ key, label }) => {
              const items = visible.filter((item) => item.group === key);
              if (items.length === 0) return null;
              return (
                <div key={key} className={styles.sheetGroup}>
                  {label ? <div className={styles.sheetLabel}>{label}</div> : null}
                  {items.map((item) => link(item, styles.sheetItem))}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <nav className={styles.nav} aria-label="移动端导航">
        {quick[0] ? link(quick[0]) : null}
        {quick[1] ? link(quick[1]) : null}
        {inbox ? link(inbox) : null}
        {quick[2] ? link(quick[2]) : null}
        <button
          type="button"
          className={styles.item}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={icons.grid} />
          </svg>
          <span>更多</span>
        </button>
      </nav>
    </>
  );
}
