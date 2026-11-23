/**
 * Connections → Connectors (V1-14): enabled instances, built-in catalog and
 * a configuration drawer. Credentials are write-only (encrypted server-side),
 * custom MCP instances get visual + JSON editors.
 */

import { useState } from "react";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import {
  useConnectorCatalog,
  useConnectorInstances,
  useDeleteConnector,
  useProbeConnector,
  useUpdateConnector,
} from "@/features/connectors/api";
import { ConnectorDrawer } from "@/features/connectors/components/ConnectorDrawer";
import type { ConnectorInstanceRow } from "@/lib/api/wire";
import styles from "./ConnectorsTab.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function initials(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

function statusTone(status: string): string {
  if (status === "active") return styles.green;
  if (status === "expired") return styles.amber;
  return styles.neutral;
}

export function ConnectorsTab() {
  const catalogQuery = useConnectorCatalog();
  const instancesQuery = useConnectorInstances();
  const probe = useProbeConnector();
  const update = useUpdateConnector();
  const remove = useDeleteConnector();
  const canWrite = useCan("connector:write");
  const [subTab, setSubTab] = useState<"enabled" | "builtin" | "custom">("enabled");
  const [pendingDelete, setPendingDelete] = useState<ConnectorInstanceRow | null>(null);

  const [drawer, setDrawer] = useState<{
    instance: ConnectorInstanceRow | null;
    kind: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalog = catalogQuery.data?.items ?? [];
  const instances = instancesQuery.data?.items ?? [];
  const configuredKinds = new Set(instances.map((row) => row.kind));
  const builtinCatalog = catalog.filter((item) => item.kind !== "mcp");
  const customCatalog = catalog.filter((item) => item.kind === "mcp");
  const customInstances = instances.filter((row) => row.kind === "mcp");

  function openCreate(kind: string) {
    setNotice(null);
    setError(null);
    setDrawer({ instance: null, kind });
  }

  return (
    <PageShell
      title="连接"
      subtitle="凭证加密且只写不读；测试连接只校验配置，不代表外部服务可达。"
      actions={
        <>
          <Button
            size="sm"
            variant="secondary"
            data-testid="connector-new"
            disabled={!canWrite}
            onClick={() => openCreate("webhook")}
          >
            ＋ 添加连接器
          </Button>
          <Button
            size="sm"
            data-testid="mcp-new"
            disabled={!canWrite}
            onClick={() => openCreate("mcp")}
          >
            ＋ 自定义 MCP
          </Button>
        </>
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

        <div className={styles.subTabs} role="tablist" aria-label="连接器视图">
          {([
            ["enabled", "已启用", instances.length],
            ["builtin", "内置", builtinCatalog.length],
            ["custom", "自定义", customInstances.length],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={subTab === key}
              data-testid={`connector-subtab-${key}`}
              className={`${styles.subTab} ${subTab === key ? styles.subTabOn : ""}`}
              onClick={() => setSubTab(key)}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>

        {subTab === "enabled" ? (
        <section>
          <div className={styles.sectionHead}>
            <h2>已启用连接器</h2>
            <span>{instances.length} 个</span>
          </div>
          {instancesQuery.isLoading && !instancesQuery.data ? (
            <Loading label="载入连接器…" />
          ) : instancesQuery.isError ? (
            <ErrorState
              message="连接器加载失败"
              onRetry={() => void instancesQuery.refetch()}
            />
          ) : instances.length === 0 ? (
            <Empty
              title="还没有连接器"
              hint="连接 GitHub、飞书、邮箱或自定义 MCP，专家才能在对话中使用。"
              action={{ label: "添加连接器", onClick: () => openCreate("webhook") }}
            />
          ) : (
            <div className={styles.grid}>
              {instances.map((row) => (
                <article
                  key={row.instanceId}
                  className={styles.card}
                  data-testid="connector-row"
                >
                  <div className={styles.cardHead}>
                    <span className={styles.avatar}>{initials(row.displayName)}</span>
                    <div className={styles.identity}>
                      <div className={styles.nameRow}>
                        <b>{row.displayName}</b>
                        <span className={`${styles.status} ${statusTone(row.status)}`}>
                          {row.status === "active" ? "已配置" : row.status}
                        </span>
                      </div>
                      <span className={styles.meta}>
                        {row.kind} · {row.authKind} · {row.toolsCount} 个工具
                      </span>
                    </div>
                  </div>
                  <div className={styles.tags}>
                    {row.defaultOpen ? (
                      <span className={`${styles.tag} ${styles.blue}`}>默认打开</span>
                    ) : (
                      <span className={styles.tag}>手动选择</span>
                    )}
                    <span className={styles.tag}>
                      {row.shared ? "共享" : "仅自己"}
                    </span>
                    {row.configured ? (
                      <span className={styles.tag}>凭证已配置</span>
                    ) : (
                      <span className={`${styles.tag} ${styles.amber}`}>待配置</span>
                    )}
                  </div>
                  <div className={styles.cardFoot}>
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="connector-open"
                      disabled={!canWrite}
                      onClick={() => {
                        setNotice(null);
                        setError(null);
                        setDrawer({ instance: row, kind: row.kind });
                      }}
                    >
                      配置
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="connector-probe"
                      disabled={!canWrite}
                      onClick={() =>
                        probe.mutate(row.instanceId, {
                          onSuccess: (data) =>
                            data.ok
                              ? setNotice(`${row.displayName} 配置有效（仅本地校验）`)
                              : setError(`${row.displayName}: ${data.error ?? "配置不完整"}`),
                          onError: (err) => setError(messageOf(err)),
                        })}
                    >
                      测试连接
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="connector-default"
                      disabled={!canWrite || update.isPending}
                      onClick={() => update.mutate({
                        instanceId: row.instanceId,
                        defaultOpen: !row.defaultOpen,
                      }, {
                        onSuccess: () => setNotice(
                          row.defaultOpen
                            ? `已取消 ${row.displayName} 的默认打开`
                            : `已将 ${row.displayName} 设为默认打开`,
                        ),
                        onError: (err) => setError(messageOf(err)),
                      })}
                    >
                      {row.defaultOpen ? "取消默认" : "设默认"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      data-testid="connector-delete"
                      disabled={!canWrite}
                      onClick={() => setPendingDelete(row)}
                    >
                      删除
                    </Button>
                    <span className={styles.spacer} />
                    <span className={styles.hint}>
                      {row.lastProbeAt
                        ? `上次探测 ${new Date(row.lastProbeAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                        : "尚未探测"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        ) : null}

        {subTab === "builtin" ? (
        <section>
          <div className={styles.sectionHead}>
            <h2>内置目录</h2>
            <span>点击连接创建实例</span>
          </div>
          <div className={styles.catalog}>
            {builtinCatalog.map((item) => {
              const configured = configuredKinds.has(item.kind);
              return (
                <div key={item.catalogId} className={styles.catalogCard}>
                  <span className={styles.catalogIcon}>
                    {initials(item.name)}
                  </span>
                  <div className={styles.catalogBody}>
                    <b>{item.name}</b>
                    <span>
                      {item.category ?? "general"} · {item.authKind}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={configured ? "ghost" : "secondary"}
                    disabled={!canWrite}
                    onClick={() => openCreate(item.kind)}
                  >
                    {configured ? "添加实例" : "连接"}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
        ) : null}

        {subTab === "custom" ? (
          <section>
            <div className={styles.sectionHead}>
              <h2>自定义 MCP</h2>
              <span>{customInstances.length} 个实例</span>
            </div>
            {customInstances.length ? (
              <div className={styles.grid}>
                {customInstances.map((row) => (
                  <article key={row.instanceId} className={styles.card} data-testid="connector-row">
                    <div className={styles.cardHead}>
                      <span className={styles.avatar}>{initials(row.displayName)}</span>
                      <div className={styles.identity}>
                        <div className={styles.nameRow}>
                          <b>{row.displayName}</b>
                          <span className={`${styles.status} ${statusTone(row.status)}`}>
                            {row.status === "active" ? "已配置" : row.status}
                          </span>
                        </div>
                        <span className={styles.meta}>
                          {row.toolsCount} 个工具 · {row.defaultOpen ? "默认打开" : "手动选择"}
                        </span>
                      </div>
                    </div>
                    <div className={styles.cardFoot}>
                      <Button size="sm" variant="secondary" disabled={!canWrite}
                        onClick={() => setDrawer({ instance: row, kind: row.kind })}>
                        配置
                      </Button>
                      <span className={styles.spacer} />
                      <Button size="sm" variant="danger" disabled={!canWrite}
                        onClick={() => setPendingDelete(row)}>
                        删除
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title="还没有自定义 MCP"
                hint="新建 MCP 实例后，在抽屉里发现并启用工具。"
                action={{ label: "新建自定义 MCP", onClick: () => openCreate("mcp") }}
              />
            )}
            <div className={styles.sectionHead} style={{ marginTop: 18 }}>
              <h2>自定义目录</h2>
              <span>MCP / 本地服务</span>
            </div>
            <div className={styles.catalog}>
              {customCatalog.map((item) => (
                <div key={item.catalogId} className={styles.catalogCard}>
                  <span className={styles.catalogIcon}>{initials(item.name)}</span>
                  <div className={styles.catalogBody}>
                    <b>{item.name}</b>
                    <span>MCP · {item.authKind}</span>
                  </div>
                  <Button size="sm" disabled={!canWrite} onClick={() => openCreate(item.kind)}>
                    新建
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <ConnectorDrawer
        open={drawer !== null}
        instance={drawer?.instance ?? null}
        initialKind={drawer?.kind ?? "webhook"}
        catalog={catalog}
        onClose={() => setDrawer(null)}
        onNotice={setNotice}
        onError={setError}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="删除连接器"
        description="删除后对话中不能再选择该实例；历史会话不受影响。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!pendingDelete) return;
                remove.mutate(pendingDelete.instanceId, {
                  onSuccess: () => {
                    setNotice(`已删除 ${pendingDelete.displayName}`);
                    setPendingDelete(null);
                  },
                  onError: (err) => setError(messageOf(err)),
                });
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p>确定删除「{pendingDelete?.displayName}」？</p>
      </Dialog>
    </PageShell>
  );
}
