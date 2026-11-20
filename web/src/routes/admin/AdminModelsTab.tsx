import { useState } from "react";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import type { ProviderRow } from "@/lib/api/wire";
import {
  useCreateProvider,
  useDeleteProvider,
  useProbeProvider,
  useProviders,
  useUpdateProvider,
} from "@/features/admin/api";
import styles from "./AdminConfig.module.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function statusLabel(status: string): string {
  if (status === "authorized") return "已授权";
  if (status === "error") return "连接失败";
  return "未探测";
}

interface FormState {
  providerId: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
}

function formOf(row: ProviderRow | null): FormState {
  return {
    providerId: row?.providerId ?? null,
    name: row?.name ?? "",
    baseUrl: row?.baseUrl ?? "https://api.deepseek.com/v1",
    apiKey: "",
    models: row ? row.models.map((model) => model.name).join(", ") : "deepseek-chat",
  };
}

export function AdminModelsTab({
  onNotice, onError,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const query = useProviders();
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const remove = useDeleteProvider();
  const probe = useProbeProvider();
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(formOf(null));
  const [deleting, setDeleting] = useState<ProviderRow | null>(null);

  const env = query.data?.env;
  const providers = query.data?.items ?? [];

  function openCreate() {
    setForm(formOf(null));
    setCreating(true);
  }

  function openEdit(row: ProviderRow) {
    setForm(formOf(row));
    setEditing(row);
  }

  function save() {
    onError("");
    if (!form.name.trim() || !form.baseUrl.trim()) {
      onError("名称与 Base URL 不能为空");
      return;
    }
    const models = form.models
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (editing) {
      update.mutate(
        {
          providerId: editing.providerId,
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          models,
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        },
        {
          onSuccess: () => {
            setEditing(null);
            onNotice(`已保存 provider「${form.name.trim()}」`);
          },
          onError: (error) => onError(messageOf(error)),
        },
      );
    } else {
      create.mutate(
        {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey,
          models,
        },
        {
          onSuccess: () => {
            setCreating(false);
            onNotice(`已添加 provider「${form.name.trim()}」`);
          },
          onError: (error) => onError(messageOf(error)),
        },
      );
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2>模型配置</h2>
        <span>OpenAI 兼容 provider；API Key 加密保存且不回显</span>
        <span className={styles.spacer} />
        <Button size="sm" data-testid="provider-new" onClick={openCreate}>
          ＋ 添加 Provider
        </Button>
      </div>

      {env?.configured ? (
        <div className={styles.warning} data-testid="provider-env-warning">
          环境变量 provider 已启用（{env.modelName ?? "默认模型"} · {env.baseUrl}）。
          当前对话引擎优先使用 env，下表中的数据库 provider 会被忽略。
        </div>
      ) : (
        <p className={styles.muted}>{env?.note}</p>
      )}

      {query.isLoading ? (
        <Loading label="载入 provider…" />
      ) : query.isError ? (
        <ErrorState message="provider 加载失败" onRetry={() => void query.refetch()} />
      ) : providers.length === 0 ? (
        <Empty
          title="还没有配置 provider"
          hint="添加 OpenAI 兼容地址与模型；未配置时使用 FakeModel。"
          action={{ label: "添加 Provider", onClick: openCreate }}
        />
      ) : (
        <div className={styles.cards}>
          {providers.map((row) => (
            <article key={row.providerId} className={styles.card} data-testid="provider-card">
              <div className={styles.cardHead}>
                <span className={styles.avatar}>{row.name.slice(0, 1).toUpperCase()}</span>
                <div className={styles.identity}>
                  <div className={styles.nameRow}>
                    <b>{row.name}</b>
                    <span className={`${styles.badge} ${
                      row.status === "authorized" ? styles.green
                        : row.status === "error" ? styles.red : styles.neutral
                    }`}>
                      {statusLabel(row.status)}
                    </span>
                  </div>
                  <span className={styles.meta}>{row.kind} · {row.baseUrl}</span>
                </div>
              </div>
              <div className={styles.modelChips}>
                {row.models.length ? row.models.map((model) => (
                  <span key={model.modelId} className={styles.modelChip}>{model.name}</span>
                )) : <span className={styles.muted}>没有模型</span>}
              </div>
              <div className={styles.cardActions}>
                <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
                  配置
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="provider-probe"
                  loading={probe.isPending}
                  onClick={() => probe.mutate(row.providerId, {
                    onSuccess: (result) =>
                      result.ok
                        ? onNotice(`${row.name} 连接正常 · ${result.detail}`)
                        : onError(`${row.name}: ${result.detail}`),
                    onError: (error) => onError(messageOf(error)),
                  })}
                >
                  测试连接
                </Button>
                <span className={styles.spacer} />
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.danger}
                  onClick={() => setDeleting(row)}
                >
                  删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        title={editing ? "配置 Provider" : "添加 Provider"}
        description="OpenAI 兼容接口；模型用逗号或换行分隔。"
        width={560}
        footer={
          <>
            <Button variant="secondary" onClick={() => {
              setCreating(false);
              setEditing(null);
            }}>
              取消
            </Button>
            <Button
              data-testid="provider-save"
              loading={create.isPending || update.isPending}
              onClick={save}
            >
              保存
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <label className={styles.field}>
            名称
            <input
              data-testid="provider-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            Base URL
            <input
              data-testid="provider-base"
              className={styles.mono}
              value={form.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            API Key
            <input
              data-testid="provider-key"
              type="password"
              value={form.apiKey}
              placeholder={editing?.configured ? "已保存；留空保持不变" : "sk-…"}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            模型（逗号或换行分隔）
            <textarea
              data-testid="provider-models"
              rows={4}
              value={form.models}
              onChange={(event) => setForm({ ...form, models: event.target.value })}
            />
          </label>
          <p className={styles.muted}>
            保存后模型会出现在对话 Composer 的模型菜单中；测试连接会发起一次最小请求。
          </p>
        </div>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="删除 Provider"
        description="该 provider 下的模型配置会一并删除；进行中的会话不受影响。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>取消</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.providerId, {
                  onSuccess: () => {
                    onNotice(`已删除 provider「${deleting.name}」`);
                    setDeleting(null);
                  },
                  onError: (error) => onError(messageOf(error)),
                });
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <p>确定删除「{deleting?.name}」？</p>
      </Dialog>
    </section>
  );
}
