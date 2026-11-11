import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const { status, login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from =
    (location.state as { from?: string } | null)?.from?.startsWith("/") === true
      ? (location.state as { from: string }).from
      : "/chat";

  if (status === "authed") return <Navigate to={from} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "账号或密码错误"
          : `登录失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={onSubmit} aria-label="登录">
      <h1 className={styles.title}>PolyOpus</h1>
      <p className={styles.sub}>本地多智能体工作台</p>
      <label className={styles.field}>
        用户名
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
      </label>
      <label className={styles.field}>
        密码
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <p className={styles.err} role={error ? "alert" : undefined}>
        {error ?? ""}
      </p>
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
