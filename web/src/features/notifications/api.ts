/** In-app notification hooks (V1-10). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@/lib/api/endpoints";

export const notificationKeys = {
  list: ["notifications"] as const,
};

export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => notifications.list({ limit: 20 }),
    refetchInterval: 10_000,
  });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: notificationKeys.list });
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
