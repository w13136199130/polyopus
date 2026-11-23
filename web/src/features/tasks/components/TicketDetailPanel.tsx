import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import { workspace } from "@/lib/api/endpoints";
import { pendingInbox, useAnswerAttention, useAttentions } from "@/lib/api/hooks";
import { ApprovalCard } from "@/components/attention/ApprovalCard";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { useCan } from "@/lib/auth/permissions";
import {
  useAddBudget,
  useDeleteTicket,
  useReassignTicket,
  useRerunTicket,
  useStopTicket,
  useTicketDetail,
  useTicketTimeline,
  useUpdateTicket,
} from "../api";
import type { TicketArtifact, TicketTimelineItem } from "@/lib/api/wire";
import { fmtCost, timeAgo } from "./TicketList";
import styles from "./TicketDetailPanel.module.css";

interface Props {
  ticketId: string | null;
  onBack?: () => void;
  onDeleted?: () => void;
}

const BUCKET_META: Record<string, [string, string]> = {
  attention: ["待我决定", styles.tagRed],
  running: ["运行中", styles.tagGreen],
  queued: ["排队中", styles.tagNeutral],
  done: ["已完成", styles.tagGreen],
};

const KIND_LABEL: Record<string, string> = {
  trigger: "Trigger",
  gate: "Gate",
  eval: "Eval",
  ticket: "Ticket",
  assignment: "Assign",
  execution: "Execution",
  report: "Report",
  attention: "Attention",
  channel: "Reply",
  error: "Error",
};

