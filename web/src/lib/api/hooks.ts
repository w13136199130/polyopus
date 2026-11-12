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
    refetchInterval: 5_000,
  });
}

export function useAnswerAttention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { attentionId: string; decision: "approve" | "deny" }) =>
      attentions.answer(input.attentionId, input.decision),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: attentionKeys.all });
    },
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
