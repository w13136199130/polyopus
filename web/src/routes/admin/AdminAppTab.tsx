/** Admin → 应用设置: env vars, backup/restore, HTTPS, updates, passkeys. */

import { useSearchParams } from "react-router";
import { Button, Tabs } from "@/components/ui";
import { AdminBackupTab } from "./AdminBackupTab";
import styles from "./AdminConfig.module.css";

type SubTab = "env" | "backup" | "https" | "updates" | "passkeys";

const SUB_TABS: ReadonlyArray<readonly [SubTab, string]> = [
  ["env", "环境变量"],
  ["backup", "备份与恢复"],
  ["https", "HTTPS"],
  ["updates", "应用更新"],
  ["passkeys", "通行密钥"],
];

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyGlyph}>v1.1</span>
      <b>{title}</b>
      <p>{body}</p>
    </div>
  );
}

export function AdminAppTab({
  onNotice, onError,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const subParam = params.get("sub");
  const sub: SubTab = SUB_TABS.some(([key]) => key === subParam)
    ? (subParam as SubTab)
    : "env";
  const setSub = (next: SubTab) => {
    const query = new URLSearchParams(params);
    if (next === "env") query.delete("sub");
    else query.set("sub", next);
    setParams(query, { replace: true });
  };

  return (
    <div className={styles.page}>
      <Tabs
        ariaLabel="应用设置"
        variant="segmented"
        value={sub}
        onChange={setSub}
        items={SUB_TABS.map(([key, label]) => ({
          key,
          label,
          testId: `admin-subtab-${key}`,
        }))}
      />

      {sub === "env" ? (
        <section className={styles.panel}>
          <div className={styles.head}>
            <h2>环境变量</h2>
            <span>实例级运行参数</span>
            <span className={styles.spacer} />
            <Button size="sm" variant="outline" disabled title="在线编辑随 v1.1">
              添加变量 · v1.1
            </Button>
          </div>
          <div className={`${styles.alert} ${styles.alertInfo}`}>
            当前通过 .env 或进程环境变量配置；在线编辑、敏感值脱敏展示与热更新随 v1.1 接入。
          </div>
          <Placeholder
            title="还没有可在线编辑的变量"
            body="已生效的变量包括数据库路径、工作区目录、模型 provider 等，请在部署环境修改后重启服务。"
          />
        </section>
      ) : null}

      {sub === "backup" ? <AdminBackupTab onNotice={onNotice} onError={onError} /> : null}

      {sub === "https" ? (
        <section className={styles.panel}>
          <div className={styles.head}><h2>HTTPS</h2><span>证书与强制跳转</span></div>
          <Placeholder
            title="HTTPS 设置随 v1.1 提供"
            body="当前请由反向代理（Nginx / Caddy）终结 TLS；内置证书申请与强制跳转尚未接入。"
          />
        </section>
      ) : null}

      {sub === "updates" ? (
        <section className={styles.panel}>
          <div className={styles.head}><h2>应用更新</h2><span>版本与升级</span></div>
          <Placeholder
            title="应用更新随 v1.1 提供"
            body="当前通过重新安装发行版升级；升级前请先创建备份，并确认 schema 迁移版本。"
          />
        </section>
      ) : null}

      {sub === "passkeys" ? (
        <section className={styles.panel}>
          <div className={styles.head}><h2>通行密钥</h2><span>WebAuthn / Passkey</span></div>
          <Placeholder
            title="实例级通行密钥随 v1.1 提供"
            body="个人账号的 step-up 密钥已在「设置 → 账号安全」提供；实例级 WebAuthn 策略尚未接入。"
          />
        </section>
      ) : null}
    </div>
  );
}
