/** Feishu channel hooks (v1.1). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { channels } from "@/lib/api/endpoints";

export const channelKeys = {
  list: ["channels"] as const,
};

export function useChannels() {
  return useQuery({ queryKey: channelKeys.list, queryFn: channels.list });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: channelKeys.list });
}

export function useCreateChannel() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: channels.create, onSuccess: invalidate });
}

export function useUpdateChannel() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ channelId, ...body }: {
      channelId: string;
      displayName?: string;
      appId?: string;
      appSecret?: string;
      verificationToken?: string;
      encryptKey?: string;
      approvers?: string[];
      status?: string;
    }) => channels.update(channelId, body),
    onSuccess: invalidate,
  });
}

export function useProbeChannel() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: channels.probe, onSuccess: invalidate });
}

export function useDeleteChannel() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: channels.remove, onSuccess: invalidate });
}
