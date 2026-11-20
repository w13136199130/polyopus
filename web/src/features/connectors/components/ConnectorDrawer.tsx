import { useEffect, useState } from "react";
import { Button, Dialog, Drawer } from "@/components/ui";
import {
  useCreateConnector,
  useDeleteConnector,
  useProbeConnector,
  useStartOAuth,
  useUpdateConnector,
} from "@/features/connectors/api";
import type { ConnectorCatalogRow, ConnectorInstanceRow } from "@/lib/api/wire";
import styles from "./ConnectorDrawer.module.css";

interface McpServer {
  name: string;
  type: "http" | "stdio";
  url: string;
  command: string;
}

interface Props {
  open: boolean;
  /** null = create mode; initialKind picks the catalog entry. */
  instance: ConnectorInstanceRow | null;
  initialKind: string;
  catalog: ConnectorCatalogRow[];
  onClose: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

const CREDENTIALS: Record<string, Array<[key: string, label: string, secret?: boolean]>> = {
  webhook: [["url", "回调 URL"], ["token", "签名 Token", true]],
  github: [["client_id", "Client ID"], ["client_secret", "Client Secret", true]],
  feishu: [["app_id", "App ID"], ["app_secret", "App Secret", true]],
  imap: [["host", "IMAP Host"], ["username", "用户名"], ["password", "授权码 / 密码", true]],
};

const MCP_TEMPLATE = `{
  "servers": {
    "my-mcp": {
      "type": "http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}`;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function asServers(config: unknown): McpServer[] {
  if (!config || typeof config !== "object") return [];
  const root = (config as { servers?: unknown }).servers ?? config;
  if (!root || typeof root !== "object") return [];
  return Object.entries(root as Record<string, unknown>).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const type = String(row.type ?? row.transport ?? "http") === "stdio" ? "stdio" : "http";
    return [{
      name,
      type,
      url: String(row.url ?? ""),
      command: String(row.command ?? ""),
    }];
  });
}

function serverConfig(servers: McpServer[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const server of servers) {
    const name = server.name.trim();
    if (!name) continue;
    out[name] = server.type === "http"
      ? { type: "http", url: server.url.trim() }
      : { type: "stdio", command: server.command.trim() };
  }
  return { servers: out };
}

/**
 * Connector instance drawer: identity, encrypted credentials (write-only),
 * default/shared switches, probe, OAuth and delete. Custom MCP instances get
 * a visual server editor plus the raw JSON view.
 */
