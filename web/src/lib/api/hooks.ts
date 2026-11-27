/**
 * Cross-feature query hooks (docs/49 §3: features never import each other —
 * shared data hooks live here, next to the endpoint layer).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attentions } from "./endpoints";
import type { AttentionItem } from "./wire";

export const attentionKeys = {
  all: ["attentions"] as const,
};

export function useAttentions() {
  return useQuery({
    queryKey: attentionKeys.all,
    queryFn: attentions.list,
    refetchInterval: 2_000,
  });
}

export function useAnswerAttention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      attentionId: string;
      decision?: "approve" | "approve_session" | "deny" | "answer";
      answer?: string;
    }) => attentions.answer(input.attentionId, input.decision, input.answer),
    onSuccess: () => invalidateDecisions(client),
  });
}

export function useAnswerBatchAttention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      attentionIds: string[];
      decision: "approve" | "approve_session" | "deny";
    }) => attentions.answerBatch(input.attentionIds, input.decision),
    onSuccess: () => invalidateDecisions(client),
  });
}

export function useMarkAttentionRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (attentionId: string) => attentions.markRead(attentionId),
    onSuccess: () => void client.invalidateQueries({ queryKey: attentionKeys.all }),
  });
}

export function useMarkAllAttentionsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => attentions.markAllRead(),
    onSuccess: () => void client.invalidateQueries({ queryKey: attentionKeys.all }),
  });
}

export function useSnoozeAttention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { attentionId: string; until: number }) =>
      attentions.snooze(input.attentionId, input.until),
    onSuccess: () => void client.invalidateQueries({ queryKey: attentionKeys.all }),
  });
}

function invalidateDecisions(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: attentionKeys.all });
  void client.invalidateQueries({
    predicate: (query) => ["tickets", "ticket-counts", "ticket", "ticket-timeline"]
      .includes(String(query.queryKey[0])),
  });
}

/** Pending approvals for one turn (used by chat + task inbox alike). */
export function pendingApprovalsForTurn(
  items: AttentionItem[] | undefined,
  turnId: string | null,
): AttentionItem[] {
  if (!items || !turnId) return [];
  return items.filter(
    (item) =>
      item.kind === "approval" && item.status === "pending" && item.turnId === turnId,
  );
}

/** All pending attentions for the inbox strip (approval / question / blocked). */
export function pendingInbox(items: AttentionItem[] | undefined): AttentionItem[] {
  return (items ?? []).filter((item) => item.status === "pending");
}
