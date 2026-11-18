/** Plugin hooks (V1-15). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { plugins } from "@/lib/api/endpoints";
import type { PluginRow } from "@/lib/api/wire";

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

/** Install a signed manifest bundle (P1-6): signature comes from a trusted
 * signer offline; the server verifies the HMAC before anything registers. */
export function useInstallPlugin() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      pluginId: string;
      manifest: Record<string, unknown>;
      signature: string;
      signer: string;
    }) => plugins.install(input.pluginId, {
      manifest: input.manifest,
      signature: input.signature,
      signer: input.signer,
    }),
    onSuccess: invalidate,
  });
}

export function useTogglePlugin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { pluginId: string; enabled: boolean }) =>
      plugins.setEnabled(input.pluginId, input.enabled),
    // optimistic flip so the controlled checkbox never snaps back mid-flight
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: pluginKeys.list });
      const previous = client.getQueryData<{ items: PluginRow[] }>(pluginKeys.list);
      client.setQueryData<{ items: PluginRow[] }>(pluginKeys.list, (current) =>
        current
          ? {
              items: current.items.map((plugin) =>
                plugin.pluginId === input.pluginId
                  ? {
                      ...plugin,
                      status: input.enabled ? "enabled" : "disabled",
                    }
                  : plugin,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        client.setQueryData(pluginKeys.list, context.previous);
      }
    },
    onSettled: () => void client.invalidateQueries({ queryKey: pluginKeys.list }),
  });
}

export function useUninstallPlugin() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: plugins.remove, onSuccess: invalidate });
}
