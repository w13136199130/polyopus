import { useState } from "react";
import { ConnectorsTab } from "./ConnectorsTab";
import { SourcesTab } from "./SourcesTab";
import styles from "./ConnectionsPage.module.css";

/** Connections: Sources (v0.5) + Connectors (V1-14). */
export function ConnectionsPage() {
  const [tab, setTab] = useState<"sources" | "connectors">("sources");
  return (
    <div>
      <div className={styles.tabs} role="tablist" aria-label="连接类型">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sources"}
          className={`${styles.tab} ${tab === "sources" ? styles.active : ""}`}
          onClick={() => setTab("sources")}
        >
          来源
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "connectors"}
          className={`${styles.tab} ${tab === "connectors" ? styles.active : ""}`}
          data-testid="connectors-tab"
          onClick={() => setTab("connectors")}
        >
          连接器
        </button>
      </div>
      {tab === "sources" ? <SourcesTab /> : <ConnectorsTab />}
    </div>
  );
}
