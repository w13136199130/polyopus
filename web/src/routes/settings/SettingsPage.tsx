/**
 * Personal settings (prototype `#/settings`): appearance (theme/palette/
 * density), local notification preferences, fixed shortcuts, and account
 * security (MFA, step-up, API keys). Server-owned instance settings stay
 * read-only at the bottom of the account tab.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useSession } from "@/lib/auth/session";
import {
  PALETTES,
  applyDensity,
  applyPalette,
  applyThemeChoice,
  readAccent,
  readDensity,
  readPalette,
  readThemeChoice,
  type Density,
  type ThemeChoice,
} from "@/lib/theme";
import {
  useAdminSettings,
  useApiKeys,
  useCreateApiKey,
  useMfaDisable,
  useMfaEnroll,
  useMfaVerify,
  useReauth,
  useRevokeApiKey,
  useUpdateProfile,
} from "@/features/settings/api";
import styles from "./SettingsPage.module.css";

type Tab = "appearance" | "notifications" | "shortcuts" | "account";

const TABS: Array<[Tab, string]> = [
  ["appearance", "外观"],
  ["notifications", "通知"],
  ["shortcuts", "快捷键"],
  ["account", "账号"],
];

const NOTIFY_ITEMS: Array<[string, string, string]> = [
  ["approval", "审批与提问", "有人需要你决定时提醒"],
  ["task", "任务完成", "工单结束时通知"],
  ["budget", "预算告警", "接近预算上限时提醒"],
  ["weekly", "周报", "每周一汇总用量"],
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function notifyKey(key: string): string {
  return `poly:notify:${key}`;
}

function readNotify(key: string): boolean {
  try {
    return localStorage.getItem(notifyKey(key)) !== "0";
  } catch {
    return true;
  }
}

function writeNotify(key: string, on: boolean): void {
  try {
    localStorage.setItem(notifyKey(key), on ? "1" : "0");
  } catch {
    /* private mode: preference is session-only */
  }
}

