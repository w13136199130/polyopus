/**
 * Notification center (prototype `notifications.html`): in-app list with
 * unread/read filters, single/all read and link navigation. Browser system
 * notifications are optional; a denied/unsupported permission degrades to
 * in-app only and never drops the record.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Empty, ErrorState, Loading, Tabs } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import type { NotificationRow } from "@/lib/api/wire";
import { pendingInbox, useAttentions } from "@/lib/api/hooks";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/features/notifications/api";
import styles from "./NotificationsPage.module.css";

type Filter = "all" | "unread";
type Permission = "unsupported" | "default" | "granted" | "denied";

const KIND_LABEL: Record<string, string> = {
  task: "任务",
  cloud: "云操作",
  export: "导出",
  system: "系统",
};

function permissionNow(): Permission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as Permission;
}

function timeOf(ts: number): string {
  const now = Date.now();
  const seconds = Math.max(0, Math.floor(now / 1000 - ts));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  const date = new Date(ts * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const query = useNotifications({ limit: 100 });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const attentions = useAttentions();
  const pending = pendingInbox(attentions.data?.items).length;
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get("filter") === "unread" ? "unread" : "all";
  const setFilter = (next: Filter) => {
    const query = new URLSearchParams(params);
    if (next === "all") query.delete("filter");
    else query.set("filter", next);
    setParams(query, { replace: true });
  };
  const [permission, setPermission] = useState<Permission>(permissionNow);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setPermission(permissionNow()), []);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const unreadCount = query.data?.unreadCount ?? 0;
  const visible = filter === "unread" ? items.filter((row) => !row.readAt) : items;

  function openItem(row: NotificationRow) {
    if (!row.readAt) markRead.mutate(row.notificationId);
    if (row.link) navigate(row.link);
  }

  async function askPermission() {
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result as Permission);
      if (result === "granted") {
        setNotice("已授权；系统推送通道随 v1.1 接入，站内通知不受影响。");
      }
    } catch {
      setPermission("denied");
    }
  }

  function banner() {
    if (permission === "unsupported") {
      return (
        <div className={`${styles.perm} ${styles.permNeutral}`} data-testid="notification-perm">
          当前浏览器不支持系统通知 · 已降级为站内通知，不影响接收
        </div>
      );
    }
    if (permission === "denied") {
      return (
        <div className={`${styles.perm} ${styles.permDenied}`} data-testid="notification-perm">
          系统通知权限被拒绝 · 已降级为站内通知；可在浏览器站点设置中重新开启
        </div>
      );
    }
    if (permission === "granted") {
      return (
        <div className={`${styles.perm} ${styles.permOk}`} data-testid="notification-perm">
          系统通知已授权 · 服务端后台推送随 v1.1 接入，站内记录始终保留
        </div>
      );
    }
    return (
      <div className={`${styles.perm} ${styles.permWarn}`} data-testid="notification-perm">
        <span>系统通知未开启 · 站内通知仍会正常接收</span>
        <Button size="sm" variant="secondary" onClick={() => void askPermission()}>
          开启系统通知
        </Button>
      </div>
    );
  }

  return (
    <PageShell
      title="通知"
      subtitle="站内通知是真相；系统通知失败不会丢记录。"
      actions={
        <Button
          size="sm"
          variant="secondary"
          data-testid="notifications-read-all"
          disabled={unreadCount === 0 || markAll.isPending}
          loading={markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          全部已读
        </Button>
      }
      tabs={
        <Tabs
          ariaLabel="通知筛选"
          value={filter}
          onChange={setFilter}
          items={[
            { key: "all", label: "全部", badge: items.length },
            { key: "unread", label: "未读", badge: unreadCount, testId: "notifications-unread-filter" },
          ]}
        />
      }
    >
      <div className={styles.page}>
        {notice ? (
          <button type="button" className={styles.notice} onClick={() => setNotice(null)}>
            {notice}
          </button>
        ) : null}
        {banner()}

        <div className={styles.inboxBar} data-testid="notifications-inbox">
          <div className={styles.inboxCopy}>
            <b>待我决定</b>
            <span>
              {pending > 0
                ? `${pending} 项审批或问题等待处理`
                : "没有待你决定的事项；处理完会回到通知流"}
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            data-testid="notifications-inbox-open"
            disabled={pending === 0}
            onClick={() => navigate("/inbox")}
          >
            去任务页处理
          </Button>
        </div>

        {query.isLoading && !query.data ? (
          <Loading label="载入通知…" />
        ) : query.isError ? (
          <ErrorState message="通知加载失败" onRetry={() => void query.refetch()} />
        ) : visible.length === 0 ? (
          <Empty
            title={filter === "unread" ? "没有未读通知" : "暂无通知"}
            hint={
              filter === "unread"
                ? "需要你决定的事项会出现在任务页；这里只做告知。"
                : "任务完成、审批与导出结果会出现在这里。"
            }
            action={filter === "unread"
              ? { label: "查看全部通知", onClick: () => setFilter("all") }
              : undefined}
          />
        ) : (
          <ul className={styles.list}>
            {visible.map((row) => (
              <li
                key={row.notificationId}
                className={`${styles.item} ${row.readAt ? "" : styles.unread}`}
                data-testid="notification-page-item"
              >
                <span className={styles.dot} aria-hidden="true" />
                <div className={styles.body}>
                  <div className={styles.title}>{row.title}</div>
                  {row.body ? <div className={styles.desc}>{row.body}</div> : null}
                  <div className={styles.meta}>
                    <span className={styles.kind}>{KIND_LABEL[row.kind] ?? row.kind}</span>
                    <span className={styles.time}>{timeOf(row.createdAt)}</span>
                  </div>
                </div>
                <div className={styles.actions}>
                  {!row.readAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="notification-mark-read"
                      onClick={() => markRead.mutate(row.notificationId)}
                    >
                      标为已读
                    </Button>
                  ) : (
                    <span className={styles.readTag}>已读</span>
                  )}
                  {row.link ? (
                    <Button size="sm" variant="secondary" onClick={() => openItem(row)}>
                      查看关联
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
