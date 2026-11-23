/** Admin plugin console: reuse the extensions API without duplicating state. */

import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import {
  useInstallExamples,
  usePlugins,
  useTogglePlugin,
  useUninstallPlugin,
} from "@/features/plugins/api";
import { useCan } from "@/lib/auth/permissions";
import styles from "./AdminConfig.module.css";

export function AdminPluginsTab({
  onNotice, onError, onOpenExtensions,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onOpenExtensions: () => void;
}) {
  const canWrite = useCan("admin:write");
  const query = usePlugins();
  const install = useInstallExamples();
  const toggle = useTogglePlugin();
  const remove = useUninstallPlugin();
  const plugins = query.data?.items ?? [];

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>插件</h2>
        <span>签名插件统一在扩展页安装；此处做实例级启停与卸载</span>
        <span className={styles.spacer} />
        <Button size="sm" variant="secondary" onClick={onOpenExtensions}>
          打开扩展页
        </Button>
        <Button
          size="sm"
          data-testid="admin-plugin-examples"
          disabled={!canWrite}
          loading={install.isPending}
          onClick={() => install.mutate(undefined, {
            onSuccess: (data) => onNotice(`已安装 ${data.items.length} 个示例插件`),
            onError: (error) => onError(error instanceof Error ? error.message : "安装失败"),
          })}
        >
          安装示例插件
        </Button>
      </div>

      {query.isLoading ? <Loading label="载入插件…" /> : query.isError ? (
        <ErrorState message="插件加载失败" onRetry={() => void query.refetch()} />
      ) : plugins.length === 0 ? (
        <Empty title="暂无插件" hint="安装示例插件，或到扩展页使用签名 manifest。" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>插件</th><th>版本</th><th>权限</th><th>状态</th>
                <th style={{ width: 190 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {plugins.map((plugin) => (
                <tr key={plugin.pluginId} data-testid="admin-plugin-row">
                  <td>
                    <b>{plugin.name}</b>
                    <div className={styles.muted}>{plugin.pluginId}</div>
                  </td>
                  <td className={styles.mono}>v{plugin.version}</td>
                  <td className={styles.mono}>
                    {plugin.permissions.join(", ") || "—"}
                  </td>
                  <td>{plugin.status === "enabled" ? "已启用" : plugin.status}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="admin-plugin-toggle"
                      disabled={!canWrite}
                      onClick={() => toggle.mutate({
                        pluginId: plugin.pluginId,
                        enabled: plugin.status !== "enabled",
                      }, {
                        onError: (error) => onError(
                          error instanceof Error ? error.message : "切换失败",
                        ),
                      })}
                    >
                      {plugin.status === "enabled" ? "停用" : "启用"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      data-testid="admin-plugin-remove"
                      disabled={!canWrite}
                      onClick={() => remove.mutate(plugin.pluginId, {
                        onSuccess: () => onNotice(`已卸载 ${plugin.name}`),
                        onError: (error) => onError(
                          error instanceof Error ? error.message : "卸载失败",
                        ),
                      })}
                    >
                      卸载
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
