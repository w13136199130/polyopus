/** Admin users/invites data hooks (V1-04). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invites, roles, users } from "@/lib/api/endpoints";

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
    mutationFn: (input: { userId: string; roles?: string[]; status?: string }) =>
      users.update(input.userId, { roles: input.roles, status: input.status }),
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

export type { AuditRow, BackupRow, DataJobRow, QuotaRow };
