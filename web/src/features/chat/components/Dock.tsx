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

function traceRow(event: TraceEvent): { kind: string; text: string; tone: string } | null {
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "turn.started":
      return { kind: "turn", text: `模型 ${String(payload.model ?? "")} 开始`, tone: "info" };
    case "turn.finished":
      return { kind: "turn", text: String(payload.status ?? "完成"), tone: "ok" };
    case "tool.started":
      return {
        kind: String(payload.name ?? "tool"),
        text: String(payload.args_preview ?? "调用工具"),
        tone: "info",
      };
    case "tool.completed":
      return { kind: "完成", text: "工具输出已返回", tone: "ok" };
    case "tool.failed":
      return { kind: "失败", text: String(payload.message ?? payload.code ?? ""), tone: "bad" };
    case "approval.requested":
      return {
        kind: "审批",
        text: `等待确认 · ${String(payload.tool ?? "")}`,
        tone: "warn",
      };
    case "message.started":
      return { kind: "回复", text: "开始生成", tone: "info" };
    default:
      return null;
  }
}

/**
 * Right-hand Dock (prototype `.dock`): 文件/工作区/浏览器/轨迹/终端.
 * Files and the terminal come from real backend data; the browser tab is an
 * honest empty state because v1.0 has no browser session backend.
 */
export function Dock({
  threadId, tab, onTab, onClose, trace, traceLoading, tree, treeLoading,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const rows = (trace ?? [])
    .map((event) => ({ event, row: traceRow(event) }))
    .filter((item) => item.row !== null)
    .slice(-60);

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
            <div className={styles.timeline}>
              {rows.map(({ event, row }) => (
                <div key={`${event.seq}-${event.type}`} className={`${styles.tl} ${styles[row!.tone]}`}>
                  <span className={styles.time}>{new Date(event.ts * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className={styles.kind}>{row!.kind}</span>
                  <span className={styles.txt}>{row!.text}</span>
                </div>
              ))}
            </div>
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
