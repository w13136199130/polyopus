import type { ReactNode } from "react";
import { hasPermission, useCan } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/session";
import { ErrorPage } from "./ErrorPage";

export function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: string;
  /** Any one of these permissions is enough (e.g. source OR connector). */
  anyOf?: string[];
  children: ReactNode;
}) {
  const can = useCan(permission ?? "");
  const { user } = useSession();
  const allowed = anyOf
    ? anyOf.some((item) => hasPermission(user, item))
    : can;
  if (!allowed) {
    return <ErrorPage code={403} detail={`需要权限 ${anyOf?.join(" 或 ") ?? permission}。`} />;
  }
  return <>{children}</>;
}
