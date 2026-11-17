/** Knowledge page: KB CRUD, markdown upload, preview and retrieval (V1-13). */

import { useState } from "react";
import { Button, Empty, ErrorState, Loading } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import { useCan } from "@/lib/auth/permissions";
import type { KnowledgeSearchResult } from "@/lib/api/wire";
import {
  useCreateKb,
  useDeleteDoc,
  useDeleteKb,
  useKnowledgeBases,
  useKnowledgeDocs,
  useSearchKb,
  useUploadDoc,
} from "@/features/knowledge/api";
import styles from "./KnowledgePage.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function KnowledgePage() {
  const canWrite = useCan("knowledge:write");
  const kbsQuery = useKnowledgeBases();
  const [selected, setSelected] = useState<string | null>(null);
  const [kbName, setKbName] = useState("");
  const [filename, setFilename] = useState("notes.md");
  const [content, setContent] = useState("# 标题\n## 小节\n内容。\n");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<KnowledgeSearchResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kbs = kbsQuery.data?.items ?? [];
  const activeKb = selected ?? kbs[0]?.kbId ?? null;
  const docsQuery = useKnowledgeDocs(activeKb);
  const createKb = useCreateKb();
  const deleteKb = useDeleteKb();
  const upload = useUploadDoc(activeKb ?? "");
  const deleteDoc = useDeleteDoc(activeKb ?? "");
  const search = useSearchKb(activeKb ?? "");

  async function submitKb(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const kb = await createKb.mutateAsync({ name: kbName.trim() });
      setSelected(kb.kbId);
      setKbName("");
      setNotice(`已创建知识库 ${kb.name}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function submitDoc(event: React.FormEvent) {
    event.preventDefault();
    if (!activeKb) return;
    setError(null);
    try {
      const doc = await upload.mutateAsync({ filename, content });
      setNotice(`已上传 ${doc.filename}（${doc.chunkCount} 个切片）`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!activeKb || !query.trim()) return;
    setError(null);
    try {
      setResult(await search.mutateAsync(query.trim()));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <PageShell title="知识" subtitle="Markdown 按标题切片；检索命中带文档与标题引用。">
      <div className={styles.page}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.panel}>
          <div className={styles.head}><h2>知识库</h2><span>{kbs.length} 个</span></div>
          {kbsQuery.isLoading ? <Loading label="载入知识库…" /> : kbsQuery.isError ? (
            <ErrorState message="知识库加载失败" onRetry={() => void kbsQuery.refetch()} />
          ) : kbs.length === 0 ? <Empty title="暂无知识库" /> : (
            <ul className={styles.rows}>
              {kbs.map((kb) => (
                <li key={kb.kbId} className={styles.row} data-testid="kb-row">
                  <div className={styles.who}>
                    <strong>{kb.name}</strong>
                    <span>{kb.docCount} 文档 · {kb.chunkCount} 切片</span>
                  </div>
                  <div className={styles.actions}>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(kb.kbId)}>
                      打开
                    </Button>
                    <Button size="sm" variant="danger" disabled={!canWrite}
                      onClick={() => deleteKb.mutate(kb.kbId, {
                        onSuccess: () => setNotice(`已删除 ${kb.name}`),
                        onError: (err) => setError(messageOf(err)),
                      })}>
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form className={styles.form} onSubmit={(event) => void submitKb(event)}>
            <label>名称<input data-testid="kb-name" required value={kbName}
              onChange={(event) => setKbName(event.target.value)} /></label>
            <Button type="submit" disabled={!canWrite} loading={createKb.isPending}
              data-testid="kb-create">创建知识库</Button>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>文档</h2></div>
          {kbs.length === 0 ? <div className={styles.empty}>先创建知识库</div> : (
            <>
              <select className={styles.select} data-testid="kb-select"
                value={activeKb ?? ""}
                onChange={(event) => { setSelected(event.target.value); setResult(null); }}>
                {kbs.map((kb) => (
                  <option key={kb.kbId} value={kb.kbId}>{kb.name}</option>
                ))}
              </select>
              {docsQuery.isLoading ? <Loading label="载入文档…" /> : (
                <ul className={styles.rows}>
                  {(docsQuery.data?.items ?? []).map((doc) => (
                    <li key={doc.docId} className={styles.row} data-testid="doc-row">
                      <div className={styles.who}>
                        <strong>{doc.filename}</strong>
                        <span>{doc.chunkCount} 切片 · {doc.status}</span>
                      </div>
                      <Button size="sm" variant="danger" disabled={!canWrite}
                        onClick={() => deleteDoc.mutate(doc.docId, {
                          onError: (err) => setError(messageOf(err)),
                        })}>
                        删除
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <form className={styles.form} onSubmit={(event) => void submitDoc(event)}>
                <label>文件名<input data-testid="doc-filename" required value={filename}
                  onChange={(event) => setFilename(event.target.value)} /></label>
                <label>Markdown
                  <textarea data-testid="doc-content" required value={content}
                    onChange={(event) => setContent(event.target.value)} />
                </label>
                <Button type="submit" disabled={!canWrite || !activeKb}
                  loading={upload.isPending} data-testid="doc-upload">上传文档</Button>
              </form>
            </>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.head}><h2>检索</h2></div>
          <form className={styles.form} onSubmit={(event) => void runSearch(event)}>
            <label>问题<input data-testid="kb-query" value={query}
              onChange={(event) => setQuery(event.target.value)} /></label>
            <Button type="submit" disabled={!activeKb || !query.trim()}
              loading={search.isPending} data-testid="kb-search">检索</Button>
          </form>
          {result ? result.status === "abstain" ? (
            <div className={styles.empty} data-testid="kb-abstain">
              {result.reason ?? "没有找到依据"}
            </div>
          ) : (
            <ul className={styles.rows}>
              {result.hits.map((hit) => (
                <li key={hit.chunkId} className={styles.hit} data-testid="kb-hit">
                  <strong>{hit.doc} · {hit.heading || "正文"}</strong>
                  <span>score {hit.score} · span {hit.span[0]}-{hit.span[1]}</span>
                  <p>{hit.content}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
