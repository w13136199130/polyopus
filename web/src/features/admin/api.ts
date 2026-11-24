/** Admin users/invites data hooks (V1-04). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminModels,
  adminOverview,
  adminSecurity,
  adminStorage,
  invites,
  roles,
  users,
} from "@/lib/api/endpoints";
import type { SecurityRule } from "@/lib/api/wire";

export const adminKeys = {
  users: ["admin-users"] as const,
  roles: ["admin-roles"] as const,
  invites: ["admin-invites"] as const,
};

export function useAdminUsers() {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: users.list,
    refetchInterval: 5_000,
  });
}

export function useRoles() {
  return useQuery({ queryKey: adminKeys.roles, queryFn: roles.list });
}

export function useInvites() {
  return useQuery({
    queryKey: adminKeys.invites,
    queryFn: invites.list,
    refetchInterval: 5_000,
  });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: adminKeys.users });
    void client.invalidateQueries({ queryKey: adminKeys.invites });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: users.create, onSuccess: invalidate });
}

export function useUpdateUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      userId: string; displayName?: string; roles?: string[]; status?: string;
    }) => users.update(input.userId, {
      displayName: input.displayName, roles: input.roles, status: input.status,
    }),
    onSuccess: invalidate,
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: users.remove, onSuccess: invalidate });
}

export function useCreateInvite() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: invites.create, onSuccess: invalidate });
}

export function useRevokeInvite() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: invites.remove, onSuccess: invalidate,
  });
}

/** P2-7 admin console: quotas, audit, backup, data jobs. */

import { adminOps } from "@/lib/api/endpoints";
import type { AuditRow, BackupRow, DataJobRow, QuotaRow } from "@/lib/api/wire";

export const adminOpsKeys = {
  quotas: ["admin-quotas"] as const,
  audit: (filter: string) => ["admin-audit", filter] as const,
  backups: ["admin-backups"] as const,
  dataJobs: ["admin-data-jobs"] as const,
};

export function useQuotas() {
  return useQuery({
    queryKey: adminOpsKeys.quotas,
    queryFn: adminOps.quotas,
  });
}

export function useCreateQuota() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminOps.createQuota,
    onSuccess: () => void client.invalidateQueries({ queryKey: adminOpsKeys.quotas }),
  });
}

export function useUpdateQuota() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { quotaId: string; limit: number }) =>
      adminOps.updateQuota(input.quotaId, input.limit),
    onSuccess: () => void client.invalidateQueries({ queryKey: adminOpsKeys.quotas }),
  });
}

export function useAudit(filter: { action?: string; actorId?: string; result?: string }) {
  const key = JSON.stringify(filter);
  return useQuery({
    queryKey: adminOpsKeys.audit(key),
    queryFn: () => adminOps.audit(filter),
  });
}

export function useBackups() {
  return useQuery({
    queryKey: adminOpsKeys.backups,
    queryFn: adminOps.backups,
  });
}

export function useCreateBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminOps.createBackup,
    onSuccess: () => void client.invalidateQueries({ queryKey: adminOpsKeys.backups }),
  });
}

export function useRestoreBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminOps.restoreBackup,
    onSuccess: () => void client.invalidateQueries({ queryKey: adminOpsKeys.backups }),
  });
}

export function useRemoveBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminOps.removeBackup,
    onSuccess: () => void client.invalidateQueries({ queryKey: adminOpsKeys.backups }),
  });
}

export function useDataJobs() {
  return useQuery({
    queryKey: adminOpsKeys.dataJobs,
    queryFn: adminOps.dataJobs,
    refetchInterval: 5_000,
  });
}

export const adminConfigKeys = {
  overview: ["admin-overview"] as const,
  providers: ["admin-providers"] as const,
  storage: ["admin-storage"] as const,
  backupAuto: ["admin-backup-auto"] as const,
  security: ["admin-security"] as const,
};

export function useAdminOverview() {
  return useQuery({
    queryKey: adminConfigKeys.overview,
    queryFn: adminOverview.get,
    refetchInterval: 15_000,
  });
}

export function useProviders() {
  return useQuery({
    queryKey: adminConfigKeys.providers,
    queryFn: adminModels.list,
  });
}

export function useCreateProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminModels.create,
    onSuccess: () => void client.invalidateQueries({
      queryKey: adminConfigKeys.providers,
    }),
  });
}

export function useUpdateProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, ...body }: {
      providerId: string;
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      models?: string[];
    }) => adminModels.update(providerId, body),
    onSuccess: () => void client.invalidateQueries({
      queryKey: adminConfigKeys.providers,
    }),
  });
}

export function useDeleteProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminModels.remove,
    onSuccess: () => void client.invalidateQueries({
      queryKey: adminConfigKeys.providers,
    }),
  });
}

export function useProbeProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminModels.probe,
    onSuccess: () => void client.invalidateQueries({
      queryKey: adminConfigKeys.providers,
    }),
  });
}

export function useStorageSnapshot() {
  return useQuery({
    queryKey: adminConfigKeys.storage,
    queryFn: adminStorage.get,
    refetchInterval: 30_000,
  });
}

export function useBackupAuto() {
  return useQuery({
    queryKey: adminConfigKeys.backupAuto,
    queryFn: adminStorage.backupAuto,
  });
}

export function useUpdateBackupAuto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminStorage.updateBackupAuto,
    onSuccess: () => void client.invalidateQueries({
      queryKey: adminConfigKeys.backupAuto,
    }),
  });
}

export function useRunBackupAuto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminStorage.runBackupAuto,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminConfigKeys.storage });
      void client.invalidateQueries({ queryKey: adminOpsKeys.backups });
    },
  });
}

export function useSecuritySnapshot() {
  return useQuery({
    queryKey: adminConfigKeys.security,
    queryFn: adminSecurity.get,
  });
}

export function usePublishPolicy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rules: SecurityRule[]) => adminSecurity.publish(rules),
    onSuccess: () => void client.invalidateQueries({
      queryKey: adminConfigKeys.security,
    }),
  });
}

export function useRollbackPolicy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => adminSecurity.rollback(version),
    onSuccess: () => void client.invalidateQueries({
      queryKey: adminConfigKeys.security,
    }),
  });
}

export type { AuditRow, BackupRow, DataJobRow, QuotaRow };
