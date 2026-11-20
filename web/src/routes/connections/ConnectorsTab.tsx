/**
 * Connections → Connectors (V1-14): enabled instances, built-in catalog and
 * a configuration drawer. Credentials are write-only (encrypted server-side),
 * custom MCP instances get visual + JSON editors.
 */

import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import {
  useConnectorCatalog,
  useConnectorInstances,
  useProbeConnector,
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
  const canWrite = useCan("connector:write");

  const [drawer, setDrawer] = useState<{
    instance: ConnectorInstanceRow | null;
    kind: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalog = catalogQuery.data?.items ?? [];
  const instances = instancesQuery.data?.items ?? [];
  const configuredKinds = new Set(instances.map((row) => row.kind));

  function openCreate(kind: string) {
    setNotice(null);
    setError(null);
    setDrawer({ instance: null, kind });
  }

  return (
    <PageShell
      title="连接"
      subtitle="凭证加密存储且只写不读；测试连接只做本地配置校验。"
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
                          {row.status === "active" ? "已连接" : row.status}
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
                              ? setNotice(`${row.displayName} 连接正常`)
                              : setError(`${row.displayName}: ${data.error ?? "配置不完整"}`),
                          onError: (err) => setError(messageOf(err)),
                        })}
                    >
                      测试连接
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

        <section>
          <div className={styles.sectionHead}>
            <h2>内置目录</h2>
            <span>点击连接创建实例</span>
          </div>
          <div className={styles.catalog}>
            {catalog.map((item) => {
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
    </PageShell>
  );
}
