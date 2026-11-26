import { Button, Empty, Loading } from "@/components/ui";
import type { KnowledgeBaseRow } from "@/lib/api/wire";
import styles from "./KbLibrary.module.css";

export interface KbLibraryProps {
  kbs: readonly KnowledgeBaseRow[];
  loading: boolean;
  activeId: string | null;
  canWrite: boolean;
  onSelect: (kbId: string) => void;
  onCreate: () => void;
  onEdit: (kb: KnowledgeBaseRow) => void;
  onDelete: (kb: KnowledgeBaseRow) => void;
  onExport: (kb: KnowledgeBaseRow) => void;
}

/** Knowledge library column: 264px card list + create button (docs/52 §9). */
export function KbLibrary({
  kbs,
  loading,
  activeId,
  canWrite,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onExport,
}: KbLibraryProps) {
  return (
    <aside className={styles.side} aria-label="知识库列表">
      <div className={styles.head}>
        <b>知识库</b>
        <span>{kbs.length} 个</span>
      </div>

      <div className={styles.list}>
        {loading ? <Loading label="载入知识库…" /> : null}
        {!loading && kbs.length === 0 ? (
          <Empty title="还没有知识库" hint="创建一个后上传 Markdown。" />
        ) : null}
        {kbs.map((kb) => (
          <article
            key={kb.kbId}
            className={`${styles.card} ${kb.kbId === activeId ? styles.active : ""}`}
          >
            <button
              type="button"
              className={styles.main}
              data-testid="kb-select"
              onClick={() => onSelect(kb.kbId)}
            >
              <span className={styles.icon} aria-hidden="true">▤</span>
              <span className={styles.body}>
                <b className={styles.name}>{kb.name}</b>
                <span className={styles.desc}>{kb.description || "无描述"}</span>
                <span className={styles.meta}>
                  {kb.docCount} 个文档 · {kb.chunkCount} 切片
                </span>
              </span>
            </button>
            <details className={styles.menu}>
              <summary aria-label={`${kb.name} 更多操作`} data-testid="kb-menu">⋯</summary>
              <div className={styles.menuPop}>
                <button type="button" disabled title="添加到会话随 v1.1 接入">添加到会话</button>
                <button type="button" onClick={() => onEdit(kb)}>编辑知识库</button>
                <button type="button" onClick={() => onExport(kb)}>导出清单</button>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={!canWrite}
                  onClick={() => onDelete(kb)}
                >
                  删除
                </button>
              </div>
            </details>
          </article>
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        className={styles.create}
        data-testid="kb-new"
        disabled={!canWrite}
        onClick={onCreate}
      >
        ＋ 新建知识库
      </Button>
    </aside>
  );
}
