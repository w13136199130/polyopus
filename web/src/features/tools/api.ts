/** Tool registry + per-agent binding hooks (V1-12). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tools } from "@/lib/api/endpoints";
import type { ToolRow } from "@/lib/api/wire";

export const toolKeys = {
  list: ["tools"] as const,
  bindings: (agentId: string) => ["agent-tools", agentId] as const,
};

export function useTools() {
  return useQuery({ queryKey: toolKeys.list, queryFn: tools.list });
}

export function useAgentTools(agentId: string | null) {
  return useQuery({
    queryKey: toolKeys.bindings(agentId ?? "none"),
    queryFn: () => tools.agentBindings(agentId as string),
    enabled: agentId !== null,
  });
}

export function useSetToolGlobal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { toolKey: string; enabled: boolean }) =>
      tools.update(input.toolKey, input.enabled),
    // optimistic flip: a controlled checkbox must not snap back to the stale
    // cache while the PATCH round-trips
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: toolKeys.list });
      const previous = client.getQueryData<{ items: ToolRow[] }>(toolKeys.list);
      client.setQueryData<{ items: ToolRow[] }>(toolKeys.list, (current) =>
        current
          ? {
              items: current.items.map((tool) =>
                tool.toolKey === input.toolKey
                  ? { ...tool, enabledGlobal: input.enabled }
                  : tool,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        client.setQueryData(toolKeys.list, context.previous);
      }
    },
    onSettled: () => void client.invalidateQueries({ queryKey: toolKeys.list }),
  });
}

export function useSetAgentTools(agentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (items: { toolKey: string; enabled: boolean }[]) =>
      tools.updateAgentBindings(agentId, items),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: toolKeys.bindings(agentId) }),
  });
}
