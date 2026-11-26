import { Button } from "@/components/ui";
import type { KnowledgeBaseRow, KnowledgeSearchResult } from "@/lib/api/wire";
import styles from "./KnowledgePage.module.css";

export interface RetrievalPanelProps {
  active: KnowledgeBaseRow;
  query: string;
  onQuery: (value: string) => void;
  mode: string;
  onMode: (value: string) => void;
  running: boolean;
  onSearch: (event: React.FormEvent) => void;
  result: KnowledgeSearchResult | null;
  latencyMs: number | null;
}

/** 检索测试 tab: lexical pipeline chips + ranked hits (knowledge-debug). */
export function RetrievalPanel({
  active,
  query,
  onQuery,
  mode,
  onMode,
  running,
  onSearch,
  result,
  latencyMs,
}: RetrievalPanelProps) {
  return (
    <div className={styles.retrieval}>
      <form className={styles.searchRow} onSubmit={onSearch}>
        <input
          data-testid="kb-query"
          placeholder="用一句话提问，例如：备份保留几份"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <select
          aria-label="检索模式"
          data-testid="kb-mode"
          value={mode}
          onChange={(event) => onMode(event.target.value)}
          className={styles.modeSelect}
        >
          <option value="lexical">lexical（FTS5 · BM25）</option>
          <option value="dense" disabled>dense（v1.1 向量）</option>
          <option value="hybrid" disabled>hybrid（v1.1）</option>
        </select>
        <Button type="submit" data-testid="kb-search" disabled={!query.trim()} loading={running}>
          检索
        </Button>
      </form>

      {result ? (
        <div className={styles.pipeline} data-testid="kb-pipeline">
          <span className={styles.pipeChip}>top-k {result.hits.length}</span>
          <span className={styles.pipeChip}>候选 {active.chunkCount} chunks</span>
          <span className={styles.pipeChip}>rerank 无（lexical）</span>
          {latencyMs !== null ? (
            <span className={`${styles.pipeChip} ${styles.pipeGreen}`}>{latencyMs}ms</span>
          ) : null}
          <span className={styles.spacer} />
          {result.status === "ok" ? (
            <span className={`${styles.pipeChip} ${styles.pipeGreen}`}>命中</span>
          ) : (
            <span className={`${styles.pipeChip} ${styles.pipeRed}`}>
              {result.status === "abstain" ? "无命中 · 分数低于阈值" : result.status}
            </span>
          )}
        </div>
      ) : null}

      {result ? result.status === "abstain" ? (
        <div className={styles.abstain} data-testid="kb-abstain">
          {result.reason ?? "知识库中没有找到依据"}
          <div className={styles.abstainSub}>
            不是"没有文档"：当前库 {active.docCount} 文档 / {active.chunkCount} 切片；
            分数低于置信阈值时宁可弃答。
          </div>
        </div>
      ) : (
        result.hits.map((hit, index) => (
          <div key={hit.chunkId} className={styles.hit} data-testid="kb-hit">
            <div className={styles.hitHead}>
              <span className={styles.rank}>#{index + 1}</span>
              <b>{hit.doc}</b>
              <span>{hit.heading || "正文"}</span>
              <span>score {hit.score} · char {hit.span[0]}–{hit.span[1]}</span>
            </div>
            <p>{hit.content}</p>
            <div className={styles.hitBar}>
              <i style={{ width: `${Math.min(100, Math.max(0, Math.round(Math.abs(hit.score) * 8)))}%` }} />
            </div>
          </div>
        ))
      ) : null}
    </div>
  );
}
