/** Connector catalog/instances hooks (V1-14). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectors } from "@/lib/api/endpoints";

export const connectorKeys = {
  catalog: ["connector-catalog"] as const,
  instances: ["connector-instances"] as const,
};

export function useConnectorCatalog() {
  return useQuery({ queryKey: connectorKeys.catalog, queryFn: connectors.catalog });
}

export function useConnectorInstances() {
  return useQuery({
    queryKey: connectorKeys.instances,
    queryFn: connectors.instances,
    refetchInterval: 10_000,
  });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: connectorKeys.instances });
}

export function useCreateConnector() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: connectors.create, onSuccess: invalidate });
}

export function useProbeConnector() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: connectors.probe, onSuccess: invalidate });
}

export function useDeleteConnector() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: connectors.remove, onSuccess: invalidate });
}

export function useStartOAuth() {
  return useMutation({ mutationFn: connectors.oauthStart });
}
