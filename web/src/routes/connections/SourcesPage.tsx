import { Link } from "react-router";
import { PageShell } from "@/layouts/PageShell";
import { SourcesTab } from "./SourcesTab";
import styles from "./ChannelsPage.module.css";

/** Webhook 来源管理（从通道页拆出的兼容路由 /sources）. */
export function SourcesPage() {
  return (
    <PageShell
      title="Webhook 来源"
      subtitle="外部系统推送事件、Gate 建单；密钥只在创建时显示一次。"
      actions={<Link to="/channels" className={styles.linkBtn}>返回通道</Link>}
    >
      <SourcesTab mode="sources" />
    </PageShell>
  );
}
