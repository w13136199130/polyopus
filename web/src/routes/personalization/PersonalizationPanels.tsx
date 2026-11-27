import { Link } from "react-router";
import { Empty, ErrorState, Loading, StatusTag, Switch } from "@/components/ui";
import { useChannels } from "@/features/channels/api";
import { useAgents } from "@/features/agents/api";
import { usePlugins, useTogglePlugin } from "@/features/plugins/api";
import { useSetToolGlobal, useTools } from "@/features/tools/api";
import styles from "./PersonalizationPage.module.css";

function PanelState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading) return <Loading label="载入…" />;
  if (error) return <ErrorState message="加载失败" onRetry={onRetry} />;
  return null;
}

export function ToolsPanel() {
  const query = useTools();
  const setTool = useSetToolGlobal();
  const items = query.data?.items ?? [];
  const state = <PanelState loading={query.isLoading} error={query.isError} onRetry={() => void query.refetch()} />;
  if (query.isLoading || query.isError) return state;

  return (
    <div className={styles.panel}>
      <div className={styles.panelNote}>
        工具按服务端注册表分组；这里只调整全局启用，专家级绑定在专家编辑抽屉里。
      </div>
      {items.length === 0 ? <Empty title="还没有注册工具" /> : (
        <div className={styles.cards}>
          {items.map((tool) => (
            <article key={tool.toolKey} className={styles.miniCard} data-testid="tool-row">
              <div className={styles.miniHead}>
                <b>{tool.toolKey}</b>
                <StatusTag tone={tool.risk === "high" || tool.risk === "critical" ? "red" : "neutral"}>
                  {tool.risk}
                </StatusTag>
                <span className={styles.spacer} />
                <Switch
                  checked={tool.enabledGlobal}
                  label={`启用 ${tool.toolKey}`}
                  onChange={(next) => setTool.mutate({ toolKey: tool.toolKey, enabled: next })}
                />
              </div>
              <span className={styles.miniMeta}>{tool.source} · {tool.scopes.join(", ") || "无 scope"}</span>
              <p className={styles.miniDesc}>{tool.description || "无描述"}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function PluginsPanel() {
  const query = usePlugins();
  const toggle = useTogglePlugin();
  const items = query.data?.items ?? [];
  if (query.isLoading || query.isError) {
    return <PanelState loading={query.isLoading} error={query.isError} onRetry={() => void query.refetch()} />;
  }
  return (
    <div className={styles.panel}>
      <div className={styles.panelNote}>
        插件是服务端 tool 集合；按专家启用仍在插件管理里维护。
      </div>
      {items.length === 0 ? <Empty title="还没有安装插件" /> : (
        <div className={styles.cards}>
          {items.map((plugin) => (
            <article key={plugin.pluginId} className={styles.miniCard} data-testid="plugin-row">
              <div className={styles.miniHead}>
                <b>{plugin.name}</b>
                <span className={styles.miniMeta}>v{plugin.version}</span>
                <span className={styles.spacer} />
                <Switch
                  checked={plugin.status === "enabled"}
                  label={`启用 ${plugin.name}`}
                  onChange={(next) => toggle.mutate({ pluginId: plugin.pluginId, enabled: next })}
                />
              </div>
              <p className={styles.miniDesc}>
                {plugin.tools.length} 个工具 · 权限 {plugin.permissions.join(", ") || "无"}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function SubagentsPanel() {
  const query = useAgents();
  const published = (query.data?.items ?? []).filter((agent) => agent.status === "published");
  if (query.isLoading || query.isError) {
    return <PanelState loading={query.isLoading} error={query.isError} onRetry={() => void query.refetch()} />;
  }
  return (
    <div className={styles.panel}>
      <div className={styles.panelNote}>
        已发布专家可被主专家委派为子智能体；具体子智能体配置在专家抽屉的「子智能体」分区。
      </div>
      {published.length === 0 ? <Empty title="还没有已发布专家" /> : (
        <div className={styles.cards}>
          {published.map((agent) => (
            <article key={agent.agentId} className={styles.miniCard}>
              <div className={styles.miniHead}>
                <b>{agent.name}</b>
                <StatusTag tone="green">v{agent.version}</StatusTag>
              </div>
              <p className={styles.miniDesc}>{agent.description || "无描述"}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChannelsPanel() {
  const query = useChannels();
  const items = query.data?.items ?? [];
  if (query.isLoading || query.isError) {
    return <PanelState loading={query.isLoading} error={query.isError} onRetry={() => void query.refetch()} />;
  }
  return (
    <div className={styles.panel}>
      <div className={styles.panelNote}>
        通道负责入站消息；完整配置与检测在通道页。 <Link to="/channels">打开通道</Link>
      </div>
      {items.length === 0 ? <Empty title="还没有配置通道" /> : (
        <div className={styles.cards}>
          {items.map((channel) => (
            <article key={channel.channelId} className={styles.miniCard}>
              <div className={styles.miniHead}>
                <b>{channel.displayName}</b>
                <StatusTag tone={channel.status === "active" ? "green" : "neutral"}>
                  {channel.status === "active" ? "已启用" : "已停用"}
                </StatusTag>
              </div>
              <span className={styles.miniMeta}>{channel.kind} · {channel.channelId}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function SkillsPanel() {
  return (
    <Empty
      title="技能随 v1.1 接入"
      hint="技能包需要新的 skills / skill_packages 表与运行时；当前不提供假开关。"
    />
  );
}

export function MbtiPanel() {
  return (
    <Empty
      title="人格（MBTI）随 v1.1 接入"
      hint="人格只影响提示词风格，不影响权限与工具；后端尚无持久化字段。"
    />
  );
}
