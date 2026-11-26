/** Team roster hooks (v1.1 orchestration slice 1: read-only). */

import { useQuery } from "@tanstack/react-query";
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
