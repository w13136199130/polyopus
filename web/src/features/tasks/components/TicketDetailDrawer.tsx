import { Button, Drawer, ErrorState, Loading } from "@/components/ui";
import { useStopTicket, useTicketDetail } from "../api";
import { useState } from "react";
import { Dialog } from "@/components/ui";
import styles from "./TicketDetailDrawer.module.css";

interface Props {
  ticketId: string | null;
  onClose: () => void;
}

/** Right drawer: scope / budget / report + one-click stop with confirm. */
export function TicketDetailDrawer({ ticketId, onClose }: Props) {
  const detail = useTicketDetail(ticketId);
  const stop = useStopTicket();
  const [confirming, setConfirming] = useState(false);

  return (
    <Drawer
      open={ticketId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="任务详情"
      description={ticketId ?? undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            停止任务
          </Button>
        </>
      }
    >
      {detail.isLoading ? (
        <Loading label="载入详情…" />
      ) : detail.isError ? (
        <ErrorState message="详情加载失败" onRetry={() => void detail.refetch()} />
      ) : detail.data ? (
        <dl className={styles.facts}>
          <div>
            <dt>标题</dt>
            <dd>{detail.data.title}</dd>
          </div>
          <div>
            <dt>状态 / 桶</dt>
            <dd>
              {detail.data.state} · {detail.data.bucket}
            </dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>
              <code>{detail.data.scope.join(", ") || "—"}</code>
            </dd>
          </div>
          <div>
            <dt>预算</dt>
            <dd>
              {detail.data.budget
                ? `≤ ${detail.data.budget.maxTotalTokens} tokens`
                : "未设置"}
            </dd>
          </div>
          <div>
            <dt>Report</dt>
            <dd>
              {detail.data.report ? (
                <>
                  <span
                    className={`${styles.reportState} ${
                      styles[detail.data.report.state] ?? ""
                    }`}
                  >
                    {detail.data.report.state}
                  </span>
                  <p className={styles.reportSummary}>{detail.data.report.summary}</p>
                </>
              ) : (
                "暂无（等待执行，V05-07 接自动执行）"
              )}
            </dd>
          </div>
        </dl>
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
              loading={stop.isPending}
              onClick={() => {
                if (!ticketId) return;
                stop.mutate(ticketId, {
                  onSuccess: () => {
                    setConfirming(false);
                    onClose();
                  },
                });
              }}
            >
              确认停止
            </Button>
          </>
        }
      >
        <p>停止后任务移入「完成」桶，可通过时间线查看经过。</p>
      </Dialog>
    </Drawer>
  );
}
