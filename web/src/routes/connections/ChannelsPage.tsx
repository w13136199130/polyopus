import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Dialog, Drawer, ErrorState, Loading, StatusTag, Switch } from "@/components/ui";
import { PageShell } from "@/layouts/PageShell";
import type { ChannelRow } from "@/lib/api/wire";
import {
  useChannels,
  useCreateChannel,
  useDeleteChannel,
  useProbeChannel,
  useUpdateChannel,
} from "@/features/channels/api";
import styles from "./ChannelsPage.module.css";

interface ChannelForm {
  displayName: string;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  approvers: string;
}

const EMPTY_FORM: ChannelForm = {
  displayName: "", appId: "", appSecret: "",
  verificationToken: "", encryptKey: "", approvers: "",
};

function formOf(row: ChannelRow): ChannelForm {
  return {
    displayName: row.displayName,
    appId: row.appId ?? "",
    appSecret: "",
    verificationToken: "",
    encryptKey: "",
    approvers: row.approvers.join(", "),
  };
}

function parseApprovers(value: string): string[] {
  return value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
}

const MORE_KINDS = [
  ["企业微信", "群机器人 / 应用消息", "v1.1"],
  ["钉钉", "群机器人与审批", "v1.1"],
  ["Telegram", "Bot API", "v1.1"],
];

