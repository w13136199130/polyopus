/** Connections → Connectors (V1-14): encrypted instance config + probe. */

import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import {
  useConnectorCatalog,
  useConnectorInstances,
  useCreateConnector,
  useDeleteConnector,
  useProbeConnector,
  useStartOAuth,
} from "@/features/connectors/api";
import styles from "./ConnectorsTab.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function templateFor(kind: string): string {
  if (kind === "webhook") return '{\n  "url": "https://example.com/hook"\n}';
  if (kind === "github") return '{\n  "client_id": "",\n  "client_secret": ""\n}';
  if (kind === "feishu") return '{\n  "app_id": "",\n  "app_secret": ""\n}';
  if (kind === "imap") return '{\n  "host": "",\n  "username": "",\n  "password": ""\n}';
  return "{}";
}

export function ConnectorsTab() {
  const catalogQuery = useConnectorCatalog();
  const instancesQuery = useConnectorInstances();
  const create = useCreateConnector();
  const probe = useProbeConnector();
  const remove = useDeleteConnector();
  const oauth = useStartOAuth();
  const canWrite = useCan("connector:write");

  const catalog = catalogQuery.data?.items ?? [];
  const [kind, setKind] = useState("webhook");
  const [name, setName] = useState("");
  const [configText, setConfigText] = useState(templateFor("webhook"));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const instances = instancesQuery.data?.items ?? [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText) as Record<string, unknown>;
    } catch {
      setError("配置必须是 JSON 对象");
      return;
    }
    try {
      const created = await create.mutateAsync({
        kind, displayName: name.trim(), config,
      });
      setNotice(`已创建连接 ${created.displayName}`);
      setName("");
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <PageShell title="连接" subtitle="凭证加密存储且只写不读；测试连接只做本地配置校验。">
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.head}><h2>连接器</h2><span>{instances.length} 个</span></div>
          {instancesQuery.isLoading ? <Loading label="载入连接器…" /> : instancesQuery.isError ? (
            <ErrorState message="连接器加载失败" onRetry={() => void instancesQuery.refetch()} />
          ) : instances.length === 0 ? <Empty title="暂无连接器" /> : (
            <ul className={styles.rows}>
              {instances.map((row) => (
                <li key={row.instanceId} className={styles.row} data-testid="connector-row">
                  <div className={styles.who}>
                    <strong>{row.displayName}</strong>
                    <span>{row.kind} · {row.authKind} · {row.status}</span>
                  </div>
                  <div className={styles.actions}>
                    <Button size="sm" variant="ghost" disabled={!canWrite}
                      data-testid="connector-probe"
                      onClick={() => probe.mutate(row.instanceId, {
                        onSuccess: (data) => setNotice(
                          data.ok ? `${row.displayName} 连接正常` : `${row.displayName}: ${data.error}`,
                        ),
                        onError: (err) => setError(messageOf(err)),
                      })}>
                      测试连接
                    </Button>
                    {row.authKind === "oauth" ? (
                      <Button size="sm" variant="ghost" disabled={!canWrite}
                        onClick={() => oauth.mutate(row.kind, {
                          onSuccess: (data) => setNotice(`OAuth: ${data.authorizeUrl}`),
                          onError: (err) => setError(messageOf(err)),
                        })}>
                        OAuth
                      </Button>
                    ) : null}
                    <Button size="sm" variant="danger" disabled={!canWrite}
                      onClick={() => remove.mutate(row.instanceId, {
                        onError: (err) => setError(messageOf(err)),
                      })}>
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label>类型
              <select data-testid="connector-kind" value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setConfigText(templateFor(event.target.value));
                }}>
                {catalog.map((item) => (
                  <option key={item.catalogId} value={item.kind}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>名称<input data-testid="connector-name" required value={name}
              onChange={(event) => setName(event.target.value)} /></label>
            <label>配置 JSON（只写）
              <textarea data-testid="connector-config" value={configText}
                onChange={(event) => setConfigText(event.target.value)} />
            </label>
            <Button type="submit" disabled={!canWrite || !name.trim()}
              loading={create.isPending} data-testid="connector-create">
              创建连接
            </Button>
          </form>
        </section>
      </div>
    </PageShell>
  );
}
