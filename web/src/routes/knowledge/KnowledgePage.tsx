/**
 * Knowledge page (P1-5): KB chips + 文档/检索测试/设置 tabs.
 * Upload accepts real files (.md/.markdown/.txt, click or drag) and keeps a
 * paste path for quick text; preview opens the chunk drawer; the doc table
 * supports batch delete.
 */

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, Drawer, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import { knowledge } from "@/lib/api/endpoints";
import type { KnowledgeSearchResult } from "@/lib/api/wire";
import {
  useCreateKb,
  useDeleteDoc,
  useDeleteKb,
  useKnowledgeBases,
  useKnowledgeDocs,
  useReindexDoc,
  useReindexKb,
  useSearchKb,
  useUploadDoc,
} from "@/features/knowledge/api";
import styles from "./KnowledgePage.module.css";

const TEXT_EXT = /\.(md|markdown|txt)$/i;
type Tab = "docs" | "retrieval" | "settings";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function KnowledgePage() {
  const canWrite = useCan("knowledge:write");
  const kbsQuery = useKnowledgeBases();
  const [activeKb, setActiveKb] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("docs");

  const kbs = kbsQuery.data?.items ?? [];
  const kbId = activeKb ?? kbs[0]?.kbId ?? null;
  const active = kbs.find((row) => row.kbId === kbId) ?? null;

  const docsQuery = useKnowledgeDocs(kbId);
  const docs = docsQuery.data?.items ?? [];

  const createKb = useCreateKb();
  const deleteKb = useDeleteKb();
  const upload = useUploadDoc(kbId ?? "");
  const deleteDoc = useDeleteDoc(kbId ?? "");
  const reindex = useReindexKb();
  const reindexDoc = useReindexDoc(kbId ?? "");
  const search = useSearchKb(kbId ?? "");

  const [newKbName, setNewKbName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [filename, setFilename] = useState("notes.md");
  const [content, setContent] = useState("# 标题\n## 小节\n内容。\n");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("lexical"); // dense/hybrid 待 v1.1 向量层
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [result, setResult] = useState<KnowledgeSearchResult | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pendingKbDelete, setPendingKbDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const previewQuery = useQuery({
    queryKey: ["knowledge-preview", previewId],
    queryFn: () => knowledge.preview(previewId as string),
    enabled: previewId !== null,
  });

  const allSelected = docs.length > 0 && selected.size === docs.length;
  const uploading = useMemo(() => upload.isPending, [upload.isPending]);

  async function submitKb(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const kb = await createKb.mutateAsync({ name: newKbName.trim() });
      setActiveKb(kb.kbId);
      setNewKbName("");
      setNotice(`已创建知识库 ${kb.name}`);
    } catch (err) {
      setError(messageOf(err));
    }
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
        await upload.mutateAsync({
          filename: file.name, content: await file.text(),
        });
        done += 1;
      } catch (err) {
        setError(messageOf(err));
      }
    }
    if (done) setNotice(`已上传 ${done} 个文档`);
  }

  async function submitPaste(event: React.FormEvent) {
    event.preventDefault();
    if (!kbId || !filename.trim() || !content.trim()) return;
    setError(null);
    try {
      const doc = await upload.mutateAsync({
        filename: filename.trim(), content,
      });
      setNotice(`已上传 ${doc.filename}（${doc.chunkCount} 个切片）`);
    } catch (err) {
      setError(messageOf(err));
    }
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

  async function confirmKbDelete() {
    if (!active) return;
    setError(null);
    try {
      await deleteKb.mutateAsync(active.kbId);
      setActiveKb(null);
      setTab("docs");
      setNotice(`已删除 ${active.name}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPendingKbDelete(false);
    }
  }

  return (
    <PageShell title="知识" subtitle="Markdown 按标题切片；检索命中带文档与标题引用。">
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.kbRow}>
          {kbsQuery.isLoading ? <Loading label="载入知识库…" /> : kbs.length === 0 ? (
            <span className={styles.muted}>暂无知识库</span>
          ) : kbs.map((kb) => (
            <button
              key={kb.kbId}
              type="button"
              data-testid="kb-select"
              className={`${styles.chip} ${kb.kbId === kbId ? styles.chipActive : ""}`}
              onClick={() => { setActiveKb(kb.kbId); setSelected(new Set()); setResult(null); }}
            >
              {kb.name}
              <span>{kb.docCount} 文档 / {kb.chunkCount} 切片</span>
            </button>
          ))}
          <form className={styles.newKb} onSubmit={(event) => void submitKb(event)}>
            <input
              data-testid="kb-name"
              required
              maxLength={120}
              placeholder="新知识库名称"
              value={newKbName}
              onChange={(event) => setNewKbName(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              data-testid="kb-create"
              disabled={!canWrite || !newKbName.trim()}
              loading={createKb.isPending}
            >
              创建知识库
            </Button>
          </form>
        </div>

        {kbId ? (
          <>
            <div className={styles.tabs} role="tablist" aria-label="知识库视图">
              {([["docs", "文档"], ["retrieval", "检索测试"], ["settings", "设置"]] as const)
                .map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    data-testid={`kb-tab-${key}`}
                    className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
            </div>

            {tab === "docs" ? (
              <>
                <div
                  className={`${styles.upload} ${dragOver ? styles.uploadDrag : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    void uploadFiles(event.dataTransfer.files);
                  }}
                >
                  <span className={styles.uploadTitle}>上传文档</span>
                  <span className={styles.uploadHint}>
                    拖拽 .md / .markdown / .txt 到这里，或
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button
                      size="sm"
                      data-testid="kb-pick-files"
                      disabled={!canWrite || uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      选择文件
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="kb-paste-toggle"
                      disabled={!canWrite}
                      onClick={() => setPasteOpen((open) => !open)}
                    >
                      {pasteOpen ? "收起粘贴" : "粘贴文本"}
                    </Button>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".md,.markdown,.txt"
                    multiple
                    data-testid="kb-file-input"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        void uploadFiles(event.target.files);
                      }
                      event.target.value = "";
                    }}
                  />
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
                      <label style={{ flex: 1 }}>Markdown
                        <textarea
                          data-testid="doc-content"
                          required
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                        />
                      </label>
                      <Button
                        type="submit"
                        size="sm"
                        data-testid="doc-upload"
                        disabled={!canWrite || uploading}
                        loading={uploading}
                      >
                        上传文档
                      </Button>
                    </form>
                  ) : null}
                </div>

                {selected.size > 0 ? (
                  <div className={styles.batchBar}>
                    已选 {selected.size} 项
                    <Button size="sm" variant="danger" data-testid="doc-batch-delete"
                      disabled={!canWrite}
                      onClick={() => void batchDelete()}>
                      批量删除
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                      取消选择
                    </Button>
                  </div>
                ) : null}

                {docsQuery.isLoading ? <Loading label="载入文档…" /> : docsQuery.isError ? (
                  <ErrorState message="文档加载失败" onRetry={() => void docsQuery.refetch()} />
                ) : docs.length === 0 ? (
                  <Empty title="暂无文档" hint="上传一个 Markdown 文件开始。" />
                ) : (
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
                              onChange={(event) =>
                                setSelected(event.target.checked
                                  ? new Set(docs.map((doc) => doc.docId))
                                  : new Set())}
                            />
                          </th>
                          <th>文件名</th>
                          <th>切片</th>
                          <th>状态</th>
                          <th>上传时间</th>
                          <th style={{ width: 120 }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((doc) => (
                          <tr key={doc.docId} className={styles.rowSel}>
                            <td>
                              <input
                                type="checkbox"
                                data-testid="doc-checkbox"
                                aria-label={`选择 ${doc.filename}`}
                                checked={selected.has(doc.docId)}
                                disabled={!canWrite}
                                onChange={(event) =>
                                  setSelected((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(doc.docId);
                                    else next.delete(doc.docId);
                                    return next;
                                  })}
                              />
                            </td>
                            <td className={styles.mono}>{doc.filename}</td>
                            <td>{doc.chunkCount}</td>
                            <td>
                              <span className={`${styles.statusChip} ${
                                doc.status === "ready" ? styles.statusReady
                                  : doc.status === "failed" ? styles.statusFailed
                                    : styles.statusPending
                              }`}>
                                {doc.status}
                              </span>
                            </td>
                            <td className={styles.muted}>
                              {new Date(doc.createdAt * 1000).toLocaleString("zh-CN")}
                            </td>
                            <td>
                              <Button size="sm" variant="ghost" data-testid="doc-preview"
                                onClick={() => setPreviewId(doc.docId)}>
                                预览
                              </Button>
                              <Button size="sm" variant="ghost" data-testid="doc-reindex"
                                disabled={!canWrite}
                                loading={reindexDoc.isPending && reindexDoc.variables === doc.docId}
                                onClick={() => reindexDoc.mutate(doc.docId, {
                                  onSuccess: () => setNotice(`已重建 ${doc.filename} 的索引`),
                                  onError: (err) => setError(messageOf(err)),
                                })}>
                                重建
                              </Button>
                              <Button size="sm" variant="danger"
                                disabled={!canWrite}
                                onClick={() => deleteDoc.mutate(doc.docId, {
                                  onError: (err) => setError(messageOf(err)),
                                })}>
                                删除
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : null}

            {tab === "retrieval" ? (
              <>
                <form className={styles.searchRow} onSubmit={(event) => void runSearch(event)}>
                  <input
                    data-testid="kb-query"
                    placeholder="用一句话提问，例如：备份保留几份"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <select
                    aria-label="检索模式"
                    data-testid="kb-mode"
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                    className={styles.modeSelect}
                  >
                    <option value="lexical">lexical（FTS5 · BM25）</option>
                    <option value="dense" disabled>dense（v1.1 向量）</option>
                    <option value="hybrid" disabled>hybrid（v1.1）</option>
                  </select>
                  <Button type="submit" data-testid="kb-search"
                    disabled={!query.trim()} loading={search.isPending}>
                    检索
                  </Button>
                </form>

                {/* 检索链路 chips（knowledge-debug 原型） */}
                {result ? (
                  <div className={styles.pipeline} data-testid="kb-pipeline">
                    <span className={styles.pipeChip}>top-k {result.hits.length}</span>
                    <span className={styles.pipeChip}>候选 {active?.chunkCount ?? 0} chunks</span>
                    <span className={styles.pipeChip}>rerank 无（lexical）</span>
                    {lastLatencyMs !== null ? (
                      <span className={`${styles.pipeChip} ${styles.pipeGreen}`}>
                        {lastLatencyMs}ms
                      </span>
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
                      不是"没有文档"：当前库 {active?.docCount ?? 0} 文档 / {active?.chunkCount ?? 0} 切片；
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
                        <i style={{
                          width: `${Math.min(100, Math.max(0, Math.round(Math.abs(hit.score) * 8)))}%`,
                        }} />
                      </div>
                    </div>
                  ))
                ) : null}
              </>
            ) : null}

            {tab === "settings" && active ? (
              <>
                <dl className={styles.settingsGrid}>
                  <dt>知识库</dt><dd>{active.name}</dd>
                  <dt>文档数</dt><dd>{active.docCount}</dd>
                  <dt>切片数</dt><dd>{active.chunkCount}</dd>
                  <dt>创建时间</dt>
                  <dd>{new Date(active.createdAt * 1000).toLocaleString("zh-CN")}</dd>
                </dl>
                <Button
                  size="sm"
                  data-testid="kb-reindex"
                  disabled={!canWrite}
                  loading={reindex.isPending}
                  onClick={() => reindex.mutate(active.kbId, {
                    onSuccess: () => setNotice("索引已重建"),
                    onError: (err) => setError(messageOf(err)),
                  })}
                >
                  重建索引
                </Button>
                <div className={styles.dangerZone}>
                  <b style={{ fontSize: 13 }}>危险区</b>
                  <p>删除知识库会移除其全部文档与切片，不可撤销。</p>
                  <Button size="sm" variant="danger" data-testid="kb-delete"
                    disabled={!canWrite}
                    onClick={() => setPendingKbDelete(true)}>
                    删除知识库
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <Drawer
        open={previewId !== null}
        onOpenChange={(open) => { if (!open) setPreviewId(null); }}
        title="文档预览"
        description={previewQuery.data?.doc.filename}
        width={640}
      >
        {previewQuery.isLoading ? <Loading label="载入切片…" /> : (
          (previewQuery.data?.chunks ?? []).map((chunk) => (
            <div key={chunk.idx} className={styles.chunk}>
              <h4>#{chunk.idx} {chunk.heading || "正文"}</h4>
              <pre>{chunk.content}</pre>
            </div>
          ))
        )}
      </Drawer>

      <Dialog
        open={pendingKbDelete}
        onOpenChange={setPendingKbDelete}
        title="确认删除知识库"
        description={active ? `将删除「${active.name}」及其全部文档与切片。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingKbDelete(false)}>取消</Button>
            <Button variant="danger" data-testid="confirm-kb-delete"
              loading={deleteKb.isPending}
              onClick={() => void confirmKbDelete()}>
              确认删除
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          此操作不可撤销；检索将立即失效。
        </p>
      </Dialog>
    </PageShell>
  );
}
