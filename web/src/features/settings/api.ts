/** Settings/security data hooks (V1-16). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth, settings } from "@/lib/api/endpoints";

export const settingsKeys = {
  admin: ["admin-settings"] as const,
  keys: ["api-keys"] as const,
};

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (displayName: string) => auth.updateMe(displayName),
  });
}

export function useAdminSettings() {
  return useQuery({ queryKey: settingsKeys.admin, queryFn: settings.get });
}

export function useApiKeys() {
  return useQuery({ queryKey: settingsKeys.keys, queryFn: settings.apiKeys });
}

export function useReauth() {
  return useMutation({
    mutationFn: (input: { password: string; mfaCode?: string }) =>
      settings.reauth(input.password, input.mfaCode),
  });
}

export function useMfaEnroll() {
  return useMutation({ mutationFn: settings.mfaEnroll });
}

export function useMfaVerify() {
  return useMutation({ mutationFn: settings.mfaVerify });
}

export function useMfaDisable() {
  return useMutation({ mutationFn: settings.mfaDisable });
}

export function useCreateApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: settings.createApiKey,
    onSuccess: () => void client.invalidateQueries({ queryKey: settingsKeys.keys }),
  });
}

export function useRevokeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: settings.revokeApiKey,
    onSuccess: () => void client.invalidateQueries({ queryKey: settingsKeys.keys }),
  });
}
