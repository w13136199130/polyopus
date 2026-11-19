import { useState } from "react";
import { Button, Dialog, Empty, ErrorState, Loading } from "@/components/ui";
import { useCan } from "@/lib/auth/permissions";
import {
  useAddBudget,
  useReassignTicket,
  useStopTicket,
  useTicketDetail,
  useTicketTimeline,
} from "../api";
import type { TicketTimelineItem } from "@/lib/api/wire";
import { fmtCost, timeAgo } from "./TicketList";
import styles from "./TicketDetailPanel.module.css";

interface Props {
  ticketId: string | null;
}

const BUCKET_META: Record<string, [string, string]> = {
  attention: ["待我决定", styles.tagRed],
  running: ["运行中", styles.tagGreen],
  queued: ["排队中", styles.tagNeutral],
  done: ["已完成", styles.tagGreen],
};

const KIND_LABEL: Record<string, string> = {
  trigger: "Trigger",
  ticket: "Ticket",
  assignment: "Assign",
  report: "Report",
  attention: "Attention",
  channel: "Reply",
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
export function TicketDetailPanel({ ticketId }: Props) {
  const detail = useTicketDetail(ticketId);
  const timeline = useTicketTimeline(ticketId);
  const stop = useStopTicket();
  const reassign = useReassignTicket();
  const addBudget = useAddBudget();
  const canTicket = useCan("ticket:write");
  const canAttention = useCan("attention:write");
  const canWrite = canTicket && canAttention;
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [yuan, setYuan] = useState("1");

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
  const budgetCap = data.budget?.maxCostMicros;
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
            variant="danger"
            data-testid="drawer-stop"
            disabled={!canWrite || ended}
            onClick={() => setConfirmStop(true)}
          >
            停止
          </Button>
        </div>
      </div>

      {notice ? (
        <button type="button" className={styles.notice} onClick={() => setNotice(null)}>
          {notice}
        </button>
      ) : null}

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
      </section>

      <section className={styles.panelCard}>
        <div className={styles.panelHead}>
          <b>任务线</b>
          <span className={styles.panelSub}>Trigger → Eval → Ticket → Report</span>
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
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>还没有产物。</p>
        )}
      </section>

      <Dialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="确认停止"
        description="停止只结束当前执行并收尾工单；已产生的消耗与产物保留。"
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
                    setNotice("任务已停止并进入已完成。");
                  },
                  onError: (error) => setNotice(`停止失败：${errorText(error)}`),
                })
              }
            >
              确认停止
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

