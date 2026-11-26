import { Button, Dialog, Drawer, Loading } from "@/components/ui";
import type { KnowledgeBaseRow } from "@/lib/api/wire";
import { CreateKbDrawer, EditKbDrawer, KbSettingsDrawer } from "./KbDrawers";
import styles from "./KnowledgePage.module.css";

export interface PreviewChunk {
  idx: number;
  heading: string | null;
  content: string;
}

export interface KnowledgeOverlaysProps {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  createPending: boolean;
  onCreate: (body: { name: string; description?: string }) => Promise<void>;
  editTarget: KnowledgeBaseRow | null;
  onEditClose: () => void;
  updatePending: boolean;
  onEditSave: (input: { kbId: string; name: string; description?: string }) => Promise<void>;
  settingsOpen: boolean;
  active: KnowledgeBaseRow | null;
  onSettingsClose: () => void;
  reindexPending: boolean;
  deletePending: boolean;
  onReindex: () => void;
  onRequestDelete: () => void;
  deleteTarget: KnowledgeBaseRow | null;
  onDeleteTarget: (kb: KnowledgeBaseRow | null) => void;
  onConfirmDelete: () => void;
  previewId: string | null;
  previewFile?: string | null;
  previewLoading: boolean;
  previewChunks: readonly PreviewChunk[];
  onPreviewClose: () => void;
  canWrite: boolean;
}

/** All knowledge drawers/dialogs in one place (page keeps the state). */
export function KnowledgeOverlays(props: KnowledgeOverlaysProps) {
  return (
    <>
      <CreateKbDrawer
        open={props.createOpen}
        onOpenChange={props.onCreateOpenChange}
        canWrite={props.canWrite}
        pending={props.createPending}
        onCreate={props.onCreate}
      />

      <EditKbDrawer
        kb={props.editTarget}
        onClose={props.onEditClose}
        canWrite={props.canWrite}
        pending={props.updatePending}
        onSave={props.onEditSave}
      />

      <KbSettingsDrawer
        kb={props.settingsOpen ? props.active : null}
        onClose={props.onSettingsClose}
        canWrite={props.canWrite}
        reindexPending={props.reindexPending}
        deletePending={props.deletePending}
        onReindex={props.onReindex}
        onDelete={props.onRequestDelete}
      />

      <Drawer
        open={props.previewId !== null}
        onOpenChange={(open) => { if (!open) props.onPreviewClose(); }}
        title="文档预览"
        description={props.previewFile ?? undefined}
        width={640}
      >
        {props.previewLoading ? <Loading label="载入切片…" /> : (
          props.previewChunks.map((chunk) => (
            <div key={chunk.idx} className={styles.chunk}>
              <h4>#{chunk.idx} {chunk.heading || "正文"}</h4>
              <pre>{chunk.content}</pre>
            </div>
          ))
        )}
      </Drawer>

      <Dialog
        open={props.deleteTarget !== null}
        onOpenChange={(open) => { if (!open) props.onDeleteTarget(null); }}
        title="确认删除知识库"
        description={props.deleteTarget
          ? `将删除「${props.deleteTarget.name}」及其全部文档与切片。`
          : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => props.onDeleteTarget(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="confirm-kb-delete"
              loading={props.deletePending}
              onClick={props.onConfirmDelete}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className={styles.deleteNote}>此操作不可撤销；检索将立即失效。</p>
      </Dialog>
    </>
  );
}
