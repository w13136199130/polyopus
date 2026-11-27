/** Team roster hooks (v1.1 orchestration slice 1: read-only). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { teams } from "@/lib/api/endpoints";

export const teamKeys = {
  list: ["teams"] as const,
};

export function useTeams() {
  return useQuery({
    queryKey: teamKeys.list,
    queryFn: () => teams.list(),
    refetchInterval: 10_000,
  });
}

export function useCreateTeam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string; description?: string; leadId?: string; memberIds?: string[];
    }) => teams.create(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: teamKeys.list }),
  });
}

export function useRunTeam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { teamId: string; task: string; memberIds?: string[] }) =>
      teams.run(input.teamId, { task: input.task, memberIds: input.memberIds }),
    onSuccess: () => void client.invalidateQueries({ queryKey: teamKeys.list }),
  });
}

export function useStopTeam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => teams.stop(teamId),
    onSuccess: () => void client.invalidateQueries({ queryKey: teamKeys.list }),
  });
}
