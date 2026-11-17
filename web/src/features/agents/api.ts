/** Expert/agent data hooks (V1-11). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agents } from "@/lib/api/endpoints";

export const agentKeys = {
  list: ["agents"] as const,
};

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.list,
    queryFn: () => agents.list(),
    refetchInterval: 10_000,
  });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: agentKeys.list });
}

export function useCreateAgent() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: agents.create, onSuccess: invalidate });
}

export function useUpdateAgent() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      agentId: string;
      body: {
        name?: string; description?: string; model?: string;
        systemPrompt?: string; status?: string;
      };
    }) => agents.update(input.agentId, input.body),
    onSuccess: invalidate,
  });
}

export function usePublishAgent() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: agents.publish, onSuccess: invalidate });
}

export function useDeleteAgent() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: agents.remove, onSuccess: invalidate });
}

export function useTestAgent() {
  return useMutation({
    mutationFn: (input: { agentId: string; message: string }) =>
      agents.test(input.agentId, input.message),
  });
}