export function SettingsPage() {
  const { user, logout, refresh } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = (["appearance", "notifications", "shortcuts", "account"] as const)
    .includes(tabParam as never)
    ? (tabParam as Tab)
    : "appearance";

  const settingsQuery = useAdminSettings();
  const keysQuery = useApiKeys();
  const reauth = useReauth();
  const enroll = useMfaEnroll();
  const verify = useMfaVerify();
  const disableMfa = useMfaDisable();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const updateProfile = useUpdateProfile();

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readThemeChoice);
  const [palette, setPalette] = useState(readPalette);
  const [accent, setAccent] = useState(readAccent);
  const [density, setDensity] = useState<Density>(readDensity);
  const [displayName, setDisplayName] = useState(user?.displayName ?? user?.username ?? "");
  const [notify, setNotify] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTIFY_ITEMS.map(([key]) => [key, readNotify(key)])));

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

  useEffect(() => {
    if (user) setDisplayName(user.displayName ?? user.username);
    setMfaEnabled(Boolean(user?.mfaEnabled));
  }, [user]);

  const settings = settingsQuery.data;
  const keys = keysQuery.data?.items ?? [];
  const role = user?.roles?.includes("admin")
    ? "管理员"
    : user?.roles?.includes("auditor")
      ? "只读审计"
      : "成员";
  const initial = (user?.displayName || user?.username || "?").slice(0, 1).toUpperCase();

  function selectTab(next: Tab) {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    setParams(search, { replace: true });
  }

  function chooseTheme(choice: ThemeChoice) {
    setThemeChoice(choice);
    applyThemeChoice(choice);
  }

  function choosePalette(id: string) {
    setPalette(id);
    applyPalette(id, accent);
  }

  function chooseDensity(value: Density) {
    setDensity(value);
    applyDensity(value);
  }

  function saveProfile() {
    setError(null);
    if (!displayName.trim()) {
      setError("显示名称不能为空");
      return;
    }
    updateProfile.mutate(displayName.trim(), {
      onSuccess: async () => {
        await refresh();
        setNotice("显示名称已保存");
      },
      onError: (err) => setError(messageOf(err)),
    });
  }

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
    <PageShell
      title="个人设置"
      subtitle="账户、外观、语言与安全。"
      actions={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void logout().then(() => navigate("/login"));
          }}
        >
          退出登录
        </Button>
      }
    >
      <div className={styles.page}>
        {notice ? (
          <button type="button" className={styles.notice} onClick={() => setNotice(null)}>
            {notice}
          </button>
        ) : null}
        {error ? (
          <button type="button" className={styles.error} onClick={() => setError(null)}>
            {error}
          </button>
        ) : null}

        <section className={styles.profile}>
          <span className={styles.profileAvatar}>{initial}</span>
          <div className={styles.profileText}>
            <b>
              {user?.displayName || user?.username}
              <span className={styles.roleTag}>{role}</span>
            </b>
            <span>@{user?.username}</span>
          </div>
          <span className={styles.spacer} />
          <div className={styles.nameEditor}>
            <input
              data-testid="display-name"
              value={displayName}
              maxLength={64}
              aria-label="显示名称"
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <Button
              size="sm"
              data-testid="profile-save"
              loading={updateProfile.isPending}
              onClick={saveProfile}
            >
              保存
            </Button>
          </div>
        </section>

        <div className={styles.tabs} role="tablist" aria-label="设置分区">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${styles.tab} ${tab === id ? styles.tabOn : ""}`}
              data-testid={`settings-tab-${id}`}
              onClick={() => selectTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "appearance" ? (
          <div className={styles.sections}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>主题</b>
                <span>浅色 / 深色 / 跟随系统，切换立即生效</span>
              </div>
              <div className={styles.chips}>
                {([
                  ["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`${styles.chip} ${themeChoice === value ? styles.chipOn : ""}`}
                    data-testid={`theme-${value}`}
                    onClick={() => chooseTheme(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>配色</b>
                <span>与浅色 / 深色独立；自定义色只影响强调色</span>
              </div>
              <div className={styles.swatches}>
                {PALETTES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.swatch} ${palette === item.id ? styles.swatchOn : ""}`}
                    title={item.label}
                    aria-label={item.label}
                    data-testid={`palette-${item.id}`}
                    onClick={() => choosePalette(item.id)}
                  >
                    <span style={{ background: item.color }} />
                  </button>
                ))}
                <button
                  type="button"
                  className={`${styles.swatch} ${palette === "custom" ? styles.swatchOn : ""}`}
                  title="自定义"
                  aria-label="自定义颜色"
                  onClick={() => choosePalette("custom")}
                >
                  <span style={{ background: accent }} />
                </button>
                <input
                  type="color"
                  aria-label="自定义强调色"
                  className={styles.colorInput}
                  value={accent}
                  onChange={(event) => {
                    setAccent(event.target.value);
                    setPalette("custom");
                    applyPalette("custom", event.target.value);
                  }}
                />
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>界面</b>
                <span>密度会影响全局字号与间距</span>
              </div>
              <div className={styles.rowSetting}>
                <span>密度</span>
                <div className={styles.chips}>
                  {([
                    ["default", "默认"], ["compact", "紧凑"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`${styles.chip} ${density === value ? styles.chipOn : ""}`}
                      onClick={() => chooseDensity(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.rowSetting}>
                <span>页面布局</span>
                <div className={styles.chips}>
                  <button type="button" className={`${styles.chip} ${styles.chipOn}`}>
                    经典模式
                  </button>
                  <button
                    type="button"
                    className={styles.chip}
                    disabled
                    title="极简模式随 v1.1 开放"
                  >
                    极简模式 · v1.1
                  </button>
                </div>
              </div>
              <div className={styles.rowSetting}>
                <span>语言</span>
                <div className={styles.chips}>
                  <button type="button" className={`${styles.chip} ${styles.chipOn}`}>
                    中文
                  </button>
                  <button
                    type="button"
                    className={styles.chip}
                    disabled
                    title="English UI 随 v1.1 开放"
                  >
                    English · v1.1
                  </button>
                </div>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>预览</b>
                <span>当前主题与配色下的按钮、标签与进度</span>
              </div>
              <div className={styles.preview}>
                <Button size="sm">主按钮</Button>
                <Button size="sm" variant="secondary">次按钮</Button>
                <Button size="sm" variant="danger">危险</Button>
                <span className={styles.previewTagBlue}>标签</span>
                <span className={styles.previewTagGreen}>完成</span>
                <span className={styles.previewBar}><i /></span>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>单点登录</b>
                <span>将多个登录方式绑定到当前账号；v1.1 开放</span>
              </div>
              {[
                ["飞书", "未绑定"],
                ["企业微信", "未绑定"],
                ["钉钉", "未绑定"],
              ].map(([name, state]) => (
                <div key={name} className={styles.rowSetting}>
                  <span>{name}</span>
                  <span className={styles.muted}>
                    {state} · <span title="SSO 绑定随 v1.1 开放">v1.1</span>
                  </span>
                </div>
              ))}
            </section>
          </div>
        ) : null}

        {tab === "notifications" ? (
          <div className={styles.sections}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>通知偏好</b>
                <span>本机偏好；服务端站内通知仍会按规则生成</span>
              </div>
              {NOTIFY_ITEMS.map(([key, label, hint]) => (
                <label key={key} className={styles.switchRow}>
                  <span>
                    <b>{label}</b>
                    <small>{hint}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={notify[key] ?? true}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setNotify((current) => ({ ...current, [key]: on }));
                      writeNotify(key, on);
                    }}
                  />
                </label>
              ))}
              <p className={styles.muted}>
                审批/提问与任务完成通知由服务端生成；IM 推送渠道留待 v1.1。
              </p>
            </section>
          </div>
        ) : null}

        {tab === "shortcuts" ? (
          <div className={styles.sections}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>快捷键</b>
                <span>当前版本固定；自定义快捷键随 v1.1 开放</span>
              </div>
              {[
                ["Enter", "发送消息"],
                ["Shift + Enter", "输入换行"],
                ["Esc", "关闭弹层 / 菜单"],
                ["Ctrl / ⌘ + F5", "强制刷新页面"],
              ].map(([combo, label]) => (
                <div key={combo} className={styles.rowSetting}>
                  <span>{label}</span>
                  <kbd className={styles.kbd}>{combo}</kbd>
                </div>
              ))}
            </section>
          </div>
        ) : null}

        {tab === "account" ? (
          <div className={styles.sections}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>账号</b>
                <span>个人资料与安全</span>
              </div>
              <dl className={styles.infoGrid}>
                <dt>用户名</dt><dd>@{user?.username}</dd>
                <dt>显示名称</dt><dd>{user?.displayName || user?.username}</dd>
                <dt>角色</dt><dd>{role}</dd>
                <dt>用户 ID</dt><dd className={styles.mono}>{user?.userId}</dd>
                <dt>租户</dt><dd className={styles.mono}>{user?.tenantId}</dd>
              </dl>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>账户安全</b>
                <span>MFA：{mfaEnabled ? "已启用" : "未启用"}</span>
              </div>
              {mfaEnabled ? (
                <Button
                  size="sm"
                  variant="danger"
                  data-testid="mfa-disable"
                  loading={disableMfa.isPending}
                  onClick={() => void turnOffMfa()}
                >
                  关闭 MFA
                </Button>
              ) : secret ? (
                <form className={styles.form} onSubmit={(event) => void confirmMfa(event)}>
                  <div className={styles.secret} data-testid="mfa-secret">
                    <strong>密钥</strong><code>{secret}</code>
                    <span>{otpauth}</span>
                  </div>
                  <label>
                    6 位验证码
                    <input
                      data-testid="mfa-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                    />
                  </label>
                  <Button type="submit" loading={verify.isPending} data-testid="mfa-verify">
                    确认启用
                  </Button>
                </form>
              ) : (
                <Button
                  size="sm"
                  data-testid="mfa-enroll"
                  loading={enroll.isPending}
                  onClick={() => void startEnroll()}
                >
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
              <div className={styles.panelHead}>
                <b>重新认证</b>
                <span>step-up 5 分钟，敏感操作前需要</span>
              </div>
              <form className={styles.form} onSubmit={(event) => void doReauth(event)}>
                <label>
                  当前密码
                  <input
                    type="password"
                    data-testid="reauth-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <Button type="submit" loading={reauth.isPending} data-testid="reauth-submit">
                  重新认证
                </Button>
                <span className={styles.muted}>{stepUp ? "已认证" : "未认证"}</span>
              </form>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>API Key</b>
                <span>{keys.length} 个 · 创建/撤销需要 step-up</span>
              </div>
              {newSecret ? (
                <div className={styles.secret} data-testid="api-key-secret">
                  <strong>Secret 只显示一次</strong><code>{newSecret}</code>
                </div>
              ) : null}
              {keysQuery.isLoading ? (
                <Loading label="载入 Key…" />
              ) : keysQuery.isError ? (
                <ErrorState message="Key 加载失败" onRetry={() => void keysQuery.refetch()} />
              ) : keys.length === 0 ? (
                <Empty title="暂无 API Key" />
              ) : (
                <ul className={styles.rows}>
                  {keys.map((key) => (
                    <li key={key.id} className={styles.row}>
                      <div className={styles.who}>
                        <strong>{key.name}</strong>
                        <span>{key.prefix} · {key.scopes.join(", ")}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => revokeKey.mutate(key.id, {
                          onError: (err) => setError(messageOf(err)),
                        })}
                      >
                        撤销
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <form className={styles.form} onSubmit={(event) => void createApiKey(event)}>
                <label>
                  名称
                  <input
                    data-testid="api-key-name"
                    value={keyName}
                    onChange={(event) => setKeyName(event.target.value)}
                  />
                </label>
                <label>
                  Scopes（逗号分隔）
                  <input
                    data-testid="api-key-scopes"
                    value={keyScopes}
                    onChange={(event) => setKeyScopes(event.target.value)}
                  />
                </label>
                <Button type="submit" loading={createKey.isPending} data-testid="api-key-create">
                  创建 Key
                </Button>
              </form>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <b>系统（只读）</b>
                <span>实例级配置，仅管理员可改</span>
              </div>
              {settingsQuery.isLoading ? (
                <Loading label="载入配置…" />
              ) : settingsQuery.isError ? (
                <ErrorState message="配置加载失败" onRetry={() => void settingsQuery.refetch()} />
              ) : settings ? (
                <dl className={styles.infoGrid}>
                  <dt>版本</dt><dd>{settings.version} · {settings.environment}</dd>
                  <dt>模型</dt>
                  <dd>
                    {settings.modelName ?? "未配置"}
                    {settings.modelConfigured ? " · provider 已配置" : " · 使用 FakeModel"}
                  </dd>
                  <dt>数据目录</dt><dd className={styles.mono}>{settings.dataDir}</dd>
                  <dt>工作区</dt><dd className={styles.mono}>{settings.workspaceDir}</dd>
                  <dt>审计保留</dt><dd>{settings.auditRetentionDays} 天</dd>
                </dl>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
