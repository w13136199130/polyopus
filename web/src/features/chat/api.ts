/**
 * Chat data hooks (docs/49 §4.2): server snapshots in TanStack Query, keyed
 * and invalidated exactly as the table in §4.3 says.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { models as modelsApi, threads, workspace } from "@/lib/api/endpoints";
import type { Thread, ThreadListResponse, ThreadSettings } from "@/lib/api/wire";
import { attentionKeys } from "@/lib/api/hooks";

export const chatKeys = {
  threads: ["threads"] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  trace: (threadId: string) => ["thread-trace", threadId] as const,
  models: ["models"] as const,
  workspace: (path: string) => ["workspace-tree", path] as const,
  attentions: attentionKeys.all,
};

type ThreadList = ThreadListResponse;

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
    mutationFn: (input: { title: string; agentId?: string | null }) =>
      threads.create(input.title, input.agentId ?? undefined),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: chatKeys.threads });
    },
  });
}

type UpdateInput = {
  threadId: string;
  title?: string;
  pinned?: boolean;
  settings?: ThreadSettings;
};

/**
 * Rename / pin / composer settings. Mutations are optimistic: the rail
 * reorders (pin) and toggles (KB/connector/sub-agent) must not wait for a
 * round trip, and a failed write rolls the cache back.
 */
export function useUpdateThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...body }: UpdateInput) =>
      threads.update(threadId, body),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: chatKeys.threads });
      const previous = client.getQueryData<ThreadList>(chatKeys.threads);
      client.setQueryData<ThreadList>(chatKeys.threads, (old) => {
        if (!old) return old;
        return {
          items: old.items.map((thread) => {
            if (thread.threadId !== input.threadId) return thread;
            return {
              ...thread,
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
              // `settings` is a full replacement, exactly like the request
              ...(input.settings !== undefined
                ? { settings: input.settings }
                : {}),
            };
          }),
        };
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        client.setQueryData(chatKeys.threads, context.previous);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: chatKeys.threads });
    },
  });
}

export function useDeleteThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, compact = false }: {
      threadId: string;
      /** Also purge content and VACUUM immediately. */
      compact?: boolean;
    }) => threads.remove(threadId, compact),
    onMutate: async ({ threadId }) => {
      await client.cancelQueries({ queryKey: chatKeys.threads });
      const previous = client.getQueryData<ThreadList>(chatKeys.threads);
      client.setQueryData<ThreadList>(chatKeys.threads, (old) =>
        old
          ? { items: old.items.filter((t) => t.threadId !== threadId) }
          : old,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        client.setQueryData(chatKeys.threads, context.previous);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: chatKeys.threads });
    },
  });
}

export function useBranchThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => threads.branch(threadId),
    onSuccess: (thread: Thread) => {
      void client.invalidateQueries({ queryKey: chatKeys.threads });
      return thread;
    },
  });
}

/** Stop one turn (queued/running/approval). */
export function useStopTurn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; turnId: string }) =>
      threads.stopTurn(input.threadId, input.turnId),
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: chatKeys.messages(input.threadId) });
      void client.invalidateQueries({ queryKey: chatKeys.threads });
      void client.invalidateQueries({ queryKey: chatKeys.attentions });
    },
  });
}

/** Regenerate the latest turn (old assistant rows are soft-deleted). */
export function useRegenerateTurn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; turnId: string }) =>
      threads.regenerateTurn(input.threadId, input.turnId),
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: chatKeys.messages(input.threadId) });
      void client.invalidateQueries({ queryKey: chatKeys.threads });
    },
  });
}

/** Edit the latest user message and re-run its turn. */
export function useEditTurn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; turnId: string; content: string }) =>
      threads.editTurn(input.threadId, input.turnId, input.content),
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: chatKeys.messages(input.threadId) });
      void client.invalidateQueries({ queryKey: chatKeys.threads });
    },
  });
}

/** Branch at a specific assistant message (copies history up to it). */
export function useBranchMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; messageId: string }) =>
      threads.branch(input.threadId, undefined, input.messageId),
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

/** Event tail for the Dock; polling covers approvals/tool steps while open. */
export function useThreadTrace(threadId: string | null, enabled = true) {
  return useQuery({
    queryKey: chatKeys.trace(threadId ?? "none"),
    queryFn: () => threads.trace(threadId as string),
    enabled: enabled && threadId !== null,
    staleTime: 2_000,
    refetchInterval: enabled ? 5_000 : false,
  });
}

export function useModels(enabled = true) {
  return useQuery({
    queryKey: chatKeys.models,
    queryFn: modelsApi.list,
    enabled,
    staleTime: 60_000,
  });
}

/** Workspace tree is only fetched when the Dock is open on a file tab. */
export function useWorkspaceTree(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.workspace(""),
    queryFn: () => workspace.tree(),
    enabled,
    staleTime: 5_000,
  });
}
