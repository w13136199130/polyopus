import { PageShell } from "@/layouts/PageShell";
import { SourcesTab } from "./SourcesTab";

/** 通道: inbound channels, webhook sources and their scheduled jobs. */
export function ChannelsPage() {
  return (
    <PageShell
      title="通道"
      subtitle="接入飞书与 Webhook，配置凭据、检测连通性并按通道触发任务。"
    >
      <SourcesTab />
    </PageShell>
  );
}
