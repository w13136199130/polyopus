/**
 * Chat data hooks (docs/49 §4.2): server snapshots in TanStack Query, keyed
 * and invalidated exactly as the table in §4.3 says.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { attentions, threads } from "@/lib/api/endpoints";
import type { AttentionItem } from "@/lib/api/wire";

export const chatKeys = {
  threads: ["threads"] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  attentions: ["attentions"] as const,
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

export function useAttentions() {
  return useQuery({
    queryKey: chatKeys.attentions,
    queryFn: attentions.list,
    refetchInterval: 5_000,
  });
}

export function useAnswerAttention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { attentionId: string; decision: "approve" | "deny" }) =>
      attentions.answer(input.attentionId, input.decision),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: chatKeys.attentions });
    },
  });
}

/** Pending approval cards for the given turn (kind=approval, still pending). */
export function pendingApprovalsForTurn(
  items: AttentionItem[] | undefined,
  turnId: string | null,
): AttentionItem[] {
  if (!items || !turnId) return [];
  return items.filter(
    (item) => item.kind === "approval" && item.status === "pending" && item.turnId === turnId,
  );
}
