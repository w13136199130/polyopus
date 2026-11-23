import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import styles from "./CommandPalette.module.css";

interface Command {
  id: string;
  label: string;
  hint: string;
  path?: string;
  action?: "new-chat";
  permission?: string;
}

const COMMANDS: Command[] = [
  { id: "chat", label: "对话", hint: "打开会话工作台", path: "/chat", permission: "chat:read" },
  { id: "new-chat", label: "新建对话", hint: "从空白或当前专家开始", action: "new-chat", permission: "chat:write" },
  { id: "tasks", label: "任务", hint: "待决 / 运行 / 排队 / 完成", path: "/tasks", permission: "ticket:read" },
  { id: "agents", label: "专家", hint: "管理专家与草稿", path: "/agents", permission: "agent:read" },
  { id: "knowledge", label: "知识", hint: "知识库与检索", path: "/knowledge", permission: "knowledge:read" },
  { id: "connections", label: "连接", hint: "来源与连接器", path: "/connections", permission: "source:read" },
  { id: "extensions", label: "扩展", hint: "插件与工具", path: "/extensions", permission: "extension:read" },
  { id: "automation", label: "自动化", hint: "定时任务", path: "/automation", permission: "cron:read" },
  { id: "usage", label: "用量", hint: "Token 与成本", path: "/usage", permission: "usage:read" },
  { id: "notifications", label: "通知", hint: "站内通知中心", path: "/notifications" },
  { id: "settings", label: "设置", hint: "外观与账号", path: "/settings", permission: "settings:read" },
  { id: "admin", label: "管理", hint: "用户、模型、存储与安全", path: "/admin", permission: "user:read" },
];

/** Global ⌘K / Ctrl+K palette (prototype command panel). */
export function CommandPalette() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands = useMemo(
    () => COMMANDS.filter((cmd) => !cmd.permission || hasPermission(user, cmd.permission)),
    [user],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((cmd) =>
      `${cmd.label} ${cmd.hint}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
        setIndex(0);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  if (!open) return null;

  function run(command: Command | undefined) {
    if (!command) return;
    setOpen(false);
    if (command.action === "new-chat") navigate("/chat?new=1");
    else if (command.path) navigate(command.path);
  }

  return (
    <div className={styles.overlay} onMouseDown={() => setOpen(false)}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="搜索页面或动作…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((value) => Math.min(filtered.length - 1, value + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((value) => Math.max(0, value - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(filtered[index]);
            }
          }}
        />
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <p className={styles.empty}>没有匹配的命令</p>
          ) : filtered.map((command, position) => (
            <button
              key={command.id}
              type="button"
              className={`${styles.row} ${position === index ? styles.rowOn : ""}`}
              onMouseEnter={() => setIndex(position)}
              onClick={() => run(command)}
            >
              <span className={styles.label}>{command.label}</span>
              <span className={styles.hint}>{command.hint}</span>
            </button>
          ))}
        </div>
        <div className={styles.footer}>
          <kbd>↑↓</kbd> 选择 <kbd>Enter</kbd> 打开 <kbd>Esc</kbd> 关闭
        </div>
      </div>
    </div>
  );
}
