/** Permission helpers shared by route guards, nav and buttons (V1-02). */

import type { SessionUser } from "@/lib/api/wire";
import { useSession } from "./session";

export function hasPermission(
  user: SessionUser | null | undefined,
  permission: string,
): boolean {
  // During loading/tests there is no user; the shell already gates access.
  if (!user) return true;
  if (!user.permissions) return true; // pre-RBAC server
  return user.permissions.includes("*") || user.permissions.includes(permission);
}

export function useCan(permission: string): boolean {
  const { user } = useSession();
  return hasPermission(user, permission);
}