export function ConnectorDrawer({
  open, instance, initialKind, catalog, onClose, onNotice, onError,
}: Props) {
  const create = useCreateConnector();
  const update = useUpdateConnector();
  const remove = useDeleteConnector();
  const probe = useProbeConnector();
  const oauth = useStartOAuth();

  const [kind, setKind] = useState(initialKind);
  const [displayName, setDisplayName] = useState("");
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [mcpMode, setMcpMode] = useState<"visual" | "json">("visual");
  const [servers, setServers] = useState<McpServer[]>([
    { name: "my-mcp", type: "http", url: "", command: "" },
  ]);
  const [configText, setConfigText] = useState(MCP_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(instance?.kind ?? initialKind);
    setDisplayName(instance?.displayName ?? "");
    setDefaultOpen(instance?.defaultOpen ?? false);
    setShared(instance?.shared ?? false);
    setCreds({});
    setMcpMode("visual");
    setServers([{ name: "my-mcp", type: "http", url: "", command: "" }]);
    setConfigText((instance?.kind ?? initialKind) === "mcp" ? MCP_TEMPLATE : "");
    setError(null);
    setConfirmDelete(false);
  }, [open, instance, initialKind]);

  const effectiveKind = instance?.kind ?? kind;
  const catalogRow = catalog.find((row) => row.kind === effectiveKind);
  const isMcp = effectiveKind === "mcp";

  function switchToJson() {
    if (servers.some((server) => server.name.trim())) {
      setConfigText(JSON.stringify(serverConfig(servers), null, 2));
    }
    setMcpMode("json");
  }

  function switchToVisual() {
    try {
      const parsed = JSON.parse(configText) as Record<string, unknown>;
      const next = asServers(parsed);
      if (next.length) setServers(next);
    } catch {
      setError("JSON 无法解析，保留当前可视化配置");
    }
    setMcpMode("visual");
  }

  function buildConfig(): Record<string, unknown> | undefined {
    if (isMcp) {
      if (mcpMode === "json") {
        if (!configText.trim()) return undefined;
        try {
          return JSON.parse(configText) as Record<string, unknown>;
        } catch {
          throw new Error("MCP JSON 配置无法解析");
        }
      }
      const built = serverConfig(servers);
      const map = built.servers as Record<string, unknown>;
      return Object.keys(map).length ? built : undefined;
    }
    const values = Object.fromEntries(
      Object.entries(creds).filter(([, value]) => value.trim() !== ""),
    );
    if (Object.keys(values).length) return values;
    if (configText.trim() && !CREDENTIALS[effectiveKind]) {
      try {
        return JSON.parse(configText) as Record<string, unknown>;
      } catch {
        throw new Error("配置 JSON 无法解析");
      }
    }
    return undefined;
  }

  function save() {
    setError(null);
    if (!displayName.trim()) {
      setError("显示名称不能为空");
      return;
    }
    let config: Record<string, unknown> | undefined;
    try {
      config = buildConfig();
    } catch (err) {
      setError(messageOf(err));
      return;
    }
    if (instance) {
      update.mutate(
        {
          instanceId: instance.instanceId,
          displayName: displayName.trim(),
          defaultOpen,
          shared,
          ...(config ? { config } : {}),
        },
        {
          onSuccess: () => {
            onNotice(`已保存连接 ${displayName.trim()}`);
            onClose();
          },
          onError: (err) => setError(messageOf(err)),
        },
      );
      return;
    }
    create.mutate(
      {
        kind: effectiveKind,
        displayName: displayName.trim(),
        config: config ?? {},
        defaultOpen,
        shared,
      },
      {
        onSuccess: (created) => {
          onNotice(`已创建连接 ${created.displayName}`);
          onClose();
        },
        onError: (err) => setError(messageOf(err)),
      },
    );
  }

  function test() {
    if (!instance) return;
    probe.mutate(instance.instanceId, {
      onSuccess: (result) =>
        result.ok
          ? onNotice(`${instance.displayName} 连接正常`)
          : onError(`${instance.displayName}: ${result.error ?? "配置不完整"}`),
      onError: (err) => setError(messageOf(err)),
    });
  }

  function reauthorize() {
    if (!instance) return;
    oauth.mutate(instance.kind, {
      onSuccess: (result) => {
        onNotice("已生成授权链接，请在新窗口完成授权。");
        window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
      },
      onError: (err) => setError(messageOf(err)),
    });
  }

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => { if (!next) onClose(); }}
        title={instance ? instance.displayName : `添加${catalogRow?.name ?? "连接器"}`}
        description={
          instance
            ? `${instance.kind} · ${instance.authKind} · ${instance.toolsCount} 个工具`
            : "凭证加密保存且只写不读；测试连接只做本地配置校验。"
        }
        width={600}
        footer={
          <>
            {instance ? (
              <>
                <Button variant="ghost" size="sm" onClick={test} loading={probe.isPending}>
                  测试连接
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.danger}
                  onClick={() => setConfirmDelete(true)}
                >
                  删除
                </Button>
              </>
            ) : null}
            <span className={styles.flex} />
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button
              data-testid="connector-save"
              loading={create.isPending || update.isPending}
              onClick={save}
            >
              {instance ? "保存" : "创建连接"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          {error ? <div role="alert" className={styles.error}>{error}</div> : null}

          {!instance ? (
            <label className={styles.field}>
              连接器类型
              <select
                data-testid="connector-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {catalog.map((row) => (
                  <option key={row.catalogId} value={row.kind}>{row.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label className={styles.field}>
            显示名称
            <input
              data-testid="connector-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>

          {instance ? (
            <div className={styles.stateGrid}>
              <div>
                <span>认证方式</span>
                <b>{instance.authKind}</b>
              </div>
              <div>
                <span>状态</span>
                <b>{instance.status}</b>
              </div>
              <div>
                <span>工具</span>
                <b>{instance.toolsCount} 个</b>
              </div>
            </div>
          ) : null}

          {isMcp ? (
            <>
              <div className={styles.modeTabs} role="tablist" aria-label="MCP 配置视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mcpMode === "visual"}
                  className={`${styles.modeTab} ${mcpMode === "visual" ? styles.modeOn : ""}`}
                  onClick={switchToVisual}
                >
                  可视化
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mcpMode === "json"}
                  className={`${styles.modeTab} ${mcpMode === "json" ? styles.modeOn : ""}`}
                  onClick={switchToJson}
                >
                  {"</>"} JSON
                </button>
                <span className={styles.flex} />
                <span className={styles.hint}>配置只写不读；编辑时留空保持原值</span>
              </div>

              {mcpMode === "visual" ? (
                <div className={styles.servers}>
                  {servers.map((server, index) => (
                    <div key={index} className={styles.serverRow} data-testid="mcp-server-row">
                      <input
                        aria-label={`Server ${index + 1} 名称`}
                        placeholder="server 名称"
                        value={server.name}
                        onChange={(event) => setServers((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, name: event.target.value } : item))}
                      />
                      <select
                        aria-label={`Server ${index + 1} 类型`}
                        value={server.type}
                        onChange={(event) => setServers((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, type: event.target.value as "http" | "stdio" }
                              : item))}
                      >
                        <option value="http">HTTP</option>
                        <option value="stdio">Stdio</option>
                      </select>
                      {server.type === "http" ? (
                        <input
                          aria-label={`Server ${index + 1} URL`}
                          placeholder="https://mcp.example.com/mcp"
                          value={server.url}
                          onChange={(event) => setServers((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, url: event.target.value } : item))}
                        />
                      ) : (
                        <input
                          aria-label={`Server ${index + 1} Command`}
                          placeholder="npx -y my-mcp-server"
                          value={server.command}
                          onChange={(event) => setServers((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, command: event.target.value } : item))}
                        />
                      )}
                      <button
                        type="button"
                        aria-label={`移除 Server ${index + 1}`}
                        onClick={() => setServers((current) =>
                          current.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="mcp-add-server"
                    onClick={() => setServers((current) => [
                      ...current,
                      { name: `server-${current.length + 1}`, type: "http", url: "", command: "" },
                    ])}
                  >
                    ＋ 添加 Server
                  </Button>
                </div>
              ) : (
                <label className={styles.field}>
                  MCP 配置 JSON
                  <textarea
                    data-testid="connector-config"
                    className={styles.mono}
                    rows={12}
                    value={configText}
                    onChange={(event) => setConfigText(event.target.value)}
                  />
                  <span className={styles.hint}>
                    支持 HTTP / Stdio；也接受顶层 name→server 的简写。
                  </span>
                </label>
              )}
            </>
          ) : (
            <>
              <div className={styles.credGrid}>
                {(CREDENTIALS[effectiveKind] ?? []).map(([key, label, secret]) => (
                  <label key={key} className={styles.field}>
                    {label}
                    <input
                      type={secret ? "password" : "text"}
                      value={creds[key] ?? ""}
                      placeholder={instance?.configured ? "已保存；留空保持不变" : ""}
                      onChange={(event) => setCreds((current) => ({
                        ...current, [key]: event.target.value,
                      }))}
                    />
                  </label>
                ))}
              </div>
              {!CREDENTIALS[effectiveKind] ? (
                <label className={styles.field}>
                  配置 JSON（只写）
                  <textarea
                    data-testid="connector-config"
                    className={styles.mono}
                    rows={8}
                    value={configText}
                    onChange={(event) => setConfigText(event.target.value)}
                  />
                </label>
              ) : (
                <p className={styles.hint}>
                  已有凭证已加密保存且不会回显；留空字段保持原值。
                </p>
              )}
            </>
          )}

          <div className={styles.switches}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={defaultOpen}
                onChange={(event) => setDefaultOpen(event.target.checked)}
              />
              对话默认选中
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={shared}
                onChange={(event) => setShared(event.target.checked)}
              />
              共享给其他成员（只读使用）
            </label>
          </div>

          {instance?.authKind === "oauth" ? (
            <div className={styles.oauth}>
              <div>
                <b>OAuth 授权</b>
                <span>过期后可重新授权，不影响历史会话。</span>
              </div>
              <Button size="sm" variant="secondary" onClick={reauthorize}>
                重新授权
              </Button>
            </div>
          ) : null}
        </div>
      </Drawer>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除连接"
        description="删除后对话中将无法再选择该连接器，历史会话不受影响。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>取消</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!instance) return;
                remove.mutate(instance.instanceId, {
                  onSuccess: () => {
                    onNotice(`已删除连接 ${instance.displayName}`);
                    setConfirmDelete(false);
                    onClose();
                  },
                  onError: (err) => setError(messageOf(err)),
                });
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <p>确定删除「{instance?.displayName}」？</p>
      </Dialog>
    </>
  );
}
