import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { AuthProvider } from "@/lib/auth/session";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // docs/49 §4.2 — server snapshots live in the Query cache; stream data
      // never enters it, so a conservative default staleTime is fine here.
      staleTime: 3_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
