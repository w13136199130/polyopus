/**
 * Ticket detail drawer — task-timeline prototype restoration:
 * why-banner (当前在等什么) + KPI row + budget bar + mandate panel +
 * unified stage timeline (Trigger → … → Attention, tone dots) + report.
 * 改派/追加预算 stay disabled until their endpoints ship (docs/29 lists
 * them; backend hasn't implemented).
 */

import { useState } from "react";
import { Button, Dialog, Drawer, ErrorState, Loading } from "@/components/ui";
import { useStopTicket, useTicketDetail, useTicketTimeline } from "../api";
import type { TicketDetail, TicketTimelineItem } from "@/lib/api/wire";
import styles from "./TicketDetailDrawer.module.css";

interface Props {
  ticketId: string | null;
  onClose: () => void;
}

const BUCKET_META: Record<
  string,
  { label: string; tone: string; why: string; whySub: string }
> = {
  attention: {
    label: "待我决定", tone: "Red",
    why: "需要你的决定", whySub: "审批/追加预算后继续，或停止保留已完成内容",
  },
  running: {
    label: "运行中", tone: "Green",
    why: "正在执行", whySub: "内置执行器驱动中；可随时停止",
  },
  queued: {
    label: "已排队", tone: "Blue",
    why: "排队等待执行器", whySub: "前序任务完成后自动开始",
  },
  done: {
    label: "已完成", tone: "Green",
    why: "已结束", whySub: "查看下方报告与时间线",
  },
};

function toneOf(item: TicketTimelineItem): string {
  if (item.tone === "danger" || item.tone === "red" || item.kind === "error")
    return "tlFail";
  if (item.tone === "warn" || item.tone === "amber") return "tlWait";
  if (item.tone === "success" || item.tone === "green") return "tlDone";
  if (item.tone === "info" || item.tone === "active") return "tlActive";
  return "tlDone";
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    ticket: "Ticket", trigger: "Trigger", assignment: "Assignment",
    execution_thread: "Thread", human_message: "人工消息",
    report: "Report", attention: "Attention", tool: "Tool",
    ticket_ended: "结束",
  };
  return map[kind] ?? kind;
}

function fmtCost(micros?: number): string {
  if (!micros) return "¥0.00";
  return `¥${(micros / 1_000_000).toFixed(2)}`;
}

function Head({ detail }: { detail: TicketDetail }) {
  const meta = BUCKET_META[detail.bucket] ?? BUCKET_META.queued;
  return (
    <div className={styles.head}>
      <div>
        <div className={styles.title}>
          {detail.ticketId.slice(0, 11)} · {detail.title}
        </div>
        <div className={styles.sub}>
          <span className={`${styles.tag} ${styles[`tag${meta.tone}`]}`}>
            {meta.label}
          </span>
          <span className={`${styles.tag} ${styles.tagOutline}`}>
            {detail.sourceId ? `来源 ${detail.sourceId.slice(0, 10)}` : "手动创建"}
          </span>
          <span className={`${styles.tag} ${styles.tagOutline}`}>
            授权 {detail.strength}
          </span>
          <span className={`${styles.tag} ${styles.tagOutline}`}>内置执行器</span>
        </div>
      </div>
    </div>
  );
}

function BudgetBar({ detail }: { detail: TicketDetail }) {
  const cap = detail.budget?.maxCostMicros;
  if (!cap) return null;
  const used = Math.min(100, Math.round(((detail.costMicros ?? 0) / cap) * 100));
  return (
    <div className={styles.budget}>
      <div className={styles.budgetTop}>
        <span>预算 {used >= 80 ? "告警" : ""}</span>
        <span>
          {fmtCost(detail.costMicros)} / {fmtCost(cap)}
        </span>
      </div>
      <div className={`${styles.bar} ${used >= 80 ? styles.barWarn : ""}`}>
        <i style={{ width: `${used}%` }} />
      </div>
    </div>
  );
}

