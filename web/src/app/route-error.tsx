import { useRouteError } from "react-router";
import { ErrorPage } from "@/routes/ErrorPage";

/** Route-level crash surface (createBrowserRouter errorElement). */
export function RouteError() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : String(error ?? "未知错误");
  return <ErrorPage code={500} detail={message} />;
}
