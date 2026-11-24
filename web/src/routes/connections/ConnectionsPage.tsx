import { useCallback, useState } from "react";
import { Button } from "@/components/ui";
import paths, { type IconName } from "@/layouts/icons";
import { PageShell } from "@/layouts/PageShell";
import { ConnectorsTab } from "./ConnectorsTab";
import { SourcesTab } from "./SourcesTab";
import styles from "./ConnectionsPage.module.css";

type TabKey = "connectors" | "channels" | "bridge" | "acp";

const TABS: ReadonlyArray<readonly [TabKey, string]> = [
  ["connectors", "连接器"],
  ["channels", "通道"],
  ["bridge", "云端协同"],
  ["acp", "ACP"],
];

const PLACEHOLDERS: Record<
  "bridge" | "acp",
  { icon: IconName; title: string; body: string }
> = {
  bridge: {
    icon: "cloud",
    title: "云端协同尚未接入",
    body: "跨实例共享专家与会话需要控制器和端到端鉴权，计划随 v1.1 上线；当前版本只有本地连接器。",
  },
  acp: {
    icon: "terminal",
    title: "ACP 协作尚未接入",
    body: "外部 Runner 的注册、权限与任务委派会在 v1.1 提供；当前 Agent 只在本实例内执行。",
  },
};

function Glyph({ name, size = 24 }: { name: IconName; size?: number }) {
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

function Placeholder({ tab }: { tab: "bridge" | "acp" }) {
  const meta = PLACEHOLDERS[tab];
  return (
    <div className={styles.placeholder}>
      <span className={styles.glyph}>
        <Glyph name={meta.icon} />
      </span>
      <b>{meta.title}</b>
      <p>{meta.body}</p>
      <span className={styles.v11}>v1.1</span>
    </div>
  );
}

/** Connections: connectors, inbound channels, and the v1.1 bridge/ACP tabs. */
export function ConnectionsPage() {
  const [tab, setTab] = useState<TabKey>("connectors");
  // Pending request survives a tab switch, so the header action also works
  // from 通道 / 云端协同 / ACP; the child clears it once the drawer opens.
  const [mcpPending, setMcpPending] = useState(false);
  const clearMcpPending = useCallback(() => setMcpPending(false), []);

  return (
    <PageShell
      title="连接"
      subtitle="连接器、通道与云端协同，在对话中按需使用。"
      actions={
        <Button
          size="sm"
          data-testid="mcp-new"
          onClick={() => {
            setTab("connectors");
            setMcpPending(true);
          }}
        >
          ＋ 添加自定义 MCP
        </Button>
      }
    >
      <div className={styles.tabs} role="tablist" aria-label="连接类型">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={
              key === "connectors"
                ? "connectors-tab"
                : key === "channels"
                  ? "channels-tab"
                  : undefined
            }
            className={`${styles.tab} ${tab === key ? styles.active : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "connectors" ? (
        <ConnectorsTab openMcpRequest={mcpPending} onMcpOpened={clearMcpPending} />
      ) : null}
      {tab === "channels" ? <SourcesTab /> : null}
      {tab === "bridge" || tab === "acp" ? <Placeholder tab={tab} /> : null}
    </PageShell>
  );
}