function toneClass(item: TicketTimelineItem): string {
  if (item.tone === "danger" || item.tone === "red" || item.kind === "error") {
    return styles.dotRed;
  }
  if (item.tone === "warn" || item.tone === "amber") return styles.dotAmber;
  if (item.tone === "success" || item.tone === "green") return styles.dotGreen;
  return styles.dotBlue;
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function sizeLabel(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}

/**
 * Right pane of the tasks page (prototype `renderTaskDetail`): header +
 * actions, immutable mandate, task timeline, report/artifacts.
 *
 * The three actions are real: 重新派工 requeues, 追加预算 raises the ceiling,
 * 停止 ends the ticket (confirm required).
 */
export function TicketDetailPanel({ ticketId, onBack, onDeleted }: Props) {
  const detail = useTicketDetail(ticketId);
  const timeline = useTicketTimeline(ticketId);
  const stop = useStopTicket();
  const reassign = useReassignTicket();
  const rerun = useRerunTicket();
  const editTicket = useUpdateTicket();
  const remove = useDeleteTicket();
  const addBudget = useAddBudget();
  const attentions = useAttentions();
  const answer = useAnswerAttention();
  const canTicket = useCan("ticket:write");
  const canAttention = useCan("attention:write");
  const canWrite = canTicket && canAttention;
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editInstruction, setEditInstruction] = useState("");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [yuan, setYuan] = useState("1");
  const [previewArtifact, setPreviewArtifact] = useState<TicketArtifact | null>(null);
  const previewQuery = useQuery({
    queryKey: ["workspace-file", previewArtifact?.ref ?? ""],
    queryFn: () => workspace.file(previewArtifact?.ref ?? ""),
    enabled: previewArtifact !== null && previewArtifact.kind === "file",
  });

  if (!ticketId) {
    return (
      <div className={styles.empty}>
        <Empty title="选择一个任务" hint="左侧任务卡会在这里展开授权范围、任务线与产物。" />
      </div>
    );
  }
  if (detail.isLoading) return <Loading label="载入任务详情…" />;
  if (detail.isError) {
    return (
      <ErrorState
        message="任务详情加载失败"
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const data = detail.data;
  if (!data) return null;
  const ticket = data;

  const [statusLabel, statusTone] = BUCKET_META[data.bucket] ?? BUCKET_META.queued;
  const ended = data.state === "ended";
  const attentionPending = data.bucket === "attention";
  const sourceLabel = data.sourceName
    ?? (data.sourceId ? data.sourceId.slice(0, 14) : "手动创建");
  const actor = data.actor?.name ?? "系统";
  const executor = data.executor === "builtin" || !data.executor
    ? "内置执行器"
    : `${data.executor} 执行器`;
  const pendingAttention = pendingInbox(attentions.data?.items).find(
    (item) => item.ticketId === ticketId,
  );
  const budgetCap = data.budget?.maxCostMicros;
  const budgetPct = budgetCap
    ? Math.min(100, Math.round(((data.costMicros ?? 0) / budgetCap) * 100))
    : 0;
  const facts = data.report?.facts ?? {};

  function exportReport() {
    const payload = {
      ticket: data,
      timeline: timeline.data?.items ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${ticket.ticketId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("已导出任务报告（JSON）。");
  }

  function submitBudget() {
    const amount = Number(yuan);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("请输入大于 0 的金额。");
      return;
    }
    addBudget.mutate(
      { ticketId: ticket.ticketId, additionalCostMicros: Math.round(amount * 1_000_000) },
      {
        onSuccess: () => {
          setBudgetOpen(false);
          setNotice(`已追加预算 ¥${amount.toFixed(2)}。`);
        },
        onError: (error) => setNotice(`追加预算失败：${errorText(error)}`),
      },
    );
  }

  function doReassign() {
    reassign.mutate(ticket.ticketId, {
      onSuccess: () => setNotice("已重新排队，执行器会重新领取该任务。"),
      onError: (error) => setNotice(`重新派工失败：${errorText(error)}`),
    });
  }

  return (
    <div className={styles.panel} data-testid="ticket-detail">
      <div className={styles.head}>
        {onBack ? (
          <Button
            size="sm"
            variant="ghost"
            className={styles.mobileBack}
            data-testid="detail-back"
            onClick={onBack}
          >
            ← 返回列表
          </Button>
        ) : null}
        <div className={styles.headMain}>
          <h2 className={styles.title}>{data.title}</h2>
          <div className={styles.chips}>
            <span className={`${styles.tag} ${styles.tagOutline} ${styles.refChip}`}>
              {data.ticketId}
            </span>
            <span className={`${styles.tag} ${statusTone}`}>{statusLabel}</span>
            <span className={`${styles.tag} ${styles.tagBlue}`}>{data.strength}</span>
            <span className={`${styles.tag} ${styles.tagOutline}`}>
              策略 v{data.policyVersion ?? 1}
            </span>
            <span className={`${styles.tag} ${styles.tagOutline}`}>{executor}</span>
            <span className={styles.hint}>
              {sourceLabel} · @{actor} · {timeAgo(data.createdAt)}
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            data-testid="detail-reassign"
            loading={reassign.isPending}
            disabled={!canWrite || ended || attentionPending}
            title={
              attentionPending
                ? "先处理待决审批，再重新派工"
                : ended
                  ? "任务已结束"
                  : "结束当前执行并重新排队"
            }
            onClick={doReassign}
          >
            重新派工
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="detail-budget"
            disabled={!canWrite || ended}
            onClick={() => setBudgetOpen(true)}
          >
            追加预算
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="detail-rerun"
            loading={rerun.isPending}
            disabled={!canWrite || !ended}
            title={ended ? "重新排队并执行此任务" : "任务结束后可再次运行"}
            onClick={() => rerun.mutate(data.ticketId, {
              onSuccess: () => setNotice("已重新排队，执行器会再次领取该任务。"),
              onError: (error) => setNotice(`再次运行失败：${errorText(error)}`),
            })}
          >
            再次运行
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="detail-edit"
            disabled={!canWrite || !ended}
            title={ended ? "编辑标题与任务说明；再次运行会使用新说明" : "运行中不可编辑，请先取消任务"}
            onClick={() => {
              setEditTitle(data.title);
              setEditInstruction(data.instruction ?? "");
              setEditOpen(true);
            }}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="danger"
            data-testid="drawer-stop"
            disabled={!canWrite || ended}
            onClick={() => setConfirmStop(true)}
          >
            取消任务
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="detail-delete"
            disabled={!canWrite || !ended}
            title={ended ? "删除此任务记录" : "先停止任务，再删除"}
            onClick={() => setConfirmDelete(true)}
          >
            删除
          </Button>
        </div>
      </div>

      {notice ? (
        <button type="button" className={styles.notice} onClick={() => setNotice(null)}>
          {notice}
        </button>
      ) : null}

      {pendingAttention?.kind === "approval" ? (
        <ApprovalCard
          attention={pendingAttention}
          busy={answer.isPending}
          onAnswer={(attentionId, decision) =>
            answer.mutate(
              { attentionId, decision },
              {
                onSuccess: () => {
                  void detail.refetch();
                  void timeline.refetch();
                },
              },
            )}
        />
      ) : pendingAttention ? (
        <div className={styles.attentionBlock} data-testid="ticket-attention">
          <b>需要处理</b>
          <span>
            {String((pendingAttention.payload as { summary?: string }).summary
              ?? pendingAttention.kind)}
          </span>
        </div>
      ) : null}

      <section className={styles.panelCard} data-testid="task-instruction">
        <div className={styles.panelHead}>
          <b>任务内容</b>
          <span className={styles.panelSub}>执行器收到的指令</span>
          <span className={styles.spacer} />
          <Button
            size="sm"
            variant="ghost"
            data-testid="instruction-edit"
            disabled={!canWrite || !ended}
            title={ended ? "编辑任务说明" : "运行中不可编辑"}
            onClick={() => {
              setEditTitle(data.title);
              setEditInstruction(data.instruction ?? "");
              setEditOpen(true);
            }}
          >
            编辑
          </Button>
        </div>
        <p className={styles.instruction}>
          {data.instruction || "无任务说明"}
        </p>
      </section>

      <section className={styles.panelCard}>
        <div className={styles.panelHead}>
          <b>授权范围</b>
          <span className={styles.panelSub}>Mandate · 不可变</span>
          <span className={styles.spacer} />
          <span className={`${styles.tag} ${styles.tagOutline}`}>
            policy v{data.policyVersion ?? 1}
          </span>
        </div>
        <dl className={styles.dl}>
          <dt>scope</dt>
          <dd>
            {data.scope.length
              ? data.scope.map((item) => <code key={item}>{item}</code>)
              : "—"}
          </dd>
          <dt>strength</dt>
          <dd>
            {data.strength}
            {data.strength === "explicit" ? "（用户明确请求）" : "（系统推断）"}
          </dd>
          <dt>发起人</dt>
          <dd>
            {sourceLabel}:{actor}
          </dd>
          <dt>预算</dt>
          <dd>
            {fmtCost(data.costMicros)} / {budgetCap ? fmtCost(budgetCap) : "未设置"}
          </dd>
        </dl>
        <div className={styles.budgetBar} aria-hidden="true" data-testid="budget-bar">
          <i
            className={`${styles.budgetFill} ${
              budgetPct >= 80 ? styles.budgetWarn : ""
            }`}
            style={{ width: `${budgetCap ? budgetPct : 0}%` }}
          />
        </div>
        <div className={styles.budgetMeta}>
          <span>{budgetCap ? `已用 ${budgetPct}%` : "未设置上限"}</span>
          {budgetPct >= 80 && data.state !== "ended" ? (
            <span className={styles.budgetAlert}>接近或已超预算</span>
          ) : null}
        </div>
      </section>

      <section className={styles.panelCard}>
        <div className={styles.panelHead}>
          <b>任务线</b>
          <span className={styles.panelSub}>
            Trigger → Gate → Eval → Ticket → Assign → Execution → Report → Attention
          </span>
        </div>
        {timeline.isLoading ? (
          <p className={styles.muted}>载入时间线…</p>
        ) : timeline.isError ? (
          <p className={styles.error}>时间线加载失败</p>
        ) : (timeline.data?.items.length ?? 0) === 0 ? (
          <p className={styles.muted}>还没有时间线记录。</p>
        ) : (
          <ul className={styles.timeline}>
            {(timeline.data?.items ?? []).slice(-30).map((item) => (
              <li key={item.id} className={styles.tlItem}>
                <span className={styles.tlTime}>{timeOf(item.at)}</span>
                <span className={`${styles.dot} ${toneClass(item)}`} />
                <div className={styles.tlMain}>
                  <div className={styles.tlTitle}>
                    <span className={styles.kind}>{KIND_LABEL[item.kind] ?? item.kind}</span>
                    <span>{item.title}</span>
                  </div>
                  {item.description ? (
                    <div className={styles.tlDesc}>{item.description}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.report ? (
        <section className={styles.panelCard}>
          <div className={styles.panelHead}>
            <b>报告</b>
            <span className={`${styles.tag} ${styles.tagOutline}`}>
              {data.report.state}
            </span>
          </div>
          <p className={styles.report}>{data.report.summary}</p>
          {Object.keys(facts).length ? (
            <ul className={styles.facts}>
              {Object.entries(facts).map(([key, value]) => (
                <li key={key}>
                  <code>{key}</code>
                  <span>
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className={styles.panelCard}>
        <div className={styles.panelHead}>
          <b>产物</b>
          <span className={styles.panelSub}>Artifacts</span>
          <span className={styles.spacer} />
          <Button size="sm" variant="ghost" onClick={exportReport}>
            导出
          </Button>
        </div>
        {data.artifacts?.length ? (
          <ul className={styles.artifacts}>
            {data.artifacts.map((item) => (
              <li key={item.artifactId}>
                <span className={styles.artifactIcon} aria-hidden="true">▤</span>
                <span className={styles.artifactName}>{item.kind} · {item.ref}</span>
                <span className={styles.spacer} />
                <span className={styles.muted}>{sizeLabel(item.size)}</span>
                {item.kind === "file" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="artifact-preview"
                    onClick={() => setPreviewArtifact(item)}
                  >
                    预览
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>
            还没有产物。若任务只返回文本，报告内容见上方；需要文件时请在指令中明确要求写入工作区。
          </p>
        )}
      </section>

      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="编辑任务"
        description="仅已结束/失败的任务可编辑；保存后再次运行会使用新说明。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>取消</Button>
            <Button
              data-testid="ticket-edit-save"
              loading={editTicket.isPending}
              disabled={!editTitle.trim()}
              onClick={() => editTicket.mutate({
                ticketId: data.ticketId,
                title: editTitle.trim(),
                content: editInstruction.trim(),
              }, {
                onSuccess: () => {
                  setEditOpen(false);
                  setNotice("任务已更新；再次运行会使用新说明。");
                },
                onError: (error) => setNotice(`保存失败：${errorText(error)}`),
              })}
            >
              保存
            </Button>
          </>
        }
      >
        <label className={styles.budgetLabel}>
          标题
          <input
            data-testid="ticket-edit-title"
            value={editTitle}
            maxLength={200}
            onChange={(event) => setEditTitle(event.target.value)}
          />
        </label>
        <label className={styles.budgetLabel}>
          任务说明
          <textarea
            data-testid="ticket-edit-instruction"
            rows={7}
            maxLength={4000}
            value={editInstruction}
            onChange={(event) => setEditInstruction(event.target.value)}
          />
        </label>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除任务"
        description="删除任务记录、报告与时间线；审计、用量与执行事件保留。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>取消</Button>
            <Button
              variant="danger"
              data-testid="confirm-delete"
              loading={remove.isPending}
              onClick={() => remove.mutate(data.ticketId, {
                onSuccess: () => {
                  setConfirmDelete(false);
                  onDeleted?.();
                },
                onError: (error) => setNotice(`删除失败：${errorText(error)}`),
              })}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p>确定删除「{data.title}」？此操作不可撤销。</p>
      </Dialog>

      <Dialog
        open={previewArtifact !== null}
        onOpenChange={(open) => { if (!open) setPreviewArtifact(null); }}
        title={previewArtifact ? `产物 · ${previewArtifact.ref}` : "产物预览"}
        description="只读预览工作区文件；大小与 sha256 已登记。"
        width={760}
      >
        {previewQuery.isLoading ? <Loading label="读取文件…" /> : previewQuery.isError ? (
          <ErrorState message="文件读取失败" onRetry={() => void previewQuery.refetch()} />
        ) : previewQuery.data ? (
          <div className={styles.artifactPreview}>
            <MarkdownView content={previewQuery.data.content} />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="取消任务"
        description="取消会结束当前执行并收尾工单；已产生的消耗与产物保留。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmStop(false)}>取消</Button>
            <Button
              variant="danger"
              data-testid="confirm-stop"
              loading={stop.isPending}
              onClick={() =>
                stop.mutate(data.ticketId, {
                  onSuccess: () => {
                    setConfirmStop(false);
                    setNotice("任务已取消并进入已完成。");
                  },
                  onError: (error) => setNotice(`取消失败：${errorText(error)}`),
                })
              }
            >
              确认取消
            </Button>
          </>
        }
      >
        <p>已生成的内容会保留，任务进入「已完成」。</p>
      </Dialog>

      <Dialog
        open={budgetOpen}
        onOpenChange={setBudgetOpen}
        title="追加预算"
        description="预算上限只增不减；mandate 保持不变。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBudgetOpen(false)}>取消</Button>
            <Button
              data-testid="budget-submit"
              loading={addBudget.isPending}
              onClick={submitBudget}
            >
              追加
            </Button>
          </>
        }
      >
        <label className={styles.budgetLabel}>
          追加金额（元）
          <input
            data-testid="budget-amount"
            type="number"
            min="0.01"
            step="0.5"
            value={yuan}
            onChange={(event) => setYuan(event.target.value)}
          />
        </label>
        <p className={styles.muted}>
          当前上限 {budgetCap ? fmtCost(budgetCap) : "未设置"}，已用 {fmtCost(data.costMicros)}。
        </p>
      </Dialog>
    </div>
  );
}

