/** Settings page (V1-16): account security, API keys and read-only system. */

import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useSession } from "@/lib/auth/session";
import {
  useAdminSettings,
  useApiKeys,
  useCreateApiKey,
  useMfaDisable,
  useMfaEnroll,
  useMfaVerify,
  useReauth,
  useRevokeApiKey,
} from "@/features/settings/api";
import styles from "./SettingsPage.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function SettingsPage() {
  const { user } = useSession();
  const settingsQuery = useAdminSettings();
  const keysQuery = useApiKeys();
  const reauth = useReauth();
  const enroll = useMfaEnroll();
  const verify = useMfaVerify();
  const disableMfa = useMfaDisable();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [password, setPassword] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(Boolean(user?.mfaEnabled));
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [keyName, setKeyName] = useState("ci");
  const [keyScopes, setKeyScopes] = useState("chat:read");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = settingsQuery.data;
  const keys = keysQuery.data?.items ?? [];

  async function doReauth(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await reauth.mutateAsync({ password });
      setStepUp(true);
      setNotice("已重新认证，敏感操作 5 分钟内有效");
      setPassword("");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function startEnroll() {
    setError(null);
    try {
      const data = await enroll.mutateAsync();
      setSecret(data.secret);
      setOtpauth(data.otpauthUrl);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function confirmMfa(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const data = await verify.mutateAsync(code);
      setRecovery(data.recoveryCodes);
      setMfaEnabled(true);
      setSecret(null);
      setOtpauth(null);
      setNotice("MFA 已启用，恢复码只显示一次");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function turnOffMfa() {
    setError(null);
    if (!stepUp) {
      setError("请先重新认证");
      return;
    }
    try {
      await disableMfa.mutateAsync("totp");
      setMfaEnabled(false);
      setRecovery([]);
      setNotice("MFA 已关闭");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function createApiKey(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!stepUp) {
      setError("请先重新认证");
      return;
    }
    try {
      const data = await createKey.mutateAsync({
        name: keyName.trim(),
        scopes: keyScopes.split(",").map((scope) => scope.trim()).filter(Boolean),
      });
      setNewSecret(data.secret);
      setNotice("API Key 已创建，secret 只显示一次");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <PageShell title="设置" subtitle="账户安全、API Key 与只读实例配置；敏感操作需要 step-up。">
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.head}><h2>账户安全</h2><span>{user?.username}</span></div>
          <div className={styles.muted}>MFA：{mfaEnabled ? "已启用" : "未启用"}</div>
          {mfaEnabled ? (
            <Button size="sm" variant="danger" data-testid="mfa-disable"
              loading={disableMfa.isPending} onClick={() => void turnOffMfa()}>
              关闭 MFA
            </Button>
          ) : secret ? (
            <form className={styles.form} onSubmit={(event) => void confirmMfa(event)}>
              <div className={styles.secret} data-testid="mfa-secret">
                <strong>密钥</strong><code>{secret}</code>
                <span>{otpauth}</span>
              </div>
              <label>6 位验证码<input data-testid="mfa-code" value={code}
                onChange={(event) => setCode(event.target.value)} /></label>
              <Button type="submit" loading={verify.isPending}
                data-testid="mfa-verify">确认启用</Button>
            </form>
          ) : (
            <Button size="sm" data-testid="mfa-enroll"
              loading={enroll.isPending} onClick={() => void startEnroll()}>
              绑定 TOTP
            </Button>
          )}
          {recovery.length > 0 ? (
            <div className={styles.secret} data-testid="mfa-recovery">
              <strong>恢复码</strong>
              <div className={styles.codes}>
                {recovery.map((item) => <code key={item}>{item}</code>)}
              </div>
            </div>
          ) : null}
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>重新认证</h2><span>step-up 5 分钟</span></div>
          <form className={styles.form} onSubmit={(event) => void doReauth(event)}>
            <label>当前密码<input type="password" data-testid="reauth-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)} /></label>
            <Button type="submit" loading={reauth.isPending}
              data-testid="reauth-submit">重新认证</Button>
            <span className={styles.muted}>{stepUp ? "已认证" : "未认证"}</span>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>API Key</h2><span>{keys.length} 个</span></div>
          {newSecret ? (
            <div className={styles.secret} data-testid="api-key-secret">
              <strong>Secret 只显示一次</strong><code>{newSecret}</code>
            </div>
          ) : null}
          {keysQuery.isLoading ? <Loading label="载入 Key…" /> : keysQuery.isError ? (
            <ErrorState message="Key 加载失败" onRetry={() => void keysQuery.refetch()} />
          ) : keys.length === 0 ? <Empty title="暂无 API Key" /> : (
            <ul className={styles.rows}>
              {keys.map((key) => (
                <li key={key.id} className={styles.row}>
                  <div className={styles.who}>
                    <strong>{key.name}</strong>
                    <span>{key.prefix} · {key.scopes.join(", ")}</span>
                  </div>
                  <Button size="sm" variant="danger"
                    onClick={() => revokeKey.mutate(key.id, {
                      onError: (err) => setError(messageOf(err)),
                    })}>
                    撤销
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form className={styles.form} onSubmit={(event) => void createApiKey(event)}>
            <label>名称<input data-testid="api-key-name" value={keyName}
              onChange={(event) => setKeyName(event.target.value)} /></label>
            <label>Scopes（逗号分隔）<input data-testid="api-key-scopes" value={keyScopes}
              onChange={(event) => setKeyScopes(event.target.value)} /></label>
            <Button type="submit" loading={createKey.isPending}
              data-testid="api-key-create">创建 Key</Button>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>通知</h2></div>
          <div className={styles.muted}>
            站内通知已在顶栏启用；IM 推送留待 v1.1，本页不提供假开关。
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>系统（只读）</h2></div>
          {settingsQuery.isLoading ? <Loading label="载入配置…" /> : settingsQuery.isError ? (
            <ErrorState message="配置加载失败" onRetry={() => void settingsQuery.refetch()} />
          ) : settings ? (
            <dl className={styles.grid}>
              <dt>版本</dt><dd>{settings.version} · {settings.environment}</dd>
              <dt>模型</dt>
              <dd>{settings.modelName ?? "未配置"}{settings.modelConfigured ? " · provider 已配置" : " · 使用 FakeModel"}</dd>
              <dt>数据目录</dt><dd>{settings.dataDir}</dd>
              <dt>工作区</dt><dd>{settings.workspaceDir}</dd>
              <dt>外链基址</dt><dd>{settings.publicBaseUrl}</dd>
              <dt>审计保留</dt><dd>{settings.auditRetentionDays} 天</dd>
              <dt>每日成本上限</dt><dd>{settings.dailyCostBudgetMicros} micros</dd>
            </dl>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
