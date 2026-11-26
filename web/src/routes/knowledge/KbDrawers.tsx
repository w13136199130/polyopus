import { useEffect, useState } from "react";
import { Button, Drawer, Switch } from "@/components/ui";
import type { KnowledgeBaseRow } from "@/lib/api/wire";
import styles from "./KbDrawers.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function CreateKbDrawer({
  open,
  onOpenChange,
  canWrite,
  pending,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  pending: boolean;
  onCreate: (body: { name: string; description?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onCreate({ name: name.trim(), description: description.trim() || undefined });
      onOpenChange(false);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="新建知识库"
      description="创建后上传 Markdown，对话里按标题切片检索并带引用。"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type="submit"
            form="kb-create-form"
            data-testid="kb-create"
            loading={pending}
            disabled={!canWrite || !name.trim()}
          >
            创建知识库
          </Button>
        </>
      }
    >
      <form id="kb-create-form" className={styles.form} onSubmit={(event) => void submit(event)}>
        {error ? <div className={styles.error}>{error}</div> : null}
        <label className={styles.field}>
          <span>名称 *</span>
          <input
            data-testid="kb-name"
            required
            maxLength={120}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：运维手册"
          />
        </label>
        <label className={styles.field}>
          <span>描述</span>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="这个知识库放什么、给谁用"
          />
        </label>
      </form>
    </Drawer>
  );
}

export function EditKbDrawer({
  kb,
  onClose,
  canWrite,
  pending,
  onSave,
}: {
  kb: KnowledgeBaseRow | null;
  onClose: () => void;
  canWrite: boolean;
  pending: boolean;
  onSave: (input: { kbId: string; name: string; description?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kb) return;
    setName(kb.name);
    setDescription(kb.description ?? "");
    setError(null);
  }, [kb]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!kb) return;
    setError(null);
    try {
      await onSave({
        kbId: kb.kbId,
        name: name.trim(),
        description: description.trim(),
      });
      onClose();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <Drawer
      open={kb !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="编辑知识库"
      description={kb?.kbId}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            type="submit"
            form="kb-edit-form"
            data-testid="kb-edit-save"
            loading={pending}
            disabled={!canWrite || !name.trim()}
          >
            保存
          </Button>
        </>
      }
    >
      <form id="kb-edit-form" className={styles.form} onSubmit={(event) => void submit(event)}>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.iconRow} aria-hidden="true">
          <span className={`${styles.iconOption} ${styles.iconOn}`}>▤</span>
          <span className={styles.iconOption}>◫</span>
          <span className={styles.iconOption}>▦</span>
          <span className={styles.iconOption}>✎</span>
        </div>
        <p className={styles.hint}>图标选择随 v1.1 持久化；当前只保存名称与描述。</p>
        <label className={styles.field}>
          <span>名称 *</span>
          <input
            data-testid="kb-edit-name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>描述</span>
          <textarea
            data-testid="kb-edit-desc"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>文档数量上限</span>
          <input type="number" value={1000} disabled />
        </label>
        <div className={styles.inline}>
          <span>默认启用</span>
          <Switch checked={false} disabled label="默认启用（v1.1）" onChange={() => undefined} />
        </div>
        <label className={styles.field}>
          <span>谁可以使用</span>
          <select disabled>
            <option>全实例成员</option>
          </select>
        </label>
      </form>
    </Drawer>
  );
}

export function KbSettingsDrawer({
  kb,
  onClose,
  canWrite,
  reindexPending,
  deletePending,
  onReindex,
  onDelete,
}: {
  kb: KnowledgeBaseRow | null;
  onClose: () => void;
  canWrite: boolean;
  reindexPending: boolean;
  deletePending: boolean;
  onReindex: () => void;
  onDelete: () => void;
}) {
  return (
    <Drawer
      open={kb !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="知识库设置"
      description={kb?.name}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="kb-reindex"
            disabled={!canWrite}
            loading={reindexPending}
            onClick={onReindex}
          >
            重建索引
          </Button>
        </>
      }
    >
      {kb ? (
        <div className={styles.sections}>
          <section className={styles.section}>
            <h4>概览</h4>
            <dl className={styles.stats}>
              <dt>文档数</dt><dd>{kb.docCount}</dd>
              <dt>切片数</dt><dd>{kb.chunkCount}</dd>
              <dt>创建时间</dt>
              <dd>{new Date(kb.createdAt * 1000).toLocaleString("zh-CN")}</dd>
            </dl>
          </section>

          <section className={styles.section}>
            <h4>启用与模型</h4>
            <div className={styles.inline}>
              <span>启用知识库</span>
              <Switch checked disabled label="启用知识库（v1.1）" onChange={() => undefined} />
            </div>
            <div className={styles.inline}>
              <span>向量模型</span>
              <span className={styles.pill}>本地 ONNX · 随 v1.1</span>
            </div>
            <div className={styles.inline}>
              <span>OCR</span>
              <Switch checked={false} disabled label="OCR（v1.1）" onChange={() => undefined} />
            </div>
          </section>

          <section className={styles.section}>
            <h4>切片与限制</h4>
            <div className={styles.grid2}>
              <label className={styles.field}><span>切片大小</span><input value={512} disabled /></label>
              <label className={styles.field}><span>重叠</span><input value={64} disabled /></label>
              <label className={styles.field}><span>文档上限</span><input value={1000} disabled /></label>
              <label className={styles.field}><span>单文件上限</span><input value="20 MB" disabled /></label>
            </div>
          </section>

          <section className={styles.section}>
            <h4>检索与共享</h4>
            <label className={styles.field}>
              <span>检索模式</span>
              <select disabled>
                <option>lexical（FTS5 · BM25）</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>共享范围</span>
              <select disabled>
                <option>仅自己</option>
              </select>
            </label>
            <p className={styles.hint}>以上设置依赖知识库设置接口，随 v1.1 接入；当前仅名称与描述可改。</p>
          </section>

          <section className={`${styles.section} ${styles.dangerZone}`}>
            <h4>危险区</h4>
            <p>删除知识库会移除其全部文档与切片，不可撤销。</p>
            <Button
              size="sm"
              variant="danger"
              data-testid="kb-delete"
              disabled={!canWrite}
              loading={deletePending}
              onClick={onDelete}
            >
              删除知识库
            </Button>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
