/** Knowledge base/document hooks (V1-13). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { knowledge } from "@/lib/api/endpoints";

export const knowledgeKeys = {
  kbs: ["knowledge-bases"] as const,
  docs: (kbId: string, q = "") => ["knowledge-docs", kbId, q] as const,
};

export function useKnowledgeBases() {
  return useQuery({ queryKey: knowledgeKeys.kbs, queryFn: knowledge.listKbs });
}

export function useKnowledgeDocs(kbId: string | null, q = "") {
  return useQuery({
    queryKey: knowledgeKeys.docs(kbId ?? "none", q),
    queryFn: () => knowledge.docs(kbId as string, q || undefined),
    enabled: kbId !== null,
  });
}

export function useCreateKb() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: knowledge.createKb,
    onSuccess: () => void client.invalidateQueries({ queryKey: knowledgeKeys.kbs }),
  });
}

export function useDeleteKb() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: knowledge.removeKb,
    onSuccess: () => void client.invalidateQueries({ queryKey: knowledgeKeys.kbs }),
  });
}

export function useUpdateKb() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kbId: string; name?: string; description?: string }) =>
      knowledge.updateKb(input.kbId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: knowledgeKeys.kbs }),
  });
}

export function useUploadDoc(kbId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { filename: string; content: string }) =>
      knowledge.upload(kbId, body),
    onSuccess: () => {
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "knowledge-docs"
          && query.queryKey[1] === kbId,
      });
      void client.invalidateQueries({ queryKey: knowledgeKeys.kbs });
    },
  });
}

export function useDeleteDoc(kbId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: knowledge.removeDoc,
    onSuccess: () => {
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "knowledge-docs"
          && query.queryKey[1] === kbId,
      });
      void client.invalidateQueries({ queryKey: knowledgeKeys.kbs });
    },
  });
}

export function useSearchKb(kbId: string) {
  return useMutation({
    mutationFn: (query: string) => knowledge.search(kbId, query),
  });
}

/** Rebuild the derived FTS index from stored chunks (P1-5 settings tab). */
export function useReindexKb() {
  return useMutation({ mutationFn: knowledge.reindex });
}

/** Per-doc reindex (knowledge-debug 摄取队列行内操作). */
export function useReindexDoc(kbId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => knowledge.reindexDoc(docId),
    onSuccess: () => {
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "knowledge-docs"
          && query.queryKey[1] === kbId,
      });
      void client.invalidateQueries({ queryKey: knowledgeKeys.kbs });
    },
  });
}
