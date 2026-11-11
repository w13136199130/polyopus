import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  UNAUTHORIZED_EVENT,
  apiFetch,
  resetUnauthorizedLatch,
} from "@/lib/api/client";
import type { LoginResponse, SessionUser } from "@/lib/api/wire";

export type SessionStatus = "loading" | "authed" | "anon";

interface SessionValue {
  status: SessionStatus;
  user: SessionUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function me(): Promise<SessionUser | null> {
  try {
    const data = await apiFetch<{ user: SessionUser }>("/auth/me", {
      skipUnauthorized: true,
    });
    return data.user;
  } catch {
    // Probe failures (server down) stay anonymous; page APIs surface errors.
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    let alive = true;
    void me().then((found) => {
      if (!alive) return;
      setUser(found);
      setStatus(found ? "authed" : "anon");
    });

    // single-flight 401 from any API call ends the session here; the shell
    // guard then redirects to /login with the current path as returnTo
    function onUnauthorized() {
      setUser(null);
      setStatus("anon");
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      skipUnauthorized: true, // a wrong password is a form error, not a logout
    });
    resetUnauthorizedLatch();
    setUser(data.user);
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST", skipUnauthorized: true });
    } finally {
      resetUnauthorizedLatch();
      setUser(null);
      setStatus("anon");
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <AuthProvider>");
  return ctx;
}
