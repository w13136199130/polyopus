import { useRouteError } from "react-router";
import { Button } from "@/components/ui";

/** Route-level crash surface (createBrowserRouter errorElement). */
export function RouteError() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : String(error ?? "未知错误");

  return (
    <div style={{ padding: 24, display: "grid", gap: 12, justifyItems: "center" }}>
      <h1 style={{ margin: 0, fontSize: 16 }}>页面崩溃了</h1>
      <p style={{ margin: 0, color: "var(--text-3)", fontSize: 13 }}>{message}</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        重新加载
      </Button>
    </div>
  );
}
