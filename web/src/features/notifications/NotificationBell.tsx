/** Top-bar notification entry with unread badge (V1-10). */

import { useState } from "react";
import { useNavigate } from "react-router";
import type { NotificationRow } from "@/lib/api/wire";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "./api";
import styles from "./NotificationBell.module.css";

function timeOf(row: NotificationRow): string {
  return new Date(row.createdAt * 1000).toLocaleString();
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const attentions = useAttentions();
  const pending = pendingInbox(attentions.data?.items).length;
  const unread = query.data?.unreadCount ?? 0;
  const items = query.data?.items ?? [];

  function openItem(row: NotificationRow) {
    if (!row.readAt) markRead.mutate(row.notificationId);
    setOpen(false);
    if (row.link) navigate(row.link);
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        data-testid="notification-bell"
        aria-label={unread > 0 ? `通知，${unread} 条未读` : "通知"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        通知
        {unread > 0 ? (
          <span className={styles.badge} data-testid="notification-badge">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={styles.panel} role="dialog" aria-label="通知列表">
          <button
            type="button"
            className={styles.inboxLink}
            data-testid="bell-inbox"
            onClick={() => {
              setOpen(false);
              navigate("/tasks?bucket=attention");
            }}
          >
            <span>待我决定</span>
            <b className={`${styles.inboxCount} ${pending ? styles.inboxCountHot : ""}`}>
              {pending}
            </b>
            <span className={styles.inboxGo}>去处理 →</span>
          </button>
          <div className={styles.head}>
            <span>{unread} 条未读</span>
            <button
              type="button"
              data-testid="notification-read-all"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              全部已读
            </button>
          </div>
          {query.isLoading ? <div className={styles.empty}>载入通知…</div> : null}
          {!query.isLoading && items.length === 0 ? (
            <div className={styles.empty}>暂无通知</div>
          ) : null}
          {items.map((row) => (
            <button
              key={row.notificationId}
              type="button"
              data-testid="notification-item"
              className={`${styles.item} ${row.readAt ? "" : styles.unread}`}
              onClick={() => openItem(row)}
            >
              <strong>{row.title}</strong>
              {row.body ? <span>{row.body}</span> : null}
              <span>{timeOf(row)}</span>
            </button>
          ))}
          <button
            type="button"
            className={styles.allLink}
            data-testid="notification-open-page"
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
          >
            查看全部通知
          </button>
        </div>
      ) : null}
    </div>
  );
}
