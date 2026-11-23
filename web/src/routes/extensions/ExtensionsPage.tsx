/**
 * Extensions page (P1-6): 插件 / 工具注册表 / Agent 工具 tabs.
 * Plugin install accepts a signed manifest bundle; the server verifies the
 * HMAC (unknown signer / bad signature → 403), so nothing unsigned loads.
 */

import { useEffect, useState } from "react";
import { Button, Dialog, Drawer, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import type { AgentToolBinding, PluginRow } from "@/lib/api/wire";
import { useAgents } from "@/features/agents/api";
import {
  useInstallExamples,
  useInstallPlugin,
  usePlugins,
  useTogglePlugin,
  useUninstallPlugin,
} from "@/features/plugins/api";
import {
  useAgentTools,
  useSetAgentTools,
  useSetToolGlobal,
  useTools,
} from "@/features/tools/api";
import styles from "./ExtensionsPage.module.css";

type Tab = "plugins" | "skills" | "tools" | "agent";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function AgentToolsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const agentsQuery = useAgents();
  const [agentId, setAgentId] = useState<string | null>(null);
  const agents = agentsQuery.data?.items ?? [];
  const selected = agentId ?? agents[0]?.agentId ?? null;
  const query = useAgentTools(selected);
  const save = useSetAgentTools(selected ?? "");
  const canWrite = useCan("extension:write");
  const [draft, setDraft] = useState<AgentToolBinding[]>([]);

  useEffect(() => {
    if (query.data?.items) setDraft(query.data.items);
  }, [query.data]);

  if (agents.length === 0) {
    return <Empty title="先在专家页创建一个 Agent" />;
  }

  return (
    <>
      <select
        className={styles.select}
        data-testid="agent-select"
        value={selected ?? ""}
        onChange={(event) => setAgentId(event.target.value)}
      >
        {agents.map((agent) => (
          <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>
        ))}
      </select>
      {query.isLoading ? <Loading label="载入 Agent 工具…" /> : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>工具</th><th style={{ width: 90 }}>启用</th></tr>
              </thead>
              <tbody>
                {draft.map((item) => (
                  <tr key={item.toolKey} data-testid="agent-tool-row">
                    <td className={styles.mono}>{item.toolKey}</td>
                    <td>
                      <input
                        type="checkbox"
                        data-testid="agent-tool-enabled"
                        checked={item.enabled}
                        disabled={!canWrite}
                        onChange={(event) =>
                          setDraft((rows) =>
                            rows.map((row) =>
                              row.toolKey === item.toolKey
                                ? { ...row, enabled: event.target.checked }
                                : row,
                            ),
                          )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            size="sm"
            data-testid="agent-tools-save"
            disabled={!canWrite || !selected}
            loading={save.isPending}
            onClick={() => save.mutate(
              draft.map((item) => ({ toolKey: item.toolKey, enabled: item.enabled })),
              { onSuccess: () => onNotice("已保存 Agent 工具设置") },
            )}
          >
            保存 Agent 设置
          </Button>
        </>
      )}
    </>
  );
}

export function ExtensionsPage() {
  const canWrite = useCan("extension:write");
  const pluginsQuery = usePlugins();
  const toolsQuery = useTools();
  const setToolGlobal = useSetToolGlobal();
  const installExamples = useInstallExamples();
  const installPlugin = useInstallPlugin();
  const togglePlugin = useTogglePlugin();
  const uninstallPlugin = useUninstallPlugin();

  const [tab, setTab] = useState<Tab>("plugins");
  const [pluginView, setPluginView] = useState<"installed" | "market">("installed");
  const [detailPlugin, setDetailPlugin] = useState<PluginRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [manifestText, setManifestText] = useState(
    JSON.stringify(
      {
        id: "example.custom", name: "自定义插件", version: "1.0.0",
        apiVersion: "1.0", permissions: [],
        tools: [{
          key: "plugin.custom", description: "自定义工具",
          risk: "low", inputSchema: { type: "object" },
        }],
      },
      null, 2,
    ),
  );
  const [signature, setSignature] = useState("");
  const [signer, setSigner] = useState("local");

  const plugins = pluginsQuery.data?.items ?? [];
  const tools = toolsQuery.data?.items ?? [];

  async function submitInstall(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestText) as Record<string, unknown>;
    } catch {
      setError("manifest 不是合法 JSON");
      return;
    }
    const pluginId = String(manifest.id ?? "");
    if (!pluginId) {
      setError("manifest 缺少 id");
      return;
    }
    try {
      const installed = await installPlugin.mutateAsync({
        pluginId, manifest, signature: signature.trim(), signer: signer.trim() || "local",
      });
      setNotice(`已安装 ${installed.name} v${installed.version}`);
      setInstallOpen(false);
      setSignature("");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <PageShell
      title="扩展"
      subtitle="插件只接受本地签名白名单；工具设置只缩小权限，永不扩大策略。"
    >
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.tabs} role="tablist" aria-label="扩展视图">
          {([["plugins", "插件"], ["skills", "技能包"], ["tools", "工具"], ["agent", "Agent 工具"]] as const)
            .map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                data-testid={`ext-tab-${key}`}
                className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
        </div>

        {tab === "plugins" ? (
          <section className={styles.panel}>
            <div className={styles.head}>
              <h2>插件</h2>
              <span>{plugins.length} 个</span>
              <span className={styles.spacer} />
              <Button
                size="sm"
                data-testid="plugin-install-examples"
                disabled={!canWrite}
                loading={installExamples.isPending}
                onClick={() => installExamples.mutate(undefined, {
                  onSuccess: (data) => setNotice(`已安装 ${data.items.length} 个示例插件`),
                  onError: (err) => setError(messageOf(err)),
                })}
              >
                安装示例插件
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="plugin-install-signed"
                disabled={!canWrite}
                onClick={() => setInstallOpen(true)}
              >
                安装签名插件
              </Button>
            </div>
            <div className={styles.subTabs} role="tablist" aria-label="插件视图">
              <button
                type="button"
                role="tab"
                aria-selected={pluginView === "installed"}
                className={`${styles.subTab} ${pluginView === "installed" ? styles.subTabOn : ""}`}
                data-testid="plugin-view-installed"
                onClick={() => setPluginView("installed")}
              >
                已安装
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pluginView === "market"}
                className={`${styles.subTab} ${pluginView === "market" ? styles.subTabOn : ""}`}
                data-testid="plugin-view-market"
                onClick={() => setPluginView("market")}
              >
                插件市场 <span className={styles.tag}>v1.1</span>
              </button>
            </div>
            {pluginView === "market" ? (
              <Empty
                title="插件市场随 v1.1 接入"
                hint="市场目录与在线更新暂无后端；现在可用示例插件或签名 manifest 安装。"
                action={{
                  label: "安装示例插件",
                  onClick: () => installExamples.mutate(undefined, {
                    onSuccess: (data) => setNotice(`已安装 ${data.items.length} 个示例插件`),
                    onError: (err) => setError(messageOf(err)),
                  }),
                }}
              />
            ) : pluginsQuery.isLoading ? <Loading label="载入插件…" /> : pluginsQuery.isError ? (
              <ErrorState message="插件加载失败" onRetry={() => void pluginsQuery.refetch()} />
            ) : plugins.length === 0 ? (
              <Empty title="暂无插件" hint="可安装 3 个内置示例，或粘贴签名 manifest。" />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>插件</th><th>版本</th><th>权限</th><th>状态</th>
                      <th style={{ width: 210 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plugins.map((plugin) => (
                      <tr key={plugin.pluginId} data-testid="plugin-row">
                        <td>
                          <b style={{ fontSize: 13 }}>{plugin.name}</b>
                          <div className={styles.muted}>{plugin.pluginId}</div>
                        </td>
                        <td className={styles.mono}>v{plugin.version}</td>
                        <td className={styles.muted}>
                          {plugin.permissions.join(", ") || "—"}
                        </td>
                        <td>
                          <span className={`${styles.badge} ${
                            plugin.status === "enabled"
                              ? styles.badgeEnabled
                              : styles.badgeDisabled
                          }`}>
                            {plugin.status === "enabled" ? "已启用" : plugin.status}
                          </span>
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid="plugin-detail"
                              onClick={() => setDetailPlugin(plugin)}
                            >
                              详情
                            </Button>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                              <input
                                type="checkbox"
                                data-testid="plugin-enabled"
                                checked={plugin.status === "enabled"}
                                disabled={!canWrite}
                                onChange={(event) => togglePlugin.mutate({
                                  pluginId: plugin.pluginId,
                                  enabled: event.target.checked,
                                }, { onError: (err) => setError(messageOf(err)) })}
                              />
                              启用
                            </label>
                            <Button size="sm" variant="danger"
                              disabled={!canWrite}
                              onClick={() => uninstallPlugin.mutate(plugin.pluginId, {
                                onSuccess: () => setNotice(`已卸载 ${plugin.name}`),
                                onError: (err) => setError(messageOf(err)),
                              })}>
                              卸载
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {tab === "skills" ? (
          <section className={styles.panel}>
            <div className={styles.head}>
              <h2>技能包</h2>
              <span>导入 / 启用 / 版本管理随 v1.1 接入</span>
            </div>
            <Empty
              title="技能包运行时尚未开放"
              hint="当前可用的能力装配在「插件」和「工具」；技能包不会伪造入口。"
            />
          </section>
        ) : null}

        {tab === "tools" ? (
          <section className={styles.panel}>
            <div className={styles.head}>
              <h2>工具注册表</h2>
              <span>{tools.length} 个</span>
            </div>
            {toolsQuery.isLoading ? <Loading label="载入工具…" /> : toolsQuery.isError ? (
              <ErrorState message="工具加载失败" onRetry={() => void toolsQuery.refetch()} />
            ) : tools.length === 0 ? <Empty title="暂无工具" /> : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>工具</th><th>说明</th><th>风险</th><th>来源</th>
                      <th style={{ width: 90 }}>全局启用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((tool) => (
                      <tr key={tool.toolKey} data-testid="tool-row">
                        <td className={styles.mono}>{tool.toolKey}</td>
                        <td className={styles.muted}>{tool.description}</td>
                        <td>
                          <span className={styles.badge}
                            style={{
                              background: tool.risk === "high" || tool.risk === "critical"
                                ? "var(--red-soft)" : "var(--surface-3)",
                              color: tool.risk === "high" || tool.risk === "critical"
                                ? "var(--red)" : "var(--text-3)",
                            }}>
                            {tool.risk}
                          </span>
                        </td>
                        <td className={styles.muted}>{tool.source}</td>
                        <td>
                          <input
                            type="checkbox"
                            data-testid="tool-enabled"
                            checked={tool.enabledGlobal}
                            disabled={!canWrite}
                            onChange={(event) => setToolGlobal.mutate({
                              toolKey: tool.toolKey,
                              enabled: event.target.checked,
                            }, {
                              onSuccess: () => setNotice(
                                `${tool.toolKey} 全局${event.target.checked ? "启用" : "停用"}`,
                              ),
                              onError: (err) => setError(messageOf(err)),
                            })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {tab === "agent" ? (
          <section className={styles.panel}>
            <div className={styles.head}>
              <h2>Agent 工具设置</h2>
              <span>只缩小可用集合，不扩大策略</span>
            </div>
            <AgentToolsPanel onNotice={setNotice} />
          </section>
        ) : null}
      </div>

      <Dialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        title="安装签名插件"
        description="manifest 必须由可信 signer 签名；服务器校验 HMAC 后才会注册。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInstallOpen(false)}>取消</Button>
            <Button
              type="submit"
              form="plugin-install-form"
              data-testid="plugin-install-submit"
              loading={installPlugin.isPending}
              disabled={!signature.trim()}
            >
              安装
            </Button>
          </>
        }
      >
        <form id="plugin-install-form" className={styles.form}
          onSubmit={(event) => void submitInstall(event)}>
          <label>manifest JSON
            <textarea
              data-testid="plugin-install-manifest"
              value={manifestText}
              onChange={(event) => setManifestText(event.target.value)}
            />
          </label>
          <label>签名（signer 对 manifest 的 HMAC-SHA256）
            <input
              data-testid="plugin-install-signature"
              value={signature}
              placeholder="由打包方提供"
              onChange={(event) => setSignature(event.target.value)}
            />
          </label>
          <label>signer
            <input
              data-testid="plugin-install-signer"
              value={signer}
              onChange={(event) => setSigner(event.target.value)}
            />
          </label>
          <p className={styles.hint}>
            坏签名或未知 signer 会被拒绝（403 PLUGIN_SIGNATURE_INVALID）。
          </p>
        </form>
      </Dialog>

      <Drawer
        open={detailPlugin !== null}
        onOpenChange={(open) => { if (!open) setDetailPlugin(null); }}
        title={detailPlugin ? `插件详情 · ${detailPlugin.name}` : "插件详情"}
        description="只读信息；权限与工具来自签名 manifest。"
        width={520}
      >
        {detailPlugin ? (
          <dl className={styles.detailList}>
            <dt>ID</dt><dd className={styles.mono}>{detailPlugin.pluginId}</dd>
            <dt>版本</dt><dd>v{detailPlugin.version} · API {detailPlugin.apiVersion}</dd>
            <dt>签名</dt><dd>{detailPlugin.signed ? "已签名" : "未签名"}</dd>
            <dt>状态</dt><dd>{detailPlugin.status}</dd>
            <dt>权限</dt>
            <dd>{detailPlugin.permissions.length ? detailPlugin.permissions.join(", ") : "—"}</dd>
            <dt>工具</dt>
            <dd>{detailPlugin.tools.length ? detailPlugin.tools.join(", ") : "—"}</dd>
            <dt>安装时间</dt>
            <dd>{new Date(detailPlugin.installedAt * 1000).toLocaleString("zh-CN")}</dd>
          </dl>
        ) : null}
      </Drawer>
    </PageShell>
  );
}
