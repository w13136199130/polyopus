import { useSearchParams } from "react-router";
import { Tabs } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { MemoryPanel } from "./MemoryPanel";
import {
  ChannelsPanel,
  MbtiPanel,
  PluginsPanel,
  SkillsPanel,
  SubagentsPanel,
  ToolsPanel,
} from "./PersonalizationPanels";
import styles from "./PersonalizationPage.module.css";

type Tab = "memory" | "tools" | "plugins" | "subagents" | "channels" | "skills" | "mbti";

const TABS: Array<[Tab, string]> = [
  ["memory", "记忆"],
  ["tools", "工具"],
  ["plugins", "插件"],
  ["subagents", "子智能体"],
  ["channels", "通道"],
  ["skills", "技能"],
  ["mbti", "MBTI"],
];

/** 个性化：页头 + 模块 Tab; 记忆为真实 API，工具/插件/通道复用现有域. */
export function PersonalizationPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = (TABS.map(([key]) => key) as string[]).includes(tabParam ?? "")
    ? (tabParam as Tab)
    : "memory";

  return (
    <PageShell
      title="个性化"
      subtitle="按专家与用户管理记忆、工具、插件、子智能体与通道。"
      tabs={
        <Tabs
          ariaLabel="个性化模块"
          value={tab}
          onChange={(next) => {
            const query = new URLSearchParams(params);
            if (next === "memory") query.delete("tab");
            else query.set("tab", next);
            setParams(query, { replace: true });
          }}
          items={TABS.map(([key, label]) => ({
            key,
            label,
            testId: `personalization-tab-${key}`,
          }))}
        />
      }
    >
      <div className={styles.page}>
        {tab === "memory" ? <MemoryPanel /> : null}
        {tab === "tools" ? <ToolsPanel /> : null}
        {tab === "plugins" ? <PluginsPanel /> : null}
        {tab === "subagents" ? <SubagentsPanel /> : null}
        {tab === "channels" ? <ChannelsPanel /> : null}
        {tab === "skills" ? <div className={styles.panel}><SkillsPanel /></div> : null}
        {tab === "mbti" ? <div className={styles.panel}><MbtiPanel /></div> : null}
      </div>
    </PageShell>
  );
}
