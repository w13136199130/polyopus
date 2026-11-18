import { Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "@/lib/auth/session";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";

/**
 * Layout + auth guard (docs/49 §6): unauthenticated visits bounce to
 * /login carrying the current path, so login can return to it.
 */
export function AppShell() {
  const { status } = useSession();
  const location = useLocation();

  if (status === "loading") {
    return <div className={styles.center}>加载中…</div>;
  }
  if (status === "anon") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
