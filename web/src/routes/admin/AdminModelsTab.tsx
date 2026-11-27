/**
 * Admin → 模型配置: six sub-tabs (prototype v7 §13).
 *
 * Only 对话模型 is wired to the backend today; the other model families have
 * no provider kind or runtime in the registry yet, so they are explicit v1.1
 * placeholders instead of fake configuration forms.
 */

import { useSearchParams } from "react-router";
import { Tabs } from "@/components/ui";
import { AdminChatModelsPanel } from "./AdminChatModelsPanel";
import styles from "./AdminConfig.module.css";

type SubTab = "chat" | "embedding" | "generation" | "voice" | "decision" | "search";

const SUB_TABS: ReadonlyArray<readonly [SubTab, string]> = [
  ["chat", "对话模型"],
  ["embedding", "向量模型"],
  ["generation", "生成模型"],
  ["voice", "语音模型"],
  ["decision", "决策模型"],
  ["search", "搜索引擎"],
];

const PENDING: Record<Exclude<SubTab, "chat">, { title: string; body: string }> = {
  embedding: {
    title: "向量模型随 v1.1 提供",
    body: "知识库当前使用 SQLite 词法检索；向量化与向量服务配置（ONNX / SiliconFlow / DashScope）随向量域接入。",
  },
  generation: {
    title: "生成模型随 v1.1 提供",
    body: "生图 / 生视频模型与路由尚未接入运行时；接入后会复用同一套提供商凭证。",
  },
  voice: {
    title: "语音模型随 v1.1 提供",
    body: "STT 语音输入与 TTS 朗读还没有后端通道，对话输入区暂不展示语音入口。",
  },
  decision: {
    title: "决策模型随 v1.1 提供",
    body: "当前审批与路由由实例策略决定，没有独立的决策模型开关。",
  },
  search: {
    title: "搜索引擎随 v1.1 提供",
    body: "联网搜索尚无提供商适配；知识库检索不依赖外部搜索源。",
  },
};

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <section className={styles.panel}>
      <div className={styles.empty}>
        <span className={styles.emptyGlyph}>v1.1</span>
        <b>{title}</b>
        <p>{body}</p>
      </div>
    </section>
  );
}

export function AdminModelsTab({
  onNotice, onError, createSignal,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  createSignal: number;
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("sub");
  const sub: SubTab = SUB_TABS.some(([key]) => key === requested)
    ? (requested as SubTab)
    : "chat";
  const setSub = (next: SubTab) => {
    const query = new URLSearchParams(params);
    if (next === "chat") query.delete("sub");
    else query.set("sub", next);
    setParams(query, { replace: true });
  };

  return (
    <div className={styles.page}>
      <Tabs
        ariaLabel="模型配置"
        variant="segmented"
        value={sub}
        onChange={setSub}
        items={SUB_TABS.map(([key, label]) => ({
          key,
          label,
          testId: `admin-model-sub-${key}`,
        }))}
      />
      {sub === "chat" ? (
        <AdminChatModelsPanel
          onNotice={onNotice}
          onError={onError}
          createSignal={createSignal}
        />
      ) : (
        <Placeholder title={PENDING[sub].title} body={PENDING[sub].body} />
      )}
    </div>
  );
}
