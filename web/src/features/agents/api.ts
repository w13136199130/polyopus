/** Expert/agent data hooks (V1-11). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agents } from "@/lib/api/endpoints";

export const agentKeys = {
  list: ["agents"] as const,
  subagents: (agentId: string) => ["agent-subagents", agentId] as const,
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
  const client = useQueryClient();
  return useMutation({
    mutationFn: agents.publish,
    onSuccess: (_agent, agentId) => {
      void client.invalidateQueries({ queryKey: agentKeys.list });
      void client.invalidateQueries({ queryKey: ["agent-versions", agentId] });
      void client.invalidateQueries({ queryKey: ["agent-version", agentId] });
    },
  });
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

export function useAgentSubagents(agentId: string | null) {
  return useQuery({
    queryKey: agentKeys.subagents(agentId ?? ""),
    queryFn: () => agents.subagents(agentId as string),
    enabled: Boolean(agentId),
  });
}

export function useSetAgentSubagents(agentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (subagentIds: string[]) =>
      agents.setSubagents(agentId, subagentIds),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: agentKeys.subagents(agentId),
      });
    },
  });
}

export function useAgentFiles(agentId: string | null) {
  return useQuery({
    queryKey: ["agent-files", agentId ?? "none"],
    queryFn: () => agents.listFiles(agentId as string),
    enabled: agentId !== null,
  });
}

export function useSaveAgentFile(agentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; content: string }) =>
      agents.putFile(agentId, input.name, input.content),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["agent-files", agentId] });
      void client.invalidateQueries({ queryKey: agentKeys.list });
    },
  });
}

export function useDeleteAgentFile(agentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => agents.deleteFile(agentId, name),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["agent-files", agentId] });
      void client.invalidateQueries({ queryKey: agentKeys.list });
    },
  });
}

export function useAgentVersions(agentId: string | null) {
  return useQuery({
    queryKey: ["agent-versions", agentId ?? "none"],
    queryFn: () => agents.listVersions(agentId as string),
    enabled: agentId !== null,
  });
}

export function useRollbackAgent(agentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => agents.rollback(agentId, version),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["agent-versions", agentId] });
      void client.invalidateQueries({ queryKey: ["agent-files", agentId] });
      void client.invalidateQueries({ queryKey: agentKeys.list });
    },
  });
}

export function useAgentVersion(agentId: string | null, version: number | null) {
  return useQuery({
    queryKey: ["agent-version", agentId ?? "none", version ?? 0],
    queryFn: () => agents.getVersion(agentId as string, version as number),
    enabled: agentId !== null && version !== null,
  });
}
