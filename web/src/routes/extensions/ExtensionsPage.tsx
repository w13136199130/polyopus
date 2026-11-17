/** Extensions page: global tool registry + per-agent tool switches (V1-12). */

import { useEffect, useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import type { AgentToolBinding } from "@/lib/api/wire";
import { useAgents } from "@/features/agents/api";
import {
  useInstallExamples,
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function AgentToolEditor({ agentId }: { agentId: string }) {
  const query = useAgentTools(agentId);
  const save = useSetAgentTools(agentId);
  const canWrite = useCan("extension:write");
  const [draft, setDraft] = useState<AgentToolBinding[]>([]);

  useEffect(() => {
    if (query.data?.items) setDraft(query.data.items);
  }, [query.data]);

  if (query.isLoading) return <Loading label="载入 Agent 工具…" />;
  if (query.isError) {
    return <ErrorState message="Agent 工具加载失败" onRetry={() => void query.refetch()} />;
  }

  function toggle(toolKey: string, enabled: boolean) {
    setDraft((items) =>
      items.map((item) => (item.toolKey === toolKey ? { ...item, enabled } : item)),
    );
  }

  return (
    <div>
      <ul className={styles.rows}>
        {draft.map((item) => (
          <li key={item.toolKey} className={styles.row} data-testid="agent-tool-row">
            <strong className={styles.who}>{item.toolKey}</strong>
            <label className={styles.check}>
              <input
                type="checkbox"
                data-testid="agent-tool-enabled"
                checked={item.enabled}
                disabled={!canWrite}
                onChange={(event) => toggle(item.toolKey, event.target.checked)}
              />
              启用
            </label>
          </li>
        ))}
      </ul>
      <Button size="sm" disabled={!canWrite} loading={save.isPending}
        data-testid="agent-tools-save"
        onClick={() => save.mutate(draft.map((item) => ({
          toolKey: item.toolKey, enabled: item.enabled,
        })))}>
        保存 Agent 设置
      </Button>
    </div>
  );
}

export function ExtensionsPage() {
  const toolsQuery = useTools();
  const agentsQuery = useAgents();
  const pluginsQuery = usePlugins();
  const setGlobal = useSetToolGlobal();
  const installExamples = useInstallExamples();
  const togglePlugin = useTogglePlugin();
  const uninstallPlugin = useUninstallPlugin();
  const canWrite = useCan("extension:write");
  const agents = agentsQuery.data?.items ?? [];
  const [agentId, setAgentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tools = toolsQuery.data?.items ?? [];
  const plugins = pluginsQuery.data?.items ?? [];
  const selected = agentId ?? agents[0]?.agentId ?? null;

  async function toggleGlobal(toolKey: string, enabled: boolean) {
    setError(null);
    try {
      await setGlobal.mutateAsync({ toolKey, enabled });
      setNotice(`${toolKey} 全局${enabled ? "启用" : "停用"}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <PageShell title="扩展" subtitle="工具注册表是全局白名单；Agent 开关只能进一步缩小可用工具。">
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.head}><h2>工具注册表</h2><span>{tools.length} 个</span></div>
          {toolsQuery.isLoading ? <Loading label="载入工具…" /> : toolsQuery.isError ? (
            <ErrorState message="工具加载失败" onRetry={() => void toolsQuery.refetch()} />
          ) : tools.length === 0 ? <Empty title="暂无工具" /> : (
            <ul className={styles.rows}>
              {tools.map((tool) => (
                <li key={tool.toolKey} className={styles.row} data-testid="tool-row">
                  <div className={styles.who}>
                    <strong>{tool.toolKey}</strong>
                    <span>{tool.description}</span>
                    <span>
                      <span className={styles.risk}>{tool.risk}</span>{" "}
                      {tool.sideEffects ? "有副作用" : "只读"} · {tool.source}
                    </span>
                  </div>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      data-testid="tool-enabled"
                      checked={tool.enabledGlobal}
                      disabled={!canWrite}
                      onChange={(event) =>
                        void toggleGlobal(tool.toolKey, event.target.checked)}
                    />
                    全局启用
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>Agent 工具设置</h2></div>
          {agents.length === 0 ? <Empty title="先在专家页创建一个 Agent" /> : (
            <>
              <select className={styles.select} data-testid="agent-select"
                value={selected ?? ""}
                onChange={(event) => setAgentId(event.target.value)}>
                {agents.map((agent) => (
                  <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>
                ))}
              </select>
              {selected ? <AgentToolEditor agentId={selected} /> : null}
            </>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.head}>
            <h2>插件</h2><span>{plugins.length} 个（仅本地签名白名单）</span>
          </div>
          {pluginsQuery.isLoading ? <Loading label="载入插件…" /> : plugins.length === 0 ? (
            <Empty title="暂无插件，可安装 3 个示例" />
          ) : (
            <ul className={styles.rows}>
              {plugins.map((plugin) => (
                <li key={plugin.pluginId} className={styles.row}
                  data-testid="plugin-row">
                  <div className={styles.who}>
                    <strong>{plugin.name}</strong>
                    <span>
                      {plugin.pluginId} v{plugin.version} · {plugin.status} ·{" "}
                      {plugin.tools.join(", ") || "无工具"}
                    </span>
                  </div>
                  <div className={styles.actions}>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        data-testid="plugin-enabled"
                        checked={plugin.status === "enabled"}
                        disabled={!canWrite}
                        onChange={(event) => togglePlugin.mutate({
                          pluginId: plugin.pluginId,
                          enabled: event.target.checked,
                        })}
                      />
                      启用
                    </label>
                    <Button size="sm" variant="danger" disabled={!canWrite}
                      onClick={() => uninstallPlugin.mutate(plugin.pluginId)}>
                      卸载
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" disabled={!canWrite} loading={installExamples.isPending}
            data-testid="plugin-install-examples"
            onClick={() => installExamples.mutate(undefined, {
              onSuccess: (data) => setNotice(`已安装 ${data.items.length} 个示例插件`),
              onError: (err) => setError(messageOf(err)),
            })}>
            安装示例插件
          </Button>
        </section>
      </div>
    </PageShell>
  );
}
