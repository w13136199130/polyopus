/** Memory hooks for 个性化 · 记忆. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memories } from "@/lib/api/endpoints";
import type { MemoryAtom } from "@/lib/api/wire";

export const memoryKeys = {
  list: (filters: { kind?: string; status?: string; source?: string }) =>
    ["memories", filters.kind ?? "", filters.status ?? "", filters.source ?? ""] as const,
  pause: ["memories", "pause"] as const,
  search: (query: string) => ["memories", "search", query] as const,
};

export function useMemories(filters: { kind?: string; status?: string; source?: string }) {
  return useQuery({
    queryKey: memoryKeys.list(filters),
    queryFn: () => memories.list({ ...filters, limit: 100 }),
  });
}

export function useMemoryPause() {
  return useQuery({ queryKey: memoryKeys.pause, queryFn: memories.getPause });
}

export function useSetMemoryPause() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { paused: boolean; until?: string }) => memories.setPause(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["memories"] });
    },
  });
}

export function useCreateMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      kind: string; text: string; confidence?: number;
      evidence?: Record<string, unknown>;
    }) => memories.create(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["memories"] }),
  });
}

export function useUpdateMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { atomId: string; text?: string; status?: string; reason?: string }) =>
      memories.update(input.atomId, {
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["memories"] }),
  });
}

export function useDeleteMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (atomId: string) => memories.remove(atomId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["memories"] }),
  });
}

export function useSearchMemories() {
  return useMutation({
    mutationFn: (query: string) => memories.search(query),
  });
}

export function useMemoryExport() {
  return useMutation({ mutationFn: (format: "jsonl" | "json") => memories.export(format) });
}

export function memoryKindLabel(kind: string): string {
  if (kind === "preference") return "偏好";
  if (kind === "fact") return "事实";
  if (kind === "episode") return "情节";
  if (kind === "profile") return "画像";
  if (kind === "skill") return "技能";
  return kind;
}

export function memoryStatusLabel(status: string): string {
  if (status === "active") return "生效中";
  if (status === "pending_review") return "待复核";
  if (status === "retired") return "已退休";
  if (status === "candidate") return "候选";
  return status;
}

export type { MemoryAtom };
