/** Plugin hooks (V1-15). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { plugins } from "@/lib/api/endpoints";

export const pluginKeys = { list: ["plugins"] as const };

export function usePlugins() {
  return useQuery({ queryKey: pluginKeys.list, queryFn: plugins.list });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: pluginKeys.list });
}

export function useInstallExamples() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: plugins.installExamples, onSuccess: invalidate });
}

export function useTogglePlugin() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { pluginId: string; enabled: boolean }) =>
      plugins.setEnabled(input.pluginId, input.enabled),
    onSuccess: invalidate,
  });
}

export function useUninstallPlugin() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: plugins.remove, onSuccess: invalidate });
}
