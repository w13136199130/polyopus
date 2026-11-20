import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Empty, Loading } from "@/components/ui";
import { workspace } from "@/lib/api/endpoints";
import type { TraceEvent, WorkspaceEntry, WorkspaceTree } from "@/lib/api/wire";
import styles from "./Dock.module.css";

export type DockTab = "files" | "workspace" | "browser" | "trace" | "terminal";

const TABS: Array<[DockTab, string]> = [
  ["files", "文件"],
  ["workspace", "工作区"],
  ["browser", "浏览器"],
  ["trace", "轨迹"],
  ["terminal", "终端"],
];

interface Props {
  threadId: string | null;
  tab: DockTab;
  onTab: (tab: DockTab) => void;
  onClose: () => void;
  trace: TraceEvent[] | undefined;
  traceLoading: boolean;
  onOpenTrace: () => void;
  tree: WorkspaceTree | undefined;
  treeLoading: boolean;
}

function fileTree(
  items: WorkspaceEntry[],
  onOpen: (path: string) => void,
  depth = 0,
): ReactNode {
  return items.map((item) => (
    <div key={item.path}>
      <div className={styles.row} style={{ paddingLeft: 6 + depth * 14 }}>
        <span className={styles.icon} aria-hidden="true">
          {item.type === "dir" ? "▸" : "▤"}
        </span>
        {item.type === "dir" ? (
          <span className={styles.name}>{item.name}</span>
        ) : (
          <button
            type="button"
            className={styles.fileLink}
            onClick={() => onOpen(item.path)}
          >
            {item.name}
          </button>
        )}
        {item.size ? <span className={styles.hint}>{formatSize(item.size)}</span> : null}
      </div>
      {item.children?.length ? fileTree(item.children, onOpen, depth + 1) : null}
    </div>
  ));
}

function FilePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const file = useQuery({
    queryKey: ["workspace-file", path],
    queryFn: () => workspace.file(path),
    staleTime: 5_000,
  });
  return (
    <div className={styles.preview}>
      <div className={styles.previewHead}>
        <code>{path}</code>
        <button type="button" onClick={onClose} aria-label="关闭预览">×</button>
      </div>
      {file.isLoading ? (
        <Loading label="读取文件…" />
      ) : file.isError ? (
        <p className={styles.errorText}>无法预览（二进制或过大）。</p>
      ) : (
        <pre className={styles.pre}>{file.data?.content}</pre>
      )}
    </div>
  );
}

function formatSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10}KB`;
  return `${Math.round(size / 1024 / 102.4) / 10}MB`;
}

type TraceCategory = "turn" | "message" | "user" | "tool" | "approval" | "context";

interface TraceRowView {
  category: TraceCategory;
  label: string;
  summary: string;
  tone: "info" | "ok" | "warn" | "bad" | "neutral";
}

function preview(value: unknown, max = 90): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function traceRow(event: TraceEvent): TraceRowView | null {
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "turn.queued":
      return { category: "turn", label: "回合", tone: "neutral", summary: "消息入队" };
    case "message.user":
      return {
        category: "user", label: "用户", tone: "info",
        summary: preview(payload.content, 110),
      };
    case "message.assistant":
      return {
        category: "message", label: "回复", tone: "ok",
        summary: preview(payload.content, 110),
      };
    case "turn.started":
      return {
        category: "turn", label: "回合", tone: "info",
        summary: `模型 ${String(payload.model ?? "")} 开始`,
      };
    case "turn.finished":
      return {
        category: "turn", label: "回合", tone: "ok",
        summary: `结束 · ${String(payload.status ?? "")}`,
      };
    case "turn.cancel_requested":
      return { category: "turn", label: "回合", tone: "warn", summary: "收到停止请求" };
    case "turn.requeued":
      return {
        category: "turn", label: "回合", tone: "warn",
        summary: payload.reason === "edit" ? "编辑后重跑" : "重新生成",
      };
    case "message.started":
      return { category: "message", label: "回复", tone: "info", summary: "开始生成" };
    case "message.completed": {
      const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
      const text = blocks
        .filter((block) => (block as { type?: string }).type === "text")
        .map((block) => String((block as { text?: string }).text ?? ""))
        .join("");
      return {
        category: "message", label: "回复", tone: "ok",
        summary: preview(text) || "回复完成",
      };
    }
    case "tool.started":
      return {
        category: "tool", label: "工具", tone: "info",
        summary: `${String(payload.name ?? "tool")} ${preview(payload.args_preview, 70)}`,
      };
    case "tool.completed":
      return {
        category: "tool", label: "工具", tone: "ok",
        summary: preview(payload.output, 90) || "工具输出已返回",
      };
    case "tool.failed":
      return {
        category: "tool", label: "工具", tone: "bad",
        summary: `${String(payload.code ?? "失败")} ${preview(payload.message, 70)}`,
      };
    case "approval.requested":
      return {
        category: "approval", label: "审批", tone: "warn",
        summary: `等待确认 · ${String(payload.tool ?? "")}`,
      };
    case "approval.resolved":
      return {
        category: "approval", label: "审批", tone: "ok",
        summary: `已处理 · ${String(payload.decision ?? "")}`,
      };
    case "context.knowledge": {
      const citations = Array.isArray(payload.citations) ? payload.citations : [];
      return {
        category: "context", label: "上下文", tone: "neutral",
        summary: `知识库命中 ${citations.length} 条`,
      };
    }
    default:
      // message.delta / message.reasoning are high-volume; the final text and
      // reasoning are already in the message card.
      return null;
  }
}

function payloadText(event: TraceEvent): string {
  const text = JSON.stringify(event.payload, null, 2) ?? "";
  return text.length > 8_000 ? `${text.slice(0, 8_000)}…` : text;
}

/**
 * Right-hand Dock (prototype `.dock`): 文件/工作区/浏览器/轨迹/终端.
 * Files and the terminal come from real backend data; the browser tab is an
 * honest empty state because v1.0 has no browser session backend.
 */
export function Dock({
  threadId, tab, onTab, onClose, trace, traceLoading, tree, treeLoading,
  onOpenTrace,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const rows = (trace ?? [])
    .map((event) => ({ event, row: traceRow(event) }))
    .filter((item) => item.row !== null)
    .slice(-200);

  const toolEvents = (trace ?? []).filter((event) =>
    event.type === "tool.started"
    || event.type === "tool.completed"
    || event.type === "tool.failed",
  );

  return (
    <aside className={styles.dock} aria-label="会话 Dock">
      <div className={styles.head}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.tab} ${tab === id ? styles.tabOn : ""}`}
            aria-selected={tab === id}
            role="tab"
            onClick={() => onTab(id)}
            data-testid={`dock-${id}`}
          >
            {label}
          </button>
        ))}
        <span className={styles.spacer} />
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭 Dock">
          ×
        </button>
      </div>

      <div className={styles.body}>
        {tab === "files" || tab === "workspace" ? (
          preview ? (
            <FilePreview path={preview} onClose={() => setPreview(null)} />
          ) : treeLoading ? (
            <Loading label="读取工作区…" />
          ) : !tree?.items.length ? (
            <Empty title="工作区是空的" hint="模型用工具写文件后会出现在这里。" />
          ) : (
            <>
              {tab === "workspace" ? (
                <p className={styles.crumb}>工作区 / {tree?.root.split(/[\\/]/).pop()}</p>
              ) : null}
              {fileTree(tree.items, setPreview)}
              {tree?.truncated ? <p className={styles.hint}>仅显示前 500 项。</p> : null}
            </>
          )
        ) : null}

        {tab === "browser" ? (
          <Empty title="还没有浏览器会话" hint="工具打开网页后会出现在这里（v1.1）。" />
        ) : null}

        {tab === "trace" ? (
          !threadId ? (
            <p className={styles.hint}>先打开一个会话。</p>
          ) : traceLoading && !trace ? (
            <Loading label="读取轨迹…" />
          ) : rows.length === 0 ? (
            <Empty title="还没有运行记录" hint="发送消息后，模型、工具与审批步骤会出现在这里。" />
          ) : (
            <>
              <div className={styles.traceTools}>
                <span className={styles.traceTitle}>本会话全部轨迹</span>
                <span className={styles.spacer} />
                <button
                  type="button"
                  className={styles.openFull}
                  onClick={onOpenTrace}
                  data-testid="trace-open-full"
                >
                  展开完整轨迹
                </button>
                <span className={styles.hint}>{rows.length} 条</span>
              </div>
              <div className={styles.traceList}>
                {rows.map(({ event, row }) => (
                  <details
                    key={`${event.seq}-${event.type}`}
                    className={styles.traceRow}
                    data-testid="trace-row"
                  >
                    <summary className={styles.traceHead}>
                      <span className={styles.time}>
                        {new Date(event.ts * 1000).toLocaleTimeString("zh-CN", {
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </span>
                      <span className={`${styles.traceBadge} ${styles[row!.tone]}`}>
                        {row!.label}
                      </span>
                      <span className={styles.traceType}>{event.type}</span>
                      <span className={styles.traceSummary}>{row!.summary}</span>
                    </summary>
                    <div className={styles.traceDetail}>
                      <dl className={styles.traceMeta}>
                        <dt>seq</dt><dd>{event.seq > 0 ? event.seq : "message"}</dd>
                        <dt>turn</dt><dd>{event.turnId ?? "—"}</dd>
                        <dt>run</dt><dd>{event.runId ?? "—"}</dd>
                        <dt>时间</dt><dd>{new Date(event.ts * 1000).toLocaleString("zh-CN")}</dd>
                      </dl>
                      <div className={styles.tracePayloadHead}>输入 / 输出 / 原始载荷</div>
                      <pre className={styles.tracePayload}>{payloadText(event)}</pre>
                    </div>
                  </details>
                ))}
              </div>
            </>
          )
        ) : null}

        {tab === "terminal" ? (
          !threadId ? (
            <p className={styles.hint}>先打开一个会话。</p>
          ) : toolEvents.length === 0 ? (
            <Empty title="还没有工具调用" hint="模型执行工具时，命令与输出会显示在这里。" />
          ) : (
            <div className={styles.terminal}>
              {toolEvents.map((event) => {
                const payload = event.payload as Record<string, unknown>;
                if (event.type === "tool.started") {
                  return (
                    <div key={event.seq} className={styles.termCmd}>
                      $ {String(payload.name ?? "tool")} {String(payload.args_preview ?? "")}
                    </div>
                  );
                }
                if (event.type === "tool.failed") {
                  return (
                    <div key={event.seq} className={styles.termErr}>
                      ✗ {String(payload.code ?? "TOOL_FAILED")} {String(payload.message ?? "")}
                    </div>
                  );
                }
                return (
                  <div key={event.seq} className={styles.termOut}>
                    {String(payload.output ?? "").slice(0, 800)}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </div>
    </aside>
  );
}
