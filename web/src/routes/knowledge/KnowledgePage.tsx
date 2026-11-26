/**
 * 知识库 (docs/52 §9): 左库卡片列 + 右文档面板；文档默认卡片视图，
 * 设置与编辑都改成右侧抽屉，检索测试保留为 PolyOpus 自有 Tab。
 */

import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Tabs } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import { knowledge } from "@/lib/api/endpoints";
import type { KnowledgeBaseRow, KnowledgeSearchResult } from "@/lib/api/wire";
import {
  useCreateKb,
  useDeleteDoc,
  useDeleteKb,
  useKnowledgeBases,
  useKnowledgeDocs,
  useReindexDoc,
  useReindexKb,
  useSearchKb,
  useUpdateKb,
  useUploadDoc,
} from "@/features/knowledge/api";
import { KbLibrary } from "./KbLibrary";
import type { DocView } from "./DocViews";
import { KnowledgeDocs } from "./KnowledgeDocs";
import { KnowledgePanelHeader } from "./KnowledgePanelHeader";
import { KnowledgeOverlays } from "./KnowledgeOverlays";
import { RetrievalPanel } from "./RetrievalPanel";
import styles from "./KnowledgePage.module.css";

const TEXT_EXT = /\.(md|markdown|txt)$/i;
type Tab = "docs" | "retrieval";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function KnowledgePage() {
  const canWrite = useCan("knowledge:write");
  const kbsQuery = useKnowledgeBases();
  const [activeKb, setActiveKb] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("docs");

  const kbs = kbsQuery.data?.items ?? [];
  const kbId = activeKb ?? kbs[0]?.kbId ?? null;
  const active = kbs.find((row) => row.kbId === kbId) ?? null;

  const [docSearch, setDocSearch] = useState("");
  const deferredDocSearch = useDeferredValue(docSearch.trim());
  const [docView, setDocView] = useState<DocView>("card");
  const docsQuery = useKnowledgeDocs(kbId, deferredDocSearch);
  const docs = docsQuery.data?.items ?? [];

  const createKb = useCreateKb();
  const updateKb = useUpdateKb();
  const deleteKb = useDeleteKb();
  const upload = useUploadDoc(kbId ?? "");
  const deleteDoc = useDeleteDoc(kbId ?? "");
  const reindex = useReindexKb();
  const reindexDoc = useReindexDoc(kbId ?? "");
  const search = useSearchKb(kbId ?? "");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<KnowledgeBaseRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("lexical");
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [result, setResult] = useState<KnowledgeSearchResult | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pendingKbDelete, setPendingKbDelete] = useState<KnowledgeBaseRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ["knowledge-preview", previewId],
    queryFn: () => knowledge.preview(previewId as string),
    enabled: previewId !== null,
  });

  const uploading = useMemo(() => upload.isPending, [upload.isPending]);

  function selectKb(next: string) {
    setActiveKb(next);
    setSelected(new Set());
    setResult(null);
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!kbId) return;
    setError(null);
    let done = 0;
    for (const file of Array.from(files)) {
      if (!TEXT_EXT.test(file.name)) {
        setError(`暂不支持 ${file.name}（仅 .md/.markdown/.txt）`);
        continue;
      }
      try {
        await upload.mutateAsync({ filename: file.name, content: await file.text() });
        done += 1;
      } catch (err) {
        setError(messageOf(err));
      }
    }
    if (done) setNotice(`已上传 ${done} 个文档`);
  }

  async function batchDelete() {
    setError(null);
    let done = 0;
    for (const docId of selected) {
      try {
        await deleteDoc.mutateAsync(docId);
        done += 1;
      } catch (err) {
        setError(messageOf(err));
      }
    }
    setSelected(new Set());
    if (done) setNotice(`已删除 ${done} 个文档`);
  }

  async function batchReindex() {
    setError(null);
    let done = 0;
    for (const docId of selected) {
      try {
        await reindexDoc.mutateAsync(docId);
        done += 1;
      } catch (err) {
        setError(messageOf(err));
      }
    }
    setSelected(new Set());
    if (done) setNotice(`已重建 ${done} 个文档的索引`);
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!kbId || !query.trim()) return;
    setError(null);
    const started = performance.now();
    try {
      const found = await search.mutateAsync(query.trim());
      setResult(found);
      setLastLatencyMs(Math.max(1, Math.round(performance.now() - started)));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function exportList(kb: KnowledgeBaseRow) {
    try {
      const payload = await knowledge.docs(kb.kbId);
      downloadJson(`knowledge-${kb.name}`, {
        kbId: kb.kbId,
        name: kb.name,
        documents: payload.items,
      });
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function confirmKbDelete() {
    if (!pendingKbDelete) return;
    setError(null);
    try {
      await deleteKb.mutateAsync(pendingKbDelete.kbId);
      setActiveKb(null);
      setTab("docs");
      setSettingsOpen(false);
      setNotice(`已删除 ${pendingKbDelete.name}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPendingKbDelete(null);
    }
  }

  return (
    <PageShell
      title="知识库"
      subtitle="Markdown 按标题切片；检索命中带文档与标题引用。"
      actions={
        <Button
          size="sm"
          variant="outline"
          data-testid="kb-settings-open"
          disabled={!active}
          onClick={() => setSettingsOpen(true)}
        >
          知识库设置
        </Button>
      }
    >
      <div className={styles.layout}>
        <KbLibrary
          kbs={kbs}
          loading={kbsQuery.isLoading}
          activeId={kbId}
          canWrite={canWrite}
          onSelect={selectKb}
          onCreate={() => setCreateOpen(true)}
          onEdit={setEditTarget}
          onDelete={setPendingKbDelete}
          onExport={(kb) => void exportList(kb)}
        />

        <section className={styles.panel}>
          {notice ? <div className={styles.notice}>{notice}</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}

          {!active ? (
            <Empty
              title="选择或创建一个知识库"
              hint="创建后上传 Markdown，对话里会按标题切片检索并带引用。"
              action={canWrite ? { label: "新建知识库", onClick: () => setCreateOpen(true) } : undefined}
            />
          ) : (
            <>
              <KnowledgePanelHeader
                active={active}
                canWrite={canWrite}
                uploading={uploading}
                pasteOpen={pasteOpen}
                onTogglePaste={() => setPasteOpen((open) => !open)}
                onFiles={(files) => void uploadFiles(files)}
              />

              <Tabs
                ariaLabel="知识库视图"
                value={tab}
                onChange={setTab}
                items={[
                  { key: "docs", label: "文档", testId: "kb-tab-docs" },
                  { key: "retrieval", label: "检索测试", testId: "kb-tab-retrieval" },
                ]}
              />

              {tab === "docs" ? (
                <KnowledgeDocs
                  docs={docs}
                  loading={docsQuery.isLoading}
                  error={docsQuery.isError}
                  onRetry={() => void docsQuery.refetch()}
                  canWrite={canWrite}
                  uploading={uploading}
                  docSearch={docSearch}
                  onDocSearch={setDocSearch}
                  docView={docView}
                  onDocView={setDocView}
                  selected={selected}
                  onSelect={(docId, checked) => setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(docId);
                    else next.delete(docId);
                    return next;
                  })}
                  onSelectAll={(checked) =>
                    setSelected(checked ? new Set(docs.map((doc) => doc.docId)) : new Set())}
                  pasteOpen={pasteOpen}
                  onTogglePaste={() => setPasteOpen((open) => !open)}
                  onUploadFiles={(files) => void uploadFiles(files)}
                  onUploadText={async (name, text) => {
                    const doc = await upload.mutateAsync({ filename: name, content: text });
                    setNotice(`已上传 ${doc.filename}（${doc.chunkCount} 个切片）`);
                  }}
                  onPreview={setPreviewId}
                  onReindex={(doc) => reindexDoc.mutate(doc.docId, {
                    onSuccess: () => setNotice(`已重建 ${doc.filename} 的索引`),
                    onError: (err) => setError(messageOf(err)),
                  })}
                  onDelete={(doc) => deleteDoc.mutate(doc.docId, {
                    onSuccess: () => setNotice(`已删除 ${doc.filename}`),
                    onError: (err) => setError(messageOf(err)),
                  })}
                  onBatchReindex={() => void batchReindex()}
                  onBatchDelete={() => void batchDelete()}
                  onClearSelection={() => setSelected(new Set())}
                />
              ) : (
                <RetrievalPanel
                  active={active}
                  query={query}
                  onQuery={setQuery}
                  mode={mode}
                  onMode={setMode}
                  running={search.isPending}
                  onSearch={(event) => void runSearch(event)}
                  result={result}
                  latencyMs={lastLatencyMs}
                />
              )}
            </>
          )}
        </section>
      </div>

      <KnowledgeOverlays
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
        createPending={createKb.isPending}
        onCreate={async (body) => {
          const kb = await createKb.mutateAsync(body);
          selectKb(kb.kbId);
          setNotice(`已创建知识库 ${kb.name}`);
        }}
        editTarget={editTarget}
        onEditClose={() => setEditTarget(null)}
        updatePending={updateKb.isPending}
        onEditSave={async (input) => {
          const kb = await updateKb.mutateAsync(input);
          setNotice(`已保存 ${kb.name}`);
        }}
        settingsOpen={settingsOpen}
        active={active}
        onSettingsClose={() => setSettingsOpen(false)}
        reindexPending={reindex.isPending}
        deletePending={deleteKb.isPending}
        onReindex={() => {
          if (!active) return;
          reindex.mutate(active.kbId, {
            onSuccess: () => setNotice("索引已重建"),
            onError: (err) => setError(messageOf(err)),
          });
        }}
        onRequestDelete={() => {
          if (active) setPendingKbDelete(active);
        }}
        deleteTarget={pendingKbDelete}
        onDeleteTarget={setPendingKbDelete}
        onConfirmDelete={() => void confirmKbDelete()}
        previewId={previewId}
        previewFile={previewQuery.data?.doc.filename}
        previewLoading={previewQuery.isLoading}
        previewChunks={previewQuery.data?.chunks ?? []}
        onPreviewClose={() => setPreviewId(null)}
        canWrite={canWrite}
      />

    </PageShell>
  );
}
