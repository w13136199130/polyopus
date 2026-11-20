/** Automation (cron) hooks: jobs, edit/toggle/run/delete, run history. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cronJobs } from "@/lib/api/endpoints";
import type { CronJobListResponse } from "@/lib/api/wire";

export const cronKeys = {
  jobs: ["cron-jobs"] as const,
  runs: (jobId: string) => ["cron-runs", jobId] as const,
};

export function useCronJobs() {
  return useQuery({
    queryKey: cronKeys.jobs,
    queryFn: cronJobs.list,
    refetchInterval: 10_000,
  });
}

export function useCreateCron() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: cronJobs.create,
    onSuccess: () => void client.invalidateQueries({ queryKey: cronKeys.jobs }),
  });
}

export function useUpdateCron() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: {
      jobId: string;
      enabled?: boolean;
      name?: string;
      schedule?: string;
      timezone?: string;
      text?: string;
    }) => cronJobs.update(jobId, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: cronKeys.jobs }),
  });
}

export function useToggleCron() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, enabled }: { jobId: string; enabled: boolean }) =>
      cronJobs.setEnabled(jobId, enabled),
    onMutate: async ({ jobId, enabled }) => {
      await client.cancelQueries({ queryKey: cronKeys.jobs });
      const previous = client.getQueryData<CronJobListResponse>(cronKeys.jobs);
      client.setQueryData<CronJobListResponse>(cronKeys.jobs, (old) => (
        old
          ? {
              items: old.items.map((job) => (
                job.cronJobId === jobId ? { ...job, enabled } : job
              )),
            }
          : old
      ));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(cronKeys.jobs, context.previous);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: cronKeys.jobs }),
  });
}

export function useDeleteCron() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => cronJobs.remove(jobId),
    onSuccess: () => void client.invalidateQueries({ queryKey: cronKeys.jobs }),
  });
}

export function useRunCron() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => cronJobs.run(jobId),
    onSuccess: (_result, jobId) => {
      void client.invalidateQueries({ queryKey: cronKeys.jobs });
      void client.invalidateQueries({ queryKey: cronKeys.runs(jobId) });
    },
  });
}

export function useCronRuns(jobId: string | null) {
  return useQuery({
    queryKey: cronKeys.runs(jobId ?? "none"),
    queryFn: () => cronJobs.runs(jobId as string),
    enabled: jobId !== null,
    refetchInterval: 5_000,
  });
}
