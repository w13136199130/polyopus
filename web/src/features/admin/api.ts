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