export function TicketDetailDrawer({ ticketId, onClose }: Props) {
  const detail = useTicketDetail(ticketId);
  const timeline = useTicketTimeline(ticketId);
  const stop = useStopTicket();
  const [confirming, setConfirming] = useState(false);

  const data = detail.data;
  const meta = data ? (BUCKET_META[data.bucket] ?? BUCKET_META.queued) : null;

  return (
    <Drawer
      open={ticketId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="任务详情"
      description={ticketId ?? undefined}
      width={560}
      footer={
        <>
          <Button variant="ghost" disabled title="待后端提供 /tickets/{id}/assign">
            改派
          </Button>
          <Button variant="ghost" disabled title="待后端提供 /tickets/{id}/budget">
            追加预算
          </Button>
          <Button
            variant="danger"
            data-testid="drawer-stop"
            disabled={data?.state === "ended"}
            onClick={() => setConfirming(true)}
          >
            停止
          </Button>
        </>
      }
    >
      {detail.isLoading ? (
        <Loading label="载入详情…" />
      ) : detail.isError ? (
        <ErrorState message="详情加载失败" onRetry={() => void detail.refetch()} />
      ) : data && meta ? (
        <>
          <Head detail={data} />

          <div className={`${styles.why} ${styles[`why${meta.tone}`]}`}>
            <div>
              <b>{meta.why}</b>
              <span>{meta.whySub}</span>
            </div>
          </div>

          <dl className={styles.kpis}>
            <div className={styles.kpi}>
              <dt>状态</dt>
              <dd>{meta.label}</dd>
            </div>
            <div className={styles.kpi}>
              <dt>成本</dt>
              <dd>{fmtCost(data.costMicros)}</dd>
            </div>
            <div className={styles.kpi}>
              <dt>预算上限</dt>
              <dd>
                {data.budget?.maxCostMicros
                  ? fmtCost(data.budget.maxCostMicros)
                  : "未设置"}
              </dd>
            </div>
            <div className={styles.kpi}>
              <dt>Report</dt>
              <dd>{data.report?.state ?? "—"}</dd>
            </div>
          </dl>

          <BudgetBar detail={data} />

          <section className={styles.panel}>
            <div className={styles.panelH}>
              <b>授权范围</b>
              <span className={styles.sub}>Mandate · 不可变</span>
            </div>
            <dl className={styles.dl}>
              <div>
                <dt>scope</dt>
                <dd>
                  {data.scope.length
                    ? data.scope.map((item) => <code key={item}>{item}</code>)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>strength</dt>
                <dd>{data.strength}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelH}>
              <b>时间线</b>
              <span className={styles.sub}>Trigger → … → Report</span>
            </div>
            {timeline.isLoading ? (
              <p style={{ padding: "0 12px 12px", color: "var(--text-3)", fontSize: 12 }}>
                载入时间线…
              </p>
            ) : timeline.isError ? (
              <p style={{ padding: "0 12px 12px", color: "var(--red)", fontSize: 12 }}>
                时间线加载失败
              </p>
            ) : (
              <ul className={styles.tl}>
                {(timeline.data?.items ?? []).slice(-24).map((item) => (
                  <li
                    key={item.id}
                    className={`${styles.tlItem} ${styles[toneOf(item)]}`}
                  >
                    <span className={styles.dot} />
                    <span className={styles.tlKind}>{kindLabel(item.kind)}</span>
                    <span className={styles.tlTime}>
                      {new Date(item.at).toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className={styles.tlTitle}>{item.title}</span>
                    <span className={styles.tlSub}>
                      {item.description || item.actor?.name || ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.report ? (
            <section className={styles.panel}>
              <div className={styles.panelH}>
                <b>报告</b>
                <span className={styles.sub}>Report</span>
                <span
                  className={`${styles.reportState} ${
                    styles[`reportState${data.report.state}`] ?? ""
                  }`}
                  style={{ marginLeft: "auto" }}
                >
                  {data.report.state}
                </span>
              </div>
              <div style={{ padding: "0 12px 12px" }}>
                <p className={styles.reportSummary}>{data.report.summary}</p>
                <ul className={styles.factsList}>
                  {Object.entries(data.report.facts).map(([key, value]) => (
                    <li key={key}>
                      <code>{key}</code>
                      <span>
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="确认停止"
        description="停止只结束 Assignment，不删除工单；已产生的消耗保留。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-stop"
              loading={stop.isPending}
              onClick={() =>
                stop.mutate(ticketId ?? "", {
                  onSuccess: () => {
                    setConfirming(false);
                    onClose();
                  },
                })
              }
            >
              确认停止
            </Button>
          </>
        }
      >
        <p>已生成的内容会保留，工单进入「已完成」。</p>
      </Dialog>
    </Drawer>
  );
}