/** 通道页：卡片网格 + 飞书配置抽屉 (docs/52 §10). */
export function ChannelsPage() {
  const channelsQuery = useChannels();
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const probeChannel = useProbeChannel();
  const deleteChannel = useDeleteChannel();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelRow | null>(null);
  const [deleting, setDeleting] = useState<ChannelRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = channelsQuery.data?.items ?? [];

  async function submitCreate(form: ChannelForm) {
    try {
      const created = await createChannel.mutateAsync({
        kind: "feishu",
        displayName: form.displayName.trim(),
        appId: form.appId.trim(),
        appSecret: form.appSecret,
        verificationToken: form.verificationToken || undefined,
        encryptKey: form.encryptKey || undefined,
        approvers: parseApprovers(form.approvers),
      });
      setCreateOpen(false);
      setNotice(`已创建飞书通道「${created.displayName}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建通道失败");
    }
  }

  async function submitEdit(form: ChannelForm) {
    if (!editing) return;
    try {
      const updated = await updateChannel.mutateAsync({
        channelId: editing.channelId,
        displayName: form.displayName.trim(),
        appId: form.appId.trim() || undefined,
        appSecret: form.appSecret || undefined,
        verificationToken: form.verificationToken || undefined,
        encryptKey: form.encryptKey || undefined,
        approvers: parseApprovers(form.approvers),
      });
      setEditing(null);
      setNotice(`已更新通道「${updated.displayName}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新通道失败");
    }
  }

  return (
    <PageShell
      title="通道"
      subtitle="飞书消息进入任务中心，审批结果可回到飞书；其他通道随 v1.1 接入。"
      actions={
        <>
          <Link to="/sources" className={styles.linkBtn}>Webhook 来源</Link>
          <Button
            size="sm"
            data-testid="channel-new"
            onClick={() => {
              setNotice(null);
              setError(null);
              setCreateOpen(true);
            }}
          >
            ＋ 新建通道
          </Button>
        </>
      }
    >
      <div className={styles.page}>
        {notice ? <button type="button" className={styles.notice} onClick={() => setNotice(null)}>{notice}</button> : null}
        {error ? <button type="button" className={styles.error} onClick={() => setError(null)}>{error}</button> : null}

        <div className={styles.count}>
          当前支持 <b>4</b> 个通道，已配置 <b>{items.length}</b> 个
        </div>

        {channelsQuery.isLoading ? (
          <Loading label="载入通道…" />
        ) : channelsQuery.isError ? (
          <ErrorState message="通道加载失败" onRetry={() => void channelsQuery.refetch()} />
        ) : (
          <div className={styles.grid}>
            {items.map((row) => (
              <article key={row.channelId} className={styles.card} data-testid="channel-row">
                <header className={styles.cardHead}>
                  <span className={styles.avatar}>飞</span>
                  <div className={styles.identity}>
                    <b>{row.displayName}</b>
                    <span>{row.appId ?? row.kind} · {row.channelId}</span>
                  </div>
                  <StatusTag
                    tone={row.status === "active" ? "green" : row.status === "error" ? "red" : "neutral"}
                  >
                    {row.status === "active" ? "已启用" : row.status === "error" ? "异常" : "已停用"}
                  </StatusTag>
                </header>
                <p className={styles.desc}>
                  群消息自动建单，审批结果回传飞书。
                </p>
                <div className={styles.approvers} data-testid="channel-approvers-view">
                  审批人：{row.approvers.length ? row.approvers.join("、") : "仅任务创建人"}
                </div>
                <div className={styles.url}>
                  <code>{window.location.origin}{row.webhookPath}</code>
                </div>
                {row.lastError ? <p className={styles.cardError}>{row.lastError}</p> : null}
                <div className={styles.actions}>
                  <Button size="sm" variant="outline" data-testid="channel-edit" onClick={() => setEditing(row)}>
                    配置
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={probeChannel.isPending}
                    onClick={() => probeChannel.mutate(row.channelId, {
                      onSuccess: () => setNotice(`已检测「${row.displayName}」`),
                      onError: (err) => setError(err instanceof Error ? err.message : "检测失败"),
                    })}
                  >
                    检测
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateChannel.mutate(
                      { channelId: row.channelId, status: row.status === "active" ? "disabled" : "active" },
                      { onError: (err) => setError(err instanceof Error ? err.message : "状态更新失败") },
                    )}
                  >
                    {row.status === "active" ? "停用" : "启用"}
                  </Button>
                  <span className={styles.spacer} />
                  <Button size="sm" variant="ghost" className={styles.danger} onClick={() => setDeleting(row)}>
                    删除
                  </Button>
                </div>
              </article>
            ))}

            <button type="button" className={styles.addCard} onClick={() => setCreateOpen(true)}>
              <span>＋</span>
              添加连接通道
            </button>

            {MORE_KINDS.map(([name, desc, tag]) => (
              <article key={name} className={`${styles.card} ${styles.disabledCard}`}>
                <header className={styles.cardHead}>
                  <span className={`${styles.avatar} ${styles.avatarMuted}`}>{name.slice(0, 1)}</span>
                  <div className={styles.identity}>
                    <b>{name}</b>
                    <span>{desc}</span>
                  </div>
                  <StatusTag tone="neutral">{tag}</StatusTag>
                </header>
                <p className={styles.desc}>当前版本只接入飞书；该通道随 v1.1 提供。</p>
                <div className={styles.actions}>
                  <Button size="sm" variant="ghost" disabled>暂不可用</Button>
                </div>
              </article>
            ))}
          </div>
        )}

      </div>

      <ChannelDrawer
        open={createOpen}
        row={null}
        pending={createChannel.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(form) => void submitCreate(form)}
      />
      <ChannelDrawer
        open={editing !== null}
        row={editing}
        pending={updateChannel.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(form) => void submitEdit(form)}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="删除飞书通道"
        description={deleting ? `将删除「${deleting.displayName}」及其回调绑定。` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="channel-delete-confirm"
              loading={deleteChannel.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteChannel.mutate(deleting.channelId, {
                  onSuccess: () => {
                    setNotice(`已删除通道「${deleting.displayName}」`);
                    setDeleting(null);
                  },
                  onError: (err) => setError(err instanceof Error ? err.message : "删除失败"),
                });
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <p className={styles.dialogNote}>已产生的任务不受影响；回调地址立即失效。</p>
      </Dialog>
    </PageShell>
  );
}

function ChannelDrawer({
  open,
  row,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  row: ChannelRow | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (form: ChannelForm) => void;
}) {
  const [form, setForm] = useState<ChannelForm>(EMPTY_FORM);

  // Reset the form whenever the target changes (create vs edit).
  useEffect(() => {
    if (!open) return;
    setForm(row ? formOf(row) : EMPTY_FORM);
  }, [open, row]);

  const set = (field: keyof ChannelForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={row ? "编辑飞书通道" : "添加飞书通道"}
      description="凭据加密保存且只写不读；回调地址由系统生成。"
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            data-testid={row ? "channel-edit-save" : "channel-create"}
            loading={pending}
            disabled={!form.displayName.trim() || !form.appId.trim() || (!row && !form.appSecret)}
            onClick={() => onSubmit(form)}
          >
            {row ? "保存" : "创建通道"}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.steps}>
          <span>1 创建飞书应用</span>
          <span>2 填写凭据</span>
          <span>3 检测连接</span>
        </div>

        <section className={styles.section}>
          <h3>应用凭据</h3>
          <label className={styles.field}>
            显示名称 *
            <input
              data-testid={row ? "channel-edit-name" : "channel-name"}
              value={form.displayName}
              onChange={(event) => set("displayName", event.target.value)}
              placeholder="例如：研发发布群"
            />
          </label>
          <label className={styles.field}>
            App ID *
            <input
              data-testid={row ? "channel-edit-app-id" : "channel-app-id"}
              value={form.appId}
              onChange={(event) => set("appId", event.target.value)}
              placeholder="cli_xxx"
            />
          </label>
          <label className={styles.field}>
            App Secret {row ? "" : "*"}
            <input
              data-testid={row ? "channel-edit-app-secret" : "channel-app-secret"}
              type="password"
              value={form.appSecret}
              onChange={(event) => set("appSecret", event.target.value)}
              placeholder={row?.credentialsSet.appSecret ? "已配置，留空保持不变" : "必填"}
            />
          </label>
          {row?.credentialsSet.appSecret ? (
            <p className={styles.hint}>App Secret 等凭据已配置，留空保持不变。</p>
          ) : null}
          <label className={styles.field}>
            Verification Token
            <input
              data-testid={row ? "channel-edit-verification" : "channel-verification"}
              value={form.verificationToken}
              onChange={(event) => set("verificationToken", event.target.value)}
              placeholder={row?.credentialsSet.verificationToken ? "已配置，留空保持不变" : ""}
            />
          </label>
          <label className={styles.field}>
            Encrypt Key
            <input
              data-testid={row ? "channel-edit-encrypt" : "channel-encrypt"}
              value={form.encryptKey}
              onChange={(event) => set("encryptKey", event.target.value)}
              placeholder={row?.credentialsSet.encryptKey ? "已配置，留空保持不变" : ""}
            />
          </label>
          <label className={styles.field}>
            审批人（逗号分隔）
            <input
              data-testid={row ? "channel-edit-approvers" : "channel-approvers"}
              value={form.approvers}
              onChange={(event) => set("approvers", event.target.value)}
              placeholder="ou_bob, ou_carol"
            />
          </label>
        </section>

        <section className={styles.section}>
          <h3>通道设置</h3>
          <label className={styles.field}>
            回复方式
            <select disabled title="回复方式随 v1.1 接入">
              <option>仅最终回复</option>
            </select>
          </label>
          <div className={styles.inline}>
            <span>显示思考过程</span>
            <Switch checked={false} disabled label="显示思考过程（v1.1）" onChange={() => undefined} />
          </div>
          <div className={styles.inline}>
            <span>显示工具调用提示</span>
            <Switch checked={false} disabled label="显示工具调用提示（v1.1）" onChange={() => undefined} />
          </div>
          <p className={styles.hint}>这些设置依赖通道配置字段，随 v1.1 接入；当前只保存凭据与审批人。</p>
        </section>
      </div>
    </Drawer>
  );
}
