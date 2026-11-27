/** Admin → 模型配置 · 对话模型：model pool, provider table, probe and drawer. */

import { useEffect, useRef, useState } from "react";
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

function statusTone(status: string): string {
  if (status === "authorized") return styles.badgeGreen;
  if (status === "error") return styles.badgeRed;
  return styles.badgeNeutral;
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

function providerSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    || "provider";
}

function SearchIcon() {
  return (
    <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function AdminChatModelsPanel({
  onNotice, onError, createSignal,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  createSignal: number;
}) {
  const query = useProviders();
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const remove = useDeleteProvider();
  const probe = useProbeProvider();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(formOf(null));
  const [deleting, setDeleting] = useState<ProviderRow | null>(null);
  const [focusModels, setFocusModels] = useState(false);

  const seenCreate = useRef(createSignal);
  useEffect(() => {
    if (createSignal === seenCreate.current) return;
    seenCreate.current = createSignal;
    setForm(formOf(null));
    setFocusModels(false);
    setCreating(true);
  }, [createSignal]);

  const env = query.data?.env;
  const providers = query.data?.items ?? [];
  const filtered = providers.filter((row) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [row.name, row.kind, row.baseUrl, ...row.models.map((model) => model.name)]
      .some((value) => value.toLowerCase().includes(needle));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Mirrors /models + Registry: the first enabled model of the first usable
  // provider (error providers are skipped).
  const usable = providers.find(
    (row) => row.status !== "error" && row.models.some((model) => model.enabled),
  );
  const effective = env?.configured
    ? {
      name: env.modelName ?? "环境变量模型",
      meta: `OpenAI 兼容 · ${env.baseUrl ?? "—"}`,
      status: "已授权",
      tone: styles.badgeGreen,
    }
    : usable
      ? {
        name: usable.models.find((model) => model.enabled)?.name ?? usable.name,
        meta: `${usable.name} · ${usable.baseUrl}`,
        status: statusLabel(usable.status),
        tone: statusTone(usable.status),
      }
      : null;

  function openCreate() {
    setForm(formOf(null));
    setFocusModels(false);
    setCreating(true);
  }

  function openEdit(row: ProviderRow, models = false) {
    setForm(formOf(row));
    setFocusModels(models);
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

  const pool = env?.configured
    ? [{
      provider: "环境变量",
      names: [env.modelName ?? "环境默认模型"],
      configured: env.configured,
    }]
    : providers.filter((row) => row.status !== "error").map((row) => ({
      provider: row.name,
      names: row.models.filter((model) => model.enabled).map((model) => model.name),
      configured: row.configured,
    })).filter((group) => group.names.length > 0);
  const poolCount = pool.reduce((sum, group) => sum + group.names.length, 0);
  const defaultModel = env?.configured
    ? (env.modelName ?? "环境默认模型")
    : usable?.models.find((model) => model.enabled)?.name;

  return (
    <div className={styles.page}>
      <section className={styles.currentCard} data-testid="provider-current">
        <div>
          <span>当前生效</span>
          <b>{effective?.name ?? "尚未配置模型"}</b>
          <small>{effective?.meta ?? "添加 provider 后，对话 Composer 会显示可用模型。"}</small>
        </div>
        {effective ? (
          <span className={`${styles.badge} ${effective.tone}`}>{effective.status}</span>
        ) : null}
      </section>

      <section className={styles.poolCard} data-testid="model-pool">
        <div className={styles.poolHead}>
          <b>可用模型池</b>
          <span>{poolCount} 个可用模型</span>
          <span className={styles.spacer} />
          <span className={styles.muted}>默认模型取运行队列的首个可用模型</span>
        </div>
        {pool.length === 0 ? (
          <p className={styles.muted}>还没有可用模型；在下方添加 provider 并填写模型名。</p>
        ) : (
          <div className={styles.poolGroups}>
            {pool.map((group) => (
              <div key={group.provider} className={styles.poolGroup}>
                <span className={styles.poolName}>
                  {group.provider}
                  {!group.configured ? <em>· 未配置凭证</em> : null}
                </span>
                <div className={styles.modelChips}>
                  {group.names.map((name) => (
                    <span key={name} className={styles.modelChip}>
                      {name}
                      {name === defaultModel ? <i className={styles.defaultTag}>默认</i> : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {env?.configured ? (
        <div className={`${styles.alert} ${styles.alertWarn}`} data-testid="provider-env-warning">
          环境变量 provider 已启用（{env.modelName ?? "默认模型"}）；下面的数据库 provider 会被忽略，用于保留配置。
        </div>
      ) : (
        <p className={styles.muted}>{env?.note}</p>
      )}

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <SearchIcon />
            <input
              data-testid="provider-search"
              placeholder="搜索提供商或模型"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </div>
          <span className={styles.count}>共 {filtered.length} 条</span>
          <span className={styles.spacer} />
          <Button size="sm" variant="outline" disabled title="列设置随 v1.1">
            列
          </Button>
        </div>

        {query.isLoading ? <Loading label="载入 provider…" /> : query.isError ? (
          <ErrorState message="provider 加载失败" onRetry={() => void query.refetch()} />
        ) : providers.length === 0 ? (
          <Empty
            title="还没有配置 provider"
            hint="添加 OpenAI 兼容地址与模型；未配置时使用 FakeModel。"
            action={{ label: "添加供应商", onClick: openCreate }}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>提供商</th><th>ID</th><th>模型</th><th>状态</th><th>凭证</th>
                  <th style={{ textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, index) => (
                  <tr key={row.providerId} data-testid="provider-row">
                    <td>
                      <div className={styles.providerCell}>
                        <span className={`${styles.providerIcon} ${styles[`icon${index % 4}`]}`}>
                          {row.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className={styles.providerMeta}>
                          <b>{row.name}</b>
                          <span>{row.baseUrl}</span>
                        </div>
                      </div>
                    </td>
                    <td className={styles.mono} title={row.providerId}>{providerSlug(row.name)}</td>
                    <td>
                      <div className={styles.modelChips}>
                        {row.models.length ? row.models.map((model) => (
                          <span key={model.modelId} className={styles.modelChip}>{model.name}</span>
                        )) : <span className={styles.muted}>没有模型</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${statusTone(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${
                        row.configured ? styles.badgeGreen : styles.badgeNeutral
                      }`}>
                        {row.configured ? "已配置" : "未配置"}
                      </span>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
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
                          测试
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(row, true)}>
                          管理模型
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.pager}>
              <span>第 {currentPage} / {totalPages} 页</span>
              <span className={styles.spacer} />
              <select
                data-testid="provider-page-size"
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
              >
                <option value={6}>6</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
              </select>
              <span>条 / 页</span>
              <Button size="sm" variant="ghost" disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}>
                上一页
              </Button>
              <Button size="sm" variant="ghost" disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </section>

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
            {editing ? (
              <Button
                variant="ghost"
                className={styles.danger}
                data-testid="provider-delete"
                onClick={() => setDeleting(editing)}
              >
                删除
              </Button>
            ) : null}
            <span className={styles.spacer} />
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
              autoFocus={focusModels}
              rows={4}
              value={form.models}
              onChange={(event) => setForm({ ...form, models: event.target.value })}
            />
          </label>
          <p className={styles.muted}>
            保存后模型会出现在对话 Composer 的模型菜单中；测试会发起一次最小请求。
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
                    setEditing(null);
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
        <p className={styles.muted}>确定删除「{deleting?.name}」？</p>
      </Dialog>
    </div>
  );
}
