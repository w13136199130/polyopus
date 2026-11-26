import { useState } from "react";
import { Button, Empty, ErrorState, FilterBar, Loading, ViewToggle } from "@/components/ui";
import type { KnowledgeDocRow } from "@/lib/api/wire";
import { DocViews, type DocView } from "./DocViews";
import styles from "./KnowledgePage.module.css";

export interface KnowledgeDocsProps {
  docs: readonly KnowledgeDocRow[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  canWrite: boolean;
  uploading: boolean;
  docSearch: string;
  onDocSearch: (value: string) => void;
  docView: DocView;
  onDocView: (value: DocView) => void;
  selected: Set<string>;
  onSelect: (docId: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  pasteOpen: boolean;
  onTogglePaste: () => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onUploadText: (filename: string, content: string) => Promise<void>;
  onPreview: (docId: string) => void;
  onReindex: (doc: KnowledgeDocRow) => void;
  onDelete: (doc: KnowledgeDocRow) => void;
  onBatchReindex: () => void;
  onBatchDelete: () => void;
  onClearSelection: () => void;
}

/** 文档 tab: drop zone + paste + search/view toggle + cards/table + batch bar. */
export function KnowledgeDocs(props: KnowledgeDocsProps) {
  const {
    docs, loading, error, onRetry, canWrite, uploading,
    docSearch, onDocSearch, docView, onDocView, selected,
    onSelect, onSelectAll, pasteOpen, onTogglePaste,
    onUploadFiles, onUploadText, onPreview, onReindex, onDelete,
    onBatchReindex, onBatchDelete, onClearSelection,
  } = props;
  const [dragOver, setDragOver] = useState(false);
  const [filename, setFilename] = useState("notes.md");
  const [content, setContent] = useState("# 标题\n## 小节\n内容。\n");

  async function submitPaste(event: React.FormEvent) {
    event.preventDefault();
    if (!filename.trim() || !content.trim()) return;
    await onUploadText(filename.trim(), content);
  }

  return (
    <div
      className={`${styles.docsPane} ${dragOver ? styles.dragOver : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        onUploadFiles(event.dataTransfer.files);
      }}
    >
      {pasteOpen ? (
        <form className={styles.paste} onSubmit={(event) => void submitPaste(event)}>
          <label>文件名
            <input
              data-testid="doc-filename"
              required
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
            />
          </label>
          <label className={styles.pasteBody}>Markdown
            <textarea
              data-testid="doc-content"
              required
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm" data-testid="doc-upload" disabled={!canWrite || uploading} loading={uploading}>
            上传文档
          </Button>
        </form>
      ) : null}

      <FilterBar
        right={
          <>
            <input
              className={styles.search}
              data-testid="doc-search"
              placeholder="搜索文件名…"
              aria-label="搜索文档"
              value={docSearch}
              onChange={(event) => onDocSearch(event.target.value)}
            />
            <ViewToggle value={docView} onChange={onDocView} testIdPrefix="doc-view" />
          </>
        }
      >
        <span className={styles.dragHint}>拖拽 Markdown 到面板即可上传</span>
      </FilterBar>

      {selected.size > 0 ? (
        <div className={styles.batchBar}>
          已选 {selected.size} 项
          <Button size="sm" variant="secondary" data-testid="doc-batch-reindex"
            disabled={!canWrite} onClick={onBatchReindex}>
            批量重建
          </Button>
          <Button size="sm" variant="danger" data-testid="doc-batch-delete"
            disabled={!canWrite} onClick={onBatchDelete}>
            批量删除
          </Button>
          <Button size="sm" variant="ghost" onClick={onClearSelection}>
            取消选择
          </Button>
        </div>
      ) : null}

      {loading ? <Loading label="载入文档…" /> : error ? (
        <ErrorState message="文档加载失败" onRetry={onRetry} />
      ) : docs.length === 0 ? (
        <Empty
          title={docSearch ? "没有匹配的文档" : "暂无文档"}
          hint={docSearch
            ? "换个关键词，或清除搜索查看全部。"
            : "上传一个 Markdown 文件开始。"}
          action={docSearch
            ? { label: "清除搜索", onClick: () => onDocSearch("") }
            : canWrite ? { label: "新建文件", onClick: onTogglePaste } : undefined}
        />
      ) : (
        <DocViews
          docs={docs}
          view={docView}
          selected={selected}
          canWrite={canWrite}
          onSelect={onSelect}
          onSelectAll={onSelectAll}
          onPreview={onPreview}
          onReindex={onReindex}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
