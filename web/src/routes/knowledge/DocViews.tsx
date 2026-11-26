import { Button, StatusTag } from "@/components/ui";
import type { KnowledgeDocRow } from "@/lib/api/wire";
import styles from "./DocViews.module.css";

export type DocView = "card" | "table";

export interface DocViewsProps {
  docs: readonly KnowledgeDocRow[];
  view: DocView;
  selected: Set<string>;
  canWrite: boolean;
  onSelect: (docId: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onPreview: (docId: string) => void;
  onReindex: (doc: KnowledgeDocRow) => void;
  onDelete: (doc: KnowledgeDocRow) => void;
}

function statusLabel(status: string): string {
  if (status === "ready") return "已就绪";
  if (status === "processing") return "处理中";
  if (status === "queued") return "排队中";
  if (status === "failed") return "失败";
  return status;
}

function extOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toUpperCase() : "DOC";
}

function statusTone(status: string): "green" | "red" | "amber" {
  if (status === "ready") return "green";
  if (status === "failed") return "red";
  return "amber";
}

function DocActions({
  doc,
  canWrite,
  onPreview,
  onReindex,
  onDelete,
}: Pick<DocViewsProps, "canWrite" | "onPreview" | "onReindex" | "onDelete"> & {
  doc: KnowledgeDocRow;
}) {
  return (
    <div className={styles.actions}>
      <Button size="sm" variant="ghost" data-testid="doc-preview" onClick={() => onPreview(doc.docId)}>
        预览
      </Button>
      <Button size="sm" variant="ghost" data-testid="doc-reindex" disabled={!canWrite} onClick={() => onReindex(doc)}>
        重建
      </Button>
      <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => onDelete(doc)}>
        删除
      </Button>
    </div>
  );
}

export function DocViews(props: DocViewsProps) {
  const { docs, view, selected, canWrite, onSelect, onSelectAll } = props;
  const allSelected = docs.length > 0 && selected.size === docs.length;

  if (view === "card") {
    return (
      <div className={styles.cards} data-testid="doc-cards">
        {docs.map((doc) => (
          <article key={doc.docId} className={styles.card} data-testid="doc-card">
            <div className={styles.cardHead}>
              <span className={styles.ext} aria-hidden="true">{extOf(doc.filename)}</span>
              <span className={styles.title} title={doc.filename}>{doc.filename}</span>
              <StatusTag tone={statusTone(doc.status)}>{statusLabel(doc.status)}</StatusTag>
            </div>
            <div className={styles.meta}>
              <span>{doc.chunkCount} 切片</span>
              <span>·</span>
              <span>{new Date(doc.createdAt * 1000).toLocaleDateString("zh-CN")}</span>
            </div>
            <DocActions {...props} doc={doc} />
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                aria-label="全选文档"
                checked={allSelected}
                disabled={!canWrite}
                onChange={(event) => onSelectAll(event.target.checked)}
              />
            </th>
            <th>文件名</th>
            <th>状态</th>
            <th>分块</th>
            <th>上传时间</th>
            <th style={{ width: 180 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.docId} className={selected.has(doc.docId) ? styles.rowSelected : ""}>
              <td>
                <input
                  type="checkbox"
                  data-testid="doc-checkbox"
                  aria-label={`选择 ${doc.filename}`}
                  checked={selected.has(doc.docId)}
                  disabled={!canWrite}
                  onChange={(event) => onSelect(doc.docId, event.target.checked)}
                />
              </td>
              <td className={styles.mono}>{doc.filename}</td>
              <td>
                <StatusTag tone={statusTone(doc.status)}>{statusLabel(doc.status)}</StatusTag>
              </td>
              <td>{doc.chunkCount}</td>
              <td className={styles.muted}>
                {new Date(doc.createdAt * 1000).toLocaleString("zh-CN")}
              </td>
              <td><DocActions {...props} doc={doc} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
