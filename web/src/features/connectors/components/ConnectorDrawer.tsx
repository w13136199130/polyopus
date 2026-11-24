import { useEffect, useState } from "react";
import { Button, Dialog, Drawer } from "@/components/ui";
import {
  useConnectorTools,
  useCreateConnector,
  useDeleteConnector,
  useDiscoverConnector,
  useProbeConnector,
  useUpdateConnector,
  useUpdateConnectorTool,
} from "@/features/connectors/api";
import { MCP_TEMPLATE } from "@/features/connectors/mcpConfig";
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
  /** Custom MCP create entry (HTTP / Stdio buttons); ignored when editing. */
  initialTransport?: "http" | "stdio";
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function authText(value: string): string {
  if (value === "oauth") return "OAuth";
  if (value === "token") return "Token";
  if (value === "imap") return "IMAP / 授权码";
  return value;
}

function statusText(value: string): string {
  if (value === "active") return "已连接";
  if (value === "expired") return "已过期";
  if (value === "disabled") return "已停用";
  if (value === "error") return "连接异常";
  return value;
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
  open, instance, initialKind, initialTransport, catalog, onClose, onNotice, onError,
}: Props) {
  const create = useCreateConnector();
  const update = useUpdateConnector();
  const remove = useDeleteConnector();
  const probe = useProbeConnector();
  const discover = useDiscoverConnector();
  const toggleTool = useUpdateConnectorTool();
  const toolsQuery = useConnectorTools(
    instance?.kind === "mcp" ? instance.instanceId : null,
  );

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
    const editing = instance !== null;
    const kind = instance?.kind ?? initialKind;
    setKind(kind);
    setDisplayName(instance?.displayName ?? "");
    setDefaultOpen(instance?.defaultOpen ?? false);
    setShared(instance?.shared ?? false);
    setCreds({});
    setMcpMode("visual");
    // Existing credentials never come back from the API; start blank so an
    // untouched save cannot overwrite the stored config.
    setServers(
      editing
        ? []
        : [{
          name: "my-mcp",
          type: initialTransport ?? "http",
          url: "",
          command: "",
        }],
    );
    setConfigText(editing ? "" : kind === "mcp" ? MCP_TEMPLATE : "");
    setError(null);
    setConfirmDelete(false);
  }, [open, instance, initialKind, initialTransport]);

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
    if (!configText.trim()) {
      setMcpMode("visual");
      return;
    }
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
      const named = servers.filter((server) => server.name.trim());
      if (named.length === 0) return undefined;
      for (const server of named) {
        if (server.type === "http" && !server.url.trim()) {
          throw new Error(`${server.name}: 缺少 URL`);
        }
        if (server.type === "stdio" && !server.command.trim()) {
          throw new Error(`${server.name}: 缺少 Command`);
        }
      }
      const built = serverConfig(named);
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

  function discoverTools() {
    if (!instance) return;
    setError(null);
    discover.mutate(instance.instanceId, {
      onSuccess: (result) => {
        if (result.errors.length) {
          onError(result.errors.map((item) => `${item.server}: ${item.error}`).join("；"));
        } else {
          onNotice(`发现 ${result.items.length} 个工具`);
        }
      },
      onError: (err) => setError(messageOf(err)),
    });
  }

  function setToolEnabled(toolKey: string, enabled: boolean) {
    if (!instance) return;
    setError(null);
    toggleTool.mutate(
      { instanceId: instance.instanceId, toolKey, enabled },
      { onError: (err) => setError(messageOf(err)) },
    );
  }

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => { if (!next) onClose(); }}
        title={instance ? instance.displayName : `添加${catalogRow?.name ?? "连接器"}`}
        description={
          instance
            ? `${catalogRow?.name ?? instance.kind} · ${authText(instance.authKind)} · ${instance.toolsCount} 个工具`
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
                <b>{authText(instance.authKind)}</b>
              </div>
              <div>
                <span>状态</span>
                <b>{statusText(instance.status)}</b>
              </div>
              <div>
                <span>工具</span>
                <b>{instance.toolsCount} 个</b>
              </div>
            </div>
          ) : null}

          {instance?.kind === "mcp" ? (
            <section className={styles.discovered} data-testid="connector-tools">
              <div className={styles.discoveredHead}>
                <div>
                  <b>可调用工具</b>
                  <span>
                    {toolsQuery.data
                      ? `${toolsQuery.data.items.length} 个 · ${
                        toolsQuery.data.items.filter((tool) => tool.enabled !== false).length
                      } 启用 · 调用前按策略审批`
                      : `${instance.toolsCount} 个 · 调用前按策略审批`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="connector-discover"
                  loading={discover.isPending}
                  onClick={discoverTools}
                >
                  发现工具
                </Button>
              </div>
              {toolsQuery.isLoading ? (
                <p className={styles.hint}>读取已发现工具…</p>
              ) : toolsQuery.data?.items.length ? (
                <div className={styles.toolList}>
                  {toolsQuery.data.items.map((tool) => (
                    <div key={tool.toolKey} className={styles.toolRow} data-testid="connector-tool">
                      <div className={styles.toolIdentity}>
                        <b>{tool.toolName}</b>
                        <span>{tool.server}</span>
                      </div>
                      <p>{tool.description || "无描述"}</p>
                      <label
                        className={styles.toolToggle}
                        title={tool.enabled === false ? "已停用：模型看不到该工具" : "启用：模型可调用该工具"}
                      >
                        <input
                          type="checkbox"
                          data-testid="connector-tool-toggle"
                          checked={tool.enabled !== false}
                          disabled={toggleTool.isPending}
                          onChange={(event) =>
                            setToolEnabled(tool.toolKey, event.target.checked)}
                        />
                        {tool.enabled === false ? "停用" : "启用"}
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.hint}>
                  还没有发现工具。保存连接后点击「发现工具」，会把 MCP 的 tools/list 注册到当前租户。
                </p>
              )}
            </section>
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
                  {instance ? (
                    <p className={styles.hint}>
                      已保存的配置不会回显；添加 Server 后保存会覆盖原配置，直接保存则保持不变。
                    </p>
                  ) : null}
                  {servers.length === 0 ? (
                    <p className={styles.hint}>还没有 Server，点下面的按钮添加一个。</p>
                  ) : null}
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
                    placeholder={
                      instance
                        ? "留空保持已保存的配置；填写后保存会覆盖"
                        : "粘贴 MCP 配置 JSON"
                    }
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
                <span>真实 provider 授权随 v1.1 接入；当前不会打开占位地址。</span>
              </div>
              <span className={styles.hint}>v1.1</span>
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
