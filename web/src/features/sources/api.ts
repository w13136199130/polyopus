/**
 * Sources + schedule hooks (V05-20). One query each; mutations invalidate
 * both because a schedule job owns a kind='schedule' source.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cronJobs,
  sources,
  type CreateCronBody,
  type CreateSourceBody,
} from "@/lib/api/endpoints";
import type { SourceView } from "@/lib/api/wire";

export const sourceKeys = {
  sources: ["sources"] as const,
  cronJobs: ["cron-jobs"] as const,
};

export function useSources() {
  return useQuery({
    queryKey: sourceKeys.sources,
    queryFn: sources.list,
    refetchInterval: 5_000,
  });
}

export function useCronJobs() {
  return useQuery({
    queryKey: sourceKeys.cronJobs,
    queryFn: cronJobs.list,
    refetchInterval: 5_000,
  });
}

function useInvalidateAll() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: sourceKeys.sources });
    void client.invalidateQueries({ queryKey: sourceKeys.cronJobs });
  };
}

export function useCreateSource() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: CreateSourceBody) => sources.create(body),
    onSuccess: invalidate,
  });
}

export function useToggleSource() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (source: SourceView) =>
      source.status === "active"
        ? sources.pause(source.sourceId)
        : sources.resume(source.sourceId),
    onSuccess: invalidate,
  });
}

export function useDeleteSource() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (sourceId: string) => sources.remove(sourceId),
    onSuccess: invalidate,
  });
}

export function useTestReply() {
  return useMutation({
    mutationFn: (sourceId: string) => sources.testReply(sourceId),
  });
}

export function useCreateCronJob() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: CreateCronBody) => cronJobs.create(body),
    onSuccess: invalidate,
  });
}

export function useToggleCronJob() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (job: { cronJobId: string; enabled: boolean }) =>
      cronJobs.setEnabled(job.cronJobId, !job.enabled),
    onSuccess: invalidate,
  });
}

export function useDeleteCronJob() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (cronJobId: string) => cronJobs.remove(cronJobId),
    onSuccess: invalidate,
  });
}

/** Unsigned if the source has no secret (UI-created sources default to that). */
export async function sendTestWebhook(source: SourceView): Promise<string> {
  const actor = source.allowActors?.[0] ?? "alice";
  const nonce = `${Date.now()}-${Math.random().toFixed(9)}`;
  const accepted = await sources.postWebhook(source.sourceId, {
    external_id: `ui-${nonce}`,
    thread_key: `ui-${nonce}`,
    actor: { id: actor, kind: "user" },
    text: "/polyopus 保存结果到 out.txt",
  });
  return accepted.ticketId ?? "";
}
