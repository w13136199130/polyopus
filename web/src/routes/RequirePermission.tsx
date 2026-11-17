import type { ReactNode } from "react";
import { Forbidden } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";

export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const can = useCan(permission);
  if (!can) return <Forbidden hint={`需要权限 ${permission}。`} />;
  return <>{children}</>;
}
