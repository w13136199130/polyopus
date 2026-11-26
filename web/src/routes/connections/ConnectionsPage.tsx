import { useCallback, useState } from "react";
import { Button } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { ConnectorsTab } from "./ConnectorsTab";

/**
 * Connectors page (docs/52 §2): one rail entry. Channels, bridge and ACP are
 * separate destinations now; this page owns only connector instances.
 */
export function ConnectionsPage() {
  // Pending request survives remounts inside the tab; the child clears it once
  // the drawer opens.
  const [mcpPending, setMcpPending] = useState(false);
  const clearMcpPending = useCallback(() => setMcpPending(false), []);

  return (
    <PageShell
      title="连接器"
      subtitle="启用内置连接器或接入自定义 MCP，在对话中按需使用。"
      actions={
        <Button
          size="sm"
          data-testid="mcp-new"
          onClick={() => setMcpPending(true)}
        >
          ＋ 添加自定义 MCP
        </Button>
      }
    >
      <ConnectorsTab openMcpRequest={mcpPending} onMcpOpened={clearMcpPending} />
    </PageShell>
  );
}
