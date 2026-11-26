/**
 * Connections → Connectors (V1-14), laid out like the prototype: enabled
 * instances as a card grid, a category-filtered built-in catalog, and custom
 * MCP servers with visual / JSON editing. Credentials stay write-only.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Dialog, ErrorState, Loading, Tabs } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import paths from "@/layouts/icons";
import {
  useConnectorCatalog,
  useConnectorInstances,
  useCreateConnector,
  useDeleteConnector,
  useProbeConnector,
  useUpdateConnector,
} from "@/features/connectors/api";
import { ConnectorDrawer } from "@/features/connectors/components/ConnectorDrawer";
import { MCP_TEMPLATE, parseMcpConfig } from "@/features/connectors/mcpConfig";
import type { ConnectorInstanceRow } from "@/lib/api/wire";
import styles from "./ConnectorsTab.module.css";

type SubTab = "enabled" | "builtin" | "custom";

const CATEGORY_ORDER = ["办公协作", "开发协作", "通讯与效率", "自托管 / 扩展"];

const KIND_META: Record<
  string,
  { label: string; category: string; desc: string; tone: string }
> = {
  feishu: {
    label: "飞书",
    category: "办公协作",
    desc: "消息、文档与日程",
    tone: "blue",
  },
  github: {
    label: "GitHub",
    category: "开发协作",
    desc: "代码、issue 与 pull request",
    tone: "slate",
  },
  imap: {
    label: "邮箱",
    category: "通讯与效率",
    desc: "IMAP / SMTP 收发邮件",
    tone: "amber",
  },
  webhook: {
    label: "Webhook",
    category: "自托管 / 扩展",
    desc: "外部事件推送到 Gate 建单",
    tone: "teal",
  },
  mcp: {
    label: "MCP",
    category: "自托管 / 扩展",
    desc: "HTTP / Stdio 自定义服务",
    tone: "violet",
  },
};

const AVATAR_TONE: Record<string, string> = {
  blue: styles.avatarBlue,
  slate: styles.avatarSlate,
  amber: styles.avatarAmber,
  teal: styles.avatarTeal,
  violet: styles.avatarViolet,
};

function Glyph({ name, size = 22 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function initials(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

function kindMeta(kind: string) {
  return (
    KIND_META[kind] ?? {
      label: kind,
      category: "其他",
      desc: "自定义连接",
      tone: "blue",
    }
  );
}

function authLabel(authKind: string): string {
  if (authKind === "oauth") return "OAuth";
  if (authKind === "token") return "Token";
  if (authKind === "imap") return "IMAP";
  return authKind;
}

function credentialLabel(authKind: string): string {
  if (authKind === "oauth") return "OAuth";
  if (authKind === "token") return "Token";
  if (authKind === "imap") return "IMAP / 授权码";
  return authKind;
}

function instanceDesc(row: ConnectorInstanceRow): string {
  if (!row.configured) return "凭证未配置，配置后测试连接";
  if (row.kind === "mcp") return "自定义 MCP · HTTP / Stdio";
  return `${kindMeta(row.kind).desc} · ${authLabel(row.authKind)}`;
}

function instanceStatus(row: ConnectorInstanceRow): { label: string; cls: string } {
  if (!row.configured) return { label: "待配置", cls: styles.tagAmber };
  if (row.status === "active") return { label: "已连接", cls: styles.tagGreen };
  if (row.status === "expired") return { label: "已过期", cls: styles.tagAmber };
  if (row.status === "disabled") return { label: "已停用", cls: styles.tagNeutral };
  return { label: "连接异常", cls: styles.tagRed };
}

function AddCard({
  title,
  hint,
  testId,
  disabled,
  onClick,
}: {
  title: string;
  hint: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.addCard}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.addGlyph}>
        <Glyph name="plus" />
      </span>
      <b>{title}</b>
      <p>{hint}</p>
    </button>
  );
}

export function ConnectorsTab({
  openMcpRequest,
  onMcpOpened,
}: {
  openMcpRequest: boolean;
  onMcpOpened: () => void;
}) {
  const catalogQuery = useConnectorCatalog();
  const instancesQuery = useConnectorInstances();
  const create = useCreateConnector();
  const probe = useProbeConnector();
  const update = useUpdateConnector();
  const remove = useDeleteConnector();
  const canWrite = useCan("connector:write");

  const [params, setParams] = useSearchParams();
  const subParam = params.get("sub");
  const subTab: SubTab = subParam === "builtin" || subParam === "custom"
    ? subParam
    : "enabled";
  const setSubTab = (next: SubTab) => {
    const query = new URLSearchParams(params);
    if (next === "enabled") query.delete("sub");
    else query.set("sub", next);
    setParams(query, { replace: true });
  };
  const [category, setCategory] = useState("全部");
  const [mcpMode, setMcpMode] = useState<"visual" | "json">("visual");
  const [jsonText, setJsonText] = useState(MCP_TEMPLATE);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConnectorInstanceRow | null>(null);
  const [drawer, setDrawer] = useState<{
    instance: ConnectorInstanceRow | null;
    kind: string;
    transport?: "http" | "stdio";
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Header "添加自定义 MCP" lives on the page shell; a pending request opens
  // the drawer even when this tab just mounted, then clears itself.
  useEffect(() => {
    if (!openMcpRequest) return;
    setNotice(null);
    setError(null);
    setDrawer({ instance: null, kind: "mcp", transport: "http" });
    onMcpOpened();
  }, [openMcpRequest, onMcpOpened]);

  const catalog = catalogQuery.data?.items ?? [];
  const instances = instancesQuery.data?.items ?? [];
  const builtinCatalog = catalog.filter((item) => item.kind !== "mcp");
  const customInstances = instances.filter((row) => row.kind === "mcp");

  const availableCategories = Array.from(
    new Set(builtinCatalog.map((item) => kindMeta(item.kind).category)),
  );
  const categories = [
    ...CATEGORY_ORDER.filter((name) => availableCategories.includes(name)),
    ...availableCategories.filter((name) => !CATEGORY_ORDER.includes(name)),
  ];
  const visibleCatalog = builtinCatalog.filter(
    (item) =>
      category === "全部" || kindMeta(item.kind).category === category,
  );

  function openCreate(kind: string, transport?: "http" | "stdio") {
    setNotice(null);
    setError(null);
    setDrawer({ instance: null, kind, transport });
  }

  function openInstance(row: ConnectorInstanceRow) {
    setNotice(null);
    setError(null);
    setDrawer({ instance: row, kind: row.kind });
  }

  function probeRow(row: ConnectorInstanceRow) {
    probe.mutate(row.instanceId, {
      onSuccess: (data) =>
        data.ok
          ? setNotice(`${row.displayName} 配置有效（仅本地校验）`)
          : setError(`${row.displayName}: ${data.error ?? "配置不完整"}`),
      onError: (err) => setError(messageOf(err)),
    });
  }

  function toggleDefault(row: ConnectorInstanceRow) {
    update.mutate(
      { instanceId: row.instanceId, defaultOpen: !row.defaultOpen },
      {
        onSuccess: () =>
          setNotice(
            row.defaultOpen
              ? `已取消 ${row.displayName} 的默认打开`
              : `已将 ${row.displayName} 设为默认打开`,
          ),
        onError: (err) => setError(messageOf(err)),
      },
    );
  }

  function validateJson() {
    setNotice(null);
    const parsed = parseMcpConfig(jsonText);
    if ("error" in parsed) {
      setJsonError(parsed.error);
      return;
    }
    setJsonError(null);
    setNotice(
      `格式有效（${parsed.serverNames.length} 个 server）；保存后可在实例里测试连接`,
    );
  }

  function saveJson() {
    setNotice(null);
    const parsed = parseMcpConfig(jsonText);
    if ("error" in parsed) {
      setJsonError(parsed.error);
      return;
    }
    setJsonError(null);
    create.mutate(
      {
        kind: "mcp",
        displayName: parsed.name,
        config: parsed.config,
        defaultOpen: false,
        shared: false,
      },
      {
        onSuccess: (created) => {
          setNotice(`已创建连接 ${created.displayName}`);
          setMcpMode("visual");
          setSubTab("custom");
        },
        onError: (err) => setJsonError(messageOf(err)),
      },
    );
  }

  function renderEnabledCard(row: ConnectorInstanceRow) {
    const meta = kindMeta(row.kind);
    const status = instanceStatus(row);
    return (
      <article key={row.instanceId} className={styles.card} data-testid="connector-row">
        <div className={styles.cardTop}>
          <span className={`${styles.avatar} ${AVATAR_TONE[meta.tone] ?? styles.avatarBlue}`}>
            {initials(row.displayName)}
          </span>
          <div className={styles.identity}>
            <div className={styles.nameRow}>
              <b>{row.displayName}</b>
              <span className={`${styles.tag} ${status.cls}`}>{status.label}</span>
            </div>
            <span className={styles.desc}>{instanceDesc(row)}</span>
          </div>
          <span className={styles.tools}>{row.toolsCount} 工具</span>
        </div>
        <div className={styles.metaRow}>
          {row.defaultOpen ? (
            <span className={`${styles.tag} ${styles.tagBlue}`}>默认打开</span>
          ) : (
            <span className={`${styles.tag} ${styles.tagNeutral}`}>手动选择</span>
          )}
          <span className={`${styles.tag} ${styles.tagOutline}`}>
            {row.shared ? "共享" : "仅自己"}
          </span>
        </div>
        <div className={styles.foot}>
          <Button
            size="sm"
            variant="outline"
            data-testid="connector-open"
            disabled={!canWrite}
            onClick={() => openInstance(row)}
          >
            配置
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="connector-probe"
            disabled={!canWrite}
            onClick={() => probeRow(row)}
          >
            测试连接
          </Button>
          <span className={styles.spacer} />
          <Button
            size="sm"
            variant="ghost"
            data-testid="connector-default"
            disabled={!canWrite || update.isPending}
            onClick={() => toggleDefault(row)}
          >
            {row.defaultOpen ? "取消默认" : "设为默认"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={styles.dangerText}
            data-testid="connector-delete"
            disabled={!canWrite}
            onClick={() => setPendingDelete(row)}
          >
            删除
          </Button>
        </div>
      </article>
    );
  }

  function renderCustomCard(row: ConnectorInstanceRow) {
    const status = instanceStatus(row);
    return (
      <article key={row.instanceId} className={styles.card} data-testid="connector-row">
        <div className={styles.cardTop}>
          <span className={`${styles.avatar} ${styles.avatarViolet}`}>
            {initials(row.displayName)}
          </span>
          <div className={styles.identity}>
            <div className={styles.nameRow}>
              <b>{row.displayName}</b>
              <span className={`${styles.tag} ${status.cls}`}>{status.label}</span>
            </div>
            <span className={styles.desc}>
              {row.configured
                ? "自定义 MCP · HTTP / Stdio"
                : "还没有 server，编辑后探测"}
            </span>
          </div>
          <span className={styles.tools}>{row.toolsCount} 工具</span>
        </div>
        <div className={styles.metaRow}>
          <span className={`${styles.tag} ${styles.tagOutline}`}>MCP</span>
          <span className={`${styles.tag} ${styles.tagOutline}`}>HTTP / Stdio</span>
          {row.defaultOpen ? (
            <span className={`${styles.tag} ${styles.tagBlue}`}>默认打开</span>
          ) : null}
        </div>
        <div className={styles.foot}>
          <Button
            size="sm"
            variant="outline"
            data-testid="connector-open"
            disabled={!canWrite}
            onClick={() => openInstance(row)}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="connector-probe"
            disabled={!canWrite}
            onClick={() => probeRow(row)}
          >
            探测
          </Button>
          <span className={styles.spacer} />
          <Button
            size="sm"
            variant="ghost"
            className={styles.dangerText}
            data-testid="connector-delete"
            disabled={!canWrite}
            onClick={() => setPendingDelete(row)}
          >
            删除
          </Button>
        </div>
      </article>
    );
  }

  return (
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

      <Tabs
        ariaLabel="连接器视图"
        variant="segmented"
        value={subTab}
        onChange={setSubTab}
        items={[
          { key: "enabled", label: "已启用连接器", testId: "connector-subtab-enabled" },
          { key: "builtin", label: "内置连接器", testId: "connector-subtab-builtin" },
          { key: "custom", label: "自定义连接器", testId: "connector-subtab-custom" },
        ]}
      />

      {subTab === "enabled" ? (
        instancesQuery.isLoading && !instancesQuery.data ? (
          <Loading label="载入连接器…" />
        ) : instancesQuery.isError ? (
          <ErrorState
            message="连接器加载失败"
            onRetry={() => void instancesQuery.refetch()}
          />
        ) : instances.length === 0 ? (
          <div className={styles.emptyCard}>
            <span className={styles.emptyGlyph}>
              <Glyph name="plug" size={26} />
            </span>
            <b>还没有连接器</b>
            <p>连接飞书、GitHub 或邮箱，专家才能在对话中读写你的工作资料。</p>
            <div className={styles.emptyActions}>
              <Button
                data-testid="connector-new"
                disabled={!canWrite}
                onClick={() => openCreate("webhook")}
              >
                添加连接器
              </Button>
              <Button variant="secondary" onClick={() => setSubTab("builtin")}>
                浏览内置连接器
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.grid}>
            {instances.map(renderEnabledCard)}
            <AddCard
              title="添加连接"
              hint="从内置连接器或 MCP 开始。"
              testId="connector-new"
              disabled={!canWrite}
              onClick={() => openCreate("webhook")}
            />
          </div>
        )
      ) : null}

      {subTab === "builtin" ? (
        <section className={styles.section}>
          <div className={styles.chips}>
            {["全部", ...categories].map((name) => (
              <button
                key={name}
                type="button"
                className={`${styles.chip} ${category === name ? styles.chipOn : ""}`}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {catalogQuery.isLoading && !catalogQuery.data ? (
            <Loading label="载入内置连接器…" />
          ) : catalogQuery.isError ? (
            <ErrorState
              message="内置目录加载失败"
              onRetry={() => void catalogQuery.refetch()}
            />
          ) : (
            <div className={styles.grid}>
              {visibleCatalog.map((item) => {
                const meta = kindMeta(item.kind);
                const count = instances.filter((row) => row.kind === item.kind).length;
                const configured = count > 0;
                return (
                  <article
                    key={item.catalogId}
                    className={styles.card}
                    data-testid="connector-catalog-row"
                  >
                    <div className={styles.cardTop}>
                      <span
                        className={`${styles.avatar} ${AVATAR_TONE[meta.tone] ?? styles.avatarBlue}`}
                      >
                        {initials(item.name)}
                      </span>
                      <div className={styles.identity}>
                        <div className={styles.nameRow}>
                          <b>{item.name}</b>
                        </div>
                        <span className={styles.desc}>{meta.desc}</span>
                      </div>
                      <span
                        className={`${styles.tag} ${configured ? styles.tagGreen : styles.tagNeutral}`}
                      >
                        {configured ? "已连接" : "未配置"}
                      </span>
                    </div>
                    <div className={styles.metaRow}>
                      <span className={`${styles.tag} ${styles.tagOutline}`}>
                        {meta.category}
                      </span>
                      <span className={`${styles.tag} ${styles.tagNeutral}`}>
                        {credentialLabel(item.authKind)}
                      </span>
                    </div>
                    <div className={styles.foot}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canWrite}
                        onClick={() => openCreate(item.kind)}
                      >
                        {configured ? "添加实例" : "连接"}
                      </Button>
                      <span className={styles.spacer} />
                      <span className={styles.hint}>
                        {configured ? `${count} 个实例` : "点击查看凭证要求"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {subTab === "custom" ? (
        <section className={styles.section}>
          <div className={styles.toolbar}>
            <div className={styles.chips}>
              <button
                type="button"
                className={`${styles.chip} ${mcpMode === "visual" ? styles.chipOn : ""}`}
                onClick={() => setMcpMode("visual")}
              >
                可视化
              </button>
              <button
                type="button"
                className={`${styles.chip} ${mcpMode === "json" ? styles.chipOn : ""}`}
                onClick={() => setMcpMode("json")}
              >
                {"</>"} JSON
              </button>
            </div>
            <span className={styles.spacer} />
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite}
              onClick={() => openCreate("mcp", "http")}
            >
              添加 HTTP Server
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite}
              onClick={() => openCreate("mcp", "stdio")}
            >
              添加 Stdio Server
            </Button>
          </div>

          {mcpMode === "visual" ? (
            instancesQuery.isLoading && !instancesQuery.data ? (
              <Loading label="载入自定义连接器…" />
            ) : (
              <div className={styles.grid}>
                {customInstances.map(renderCustomCard)}
                <AddCard
                  title="添加 MCP Server"
                  hint="支持 HTTP / Stdio、Headers、Args、Env。"
                  testId="mcp-add-card"
                  disabled={!canWrite}
                  onClick={() => openCreate("mcp", "http")}
                />
              </div>
            )
          ) : (
            <div className={styles.jsonPanel}>
              <div className={styles.jsonHead}>
                <b>MCP 配置 JSON</b>
                <span className={styles.hint}>
                  支持 {"{ \"servers\": { ... } }"} 或 name → server 简写；保存后可在实例里发现工具。
                </span>
              </div>
              <textarea
                data-testid="mcp-json-editor"
                value={jsonText}
                spellCheck={false}
                onChange={(event) => {
                  setJsonText(event.target.value);
                  setJsonError(null);
                }}
              />
              {jsonError ? (
                <p className={styles.jsonError} role="alert">
                  {jsonError}
                </p>
              ) : null}
              <div className={styles.jsonFoot}>
                <Button size="sm" variant="secondary" onClick={validateJson}>
                  探测
                </Button>
                <span className={styles.spacer} />
                <Button
                  size="sm"
                  data-testid="mcp-json-save"
                  disabled={!canWrite}
                  loading={create.isPending}
                  onClick={saveJson}
                >
                  保存 JSON
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <ConnectorDrawer
        open={drawer !== null}
        instance={drawer?.instance ?? null}
        initialKind={drawer?.kind ?? "webhook"}
        initialTransport={drawer?.transport}
        catalog={catalog}
        onClose={() => setDrawer(null)}
        onNotice={setNotice}
        onError={setError}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="删除连接器"
        description="删除后对话中不能再选择该实例；历史会话不受影响。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
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
    </div>
  );
}
