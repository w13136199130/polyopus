import { useRef } from "react";
import { Button } from "@/components/ui";
import type { KnowledgeBaseRow } from "@/lib/api/wire";
import styles from "./KnowledgePage.module.css";

export interface KnowledgePanelHeaderProps {
  active: KnowledgeBaseRow;
  canWrite: boolean;
  uploading: boolean;
  pasteOpen: boolean;
  onTogglePaste: () => void;
  onFiles: (files: FileList) => void;
}

/** Right-panel header: name/counts + folder/file/upload actions. */
export function KnowledgePanelHeader({
  active,
  canWrite,
  uploading,
  pasteOpen,
  onTogglePaste,
  onFiles,
}: KnowledgePanelHeaderProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <header className={styles.panelHead}>
      <div className={styles.titleBlock}>
        <h2>{active.name}</h2>
        <p>
          {active.docCount} / 1000 个文档 · {active.chunkCount} 切片 · 支持 .md / .txt
        </p>
      </div>
      <div className={styles.panelActions}>
        <Button size="sm" variant="ghost" disabled title="文件夹随 v1.1 接入">
          新建文件夹
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="kb-paste-toggle"
          disabled={!canWrite}
          onClick={onTogglePaste}
        >
          {pasteOpen ? "收起粘贴" : "新建文件"}
        </Button>
        <Button
          size="sm"
          data-testid="kb-pick-files"
          disabled={!canWrite || uploading}
          onClick={() => fileRef.current?.click()}
        >
          上传文档
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt"
          multiple
          data-testid="kb-file-input"
          className={styles.fileInput}
          onChange={(event) => {
            if (event.target.files?.length) onFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
