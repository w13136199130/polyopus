import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { NAV_GROUPS, NAV_ITEMS, navHref } from "@/app/nav";
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

const GROUP_LABEL = Object.fromEntries(NAV_GROUPS.map((group) => [group.key, group.label]));

const EXTRA_COMMANDS: Command[] = [
  { id: "new-chat", label: "新建对话", hint: "从空白或当前专家开始", action: "new-chat", permission: "chat:write" },
  { id: "notifications", label: "通知", hint: "站内通知中心", path: "/notifications" },
  { id: "settings", label: "个人设置", hint: "外观与账号", path: "/settings", permission: "settings:read" },
];

/** Single source of truth: nav entries + a few non-nav surfaces/actions. */
const COMMANDS: Command[] = [
  ...EXTRA_COMMANDS.slice(0, 1),
  ...NAV_ITEMS.map((item) => ({
    id: `${item.path}${item.search ?? ""}`,
    label: item.label,
    hint: `${GROUP_LABEL[item.group] || "主功能"}${item.soon ? " · 规划中" : ""}`,
    path: navHref(item),
    permission: item.permission,
  })),
  ...EXTRA_COMMANDS.slice(1),
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
