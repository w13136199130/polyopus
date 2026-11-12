/**
 * Chat data hooks (docs/49 §4.2): server snapshots in TanStack Query, keyed
 * and invalidated exactly as the table in §4.3 says.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { threads } from "@/lib/api/endpoints";
import { attentionKeys } from "@/lib/api/hooks";

export const chatKeys = {
  threads: ["threads"] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  attentions: attentionKeys.all,
};

export function useThreads() {
  return useQuery({
    queryKey: chatKeys.threads,
    queryFn: threads.list,
    // keep list fresh while chat is open (docs/49 §4.2: threads 10s)
    staleTime: 3_000,
    refetchInterval: 10_000,
  });
}

export function useCreateThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => threads.create(title),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: chatKeys.threads });
    },
  });
}

export function useMessages(threadId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(threadId ?? "none"),
    queryFn: () => threads.messages(threadId as string),
    enabled: threadId !== null,
    // events are the truth; projection may lag a beat, so allow refetch
    staleTime: 0,
  });
}

