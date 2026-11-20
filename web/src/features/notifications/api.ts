/** In-app notification hooks (V1-10). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@/lib/api/endpoints";

export const notificationKeys = {
  all: ["notifications"] as const,
  list: (unreadOnly: boolean, limit: number) =>
    ["notifications", { unreadOnly, limit }] as const,
};

export function useNotifications(options?: { unreadOnly?: boolean; limit?: number }) {
  const unreadOnly = options?.unreadOnly ?? false;
  const limit = options?.limit ?? 20;
  return useQuery({
    queryKey: notificationKeys.list(unreadOnly, limit),
    queryFn: () => notifications.list({ unreadOnly, limit }),
    refetchInterval: 10_000,
  });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: notificationKeys.all });
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: notifications.markRead,
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: notifications.markAllRead,
    onSuccess: invalidate,
  });
}
