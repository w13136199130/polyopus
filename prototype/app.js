/* PolyOpus interactive prototype */
(function () {
  "use strict";

  /* ---------------- utils ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const icon = (name, cls) =>
    '<svg class="ic ' + (cls || "") + '"><use href="#i-' + name + '"/></svg>';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () =>
    new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const money = (n) => "¥" + Number(n).toFixed(2);
  const pct = (n) => Math.round(n * 100) + "%";

  /* ---------------- data ---------------- */
  const TASKS = [
    {
      id: "tk_412", title: "修复登录超时", bucket: "attention", state: "open",
      source: "github", sourceLabel: "GitHub", ref: "#412 · acme/api",
      actor: "alice", actorColor: "violet", executor: "内置", strength: "explicit",
      policy: 7, progress: 0.6, cost: 0.42, budget: 2.0, createdAt: "12 分钟前",
      summary: "已定位到 auth.ts:88，需要确认 CI 配置改动",
      attention: {
        id: "at_1", kind: "approval",
        question: "是否允许修改 .github/workflows/ci.yml？",
        detail: "影响：CI 配置（写操作）· 授权范围 repo:acme/api",
      },
      timeline: [
        ["10:02", "Trigger", "issue_comment #412 · @alice「登录 502，麻烦看下」", "info"],
        ["10:02", "Gate", "pass · actor allowed · explicit request", "ok"],
        ["10:02", "Eval", "accept · explicit · scope repo:acme/api · confidence 0.86", "ok"],
        ["10:02", "Ticket", "opened · 授权签发（policy v7）", ""],
        ["10:03", "Assign", "builtin → session s_88 · workdir /t_412", ""],
        ["10:07", "Report", "progress 60% · 定位到 auth.ts:88", "info"],
        ["10:12", "Attention", "需要确认：是否允许修改 .github/workflows/ci.yml", "warn"],
      ],
      reports: [
        ["10:12", "waiting", "需要确认是否修改 CI 配置；已暂停，不消耗预算。"],
        ["10:07", "progress", "已定位到 auth.ts:88；准备补一个失败用例复现。"],
      ],
      artifacts: [
        ["file", "patch-auth.diff", "6.2 KB"],
        ["file", "trace-2026-11-05.json", "18 KB"],
        ["globe", "PR #418（待创建）", "预览"],
      ],
    },
    {
      id: "tk_411", title: "补充导出接口文档", bucket: "running", state: "open",
      source: "github", sourceLabel: "GitHub", ref: "#411 · acme/api",
      actor: "bob", actorColor: "blue", executor: "Claude Code", strength: "explicit",
      policy: 7, progress: 0.6, cost: 0.42, budget: 2.0, createdAt: "03:12",
      summary: "读 12 文件 · 改 3 文件 · 待跑测试",
      timeline: [
        ["10:01", "Trigger", "pull_request_review_comment #411 · @bob「补下导出接口文档」", "info"],
        ["10:01", "Eval", "accept · explicit · scope repo:acme/api", "ok"],
        ["10:02", "Assign", "claude_code → session cc_31", ""],
        ["10:09", "Report", "progress 60% · 已改 3 个文件，准备跑测试", "info"],
      ],
      reports: [["10:09", "progress", "已改 3 个文件，准备跑测试。"]],
      artifacts: [["file", "openapi.yaml", "24 KB"]],
    },
    {
      id: "tk_410", title: "整理本周发布记录", bucket: "attention", state: "open",
      source: "feishu", sourceLabel: "飞书", ref: "研发群 · 话题 #release",
      actor: "carol", actorColor: "amber", executor: "内置", strength: "explicit",
      policy: 7, progress: 0.35, cost: 2.0, budget: 2.0, createdAt: "08:40",
      summary: "预算已用尽，等待追加",
      stalled: true,
      attention: {
        id: "at_3", kind: "blocked",
        question: "预算已用尽（¥2.00 / ¥2.00）",
        detail: "已产出 60% 的发布记录；追加预算可继续。",
      },
      timeline: [
        ["08:40", "Trigger", "飞书 · @carol「整理下本周发布记录」", "info"],
        ["08:41", "Eval", "accept · explicit · scope channel:feishu/release", "ok"],
        ["08:42", "Assign", "builtin → session s_91", ""],
        ["09:10", "Report", "blocked · budget_exhausted", "warn"],
      ],
      reports: [["09:10", "blocked", "预算耗尽，已产出 60%。"]],
      artifacts: [["file", "release-notes.md", "9 KB"]],
    },
    {
      id: "tk_409", title: "核对供应商报价", bucket: "queued", state: "open",
      source: "email", sourceLabel: "邮件", ref: "ops@acme.com",
      actor: "dave", actorColor: "blue", executor: "内置", strength: "explicit",
      policy: 7, progress: 0, cost: 0, budget: 1.0, createdAt: "1 小时前",
      summary: "等待执行器空闲",
      timeline: [
        ["09:12", "Trigger", "邮件 · @dave「核对三家供应商报价」", "info"],
        ["09:12", "Eval", "accept · explicit · scope mail:ops", "ok"],
        ["09:12", "Ticket", "opened · 等待执行器", ""],
      ],
      reports: [],
      artifacts: [],
    },
    {
      id: "tk_408", title: "更新 README 快速开始", bucket: "done", state: "ended",
      source: "github", sourceLabel: "GitHub", ref: "#409 · acme/api",
      actor: "alice", actorColor: "violet", executor: "内置", strength: "explicit",
      policy: 7, progress: 1, cost: 0.18, budget: 1.0, createdAt: "昨天",
      summary: "PR #417 已合并",
      timeline: [
        ["昨天", "Trigger", "issue_comment #409 · @alice「README 跑不起来」", "info"],
        ["昨天", "Ticket", "opened", ""],
        ["昨天", "Report", "ready · PR #417", "ok"],
        ["昨天", "Ticket", "ended · completed", "ok"],
      ],
      reports: [["昨天", "ready", "PR #417 已创建并合并。"]],
      artifacts: [["globe", "PR #417", "已合并"]],
    },
    {
      id: "tk_407", title: "补一个导出接口", bucket: "attention", state: "open",
      source: "github", sourceLabel: "GitHub", ref: "#410 · acme/api",
      actor: "bob", actorColor: "blue", executor: "内置", strength: "explicit",
      policy: 7, progress: 0.2, cost: 0.12, budget: 1.0, createdAt: "40 分钟前",
      summary: "等待回答字段命名",
      attention: {
        id: "at_2", kind: "question",
        question: "目标字段名用 camelCase 还是 snake_case？",
        detail: "Agent 已暂停，不会继续消耗预算。",
      },
      timeline: [
        ["09:30", "Trigger", "issue_comment #410 · @bob「补一个导出接口」", "info"],
        ["09:31", "Ticket", "opened", ""],
        ["09:44", "Attention", "question · 字段命名", "warn"],
      ],
      reports: [["09:44", "waiting", "等待字段命名确认。"]],
      artifacts: [],
    },
  ];

  const SESSIONS = [
    { id: "s1", title: "登录超时排查", preview: "已定位到 auth.ts:88…", time: "12:02", badge: "任务", unread: true, pinned: true },
    { id: "s2", title: "API 文档补全", preview: "PR #418 已提交", time: "11:40", pinned: true },
    { id: "s3", title: "周报数据核对", preview: "表格已生成，等你确认口径", time: "10:15", active: true },
    { id: "s4", title: "发布流程问答", preview: "引用 ops-handbook #deploy", time: "09:52" },
    { id: "s5", title: "竞品调研", preview: "已整理 6 家对比", time: "昨天", group: "更早" },
    { id: "s6", title: "数据库迁移方案", preview: "方案 B 已确认", time: "周一", group: "更早" },
  ];

  const SESSION_THREADS = {
    s2: [
      { role: "system", text: "已关联 PR #418 · acme/api" },
      { role: "user", text: "补一下导出接口文档，顺便更新 openapi.yaml。", time: "11:20" },
      { role: "assistant", time: "11:22", steps: [["读取 3 个文件", "1.2s"], ["生成文档", "2.4s"]],
        text: "已补全 6 个接口的说明，并在 openapi.yaml 里加了 export 的 schema。没有改业务代码。",
        tool: { name: "fs.write", arg: "docs/export.md", status: "完成 1.1s" } },
    ],
    s3: [
      { role: "system", text: "周报数据 · 2026-W45" },
      { role: "user", text: "把本周数据核对一下，和上周做个对比。", time: "10:15" },
      { role: "assistant", time: "10:16", steps: [["读取 2 个表格", "0.8s"], ["计算环比", "0.2s"]],
        text: "本周新增 42 个工单，环比 +12%；失败率 0.4%，低于阈值。表格已生成，等你确认口径后导出。",
        tool: { name: "sheet.read", arg: "weekly.xlsx", status: "完成 0.8s" } },
      { role: "assistant", id: "m_s3_ask", time: "10:17", text: "导出前确认两个口径：",
        ask: { status: "pending", questions: [
          { header: "范围", question: "本周发布记录要包含哪些环境？", multi_select: true,
            options: [{ label: "生产发布" }, { label: "预发环境" }, { label: "全部环境" }] },
          { header: "格式", question: "输出成什么格式？", multi_select: false,
            options: [{ label: "飞书文档" }, { label: "Markdown 文件" }] },
        ], state: { current: 0, reviewing: false, answers: [{ picked: [], other: "" }, { picked: [], other: "" }] } } },
    ],
    s4: [
      { role: "system", text: "知识库 · ops-handbook" },
      { role: "user", text: "发布流程需要谁审批？", time: "09:52" },
      { role: "assistant", time: "09:52", text: "发布审批由 SRE 负责人和业务 owner 共同确认；紧急发布需值班经理批准。引用：ops-handbook #deploy。",
        citations: ["ops-handbook · #deploy"] },
      { role: "assistant", id: "m_s4_plan", time: "09:53", text: "我已把发布流程整理成一份可执行计划，包含检查项、审批人与回滚点。",
        plan: { path: "/plans/release.md", status: "ready" } },
    ],
    s5: [
      { role: "system", text: "竞品调研 · 6 家" },
      { role: "user", text: "整理一下这 6 家的定价和插件机制。", time: "昨天" },
      { role: "assistant", time: "昨天", text: "已整理成对比表：定价分订阅/按量两类，插件机制以 MCP 和函数沙箱为主。需要我导出 markdown 吗？" },
    ],
    s6: [
      { role: "system", text: "数据库迁移 · 方案 B" },
      { role: "user", text: "方案 B 的停机窗口多长？", time: "周一" },
      { role: "assistant", time: "周一", text: "方案 B 预估 18 分钟停机，包含双写校验和回滚点；建议在周三 14:00–17:00 窗口执行。" },
    ],
  };

  const AGENTS = [
    { id: "ag_1", name: "业务专家", desc: "SOP、流程、风险评估", model: "deepseek-v4", color: "teal", status: "运行中", sessions: 24 },
    { id: "ag_2", name: "代码助手", desc: "读代码、改代码、跑测试", model: "claude-sonnet", color: "violet", status: "运行中", sessions: 18 },
    { id: "ag_3", name: "知识库问答", desc: "基于内部文档回答", model: "deepseek-v4", color: "blue", status: "空闲", sessions: 41 },
    { id: "ag_4", name: "发布管家", desc: "发布检查、周报、通知", model: "deepseek-v4", color: "amber", status: "已停止", sessions: 6 },
  ];

  const KBS = [
    { id: "kb_ops", name: "运维手册", docs: 24, chunks: 1820, status: "ready" },
    { id: "kb_api", name: "API 文档", docs: 12, chunks: 940, status: "ready" },
    { id: "kb_hr", name: "人事制度", docs: 8, chunks: 310, status: "indexing" },
  ];

  const DOCS = {
    kb_ops: [
      ["deploy.md", "Markdown", "ready", 42, "2 小时前"],
      ["incident-runbook.pdf", "PDF", "ready", 128, "昨天"],
      ["oncall.md", "Markdown", "ready", 36, "3 天前"],
      ["legacy-notes.docx", "Word", "failed", 0, "上周"],
    ],
    kb_api: [
      ["openapi.yaml", "YAML", "ready", 210, "今天"],
      ["auth.md", "Markdown", "ready", 64, "昨天"],
    ],
    kb_hr: [["handbook.pdf", "PDF", "processing", 0, "刚刚"]],
  };

  const CONNECTORS = [
    { name: "GitHub", kind: "mcp", status: "已连接", detail: "acme/api · 12 个工具" },
    { name: "飞书", kind: "channel", status: "已连接", detail: "研发群 · 1 个机器人" },
    { name: "Notion", kind: "oauth", status: "已过期", detail: "需要重新授权" },
    { name: "PostgreSQL", kind: "mcp", status: "未连接", detail: "只读查询" },
  ];

  const PLUGINS = [
    { name: "weather", desc: "天气卡片", version: "0.2.2", on: true, perms: ["网络"] },
    { name: "github-trending", desc: "趋势仓库", version: "0.1.4", on: true, perms: ["网络"] },
    { name: "qrcode", desc: "二维码生成", version: "0.3.0", on: false, perms: [] },
    { name: "demo-ui-card", desc: "交互卡片示例", version: "0.1.0", on: false, perms: ["工作区"] },
  ];
  const PLUGIN_MARKET = [
    { name: "calendar-sync", desc: "同步日历与会议", version: "1.2.0", perms: ["网络", "日历"] },
    { name: "notion-export", desc: "导出页面到 Notion", version: "0.9.0", perms: ["网络"] },
    { name: "pdf-tools", desc: "PDF 拆分 / OCR", version: "1.4.1", perms: ["文件"] },
  ];

  const KEYMAP_DEFAULT = { palette: "⌘K", newChat: "⌘N", inbox: "⌘⇧A", stop: "⌘." };
  const ROLE_PERMS = {
    admin: ["*"],
    member: ["chat", "tasks", "agents", "knowledge", "connections", "extensions", "workbench", "usage", "settings"],
    auditor: ["chat", "tasks", "knowledge", "usage", "settings", "audit"],
  };
  const ROLE_LABEL = { admin: "管理员", member: "成员", auditor: "只读审计" };
  const ACTION_PERM = {
    "new-chat": "chat:write", send: "chat:write", "edit-save": "chat:write", attach: "chat:write",
    "queue-steer": "chat:write", "task-new": "tasks:write",
    "agent-new": "agents:write", "agent-save": "agents:write", "agent-publish": "agents:write",
    "conn-add": "connections:write", "conn-save": "connections:write", "conn-delete": "connections:write",
    "kb-upload": "knowledge:write", "kb-newfile": "knowledge:write", "kb-newfolder": "knowledge:write",
    "doc-delete": "knowledge:write", "doc-reindex": "knowledge:write",
    "kb-bulk-delete": "knowledge:write", "kb-bulk-reindex": "knowledge:write",
    "security-save": "admin", "env-save": "admin", "user-invite": "admin", "user-new": "admin",
  };

  const state = {
    route: "chat",
    role: "admin",
    errorDemo: null,
    loggedOut: false,
    loginError: "",
    listError: false,
    keymap: (() => {
      try { return { ...KEYMAP_DEFAULT, ...JSON.parse(localStorage.getItem("poly.keymap") || "{}") }; }
      catch (e) { return { ...KEYMAP_DEFAULT }; }
    })(),
    theme: localStorage.getItem("poly.theme") || "light",
    palette: localStorage.getItem("poly.palette") || "tech",
    density: localStorage.getItem("poly.density") || "default",
    railCollapsed: localStorage.getItem("poly.rail") === "1",
    userMenu: false,
    layout: localStorage.getItem("poly.layout") || "classic",
    lang: "zh",
    displayName: localStorage.getItem("poly.displayName") || "admin",
    email: localStorage.getItem("poly.email") || "admin@polyopus.local",
    avatarColor: "blue",
    formErrors: {},
    tables: {},
    contextPct: 62,
    agentColor: "tech",
    piiStrategy: "掩码",
    skillScan: "拦截",
    lastBackup: "2026-11-05 03:00 · 1.8 GB · 成功",
    mbti: "INTJ 建筑师",
    bridgeConnected: true,
    remoteConnected: false,
    personalSubagents: [
      { name: "调研员", desc: "负责检索与事实核对", status: "运行中" },
      { name: "写手", desc: "负责初稿与改写", status: "空闲" },
    ],
    notifications: { approval: true, task: true, budget: true, weekly: false },
    adminUsers: [
      { u: "admin", n: "管理员", e: "admin@polyopus.local", role: "管理员", auth: "密码 + 单点登录", status: "已启用" },
      { u: "alice", n: "Alice Chen", e: "alice@acme.com", role: "成员", auth: "飞书", status: "已启用" },
      { u: "bob", n: "Bob Li", e: "bob@acme.com", role: "成员", auth: "密码", status: "已启用" },
      { u: "carol", n: "Carol Wang", e: "carol@acme.com", role: "成员", auth: "钉钉", status: "已禁用" },
    ],
    providers: [
      { name: "DeepSeek", id: "deepseek", status: "已授权", models: "deepseek-v4 / deepseek-r1" },
      { name: "OpenAI", id: "openai", status: "未授权", models: "gpt-5 / gpt-5-mini" },
      { name: "Ollama", id: "ollama", status: "本地", models: "qwen2.5 / llama3" },
      { name: "自定义", id: "custom", status: "未配置", models: "OpenAI 兼容端点" },
    ],
    storages: [
      { name: "本地目录", id: "filesystem", status: "已配置", detail: "/data/workspaces · 读写" },
      { name: "腾讯云 COS", id: "cos", status: "已配置", detail: "cos-prod · ap-guangzhou" },
      { name: "PostgreSQL", id: "postgres", status: "未配置", detail: "结构化存储" },
      { name: "Docker 沙箱", id: "docker", status: "未配置", detail: "按专家隔离" },
    ],
    customColor: "#1677ff",
    tasks: TASKS.map((t) => ({ ...t })),
    selectedTask: "tk_412",
    selectedAttention: "at_1",
    bucket: "attention",
    sourceFilter: "all",
    attFilter: "all",
    q: "",
    messages: [
      { role: "system", text: "已从 GitHub #412 创建任务 · 授权 explicit · 策略 v7 · 10:02" },
      { role: "user", id: "m1", text: "帮我修一下 issue #412 的登录超时，先看下相关代码，别直接改。", time: "10:02" },
      {
        role: "assistant", id: "m2", time: "10:03",
        steps: [["读取 3 个文件", "0.8s"], ["检索知识库", "2 条引用"]],
        text: "定位到 src/auth.ts:88：refreshToken 在 401 时没有清空旧 token，重试会带着过期凭证死循环。先只读，未做修改。",
        code: { file: "src/auth.ts · 88-94", lang: "TypeScript", body: "// 检测到的问题\nif (res.status === 401) {\n  // TODO: 这里没有清理旧 token\n  return retry(req, token)\n}" },
        tool: { name: "fs.read", arg: "src/auth.ts", status: "完成 0.8s" },
        files: { open: false, items: [
          { path: "src/auth.ts", status: "M", add: 12, del: 4, diff: "-   return retry(req, token)\n+   if (res.status === 401) {\n+     clearToken()\n+     return retry(req, token)\n+   }" },
          { path: "tests/auth.spec.ts", status: "A", add: 28, del: 0, diff: "+ it('clears expired token before retry', async () => {\n+   await expect(login()).rejects.toThrow('401')\n+ })" },
        ] },
        citations: ["ops-handbook · 发布流程", "issue #412 · alice"],
        approval: "at_1",
      },
    ],
    streaming: false,
    streamTimer: null,
    queue: [],
    draft: "",
    editingMessage: null,
    editDraft: "",
    sessionQ: "",
    activeSession: "s1",
    threads: {},
    chatWelcome: false,
    dockOpen: false,
    dockTab: "files",
    sessionState: {},
    olderLoaded: false,
    pendingScroll: null,
    autoScroll: true,
    selectedSkills: ["weather"],
    selectedSubagents: ["researcher"],
    selectedConnectors: ["feishu"],
    attachments: [],
    hitl: "ask",
    mentionQ: "",
    slashQ: "",
    chatError: false,
    modelMissing: false,
    offline: false,
    connectorsEmpty: false,
    adminEmpty: false,
    inviteError: "",
    envRows: [["OCTOP_DEFAULT_TIMEZONE", "Asia/Shanghai"], ["OCTOP_LOG_LEVEL", "info"], ["OCTOP_MAX_WORKERS", "4"]],
    envError: "",
    usageView: "summary",
    usageRange: "30d",
    extView: "installed",
    extraSkills: [],
    skillVersion: {},
    skillToggle: {},
    kbSelected: [],
    kbSearch: "",
    model: "deepseek-v4",
    mode: "Act",
    kbCount: 2,
    modal: null,
    menu: null,
    drawer: null,
    cmd: false,
    cmdQ: "",
    kb: "kb_ops",
    kbTab: "docs",
    kbView: "table",
    kbFolder: "root",
    kbTest: null,
    agent: null,
    agentTab: "overview",
    settingsTab: "appearance",
    persTab: "skills",
    channelTab: "all",
    userTab: "users",
    modelTab: "chat",
    connTab: "enabled",
    connector: null,
    mcpMode: "visual",
    cronFilter: "all",
    securityTab: "hitl",
    advTab: "env",
    toasts: [],
  };
  state.threads.s1 = state.messages;

  /* ---------------- persistence ---------------- */
  function applyTheme() {
    const resolved = state.theme === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : state.theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.palette = state.palette;
    if (state.palette === "custom") {
      document.documentElement.style.setProperty("--primary", state.customColor);
    } else {
      document.documentElement.style.removeProperty("--primary");
    }
    document.body.dataset.density = state.density;
    document.body.dataset.role = state.role;
  }
  function can(perm) {
    if (state.role === "admin") return true;
    const [base, action] = String(perm).split(":");
    if (!(ROLE_PERMS[state.role] || []).includes(base)) return false;
    if (action === "write" && state.role === "auditor") return false;
    return true;
  }

  function requirePerm(perm, message) {
    if (can(perm)) return true;
    toast(message || "当前角色没有此操作权限", "error");
    return false;
  }

  function savePrefs() {
    localStorage.setItem("poly.theme", state.theme);
    localStorage.setItem("poly.palette", state.palette);
    localStorage.setItem("poly.density", state.density);
    localStorage.setItem("poly.rail", state.railCollapsed ? "1" : "0");
    localStorage.setItem("poly.layout", state.layout);
    localStorage.setItem("poly.keymap", JSON.stringify(state.keymap));
  }

  function matchCombo(e, combo) {
    const norm = String(combo || "").toLowerCase()
      .replace(/⌘/g, "mod+").replace(/⇧/g, "shift+").replace(/⌥/g, "alt+")
      .replace(/cmd|ctrl|control/g, "mod").replace(/option/g, "alt");
    const parts = norm.split("+").map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return false;
    const key = parts[parts.length - 1];
    const needMod = parts.includes("mod");
    const needShift = parts.includes("shift");
    const needAlt = parts.includes("alt");
    return needMod === (e.metaKey || e.ctrlKey) &&
      needShift === e.shiftKey && needAlt === e.altKey &&
      e.key.toLowerCase() === key;
  }

  /* ---------------- routing ---------------- */
  function parseRoute() {
    const h = (location.hash || "#/chat").replace(/^#\/?/, "");
    return h || "chat";
  }
  function navigate(path) {
    state.menu = null;
    if (location.hash === "#/" + path) {
      state.route = parseRoute();
      render();
    } else {
      location.hash = "#/" + path;
    }
  }
  window.addEventListener("hashchange", () => {
    state.route = parseRoute();
    state.menu = null;
    state.modal = null;
    state.drawer = null;
    if (state.route.startsWith("tasks/")) {
      const id = state.route.split("/")[1];
      if (taskById(id)) state.selectedTask = id;
    }
    render();
  });

  function loadingThen(el, ms, fn) {
    if (!el || el.disabled || el.classList.contains("loading")) return;
    el.classList.add("loading");
    el.disabled = true;
    setTimeout(fn, ms);
  }

  /* ---------------- toast ---------------- */
  function toast(msg, type) {
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML =
      (type === "error" ? icon("alert", "ic-sm") : icon("check", "ic-sm")) +
      "<span>" + esc(msg) + "</span>";
    box.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  /* ---------------- helpers ---------------- */
  const taskById = (id) => state.tasks.find((t) => t.id === id);
  const attentionById = (id) => {
    for (const t of state.tasks) {
      if (t.attention && t.attention.id === id) return { task: t, att: t.attention };
    }
    return null;
  };
  const attentions = () => state.tasks.filter((t) => t.attention && !t.attention.resolved).map((t) => ({ task: t, att: t.attention }));
  const bucketCount = (b) => state.tasks.filter((t) => (b === "all" ? true : t.bucket === b)).length;
  const approvalResolved = (attId) => {
    const t = taskById("tk_412");
    return t && t.attention && t.attention.id === attId && t.attention.resolved;
  };

  function sourceTag(source) {
    const map = {
      github: ["GH", "GitHub", "outline"],
      feishu: ["FS", "飞书", "outline"],
      email: ["EM", "邮件", "outline"],
      webhook: ["WH", "Webhook", "outline"],
    };
    const m = map[source] || ["", source, "outline"];
    return '<span class="tag ' + m[2] + '">' + m[0] + "</span>";
  }

  /* ---------------- render: shell ---------------- */
  function renderRail() {
    const primary = [
      ["chat", "chat", "对话"],
      ["tasks", "inbox", "任务"],
      ["agents", "bot", "专家"],
      ["knowledge", "book", "知识"],
      ["connections", "plug", "连接"],
      ["extensions", "grid", "扩展"],
      ["workbench", "monitor", "工作台"],
      ["usage", "chart", "用量"],
    ].filter(([r]) => can(r));
    const bottom = [["settings", "sliders", "设置"], ["admin", "shield", "管理"]].filter(([r]) => can(r));
    const workItems = primary.filter(([r]) => ["chat", "tasks", "agents", "knowledge"].includes(r));
    const capItems = primary.filter(([r]) => !["chat", "tasks", "agents", "knowledge"].includes(r));
    const n = attentions().length;    const isActive = (r) => {
      const map = {
        chat: /^chat/, tasks: /^(tasks|inbox|ticket|automation)/,
        agents: /^(agents|experts|personalization)/, knowledge: /^knowledge/,
        connections: /^(connections|channels|bridge|acp)/, extensions: /^(extensions|skills)/,
        workbench: /^(workbench|remote)/, usage: /^usage/,
        settings: /^settings/, admin: /^admin/,
      };
      return (map[r] || new RegExp("^" + r)).test(state.route);
    };
    const item = ([r, i, label]) =>
      '<button class="rail-item ' + (isActive(r) ? "active" : "") + '" data-act="nav" data-route="' + r + '" title="' + label + '">' +
      icon(i) + '<span class="label">' + label + "</span>" +
      (r === "tasks" && n ? '<span class="badge">' + n + "</span>" : "") + "</button>";
    return '<aside class="rail ' + (state.railCollapsed ? "collapsed" : "") + '">' +
      '<div class="rail-brand"><button class="logo" data-act="rail-toggle" title="' + (state.railCollapsed ? "展开导航" : "收起导航") + '">P</button>' +
      '<div class="brand-text"><b>PolyOpus</b><span>v0.1 · 原型</span></div>' +
      '<button class="icon-btn rail-collapse" data-act="rail-toggle" title="' + (state.railCollapsed ? "展开导航" : "收起导航") + '">' + icon("chev", "ic-sm") + "</button></div>" +
      '<nav class="rail-nav">' + (workItems.length ? '<div class="rail-group">工作</div>' + workItems.map(item).join("") : "") +
      (capItems.length ? '<div class="rail-group">能力</div>' + capItems.map(item).join("") : "") +
      '<div class="rail-group">系统</div>' + bottom.map(item).join("") + "</nav>" +
      '<div class="rail-foot"><button class="rail-user" data-act="user-menu" title="账户与设置">' +
      '<span class="avatar blue">A</span><span class="meta"><span class="name">' + esc(state.displayName) + '</span><span class="role">' + ROLE_LABEL[state.role] + ' · 个人账户</span></span>' +
      '<span class="chev">' + icon("chev", "ic-xs") + "</span></button></div></aside>";
  }

  function chatSessionListHTML() {
    const q = (state.sessionQ || "").trim().toLowerCase();
    const list = SESSIONS.filter((s) => !q || (s.title + " " + s.preview).toLowerCase().includes(q));
    let items = "";
    let group = "";
    list.forEach((s) => {
      const g = s.group || (s.pinned ? "置顶" : "今天");
      if (g !== group) { items += '<div class="group-label">' + g + "</div>"; group = g; }
      const active = !state.chatWelcome && state.activeSession === s.id ? " active" : "";
      items += '<div class="list-item' + active + '" data-act="session" data-id="' + s.id + '">' +
        '<span class="dot' + (s.unread ? " blue" : "") + '" style="margin-top:6px"></span>' +
        '<div class="li-main"><div class="list-title">' + esc(s.title) +
        (s.badge ? ' <span class="tag blue sm">' + s.badge + "</span>" : "") +
        '</div><div class="list-sub">' + esc(s.preview) + "</div></div>" +
        '<div class="session-meta"><span class="list-time">' + esc(s.time) + "</span>" +
        '<button class="icon-btn session-more" data-act="session-menu" data-id="' + s.id + '" title="会话操作">' + icon("more", "ic-sm") + "</button></div></div>";
    });
    if (!list.length) items = '<div class="empty" style="padding:28px 12px"><b>没有匹配的会话</b><p>换个关键词试试。</p></div>';
    return items;
  }

  function renderChatSide() {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">对话</div>' +
      '<div class="side-sub">业务专家 · ' + SESSIONS.length + " 个会话</div></div>" +
      '<button class="icon-btn" data-act="new-chat" title="新建对话">' + icon("plus") + "</button></div>" +
      '<div style="padding:0 12px 10px"><div class="search">' + icon("search", "ic-sm") +
      '<input placeholder="搜索会话" data-input="session-search" value="' + esc(state.sessionQ) + '" /></div></div>' +
      '<div class="side-body" id="session-list">' + chatSessionListHTML() + "</div>" +
      '<div class="side-foot" style="display:block"><button class="btn block" data-act="new-chat">' + icon("plus", "ic-sm") + "新建对话</button></div></aside>";
  }

  function renderTasksSide() {
    const srcs = [["all", "全部来源", "grid"], ["github", "GitHub", "gh"], ["feishu", "飞书", "fs"], ["email", "邮件", "em"]];
    const srcLabel = { github: "GH", feishu: "FS", email: "EM" };
    return '<aside class="side"><div class="side-head"><div><div class="side-title">任务</div>' +
      '<div class="side-sub">今日 12 · 待决 ' + attentions().length + "</div></div></div>" +
      '<div style="padding:0 12px 10px"><div class="search">' + icon("search", "ic-sm") +
      '<input placeholder="搜索任务、发起人或 PR" data-input="task-search" value="' + esc(state.q) + '" /></div></div>' +
      '<div class="side-body"><div class="group-label">来源</div>' +
      srcs.slice(1).map(([v, label]) =>
        '<div class="side-nav ' + (state.sourceFilter === v ? "active" : "") + '" data-act="filter-source" data-value="' + v + '">' +
        '<span class="tag outline">' + srcLabel[v] + "</span><span>" + label + "</span>" +
        '<span class="count">' + state.tasks.filter((t) => t.source === v).length + "</span></div>").join("") +
      '<div class="group-label">执行器</div>' +
      ["内置", "Claude Code", "Codex"].map((e) =>
        '<div class="side-nav"><span class="dot ' + (e === "内置" ? "blue" : "") + '"></span><span>' + e + "</span>" +
        '<span class="count">' + state.tasks.filter((t) => t.executor === e).length + "</span></div>").join("") +
      '<div class="group-label">快捷</div>' +
      '<div class="side-nav" data-act="nav" data-route="inbox">' + icon("inbox", "ic-sm") + "<span>待我决定</span><span class=\"count\">" + attentions().length + "</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="settings">' + icon("sliders", "ic-sm") + "<span>任务设置</span></div>" +
      "</div></aside>";
  }

  function renderInboxSide() {
    const list = attentions();
    const count = (k) => (k === "all" ? list.length : list.filter((x) => x.att.kind === k).length);
    const items = [
      ["all", "全部待决", "inbox"],
      ["approval", "审批", "shield"],
      ["question", "提问", "chat"],
      ["blocked", "受阻", "alert"],
    ];
    return '<aside class="side"><div class="side-head"><div><div class="side-title">收件箱</div>' +
      '<div class="side-sub">' + list.length + " 件待你决定</div></div></div>" +
      '<div class="side-body">' +
      items.map(([k, label, ic]) =>
        '<div class="side-nav ' + (state.attFilter === k ? "active" : "") + '" data-act="att-filter" data-value="' + k + '">' +
        icon(ic, "ic-sm") + "<span>" + label + "</span><span class=\"count\">" + count(k) + "</span></div>").join("") +
      '<div class="divider"></div>' +
      '<div class="side-nav" data-act="inbox-read-all">' + icon("check", "ic-sm") + "<span>全部标记已读</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="tasks">' + icon("inbox", "ic-sm") + "<span>返回任务中心</span></div>" +
      "</div>" +
      '<div class="side-foot">' + icon("info", "ic-sm") + "<span>审批/提问/受阻会进入这里</span></div></aside>";
  }

  function renderKnowledgeSide() {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">知识</div>' +
      '<div class="side-sub">3 个知识库 · 44 篇文档</div></div>' +
      '<button class="icon-btn" data-act="kb-new" title="新建知识库">' + icon("plus") + "</button></div>" +
      '<div class="side-body">' + KBS.map((k) =>
        '<div class="list-item ' + (state.kb === k.id ? "active" : "") + '" data-act="kb-select" data-id="' + k.id + '">' +
        '<div class="li-main"><div class="list-title">' + esc(k.name) + "</div>" +
        '<div class="list-sub">' + k.docs + " 篇 · " + k.chunks + " 切片</div></div>" +
        '<span class="dot ' + (k.status === "ready" ? "green" : "amber") + '"></span></div>').join("") +
      "</div></aside>";
  }

  function renderAgentsSide() {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">专家</div>' +
      '<div class="side-sub">4 个专家 · 3 个运行中</div></div>' +
      '<button class="icon-btn" data-act="agent-new" title="新建专家">' + icon("plus") + "</button></div>" +
      '<div class="side-body">' + AGENTS.map((a) =>
        '<div class="list-item ' + (state.agent === a.id ? "active" : "") + '" data-act="agent-open" data-id="' + a.id + '">' +
        '<span class="avatar ' + a.color + '" style="width:28px;height:28px;font-size:12px">' + esc(a.name[0]) + "</span>" +
        '<div class="li-main"><div class="list-title">' + esc(a.name) + "</div>" +
        '<div class="list-sub">' + esc(a.model) + " · " + a.status + "</div></div></div>").join("") +
      "</div></aside>";
  }

  function renderConnectionsSide() {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">连接</div>' +
      '<div class="side-sub">连接器 / 渠道 / MCP</div></div></div><div class="side-body">' +
      ["全部", "连接器", "渠道", "MCP"].map((x, i) =>
        '<div class="side-nav ' + (i === 0 ? "active" : "") + '">' + icon(["grid", "plug", "chat", "terminal"][i], "ic-sm") + "<span>" + x + "</span></div>").join("") +
      "</div></aside>";
  }

  function renderExtensionsSide() {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">扩展</div>' +
      '<div class="side-sub">技能 / 插件 / 技能包</div></div></div><div class="side-body">' +
      ["插件", "技能", "技能包"].map((x, i) =>
        '<div class="side-nav ' + (i === 0 ? "active" : "") + '">' + icon(["grid", "spark", "book"][i], "ic-sm") + "<span>" + x + "</span></div>").join("") +
      "</div></aside>";
  }

  function renderSettingsSide() {
    const tabs = [["appearance", "外观", "moon"], ["notifications", "通知", "inbox"], ["shortcuts", "快捷键", "cmd"], ["account", "账号", "user"]];
    return '<aside class="side"><div class="side-head"><div><div class="side-title">设置</div>' +
      '<div class="side-sub">个人偏好</div></div></div><div class="side-body">' +
      tabs.map(([id, label, ic]) =>
        '<div class="side-nav ' + (state.settingsTab === id ? "active" : "") + '" data-act="settings-tab" data-id="' + id + '">' +
        icon(ic, "ic-sm") + "<span>" + label + "</span></div>").join("") + "</div></aside>";
  }

  function renderAdminSide() {
    const items = [
      ["admin", "管理概览", "chart"],
      ["admin-users", "用户管理", "users"],
      ["admin-models", "模型配置", "cpu"],
      ["admin-storage", "存储管理", "database"],
      ["admin-plugins", "插件管理", "puzzle"],
      ["admin-security", "安全防护", "shield"],
      ["admin-advanced", "应用设置", "sliders"],
    ];
    return '<aside class="side"><div class="side-head"><div><div class="side-title">管理</div>' +
      '<div class="side-sub">实例级配置</div></div></div><div class="side-body">' +
      items.map(([route, label, ic]) =>
        '<div class="side-nav ' + (state.route === route ? "active" : "") + '" data-act="nav" data-route="' + route + '">' +
        icon(ic, "ic-sm") + "<span>" + label + "</span></div>").join("") + "</div></aside>";
  }

  function renderSide() {
    if (/^(settings|admin|usage|connections|extensions|workbench|channels|bridge|acp|personalization|skills|remote|knowledge)/.test(state.route)) return "";
    if (state.route.startsWith("chat")) return renderChatSide();
    if (state.route.startsWith("tasks") || state.route.startsWith("ticket")) return renderTasksSide();
    if (state.route.startsWith("automation")) return renderAutomationSide();
    if (state.route.startsWith("inbox")) return renderInboxSide();
    if (state.route.startsWith("knowledge")) return renderKnowledgeSide();
    if (state.route.startsWith("agents")) return renderAgentsSide();
    if (state.route.startsWith("connections")) return renderSubSide("连接器", "连接与 MCP", [
      ["enabled", "已启用连接器", "plug"], ["builtin", "内置连接器", "grid"], ["custom", "自定义连接器", "terminal"],
    ], "connTab", state.connTab);
    if (state.route.startsWith("extensions")) return renderExtensionsSide();
    if (state.route.startsWith("settings")) return renderSettingsSide();
    if (state.route.startsWith("personalization")) return renderSubSide("个性化", "当前专家", [
      ["skills", "技能", "spark"], ["tools", "工具", "terminal"], ["plugins", "插件", "puzzle"],
      ["subagents", "子智能体", "bot"], ["mbti", "MBTI 人格", "user"], ["memory", "记忆", "database"],
    ], "persTab", state.persTab);
    if (state.route.startsWith("channels")) return renderSubSide("通道", "IM 与 Webhook", [
      ["all", "全部通道", "chat"], ["feishu", "飞书", "chat"], ["wecom", "企业微信", "chat"],
      ["qq", "QQ", "chat"], ["dingtalk", "钉钉", "chat"], ["discord", "Discord", "chat"], ["telegram", "Telegram", "chat"],
    ], "channelTab", state.channelTab);
    if (state.route.startsWith("skills")) return renderSubSide("技能包", "已安装与市场", [
      ["installed", "已安装", "package"], ["builtin", "内置技能", "spark"], ["market", "技能市场", "grid"],
    ], "skillTab", state.skillTab || "installed");
    if (state.route.startsWith("bridge")) return renderSubSide("云端协同", "跨实例", [
      ["connections", "连接", "cloud"], ["experts", "对端专家", "bot"],
    ], "bridgeTab", state.bridgeTab || "connections");
    if (state.route.startsWith("acp")) return renderSubSide("ACP 协作", "外部 Runner", [
      ["runners", "Runner", "terminal"], ["permissions", "权限", "shield"],
    ], "acpTab", state.acpTab || "runners");
    if (state.route === "admin") return renderAdminSide();
    if (state.route.startsWith("admin-users")) return renderSubSide("用户管理", "账号与权限", [      ["users", "用户管理", "users"], ["roles", "角色管理", "shield"], ["groups", "用户分组", "grid"],
    ], "userTab", state.userTab);
    if (state.route.startsWith("admin-models")) return renderSubSide("模型配置", "Provider 与模型", [
      ["chat", "对话模型", "chat"], ["embedding", "向量模型", "database"], ["generation", "生成模型", "spark"],
      ["voice", "语音模型", "mic"], ["search", "搜索模型", "search"], ["decision", "决策模型", "chart"],
    ], "modelTab", state.modelTab);
    if (state.route.startsWith("admin-storage")) return renderSubSide("存储管理", "后端与容量", [
      ["mine", "我的存储", "database"], ["types", "支持类型", "grid"],
    ], "storageTab", state.storageTab || "mine");
    if (state.route.startsWith("admin-plugins")) return renderSubSide("插件管理", "服务器插件", [
      ["plugins", "插件", "puzzle"], ["permissions", "权限审计", "shield"],
    ], "pluginTab", state.pluginTab || "plugins");
    if (state.route.startsWith("admin-security")) return renderSubSide("安全防护", "运行策略", [
      ["hitl", "工具审批", "shield"], ["filesystem", "文件访问", "folder"], ["pii", "敏感信息", "key"],
      ["toolGuard", "命令防护", "terminal"], ["skillScan", "技能扫描", "puzzle"], ["audit", "审计日志", "file"],
    ], "securityTab", state.securityTab);
    if (state.route.startsWith("admin-advanced")) return renderSubSide("应用设置", "实例级", [
      ["env", "环境变量", "sliders"], ["backup", "备份与恢复", "database"], ["https", "HTTPS", "shield"],
      ["updates", "应用更新", "refresh"], ["webauthn", "通行密钥", "key"],
    ], "advTab", state.advTab);
    if (state.route.startsWith("remote")) return renderSubSide("远程桌面", "主机画面", [["desktop", "桌面", "monitor"], ["phone", "手机", "monitor"]], "remoteTab", state.remoteTab || "desktop");
    if (state.route.startsWith("workbench")) return renderSubSide("工作台", "终端与浏览器", [["terminal", "终端", "terminal"], ["browser", "浏览器", "globe"]], "wbTab", state.wbTab || "terminal");
    return '<aside class="side"><div class="side-head"><div><div class="side-title">导航</div></div></div></aside>';
  }

  /* ---------------- render: chat ---------------- */
  function renderMsg(m) {
    if (m.role === "system") return '<div class="sysline">' + m.text + "</div>";
    if (m.role === "user") {
      const editing = Boolean(m.id && state.editingMessage === m.id);
      return (m.divider ? '<div class="msg-divider">以下是新消息</div>' : "") +
        '<div class="msg user"><div class="avatar violet">A</div><div class="msg-body">' +
        '<div class="msg-meta" style="justify-content:flex-end">alice · ' + esc(m.time || "") + "</div>" +
        (editing
          ? '<div class="edit-box"><textarea data-input="edit-message">' + esc(state.editDraft) + "</textarea>" +
            '<div class="edit-actions"><button class="btn sm text" data-act="edit-cancel">取消</button>' +
            '<button class="btn sm primary" data-act="edit-save" data-id="' + m.id + '">保存并重新发送</button></div></div>'
          : '<div class="msg-text">' + esc(m.text) + "</div>") +
        (m.attachments && m.attachments.length ? '<div class="msg-attach">' + m.attachments.map((f) =>
          '<span class="tag outline sm">' + icon("file", "ic-xs") + esc(f.name) + "</span>").join("") + "</div>" : "") +
        (!editing ? '<div class="msg-tools"><button class="icon-btn" data-act="copy" data-id="' + (m.id || "") + '" title="复制">' + icon("copy", "ic-sm") + "</button>" +
          '<button class="icon-btn" data-act="edit" data-id="' + (m.id || "") + '" title="编辑重发">' + icon("edit", "ic-sm") + "</button></div>" : "") +
        "</div></div>";
    }
    const steps = (m.steps || []).map(([t, d]) =>
      '<div class="step"><span class="ok">' + icon("check") + "</span><b>" + esc(t) + "</b>" +
      (d ? '<span class="t">' + esc(d) + "</span>" : "") + "</div>").join("");
    let html = '<div class="msg"><div class="avatar">业</div><div class="msg-body">' +
      '<div class="msg-meta"><span class="msg-name">业务专家</span><span>' + esc(m.time || "") + "</span>" +
      (m.strength ? '<span class="tag blue sm">' + esc(m.strength) + "</span>" : "") + "</div>";
    if (steps) html += '<div class="process">' + steps + "</div>";
    html += '<div class="msg-text" ' + (m.streaming ? 'id="stream-text"' : "") + ">" + esc(m.text || "");
    if (m.streaming) html += '<span class="typing"><i></i><i></i><i></i></span>';
    html += "</div>";
    if (m.code) {
      html += '<div class="code"><div class="code-h">' + icon("file", "ic-sm") + "<span>" + esc(m.code.file) + "</span><span class=\"spacer\"></span><span>" + esc(m.code.lang) + "</span></div>" +
        "<pre>" + colorize(m.code.body) + "</pre></div>";
    }
    if (m.tool) {
      html += '<div class="toolcard" data-act="toggle-tool"><div class="tool-h">' + icon("terminal", "ic-sm") +
        "<b>" + esc(m.tool.name) + "</b><span>" + esc(m.tool.arg) + "</span><span class=\"spacer\"></span><span class=\"tag green sm\">" + esc(m.tool.status) + "</span></div>" +
        '<div class="tool-b">' + esc(m.tool.name) + "(" + esc(m.tool.arg) + ") → ok · 0.8s · 只读</div></div>";
    }
    if (m.files) html += renderFileCard(m);
    if (m.ask) html += renderAskCard(m);
    if (m.plan) html += renderPlanCard(m);
    if (m.citations) {
      html += '<div class="row" style="flex-wrap:wrap;margin:8px 0"><span class="hint">引用</span>' +
        m.citations.map((c) => '<span class="tag outline sm">' + icon("book", "ic-xs") + esc(c) + "</span>").join("") + "</div>";
    }
    if (m.approval) {
      const found = attentionById(m.approval);
      if (found && !found.att.resolved) {
        html += renderApproval(m.approval);
      } else {
        html += '<div class="approval resolved"><div class="approval-h">' + icon("check", "ic-sm") + "已处理 · 本次允许" +
          '<span class="timer">10:13 由 alice 确认</span></div></div>';
      }
    }
    html += '<div class="msg-tools"><button class="icon-btn" data-act="copy" title="复制">' + icon("copy", "ic-sm") + "</button>" +
      '<button class="icon-btn" data-act="regenerate" title="重新生成">' + icon("refresh", "ic-sm") + "</button>" +
      '<button class="icon-btn" data-act="fork" title="分支">' + icon("git-branch", "ic-sm") + "</button></div>";
    html += "</div></div>";
    return html;
  }

  function renderAskCard(m) {
    const a = m.ask;
    if (!a || !a.questions) return "";
    if (a.status !== "pending") {
      return '<div class="ask-card done"><div class="ask-head"><b>需要你确认</b><span class="tag green sm">' +
        (a.status === "answered" ? "已回答" : "已跳过") + "</span></div>" +
        '<div class="hint">' + a.questions.length + " 个问题 · " + (a.status === "answered" ? "已提交给专家" : "本轮未回答") + "</div></div>";
    }
    const st = a.state || { current: 0, reviewing: false, answers: a.questions.map(() => ({ picked: [], other: "" })) };
    const total = a.questions.length;
    const qIndex = Math.min(st.current || 0, total - 1);
    const q = a.questions[qIndex];
    const ans = st.answers[qIndex] || { picked: [], other: "" };
    const answerText = (ans.picked || []).filter((x) => x !== "__other__").join("、") + (ans.other ? (ans.picked.length ? "；" : "") + ans.other : "");
    const keys = ["A", "B", "C", "D", "E"];
    const summary = st.reviewing
      ? a.questions.map((qq, i) => {
          const aa = st.answers[i] || { picked: [], other: "" };
          const text = (aa.picked || []).join("、") + (aa.other ? (aa.picked.length ? "；" : "") + aa.other : "");
          return '<div class="ask-review"><b>' + (i + 1) + ". " + esc(qq.question) + '</b><div class="hint">' + esc(text || "未回答") + "</div></div>";
        }).join("")
      : "";
    return '<div class="ask-card" data-mid="' + m.id + '">' +
      '<div class="ask-head"><b>需要你确认</b><span class="hint">' + (st.reviewing ? "确认答案" : (qIndex + 1) + " / " + total) + "</span>" +
      '<span class="spacer"></span><button class="icon-btn" data-act="ask-skip" data-mid="' + m.id + '" title="跳过">' + icon("x", "ic-sm") + "</button></div>" +
      (st.reviewing ? '<div class="ask-review-list">' + summary + "</div>"
        : '<div class="ask-question"><span class="ask-index">' + (qIndex + 1) + ".</span><div><div class=\"hint\">" + esc(q.header || "") + '</div><b>' + esc(q.question) + "</b></div></div>" +
          '<div class="ask-options">' + (q.options || []).map((opt, i) =>
            '<button class="ask-option ' + ((ans.picked || []).includes(opt.label) ? "selected" : "") + '" data-act="ask-option" data-mid="' + m.id + '" data-q="' + qIndex + '" data-value="' + esc(opt.label) + '">' +
            '<span class="ask-key">' + keys[i] + "</span><span><b>" + esc(opt.label) + "</b>" +
            (opt.description ? '<small>' + esc(opt.description) + "</small>" : "") + "</span></button>").join("") + "</div>" +
          '<textarea class="input" data-input="ask-other" data-mid="' + m.id + '" data-q="' + qIndex + '" rows="2" placeholder="其他补充（可选）">' + esc(ans.other || "") + "</textarea>") +
      '<div class="ask-actions">' +
      (st.reviewing
        ? '<button class="btn sm" data-act="ask-back" data-mid="' + m.id + '">返回修改</button><span class="spacer"></span><button class="btn sm primary" data-act="ask-submit" data-mid="' + m.id + '">提交回答</button>'
        : '<button class="btn sm text" data-act="ask-skip" data-mid="' + m.id + '">跳过</button><span class="spacer"></span>' +
          '<button class="btn sm primary" data-act="ask-next" data-mid="' + m.id + '"' + (!answerText ? " disabled" : "") + ">" + (qIndex === total - 1 ? "确认答案" : "下一题") + "</button>") +
      "</div></div>";
  }

  function renderPlanCard(m) {
    const p = m.plan;
    if (!p) return "";
    if (p.status === "running") {
      return '<div class="plan-card running"><div class="plan-head">' + icon("play", "ic-sm") + "<b>计划执行中</b><span class=\"tag blue sm\">running</span></div>" +
        '<div class="hint">正在按 ' + esc(p.path) + " 执行；可在右侧运行轨迹查看每一步。</div>" +
        '<div class="plan-actions"><button class="btn sm" data-act="dock-open-traj">查看运行轨迹</button></div></div>';
    }
    return '<div class="plan-card"><div class="plan-head">' + icon("file", "ic-sm") + "<b>计划已就绪</b><span class=\"tag green sm\">ready</span></div>" +
      '<p>已生成执行计划 <code class="inline">' + esc(p.path) + "</code>，包含检查项、审批人与回滚点。确认后开始执行。</p>" +
      '<div class="plan-actions"><button class="btn sm primary" data-act="plan-execute" data-mid="' + m.id + '">执行计划</button>' +
      '<button class="btn sm" data-act="plan-edit" data-mid="' + m.id + '">继续编辑</button></div></div>';
  }


  function renderFileCard(m) {
    const f = m.files;
    if (!f || !f.items) return "";
    const add = f.items.reduce((n, x) => n + (x.add || 0), 0);
    const del = f.items.reduce((n, x) => n + (x.del || 0), 0);
    const diff = f.items.map((x) => (x.diff || "").split("\n").map((line) =>
      '<div class="diff-line ' + (line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "") + '">' + esc(line || " ") + "</div>").join("")).join("");
    return '<div class="files-card"><div class="files-head">' + icon("file", "ic-sm") + "<b>文件改动</b>" +
      '<span class="hint">' + f.items.length + " 个文件 · +" + add + " −" + del + "</span><span class=\"spacer\"></span>" +
      '<button class="btn sm text" data-act="files-toggle" data-mid="' + m.id + '">' + (f.open ? "收起" : "查看改动") + "</button></div>" +
      '<div class="file-list">' + f.items.map((x) =>
        '<div class="file-row" data-act="files-toggle" data-mid="' + m.id + '"><span class="file-status ' + (x.status === "A" ? "add" : "") + '">' + x.status + "</span>" +
        '<span class="mono">' + esc(x.path) + '</span><span class="spacer"></span>' +
        '<span class="diff-add">+' + (x.add || 0) + '</span><span class="diff-del">−' + (x.del || 0) + "</span></div>").join("") + "</div>" +
      (f.open ? '<div class="diff-box mono">' + diff + "</div>" : "") + "</div>";
  }


  function colorize(code) {
    return esc(code)
      .replace(/(\/\/[^\n]*)/g, '<span class="tc">$1</span>')
      .replace(/\b(if|return|const|let|for|while|await|async|function)\b/g, '<span class="tk">$1</span>')
      .replace(/(&#39;[^&]*?&#39;|&quot;[^&]*?&quot;|\b\d+\b)/g, '<span class="ts">$1</span>');
  }

  function renderApproval(attId) {
    const found = attentionById(attId);
    if (!found) return "";
    const att = found.att;
    return '<div class="approval" id="approval-' + att.id + '">' +
      '<div class="approval-h"><span class="warn">' + icon("alert", "ic-xs") + "</span>需要你确认" +
      '<span class="timer">剩 28:14</span></div>' +
      '<div class="approval-b">工具 <code>shell.exec</code> · 命令 <code>npm test -- auth</code><br/>' +
      "影响：在仓库 <code>acme/api</code> 内运行测试，只读代码、写临时缓存。</div>" +
      '<div class="approval-acts">' +
      '<button class="btn sm danger" data-act="deny" data-id="' + att.id + '">拒绝</button>' +
      '<button class="btn sm" data-act="approve" data-id="' + att.id + '">仅本次允许</button>' +
      '<button class="btn sm primary" data-act="approve-session" data-id="' + att.id + '">本会话允许</button>' +
      '<button class="btn sm text" data-act="approval-detail" data-id="' + att.id + '">查看完整参数</button>' +
      "</div></div>";
  }

  function renderChat() {
    const sess = SESSIONS.find((s) => s.id === state.activeSession) || SESSIONS[0] || { title: "新对话" };
    const msgs = state.messages.map(renderMsg).join("");
    const earlier = !state.olderLoaded && state.messages.length
      ? '<div class="load-earlier"><button class="btn sm" data-act="load-earlier">' + icon("clock", "ic-sm") + "加载更早消息</button></div>" : "";
    const follow = !state.streaming && state.messages.length
      ? '<div class="next-card"><b>接下来</b><button class="chip" data-act="prompt" data-value="补一个回归测试">补回归测试</button>' +
        '<button class="chip" data-act="dock-open-traj">查看运行轨迹</button><button class="chip" data-act="chat-share">分享结论</button></div>' : "";
    const q = state.queue.map((x, i) =>
      '<span class="chip">' + esc(x) +
      ' <span data-act="queue-steer" data-idx="' + i + '" title="插入本轮" style="cursor:pointer;color:var(--primary)">插话</span>' +
      ' <span data-act="queue-remove" data-idx="' + i + '" title="撤回" style="cursor:pointer;color:var(--text-4)">撤回</span></span>').join("");
    const busy = state.streaming;
    return '<div class="main"><div class="topbar">' +
      '<div class="who"><div class="avatar">业</div><div><div class="who-name">业务专家</div>' +
      '<div class="who-sub">' + esc(state.model) + " · " + esc(state.mode) + " 模式</div></div></div>" +
      '<span class="tag blue">' + icon("spark", "ic-xs") + " " + esc(state.mode) + "</span>" +
      '<span class="chat-title"><b>' + (!state.activeSession || state.chatWelcome ? "新对话" : esc(sess.title)) + '</b><span class="tag outline">' + (!state.activeSession || state.chatWelcome ? "新会话" : "当前会话") + '</span>' +
      '<button class="icon-btn" data-act="session-menu" data-id="' + sess.id + '" title="会话操作">' + icon("more", "ic-sm") + "</button></span>" +
      '<div class="spacer"></div>' +
      '<button class="btn sm" data-act="chat-share">' + icon("share", "ic-sm") + "分享</button>" +
      '<button class="btn sm" data-act="' + (state.dockOpen ? "dock-close" : "dock-open") + '">' + icon("terminal", "ic-sm") + (state.dockOpen ? "收起 Dock" : "打开 Dock") + "</button></div>" +
      '<div class="chat-wrap"><div class="chat-main">' +
      (!can("chat:write") ? '<div class="readonly-banner">' + icon("shield", "ic-sm") + "<span>只读审计角色：可以查看会话与数据，不能发送消息或修改配置。</span></div>" : "") +
      (state.offline ? '<div class="offline-banner">' + icon("alert", "ic-sm") + "<span>网络已断开，消息发送会失败。</span><button class=\"btn sm\" data-act=\"offline-retry\">重试</button></div>" : "") +
      (state.chatError ? renderChatError() : state.chatWelcome ? renderWelcome() : '<div class="msgs" id="msgs">' + earlier + msgs + follow + "</div>" +
        '<button class="scroll-bottom" id="scroll-bottom" data-act="scroll-bottom">' + icon("chev", "ic-xs") + "回到底部</button>") +
      (state.modelMissing ? '<div class="model-alert">' + icon("alert", "ic-sm") + '<span><b>还没有可用模型</b> 请先在模型配置中授权一个提供商。</span><button class="btn sm primary" data-act="nav" data-route="admin-models">配置模型</button></div>' : "") +
      '<div class="composer-wrap">' +
      (state.queue.length ? '<div class="queue"><span class="tag sm">队列 ' + state.queue.length + "</span><span>将在这步结束后发送：</span>" + q + "</div>" : "") +
      (state.attachments.length ? '<div class="attach-row">' + state.attachments.map((f, i) =>
        '<span class="attach-chip">' + icon("file", "ic-xs") + esc(f.name) + ' <span data-act="attach-remove" data-idx="' + i + '">×</span></span>').join("") + "</div>" : "") +
      ((state.selectedSkills.length || state.selectedSubagents.length) ? '<div class="attach-row">' +
        state.selectedSkills.map((s) => '<span class="attach-chip">' + icon("puzzle", "ic-xs") + esc(s) + ' <span data-act="remove-skill" data-value="' + s + '">×</span></span>').join("") +
        state.selectedSubagents.map((s) => '<span class="attach-chip">' + icon("bot", "ic-xs") + esc(s) + ' <span data-act="remove-subagent" data-value="' + s + '">×</span></span>').join("") + "</div>" : "") +
      '<div class="composer"><input type="file" id="attach-input" multiple style="display:none" /><textarea id="composer" placeholder="回复，或输入 / 命令、@ 文件…" rows="2"' + (state.chatError || state.modelMissing || state.offline || !can("chat:write") ? " disabled" : "") + '>' + esc(state.draft) + "</textarea>" +
      '<div class="composer-row">' +
      '<button class="icon-btn" data-act="chat-plus" title="添加模型、技能、连接器">' + icon("plus") + "</button>" +
      '<button class="chip on" data-act="menu-mode">' + icon("spark") + esc(state.mode) + "</button>" +
      '<button class="chip" data-act="menu-model">' + esc(state.model) + ' ' + icon("chev", "ic-xs") + "</button>" +
      '<button class="chip" data-act="menu-kb">知识库 · ' + (state.kbCount ? state.kbCount : "关") + "</button>" +
      '<button class="chip" data-act="menu-connectors">连接器 · ' + state.selectedConnectors.length + "</button>" +
      '<button class="chip" data-act="menu-skills">技能 · ' + state.selectedSkills.length + "</button>" +
      '<button class="chip" data-act="menu-subagents">子智能体 · ' + state.selectedSubagents.length + "</button>" +
      '<button class="chip" data-act="menu-hitl">审批 · ' + (state.hitl === "all" ? "全允许" : "每次") + "</button>" +
      '<div class="composer-right">' +
      '<button class="icon-btn" data-act="attach" title="附件">' + icon("clip") + "</button>" +
      '<button class="icon-btn" data-act="mention-open" title="提及">' + icon("at") + "</button>" +
      '<button class="icon-btn" data-act="slash-open" title="命令">' + icon("slash") + "</button>" +
      '<button class="icon-btn" data-act="voice" title="语音未接入（桌面版提供）" disabled>' + icon("mic") + "</button>" +
      '<button class="ring" data-act="context-info" title="上下文 ' + state.contextPct + '%"><span>' + state.contextPct + '%</span></button>' +
      '<button class="send ' + (busy ? "stop" : "") + '" data-act="' + (busy ? "stop" : "send") + '" title="' + (busy ? "停止" : "发送") + '"' + (!busy && (!state.draft.trim() || state.chatError || state.modelMissing || state.offline || !can("chat:write")) ? " disabled" : "") + '>' +
      icon(busy ? "stop" : "send", "ic-sm") + "</button>" +
      "</div></div></div></div></div>" +
      (state.dockOpen ? renderDock() : renderFloatActions()) + "</div></div>";
  }

  function renderChatError() {
    return '<div class="chat-error"><div class="error-glyph">' + icon("alert") + "</div><h2>会话加载失败</h2>" +
      '<p>连接超时或服务暂时不可用。已保留本地草稿，重试不会重复发送。</p>' +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-act="chat-retry">重试</button>' +
      '<button class="btn" data-act="new-chat">新建对话</button></div></div>';
  }

  function renderWelcome() {
    const cards = [
      ["排查登录超时", "从 GitHub #412 开始，先读代码再改", "chat"],
      ["整理本周发布记录", "从飞书群和 PR 汇总", "file"],
      ["回答发布流程", "先查运维手册再回答", "book"],
      ["补一个导出接口", "从 issue 创建任务", "terminal"],
    ];
    return '<div class="welcome"><div class="welcome-logo">P</div><h2>今天想先处理哪件事？</h2>' +
      '<p>从一句话、一个任务或一份文档开始；不确定就直接问。</p><div class="quick-grid">' +
      cards.map(([t, d, ic]) => '<button class="quick-card" data-act="prompt" data-value="' + esc(t) + '">' +
        '<span class="quick-ic">' + icon(ic) + "</span><b>" + t + "</b><span>" + d + "</span></button>").join("") +
      "</div></div>";
  }

  function renderFloatActions() {
    const btn = (ic, title, act) => '<button class="float-btn" data-act="' + act + '" title="' + title + '">' + icon(ic) + "</button>";
    return '<div class="float-actions">' +
      btn("user", "专家资料", "agent-profile") + btn("folder", "工作区", "dock-open-workspace") +
      btn("chart", "运行轨迹", "dock-open-traj") + btn("globe", "浏览器", "dock-open-browser") + "</div>";
  }

  function renderDock() {
    const tabs = [["files", "文件"], ["workspace", "工作区"], ["browser", "浏览器"], ["traj", "轨迹"], ["terminal", "终端"]];
    const tab = state.dockTab || "files";
    return '<aside class="dock"><div class="dock-head">' +
      tabs.map(([id, label]) =>
        '<button class="dock-tab ' + (tab === id ? "active" : "") + '" data-act="dock-tab" data-id="' + id + '">' + label + "</button>").join("") +
      '<div class="spacer"></div><button class="icon-btn" data-act="dock-close" title="关闭">' + icon("x", "ic-sm") + "</button></div>" +
      '<div class="dock-body" id="dock-body">' + renderDockBody(tab) + "</div></aside>";
  }
  function renderDockBody(tab) {
    if (tab === "traj") {
      return '<div class="timeline"><div class="tl info"><div class="row"><span class="time">10:03</span><span class="kind">fs.read</span><span class="txt">src/auth.ts · 0.8s</span></div></div>' +
        '<div class="tl info"><div class="row"><span class="time">10:03</span><span class="kind">kb.search</span><span class="txt">2 条引用 · 0.4s</span></div></div>' +
        '<div class="tl warn"><div class="row"><span class="time">10:03</span><span class="kind">approval</span><span class="txt">等待确认 · shell.exec</span></div></div></div>';
    }
    if (tab === "browser") return '<div class="empty"><div class="glyph">' + icon("globe") + "</div><b>还没有浏览器会话</b><p>工具打开网页后会出现在这里。</p></div>";
    if (tab === "terminal") return '<div class="mono" style="font-size:12px;line-height:1.8;background:var(--surface-2);border-radius:8px;padding:12px;min-height:260px">' +
      '<div style="color:var(--green)">$</div><div>$ npm test -- auth</div><div class="hint">RUNS  auth.spec.ts</div><div class="hint">✓ login timeout › clears expired token (12 ms)</div><div class="hint">✓ 3 tests passed</div><div style="color:var(--green)">$</div></div>';
    const row = (ic, name, sub, file) =>
      '<div class="row" style="padding:5px 6px;border-radius:6px;cursor:pointer" data-act="dock-file">' + icon(ic, "ic-sm") +
      "<span class=\"" + (file ? "" : "muted") + "\">" + name + "</span><span class=\"spacer\"></span><span class=\"hint\">" + (sub || "") + "</span></div>";
    if (tab === "workspace") {
      return '<div class="hint" style="margin-bottom:8px">业务专家 / 工作区</div><div>' + row("folder", "acme/api", "", false) + row("folder", "src", "12", false) +
        '<div style="padding-left:14px">' + row("file", "auth.ts", "改", true) + row("file", "session.ts", "", true) + "</div>" +
        row("folder", "tests", "8", false) + '<div style="padding-left:14px">' + row("file", "auth.spec.ts", "新", true) + "</div>" +
        row("file", "README.md", "", true) + "</div>";
    }
    return '<div>' + row("folder", "acme/api", "", false) + row("folder", "src", "12", false) +
      '<div style="padding-left:14px">' + row("file", "auth.ts", "改", true) + row("file", "session.ts", "", true) + "</div>" +
      row("folder", "tests", "8", false) + '<div style="padding-left:14px">' + row("file", "auth.spec.ts", "新", true) + "</div>" +
      row("file", "README.md", "", true) + "</div>";
  }

  /* ---------------- render: tasks ---------------- */
  const BUCKETS = [["all", "全部"], ["attention", "待我决定"], ["running", "进行中"], ["queued", "已排队"], ["done", "已完成"]];

  function taskCard(t) {
    const cls = t.bucket === "running" && t.stalled ? "stalled" : t.bucket;
    const sel = state.selectedTask === t.id ? " sel" : "";
    const stateTag = {
      attention: '<span class="tag red sm">待决</span>',
      running: t.stalled ? '<span class="tag amber sm">可能卡住</span>' : '<span class="tag green sm">运行中</span>',
      queued: '<span class="tag sm">排队中</span>',
      done: '<span class="tag green sm">已完成</span>',
    }[t.bucket] || "";
    let inner = '<div class="task-top">' + sourceTag(t.source) + "<span>" + esc(t.ref) + "</span><span class=\"spacer\"></span><span>" + esc(t.createdAt) + "</span></div>" +
      '<div class="task-title">' + esc(t.title) + "</div>" +
      '<div class="task-meta"><span class="avatar-xs">' + esc((t.actor || "?")[0].toUpperCase()) + "</span>" + esc(t.actor) +
      '<span class="tag outline sm">' + esc(t.executor) + "</span>" + stateTag + "</div>";
    if (t.bucket === "attention" && t.attention && !t.attention.resolved) {
      const a = t.attention;
      const acts = a.kind === "approval"
        ? '<button class="btn sm" data-act="deny" data-id="' + a.id + '">拒绝</button>' +
          '<button class="btn sm primary" data-act="approve" data-id="' + a.id + '">允许</button>'
        : a.kind === "question"
          ? '<button class="btn sm primary" data-act="answer-open" data-id="' + a.id + '">回答</button>'
          : '<button class="btn sm primary" data-act="budget-add" data-id="' + a.id + '">追加预算</button>' +
            '<button class="btn sm danger" data-act="deny" data-id="' + a.id + '">停止</button>';
      inner += '<div class="task-q">' + icon("alert", "ic-sm") + esc(a.question) +
        '<span class="acts">' + acts + "</span></div>";
    } else if (t.bucket === "running") {
      inner += '<div class="progress ' + (t.stalled ? "amber" : "") + '" style="margin-top:9px"><i style="width:' + pct(t.progress) + '"></i></div>' +
        '<div class="task-foot"><span>' + esc(t.summary) + "</span><span class=\"spacer\"></span><span>" + money(t.cost) + "</span></div>";
    } else if (t.bucket === "done") {
      inner += '<div class="task-foot"><span>' + esc(t.summary) + "</span><span class=\"spacer\"></span><span>" + money(t.cost) + "</span></div>";
    } else {
      inner += '<div class="task-foot"><span>' + esc(t.summary) + "</span></div>";
    }
    return '<div class="task ' + cls + sel + '" data-act="task-select" data-id="' + t.id + '">' + inner + "</div>";
  }

  function filteredTasks() {
    return state.tasks.filter((t) => {
      if (state.bucket !== "all" && t.bucket !== state.bucket) return false;
      if (state.sourceFilter !== "all" && t.source !== state.sourceFilter) return false;
      if (state.q && !(t.title + " " + t.ref + " " + t.actor + " " + t.summary).toLowerCase().includes(state.q.toLowerCase())) return false;
      return true;
    });
  }

  function taskListHTML() {
    const list = filteredTasks();
    if (!list.length) {
      return '<div class="empty"><div class="glyph">' + icon("inbox") + "</div><b>没有匹配的任务</b><p>试试清除筛选或换个关键词。</p>" +
        '<button class="btn sm" data-act="clear-filter">清除筛选</button></div>';
    }
    return list.map(taskCard).join("");
  }

  function renderTasks() {
    const counts = {
      all: bucketCount("all"), attention: bucketCount("attention"), running: bucketCount("running"),
      queued: bucketCount("queued"), done: bucketCount("done"),
    };
    return '<div class="main"><div class="page" style="padding-bottom:0;flex:0 0 auto">' +
      '<div class="row" style="align-items:flex-start"><div><div class="page-title">任务</div>' +
      '<div class="page-sub">Agent 正在处理的工作；需要你决定的事会出现在最上面。</div></div>' +
      '<div class="spacer"></div><button class="btn" data-act="nav" data-route="automation">' + icon("clock", "ic-sm") + "自动化</button>" +
      '<button class="btn" data-act="filter-open">' + icon("filter", "ic-sm") + "筛选</button>" +
      '<button class="btn primary" data-act="task-new">' + icon("plus", "ic-sm") + "新建任务</button></div>" +
      '<div class="tabs" style="margin:16px -24px 0;padding:0 24px">' +
      BUCKETS.map(([id, label]) =>
        '<button class="tab ' + (state.bucket === id ? "active" : "") + '" data-act="bucket" data-id="' + id + '">' +
        label + (id === "attention" ? '<span class="count red">' + counts.attention + "</span>" : '<span class="count">' + counts[id] + "</span>") + "</button>").join("") +
      "</div></div>" +
      '<div class="task-split"><div class="task-list" id="task-list">' + taskListHTML() + "</div>" +
      '<div class="detail" id="task-detail">' + renderTaskDetail(taskById(state.selectedTask) || state.tasks[0]) + "</div></div></div>";
  }

  function renderTaskDetail(t) {
    if (!t) return "";
    const bucketTag = t.bucket === "attention" ? '<span class="tag red">待我决定</span>'
      : t.bucket === "running" ? '<span class="tag green">运行中</span>'
      : t.bucket === "done" ? '<span class="tag green">已完成</span>'
      : '<span class="tag">排队中</span>';
    const chips = bucketTag + '<span class="tag blue">' + esc(t.strength) + '</span>' +
      '<span class="tag outline">策略 v' + t.policy + '</span><span class="tag outline">' + esc(t.executor) + "执行器</span>" +
      '<span class="hint">' + esc(t.sourceLabel) + " · @" + esc(t.actor) + " · " + esc(t.createdAt) + "</span>";
    const tl = (t.timeline || []).map(([time, kind, txt, tone]) =>
      '<div class="tl ' + (tone || "") + '"><div class="row"><span class="time">' + esc(time) + "</span><span class=\"kind\">" + esc(kind) + "</span><span class=\"txt\">" + txt + "</span></div></div>").join("");
    return '<div class="detail-top"><div><h2>' + esc(t.title) + "</h2><div class=\"chips\">" + chips + "</div></div>" +
      '<div class="detail-actions">' +
      '<button class="btn sm" data-act="task-assign" data-id="' + t.id + '">重新派工</button>' +
      '<button class="btn sm" data-act="task-budget" data-id="' + t.id + '">追加预算</button>' +
      '<button class="btn sm danger" data-act="task-stop" data-id="' + t.id + '">停止</button></div></div>' +
      '<div class="panel"><div class="panel-h"><b>授权范围</b><span class="sub">Mandate · 不可变</span><span class="spacer"></span><span class="tag outline">policy v' + t.policy + "</span></div>" +
      '<dl class="dl"><dt>scope</dt><dd><code class="inline">repo:acme/api</code> <code class="inline">path:src/auth</code> <code class="inline">tool:shell.exec</code></dd>' +
      "<dt>strength</dt><dd>" + esc(t.strength) + "（用户明确请求）</dd>" +
      '<dt>发起人</dt><dd>' + esc(t.sourceLabel) + ":" + esc(t.actor) + ' · 命中规则 <code class="inline">allow-assigned</code></dd>' +
      "<dt>预算</dt><dd>" + money(t.cost) + " / " + money(t.budget) + "</dd></dl></div>" +
      '<div class="panel"><div class="panel-h"><b>任务线</b><span class="sub">Trigger → Eval → Ticket → Report</span></div><div class="timeline">' + tl + "</div></div>" +
      '<div class="panel"><div class="panel-h"><b>产物</b><span class="sub">Artifacts</span><span class="spacer"></span><button class="btn sm text" data-act="task-export">导出</button></div>' +
      ((t.artifacts && t.artifacts.length) ? '<div>' + t.artifacts.map(([ic, name, sub]) =>
        '<div class="row" style="padding:5px 6px"><span style="color:var(--text-3)">' + icon(ic, "ic-sm") + "</span><span>" + esc(name) + "</span><span class=\"spacer\"></span><span class=\"hint\">" + esc(sub) + "</span></div>").join("") + "</div>" :
        '<div class="hint">还没有产物。</div>') + "</div>";
  }

  function renderTicket() {
    const t = taskById(state.selectedTask) || state.tasks[0];
    const tag = t.bucket === "attention" ? ["待我决定", "red"] : t.bucket === "running" ? ["运行中", "green"] : t.bucket === "done" ? ["已完成", "green"] : ["排队中", ""];
    return '<div class="main"><div class="topbar"><div class="who"><div class="avatar">业</div>' +
      '<div><div class="who-name">任务详情</div><div class="who-sub">' + esc(t.ref) + " · " + esc(t.sourceLabel) + "</div></div></div>" +
      '<span class="tag ' + tag[1] + '">' + tag[0] + "</span></div>" +
      '<div class="page" style="max-width:1000px;width:100%;margin:0 auto">' + renderTaskDetail(t) + "</div></div>";
  }

  /* ---------------- render: automation (cron) ---------------- */
  function renderAutomationSide() {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">自动化</div>' +
      '<div class="side-sub">3 个定时任务 · 2 个启用</div></div>' +
      '<button class="icon-btn" data-act="cron-new" title="创建定时任务">' + icon("plus") + "</button></div>" +
      '<div class="side-body">' +
      '<div class="side-nav ' + (state.cronFilter === "all" ? "active" : "") + '" data-act="cron-filter" data-value="all">' + icon("clock", "ic-sm") + '<span>全部任务</span><span class="count">3</span></div>' +
      '<div class="side-nav ' + (state.cronFilter === "on" ? "active" : "") + '" data-act="cron-filter" data-value="on">' + icon("play", "ic-sm") + '<span>已启用</span><span class="count">2</span></div>' +
      '<div class="side-nav ' + (state.cronFilter === "off" ? "active" : "") + '" data-act="cron-filter" data-value="off">' + icon("stop", "ic-sm") + '<span>已暂停</span><span class="count">1</span></div>' +
      '<div class="group-label">执行记录</div>' +
      '<div class="side-nav">' + icon("chart", "ic-sm") + "<span>最近运行</span></div>" +
      "</div></aside>";
  }

  function renderAutomation() {
    const allJobs = [
      ["每日科技新闻", "0 9 * * *", "每天 09:00", "智能体", "今天 09:00 · 成功", true],
      ["周一发布周报", "0 10 * * 1", "每周一 10:00", "智能体", "周一 10:00 · 成功", true],
      ["收件箱摘要", "0 18 * * *", "每天 18:00", "文本", "昨天 18:00 · 已暂停", false],
    ];
    const jobs = state.cronFilter === "all" ? allJobs : allJobs.filter((j) => (state.cronFilter === "on" ? j[5] : !j[5]));
    return '<div class="main"><div class="page">' +
      cfgHead("自动化", "创建和管理专家定期执行的计划任务，也可立刻手动运行。",
        '<button class="btn primary" data-act="cron-new">' + icon("plus", "ic-sm") + "创建定时任务</button>") +
      '<div class="card" style="margin-top:16px;overflow:hidden"><table class="table"><thead><tr>' +
      "<th>任务</th><th>调度</th><th>类型</th><th>上次运行</th><th>状态</th><th style=\"text-align:right\">操作</th></tr></thead><tbody>" +
      jobs.map(([n, cron, desc, type, last, on]) =>
        "<tr><td><b>" + n + '</b><div class="hint mono">' + cron + "</div></td><td>" + desc + "</td><td>" + type + "</td><td>" + last + "</td>" +
        '<td><span class="tag ' + (on ? "green" : "") + ' sm">' + (on ? "已启用" : "已暂停") + "</span></td>" +
        '<td style="text-align:right"><button class="btn sm text" data-act="cron-run">立即执行</button>' +
        '<button class="btn sm text" data-act="cron-new">编辑</button>' +
        '<button class="btn sm text danger" data-act="cron-delete">删除</button></td></tr>').join("") +
      "</tbody></table></div>" +
      '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "任务按服务端时区执行；错过执行时间会在容忍窗口内补跑。</div></div></div>";
  }

  /* ---------------- render: inbox ---------------- */
  function renderInbox() {
    const all = attentions();
    const list = state.attFilter === "all" ? all : all.filter((x) => x.att.kind === state.attFilter);
    if (!list.length) {
      const filtered = all.length > 0;
      return '<div class="main"><div class="page"><div class="page-title">收件箱</div><div class="page-sub">' +
        (filtered ? "该分类下没有待决事项。" : "没有待你决定的事。") + "</div>" +
        '<div class="empty"><div class="glyph">' + icon("check") + "</div><b>" +
        (filtered ? "这个分类是空的" : "收件箱是空的") + "</b><p>" +
        (filtered ? "切换到其他分类，或查看全部。" : "Agent 会继续处理进行中的任务。") + "</p>" +
        (filtered ? '<button class="btn sm" data-act="att-filter" data-value="all">查看全部</button>' :
          '<button class="btn sm" data-act="nav" data-route="tasks">查看进行中</button>') + "</div></div></div>";
    }
    const current = list.find((x) => x.att.id === state.selectedAttention) || list[0];
    const left = list.map(({ task, att }) => {
      const active = current.att.id === att.id ? " active" : "";
      const kind = { approval: ["审批", "red"], question: ["提问", "blue"], blocked: ["受阻", "amber"] }[att.kind] || ["待决", ""];
      return '<div class="list-item' + active + '" data-act="attention-select" data-id="' + att.id + '">' +
        '<div class="li-main"><div class="list-title">' + esc(task.title) + '</div><div class="list-sub">' + esc(att.question) + "</div></div>" +
        '<span class="tag ' + kind[1] + ' sm">' + kind[0] + "</span></div>";
    }).join("");
    return '<div class="main"><div class="page" style="padding-bottom:0;flex:0 0 auto"><div class="row"><div><div class="page-title">收件箱</div>' +
      '<div class="page-sub">' + list.length + " 件需要你决定；处理后会自动消失。</div></div>" +
      '<div class="spacer"></div><button class="btn sm" data-act="inbox-read-all">全部已读</button></div></div>' +
      '<div class="task-split"><div class="task-list" style="width:380px;flex:0 0 380px">' + left + "</div>" +
      '<div class="detail">' + renderAttentionDetail(current.task, current.att) + "</div></div></div>";
  }

  function renderAttentionDetail(task, att) {
    const kind = { approval: "审批", question: "提问", blocked: "受阻" }[att.kind] || "待决";
    const tone = { approval: "red", question: "blue", blocked: "amber" }[att.kind] || "";
    return '<div class="detail-top"><div><h2>' + esc(task.title) + '</h2><div class="chips">' +
      '<span class="tag ' + tone + '">' + kind + '</span><span class="tag outline">' + esc(task.ref) + "</span>" +
      '<span class="tag outline">@' + esc(task.actor) + "</span></div></div></div>" +
      '<div class="panel"><div class="panel-h"><b>' + esc(att.question) + '</b><span class="spacer"></span><span class="tag amber sm">剩 28:14</span></div>' +
      '<div class="hint" style="margin-bottom:14px">' + esc(att.detail || "") + "</div>" +
      '<div class="row" style="margin-top:14px;flex-wrap:wrap">' +
      (att.kind === "approval"
        ? '<button class="btn" data-act="deny" data-id="' + att.id + '">拒绝</button>' +
          '<button class="btn" data-act="approve" data-id="' + att.id + '">仅本次允许</button>' +
          '<button class="btn primary" data-act="approve-session" data-id="' + att.id + '">本会话允许</button>'
        : att.kind === "blocked"
          ? '<button class="btn primary" data-act="budget-add" data-id="' + att.id + '">追加 ¥1.00</button>' +
            '<button class="btn danger" data-act="deny" data-id="' + att.id + '">停止任务</button>'
          : '<button class="btn primary" data-act="answer-submit" data-id="' + att.id + '">提交回答</button>' +
            '<button class="btn" data-act="to-chat" data-id="' + att.id + '">转成对话</button>') +
      '<button class="btn text" data-act="to-chat" data-id="' + att.id + '">查看上下文</button>' +
      '<span class="spacer"></span><button class="btn text" data-act="snooze" data-id="' + att.id + '">稍后</button></div></div>' +
      '<div class="panel"><div class="panel-h"><b>任务上下文</b><span class="sub">只读</span></div>' +
      '<div class="timeline">' + (task.timeline || []).slice(-4).map(([time, k, txt, tone2]) =>
        '<div class="tl ' + (tone2 || "") + '"><div class="row"><span class="time">' + esc(time) + '</span><span class="kind">' + esc(k) + '</span><span class="txt">' + txt + "</span></div></div>").join("") +
      "</div></div>";
  }

  /* ---------------- render: Octop-like config pages ---------------- */
  function renderSubSide(title, sub, items, group, current) {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">' + esc(title) + "</div>" +
      '<div class="side-sub">' + esc(sub) + "</div></div></div>" +
      '<div class="side-body">' + items.map(([value, label, ic]) =>
        '<div class="side-nav ' + (current === value ? "active" : "") + '" data-act="subtab" data-group="' + group + '" data-value="' + value + '">' +
        icon(ic, "ic-sm") + "<span>" + esc(label) + "</span></div>").join("") + "</div></aside>";
  }

  function cfgHead(title, sub, actions) {
    return '<div class="row" style="align-items:flex-start"><div><div class="page-title">' + esc(title) + "</div>" +
      '<div class="page-sub">' + esc(sub) + "</div></div><div class=\"spacer\"></div>" + (actions || "") + "</div>";
  }

  function innerTabs(items, group, current) {
    return '<div class="tabs" style="margin:14px -24px 0;padding:0 24px">' + items.map(([value, label]) =>
      '<button class="tab ' + (current === value ? "active" : "") + '" data-act="subtab" data-group="' + group + '" data-value="' + value + '">' + label + "</button>").join("") + "</div>";
  }

  function toggle(on, key) {
    return '<button class="switch ' + (on ? "on" : "") + '" data-act="toggle-switch"' + (key ? ' data-key="' + key + '"' : "") + "></button>";
  }

  function renderPersonalization() {
    const tab = state.persTab || "skills";
    const rows = {
      skills: [["weather", "天气查询", "内置 · 当前会话可用", true], ["github-trending", "GitHub 趋势", "工作区 · 只读网络", true], ["qrcode", "二维码生成", "内置 · 无外部权限", false]],
      tools: [["fs.read", "读取工作区文件", "只读", true], ["fs.write", "写入工作区文件", "写操作 · 需确认", true], ["shell.exec", "执行 Shell 命令", "高风险 · 需审批", false], ["web.search", "联网搜索", "只读", true], ["kb.search", "知识库检索", "只读", true]],
      plugins: [["weather-card", "天气卡片", "UI 插件 · 网络", true], ["demo-card", "交互卡片示例", "UI 插件 · 工作区", false]],
    };
    let body = "";
    if (tab === "skills" || tab === "tools" || tab === "plugins") {
      body = '<div class="card" style="margin-top:16px"><div class="card-b">' +
        rows[tab].map(([name, desc, meta, on]) =>
          '<div class="setting-row"><div class="label"><b class="mono">' + name + "</b><span>" + desc + " · " + meta + "</span></div>" + toggle(on) + "</div>").join("") +
        "</div></div>";
    } else if (tab === "subagents") {
      body = '<div class="agent-grid">' + state.personalSubagents.map((s) =>
        '<div class="agent-card"><div class="row"><span class="avatar violet">' + esc(s.name[0]) + '</span><div><b class="agent-name">' + esc(s.name) + '</b><div class="agent-desc">' + esc(s.desc) + '</div></div><span class="spacer"></span><span class="tag ' + (s.status === "运行中" ? "green" : "") + ' sm">' + esc(s.status) + "</span></div>" +
        '<div class="agent-foot"><button class="btn sm" data-act="subagent-edit" data-name="' + esc(s.name) + '">编辑</button><button class="btn sm text" data-act="subagent-skills" data-name="' + esc(s.name) + '">查看技能</button></div></div>').join("") +
        '<div class="agent-card agent-new" data-act="subagent-new"><div class="empty" style="padding:22px"><div class="glyph">' + icon("plus") + '</div><b>新建子智能体</b></div></div></div>';
    } else if (tab === "mbti") {
      const types = ["INTJ 建筑师", "ENFP 竞选者", "ISTJ 物流师", "ENTP 辩论家"];
      body = '<div class="card" style="margin-top:16px"><div class="card-b"><div class="row"><div><b>当前人格：' + esc(state.mbti) + '</b><div class="hint">影响表达风格与决策偏好，不改能力。</div></div><span class="spacer"></span><button class="btn" data-act="mbti-retest">重新测试</button></div>' +
        '<div class="setting-grid" style="margin-top:16px">' + types.map((x) =>
          '<div class="card" style="padding:14px;cursor:pointer;border-color:' + (state.mbti === x ? "var(--primary)" : "var(--line)") + '" data-act="mbti-set" data-value="' + x + '"><b>' + x + '</b><div class="hint">点击切换人格</div></div>').join("") + "</div></div></div>";
    } else {
      body = '<div class="card" style="margin-top:16px"><div class="card-b">' +
        '<div class="row">' + [["1,204", "条原子记忆"], ["36", "待确认草稿"], ["7", "个记忆主题"]].map(([n, l]) =>
          '<div style="flex:1"><div class="stat"><b>' + n + "</b><span>" + l + "</span></div></div>").join("") + "</div>" +
        '<div class="divider"></div><div class="setting-row"><div class="label"><b>最近记忆</b><span>用户偏好用 camelCase；发布窗口为周三 14:00–17:00</span></div><button class="btn sm" data-act="memory-view">查看全部</button></div>' +
        '<div class="setting-row"><div class="label"><b>记忆清理</b><span>删除低置信度或过期记忆</span></div><button class="btn sm danger" data-act="memory-clear">清理</button></div></div></div>';
    }
    return '<div class="main"><div class="page">' +
      cfgHead("个性化", "管理当前专家的技能、工具、插件、子智能体、人格与记忆。",
        '<button class="btn" data-act="nav" data-route="skills">' + icon("package", "ic-sm") + "从技能市场安装</button>") +
      innerTabs([["skills", "技能"], ["tools", "工具"], ["plugins", "插件"], ["subagents", "子智能体"], ["mbti", "人格"], ["memory", "记忆"]], "persTab", tab) +
      body + "</div></div>";
  }

  function renderChannels() {
    const all = [
      ["控制台", "dashboard", "已连接", "必开", "—", true],
      ["飞书", "feishu", "已连接", "@poly", "1,284", true],
      ["企业微信", "wecom", "已连接", "@poly", "326", true],
      ["QQ", "qq", "未连接", "@poly", "—", false],
      ["钉钉", "dingtalk", "未连接", "@poly", "—", false],
      ["Discord", "discord", "已连接", "@poly", "48", true],
      ["Telegram", "telegram", "未连接", "@poly", "—", false],
    ];
    const list = state.channelTab === "all" ? all : all.filter((c) => c[1] === state.channelTab);
    return '<div class="main"><div class="page">' +
      cfgHead("通道", "管理 IM 渠道与 Webhook 接入，让专家在外部会话中回复。",
        '<button class="btn primary" data-act="channel-new">' + icon("plus", "ic-sm") + "新建通道</button>") +
      '<div class="card" style="margin-top:16px;overflow:hidden"><table class="table"><thead><tr>' +
      "<th>通道</th><th>状态</th><th>机器人前缀</th><th>消息数</th><th>启用</th><th style=\"text-align:right\">操作</th></tr></thead><tbody>" +
      list.map(([name, key, status, prefix, msgs, on]) =>
        "<tr><td><b>" + name + '</b><div class="hint">' + key + "</div></td>" +
        '<td><span class="tag ' + (status === "已连接" ? "green" : "") + ' sm">' + status + "</span></td>" +
        "<td>" + prefix + "</td><td>" + msgs + "</td><td>" + (key === "dashboard" ? '<span class="hint">必开</span>' : toggle(on)) + "</td>" +
        '<td style="text-align:right"><button class="btn sm text" data-act="channel-check">检测连接</button>' +
        '<button class="btn sm" data-act="channel-config">配置</button></td></tr>').join("") +
      "</tbody></table></div>" +
      '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "控制台通道由系统保持启用；关闭其他通道只停止收发，不删除配置。</div></div></div>";
  }

  function renderSkills() {
    const tab = state.skillTab || "installed";
    const base = {
      installed: [["weather", "天气查询", "内置", "1.2.0", true], ["github-trending", "GitHub 趋势", "工作区", "0.9.1", true], ["qrcode", "二维码生成", "工作区", "1.0.0", false]],
      builtin: [["weather", "天气查询", "内置", "1.2.0", true], ["web-search", "联网搜索", "内置", "2.0.0", true], ["pdf-reader", "PDF 阅读", "内置", "1.4.2", true]],
      market: [["doc-writer", "长文写作", "SkillHub", "2.1.0", false], ["data-analyst", "数据分析", "SkillHub", "1.8.0", false], ["slide-maker", "幻灯片", "SkillHub", "1.0.3", false]],
    };
    const installedNames = base.installed.map((x) => x[0]).concat(state.extraSkills.map((x) => x.key));
    const raw = tab === "installed" ? base.installed.concat(state.extraSkills.map((x) => [x.key, x.name, x.src, x.ver, true])) : base[tab] || base.installed;
    const rows = raw.map(([key, name, src, ver, on]) => ({
      key, name, src, ver: state.skillVersion[key] || ver,
      on: state.skillToggle[key] == null ? on : state.skillToggle[key],
      installed: installedNames.includes(key), market: tab === "market", baseVer: ver,
    }));
    return '<div class="main"><div class="page">' +
      cfgHead("技能包", "管理已安装技能包与内置技能，也可从技能市场安装。",
        '<button class="btn" data-act="skill-import">' + icon("upload", "ic-sm") + "导入技能</button>" +
        '<button class="btn primary" data-act="skill-create">' + icon("plus", "ic-sm") + "创建技能</button>") +
      '<div class="row" style="margin-top:14px">' +
      [["installed", "已安装"], ["builtin", "内置"], ["market", "技能市场"]].map(([id, label]) =>
        '<button class="chip ' + (tab === id ? "on" : "") + '" data-act="skill-tab" data-id="' + id + '">' + label + "</button>").join("") +
      '<span class="spacer"></span><span class="hint">安装/更新后需重载专家</span></div>' +
      dataTable("skills-" + tab, rows, [
        { key: "name", label: "技能", sortable: true, render: (s) => "<b>" + esc(s.name) + '</b><div class="hint">' + esc(s.key) + "</div>" },
        { key: "src", label: "来源", sortable: true, render: (s) => esc(s.src) },
        { key: "ver", label: "版本", sortable: true, render: (s) => esc(s.ver) },
        { key: "on", label: "状态", render: (s) => '<span class="tag ' + (s.on ? "green" : "") + ' sm">' + (s.on ? "已启用" : "未启用") + "</span>" },
        { key: "actions", label: "操作", align: "right", render: (s) => s.market
          ? '<button class="btn sm ' + (s.installed ? "" : "primary") + '" data-act="skill-install" data-key="' + esc(s.key) + '" data-name="' + esc(s.name) + '" data-src="' + esc(s.src) + '" data-ver="' + esc(s.baseVer) + '">' + (s.installed ? "已安装" : "安装") + "</button>"
          : '<button class="btn sm text" data-act="skill-update" data-key="' + esc(s.key) + '">更新</button>' +
            '<button class="btn sm" data-act="skill-toggle" data-key="' + esc(s.key) + '">' + (s.on ? "停用" : "启用") + "</button>" },
      ], { selectable: tab !== "market", key: (s) => s.key, search: (s) => s.name + " " + s.key + " " + s.src, placeholder: "搜索技能、来源", empty: "没有技能", bulk: tab !== "market" ? [
        { label: "启用", value: "enable" }, { label: "停用", value: "disable" },
      ] : [] }) + "</div></div>";
  }

  function renderBridge() {
    if (state.bridgeConnected === false) {
      return '<div class="main"><div class="page">' +
        cfgHead("云端协同", "将本机连接到另一实例，浏览对端专家并跨实例对话。",
          '<button class="btn primary" data-act="bridge-add">' + icon("plus", "ic-sm") + "添加连接</button>") +
        '<div class="empty" style="margin-top:40px"><div class="glyph">' + icon("cloud") + "</div><b>尚未连接</b><p>添加一个对端地址，完成握手后可浏览对端专家。</p></div></div></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("云端协同", "将本机连接到另一实例，浏览对端专家并跨实例对话。",
        '<button class="btn primary" data-act="bridge-add">' + icon("plus", "ic-sm") + "添加连接</button>") +
      '<div class="card" style="margin-top:16px"><div class="card-b"><div class="row">' +
      '<span class="avatar blue">云</span><div><div class="row"><b>公司云端</b><span class="tag green sm">已连接</span></div>' +
      '<div class="hint">https://octop.example.com · 对端账号 admin · 6 个专家 / 2 个团队</div></div>' +
      '<span class="spacer"></span><button class="btn sm" data-act="bridge-reconnect">重新连接</button>' +
      '<button class="btn sm text" data-act="bridge-edit">编辑</button>' +
      '<button class="btn sm danger" data-act="bridge-disconnect">断开</button></div>' +
      '<div class="divider"></div><div class="row"><span class="hint">自动重连已开启 · 最近握手 10:02</span><span class="spacer"></span>' +
      '<button class="btn sm" data-act="bridge-peers">浏览对端专家</button></div></div></div>' +
      '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "对话记录保留在专家所在侧；本侧只保存连接与展示信息。</div></div></div>";
  }

  function renderACP() {
    const runners = [
      ["OpenCode", "opencode --acp", "已安装", true],
      ["CodeBuddy", "codebuddy --acp", "已安装", true],
      ["Claude Code", "claude --acp", "未安装", false],
      ["Codex", "codex acp", "未安装", false],
      ["Cursor CLI", "agent acp", "未安装", false],
      ["Kimi Code", "kimi acp", "未安装", false],
    ];
    return '<div class="main"><div class="page">' +
      cfgHead("ACP 协作", "连接支持 ACP 协议的外部编程专家，并按专家开启协作。",
        '<button class="btn primary" data-act="acp-new">' + icon("plus", "ic-sm") + "添加 Runner</button>") +
      '<div class="card" style="margin-top:16px;overflow:hidden"><table class="table"><thead><tr><th>Runner</th><th>启动命令</th><th>状态</th><th>启用</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
      runners.map(([n, cmd, s, on]) =>
        "<tr><td><b>" + n + "</b></td><td class=\"mono\">" + cmd + "</td>" +
        '<td><span class="tag ' + (s === "已安装" ? "green" : "") + ' sm">' + s + "</span></td><td>" + toggle(on) + "</td>" +
        '<td style="text-align:right"><button class="btn sm text" data-act="acp-config" data-name="' + n + '">配置</button>' +
        '<button class="btn sm" data-act="acp-detect" data-name="' + n + '">检测</button></td></tr>').join("") +
      "</tbody></table></div>" +
      '<div class="alert warn" style="margin-top:14px">' + icon("alert", "ic-sm") + "外部 Runner 需要在本机安装对应 CLI；启用前请先完成登录与权限确认。</div></div></div>";
  }

  function renderRemote() {
    if (state.remoteConnected) {
      return '<div class="main"><div class="page">' +
        cfgHead("远程桌面", "查看并操控 LSH AI 主机桌面，远程完成桌面操作。",
          '<button class="btn danger" data-act="remote-disconnect">断开连接</button>') +
        '<div class="card" style="margin-top:16px"><div class="card-b"><div class="row"><span class="avatar green">' + icon("monitor", "ic-sm") + '</span><div><b>已连接 LSH AI 主机</b><div class="hint">1920×1080 · 延迟 28ms · 键鼠已接管</div></div><span class="spacer"></span><span class="tag green sm">已连接</span></div>' +
        '<div class="empty" style="padding:80px;background:var(--surface-2);border-radius:8px;margin-top:14px"><div class="glyph">' + icon("monitor") + "</div><b>桌面画面</b><p>原型中不渲染真实画面；断开后可重新连接。</p></div></div></div></div></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("远程桌面", "查看并操控 LSH AI 主机桌面，远程完成桌面操作。",
        '<button class="btn primary" data-act="remote-connect">' + icon("monitor", "ic-sm") + "连接主机</button>") +
      '<div class="empty" style="margin-top:40px"><div class="glyph">' + icon("monitor") + "</div><b>尚未连接</b><p>连接后可在这里看到主机画面、键鼠控制与剪贴板同步。</p></div></div></div>";
  }

  function tableState(id) {
    if (!state.tables[id]) state.tables[id] = { q: "", sort: "", dir: "asc", page: 1, size: 6, selected: [], hidden: [], columns: [] };
    return state.tables[id];
  }

  function dataTable(id, rows, columns, opts = {}) {
    if (state.listError) {
      return '<div class="table-card"><div class="empty" style="padding:42px"><div class="glyph">' + icon("alert") + "</div><b>列表加载失败</b><p>网络超时或服务不可用，已保留筛选条件。</p>" +
        '<button class="btn primary" data-act="table-retry">重试</button></div></div>';
    }
    const t = tableState(id);
    t.columns = columns.filter((c) => c.key !== "actions").map((c) => ({ key: c.key, label: c.label }));
    const visible = columns.filter((c) => c.key === "actions" || !(t.hidden || []).includes(c.key));
    const q = (t.q || "").toLowerCase();
    let list = rows.filter((r) => !q || (opts.search ? opts.search(r) : "").toLowerCase().includes(q));
    if (t.sort) {
      const col = columns.find((c) => c.key === t.sort);
      if (col) {
        list = list.slice().sort((a, b) => {
          const av = col.sortValue ? col.sortValue(a) : a[col.key];
          const bv = col.sortValue ? col.sortValue(b) : b[col.key];
          return String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv), undefined, { numeric: true });
        });
        if (t.dir === "desc") list.reverse();
      }
    }
    const pages = Math.max(1, Math.ceil(list.length / t.size));
    t.page = Math.min(Math.max(1, t.page), pages);
    const start = (t.page - 1) * t.size;
    const pageRows = list.slice(start, start + t.size);
    const keyOf = opts.key || ((r) => r.id || r.name || r.u);
    t.pageKeys = pageRows.map(keyOf);
    const selected = t.selected || [];
    const allOn = pageRows.length > 0 && pageRows.every((r) => selected.includes(keyOf(r)));
    const checkbox = (on, act, attrs) =>
      '<span class="checkbox ' + (on ? "on" : "") + '" data-act="' + act + '" ' + attrs + ">" + icon("check") + "</span>";
    const header = (opts.selectable ? '<th style="width:30px">' + checkbox(allOn, "table-select-all", 'data-table="' + id + '"') + "</th>" : "") +
      visible.map((c) => '<th' + (c.width ? ' style="width:' + c.width + '"' : "") + (c.align ? ' style="text-align:' + c.align + '"' : "") + '>' +
        (c.sortable ? '<button class="th-sort" data-act="table-sort" data-table="' + id + '" data-key="' + c.key + '">' + c.label +
          (t.sort === c.key ? '<span class="sort-mark">' + (t.dir === "asc" ? "↑" : "↓") + "</span>" : "") + "</button>" : c.label) + "</th>").join("");
    const body = pageRows.length ? pageRows.map((r) => '<tr>' +
      (opts.selectable ? "<td>" + checkbox(selected.includes(keyOf(r)), "table-select", 'data-table="' + id + '" data-key="' + esc(String(keyOf(r))) + '"') + "</td>" : "") +
      visible.map((c) => '<td' + (c.align ? ' style="text-align:' + c.align + '"' : "") + ">" + c.render(r) + "</td>").join("") + "</tr>").join("")
      : '<tr><td colspan="' + (visible.length + (opts.selectable ? 1 : 0)) + '"><div class="empty" style="padding:34px"><b>' + (opts.empty || "没有匹配的数据") + "</b><p>调整搜索或筛选后重试。</p></div></td></tr>";
    const bulk = (opts.bulk || []).length && selected.length
      ? '<div class="table-bulk"><b>已选 ' + selected.length + " 项</b><span class=\"spacer\"></span>" +
        opts.bulk.map((b) => '<button class="btn sm ' + (b.danger ? "danger" : "") + '" data-act="table-bulk" data-table="' + id + '" data-value="' + b.value + '">' + b.label + "</button>").join("") + "</div>"
      : "";
    return '<div class="table-card" id="table-' + id + '">' +
      '<div class="table-toolbar"><div class="search table-search">' + icon("search", "ic-sm") +
      '<input data-table-search="' + id + '" placeholder="' + esc(opts.placeholder || "搜索…") + '" value="' + esc(t.q || "") + '" /></div>' +
      '<span class="hint">共 ' + list.length + ' 条</span><span class="spacer"></span>' +
      '<button class="btn sm" data-act="table-cols" data-table="' + id + '">列</button>' + (opts.actions || "") + "</div>" +
      bulk + '<table class="table"><thead><tr>' + header + "</tr></thead><tbody>" + body + "</tbody></table>" +
      '<div class="table-foot"><span class="hint">第 ' + t.page + " / " + pages + ' 页</span><span class="spacer"></span>' +
      '<select class="input" style="width:76px;height:28px" data-act="table-size" data-table="' + id + '">' +
      [6, 10, 20, 50].map((n) => '<option value="' + n + '"' + (t.size === n ? " selected" : "") + ">" + n + " / 页</option>").join("") + "</select>" +
      '<button class="btn sm" data-act="table-page" data-table="' + id + '" data-page="' + (t.page - 1) + '"' + (t.page <= 1 ? " disabled" : "") + ">上一页</button>" +
      '<button class="btn sm" data-act="table-page" data-table="' + id + '" data-page="' + (t.page + 1) + '"' + (t.page >= pages ? " disabled" : "") + ">下一页</button></div></div>";
  }

  function renderAdminUsers() {
    const tab = state.userTab || "users";
    let body = "";
    if (tab === "users") {
      body = dataTable("admin-users", state.adminUsers, [
        { key: "u", label: "用户名", sortable: true, render: (u) => "<b>" + esc(u.u) + "</b>" },
        { key: "n", label: "显示名称", sortable: true, render: (u) => esc(u.n) },
        { key: "e", label: "邮箱", render: (u) => esc(u.e) },
        { key: "role", label: "账号类型", render: (u) => '<span class="tag ' + (u.role === "管理员" ? "blue" : "") + ' sm">' + esc(u.role) + "</span>" },
        { key: "auth", label: "登录方式", render: (u) => esc(u.auth) },
        { key: "status", label: "状态", sortable: true, render: (u) => '<span class="tag ' + (u.status === "已启用" ? "green" : u.status === "待接受" ? "amber" : "red") + ' sm">' + esc(u.status) + "</span>" },
        { key: "actions", label: "操作", align: "right", render: (u) => '<button class="btn sm text" data-act="user-reset" data-user="' + esc(u.u) + '">重置密码</button>' +
          '<button class="btn sm text" data-act="user-toggle" data-user="' + esc(u.u) + '">' + (u.status === "已启用" ? "禁用" : "启用") + "</button>" +
          '<button class="btn sm text danger" data-act="user-delete" data-user="' + esc(u.u) + '">删除</button>' },
      ], { selectable: true, key: (u) => u.u, search: (u) => u.u + " " + u.n + " " + u.e, placeholder: "搜索用户名、显示名、邮箱", empty: "没有用户", bulk: [
        { label: "启用", value: "enable" }, { label: "禁用", value: "disable" }, { label: "删除", value: "delete", danger: true },
      ] });
    } else if (tab === "roles") {
      body = '<div class="setting-grid" style="margin-top:16px">' + [["管理员", "完整权限，不受资源策略限制", "2 人"], ["成员", "使用自有专家与工作区，无管理后台权限", "18 人"], ["只读审计", "仅查看审计日志与用量", "3 人"]].map(([n, d, c]) =>
        '<div class="card" style="padding:16px"><div class="row"><b>' + n + '</b><span class="spacer"></span><span class="tag sm">' + c + '</span></div><div class="hint" style="margin-top:6px">' + d + '</div><div class="row" style="margin-top:12px"><button class="btn sm" data-act="role-edit" data-name="' + n + '">编辑权限</button><button class="btn sm text" data-act="role-members" data-name="' + n + '">查看成员</button></div></div>').join("") + "</div>";
    } else {
      body = '<div class="card" style="margin-top:16px;overflow:hidden"><table class="table"><thead><tr><th>分组</th><th>说明</th><th>成员</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
        [["design-team", "设计团队", "6 人", "启用"], ["ops-team", "运维值班", "4 人", "启用"], ["contractors", "外部顾问", "2 人", "停用"]].map(([id, d, m, s]) =>
          '<tr><td><b>' + id + '</b></td><td>' + d + '</td><td>' + m + '</td><td><span class="tag ' + (s === "启用" ? "green" : "") + ' sm">' + s + "</span></td>" +
          '<td style="text-align:right"><button class="btn sm text" data-act="group-edit" data-name="' + id + '">编辑</button><button class="btn sm text danger" data-act="group-delete" data-name="' + id + '">删除</button></td></tr>').join("") + "</tbody></table></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("用户管理", "管理内置账号与登录方式（通用 OIDC、飞书、企微、钉钉）。",
        '<button class="btn" data-act="user-invite">邀请用户</button><button class="btn primary" data-act="user-new">' + icon("plus", "ic-sm") + "新建用户</button>") +
      innerTabs([["users", "用户"], ["roles", "角色"], ["groups", "分组"]], "userTab", tab) +
      body + "</div></div>";
  }

  function renderAdminModels() {
    const tab = state.modelTab || "chat";
    const label = { chat: "对话模型", embedding: "向量模型", generation: "生成模型", voice: "语音模型", search: "搜索模型", decision: "决策模型" }[tab];
    return '<div class="main"><div class="page">' +
      cfgHead("模型配置", "配置" + label + "；所有提供商对全实例可用。",
        '<button class="btn primary" data-act="provider-add">' + icon("plus", "ic-sm") + "添加提供商</button>") +
      '<div class="card" style="margin-top:16px"><div class="card-b"><div class="row"><div><b>当前生效</b>' +
      '<div class="hint">deepseek-v4 · 思考模式开启 · 上下文 128k</div></div><span class="spacer"></span><span class="tag green">已授权</span></div></div></div>' +
      dataTable("admin-models", state.providers, [
        { key: "name", label: "提供商", sortable: true, render: (p) => '<span class="avatar blue" style="width:24px;height:24px;font-size:11px;vertical-align:middle">' + esc(p.name[0]) + "</span> <b>" + esc(p.name) + "</b>" },
        { key: "id", label: "ID", sortable: true, render: (p) => '<span class="mono">' + esc(p.id) + "</span>" },
        { key: "models", label: "模型", render: (p) => esc(p.models) },
        { key: "status", label: "状态", sortable: true, render: (p) => '<span class="tag ' + (p.status === "已授权" ? "green" : p.status === "本地" ? "blue" : "") + ' sm">' + esc(p.status) + "</span>" },
        { key: "auth", label: "凭证", render: (p) => p.status === "已授权" ? '<span class="tag green sm">已配置</span>' : '<span class="hint">未配置</span>' },
        { key: "actions", label: "操作", align: "right", render: (p) => '<button class="btn sm" data-act="provider-config" data-name="' + esc(p.name) + '">配置</button>' +
          '<button class="btn sm text" data-act="provider-test" data-name="' + esc(p.name) + '">测试</button>' +
          '<button class="btn sm text" data-act="model-manage" data-name="' + esc(p.name) + '">管理模型</button>' },
      ], { selectable: true, key: (p) => p.id, search: (p) => p.name + " " + p.id + " " + p.models, placeholder: "搜索提供商或模型", empty: "还没有提供商", bulk: [
        { label: "测试连接", value: "test" }, { label: "设为生效", value: "activate" },
      ] }) + "</div></div>";
  }

  function renderAdminStorage() {
    return '<div class="main"><div class="page">' +
      cfgHead("存储管理", "配置可供专家使用的存储后端，如本地目录、对象存储、沙箱与数据库。",
        '<button class="btn primary" data-act="storage-add">' + icon("plus", "ic-sm") + "添加存储后端</button>") +
      '<div class="agent-grid">' + state.storages.map((s) =>
        '<div class="agent-card"><div class="row"><span class="avatar ' + (s.id === "cos" ? "amber" : "blue") + '">' + esc(s.name[0]) + '</span><div><b class="agent-name">' + esc(s.name) + '</b><div class="agent-desc">' + esc(s.id) + " · " + esc(s.detail) + '</div></div><span class="spacer"></span><span class="tag ' + (s.status === "已配置" ? "green" : "") + ' sm">' + esc(s.status) + "</span></div>" +
        '<div class="agent-foot"><button class="btn sm" data-act="storage-config" data-name="' + esc(s.name) + '">配置</button><button class="btn sm text" data-act="storage-probe" data-name="' + esc(s.name) + '">探测</button><span class="spacer"></span><button class="btn sm text" data-act="nav" data-route="workbench">浏览</button></div></div>').join("") + "</div>" +
      '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "删除被专家引用的后端会被阻止；先在工作区里解绑。</div></div></div>";
  }

  function renderAdminPlugins() {
    return '<div class="main"><div class="page">' +
      cfgHead("插件管理", "安装并管理服务器插件，各专家可在个性化中单独启用。",
        '<button class="btn primary" data-act="plugin-install">' + icon("plus", "ic-sm") + "安装插件</button>") +
      dataTable("admin-plugins", PLUGINS, [
        { key: "name", label: "插件", sortable: true, render: (p) => "<b>" + esc(p.name) + '</b><div class="hint">' + esc(p.desc) + "</div>" },
        { key: "version", label: "版本", sortable: true, render: (p) => esc(p.version) },
        { key: "perms", label: "权限", render: (p) => p.perms.length ? p.perms.map((x) => '<span class="tag sm outline">' + x + "</span>").join(" ") : '<span class="hint">无</span>' },
        { key: "on", label: "状态", render: (p) => '<span class="tag ' + (p.on ? "green" : "") + ' sm">' + (p.on ? "已启用" : "已禁用") + "</span>" },
        { key: "toggle", label: "启用", render: (p) => toggle(p.on) },
        { key: "actions", label: "操作", align: "right", render: (p) => '<button class="btn sm text" data-act="plugin-detail" data-name="' + esc(p.name) + '">详情</button>' +
          '<button class="btn sm text danger" data-act="plugin-remove" data-name="' + esc(p.name) + '">卸载</button>' },
      ], { selectable: true, key: (p) => p.name, search: (p) => p.name + " " + p.desc + " " + p.perms.join(" "), placeholder: "搜索插件或权限", empty: "还没有插件", bulk: [
        { label: "启用", value: "enable" }, { label: "禁用", value: "disable" }, { label: "卸载", value: "remove", danger: true },
      ] }) + "</div></div>";
  }

  function renderAdminSecurity() {
    const tab = state.securityTab || "hitl";
    let body = "";
    if (tab === "hitl") {
      body = '<div class="card"><div class="card-b">' +
        '<div class="setting-row"><div class="label"><b>启用工具人工审批</b><span>命中的工具执行前暂停，等待用户在对话中批准或拒绝。</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-row" style="align-items:flex-start"><div class="label"><b>需审批的工具</b><span>勾选后命中列表的工具会暂停。</span></div>' +
        '<div class="row" style="flex-wrap:wrap;max-width:520px">' + ["shell.exec", "fs.write", "git.push", "http.post"].map((x) => '<span class="chip on">' + x + "</span>").join("") + "</div></div>" +
        '<div class="alert warn" style="margin-top:12px">' + icon("alert", "ic-sm") + "开启后 IM 频道需发送 /approve 或 /reject；Dashboard 会弹出审批卡片。</div></div></div>";
    } else if (tab === "filesystem") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>启用文件路径规则</b><span>匹配的路径对 read/write 类文件工具拒绝访问。</span></div>' + toggle(true) + "</div>" +
        '<div class="field" style="margin-top:12px"><label class="hint">敏感路径（每行一条，支持 glob）</label>' +
        '<textarea class="input" rows="6">~/.ssh/**\n~/.aws/**\n/etc/passwd\n**/.env\n**/secrets/**</textarea></div></div></div>';
    } else if (tab === "pii") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>启用 API Key 脱敏</b><span>检测提示词、输出与工具结果中的密钥。</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-row"><div class="label"><b>脱敏策略</b><span>命中后如何处理</span></div><div class="row">' +
        ["掩码", "删除", "阻断", "哈希"].map((x, i) => '<button class="chip ' + (state.piiStrategy === x ? "on" : "") + '" data-act="pii-strategy" data-value="' + x + '">' + x + "</button>").join("") + "</div></div></div></div>";
    } else if (tab === "toolGuard") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>启用命令参数扫描</b><span>对 bash/execute 的 command 参数做正则扫描。</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-row"><div class="label"><b>命中规则后的动作</b><span>阻断 / 需人工审批 / 仅记录</span></div>' +
        '<select class="input" style="width:220px"><option>阻断（HIGH/CRITICAL）</option><option>需人工审批（含 MEDIUM）</option><option>仅记录警告</option></select></div>' +
        '<div class="field"><label class="hint">规则 YAML</label><textarea class="input mono" id="toolguard-yaml" rows="10">rules:\n  - id: rm-rf-root\n    severity: critical\n    pattern: "rm -rf /"\n    tools: [bash, execute]\n    action: block\n  - id: curl-pipe-sh\n    severity: high\n    pattern: "curl .* \\| (ba)?sh"\n    action: require_approval</textarea></div>' +
        '<div class="row" style="margin-top:10px"><button class="btn" data-act="security-reset-rules">恢复默认规则</button><span class="spacer"></span><button class="btn primary" data-act="security-save-rules">保存规则</button></div></div></div>';
    } else if (tab === "skillScan") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>技能安装前扫描</b><span>静态扫描技能包中的风险模式。</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-row"><div class="label"><b>扫描模式</b><span>发现风险后的处理</span></div><div class="row">' +
        ["关闭", "警告", "拦截"].map((x, i) => '<button class="chip ' + (state.skillScan === x ? "on" : "") + '" data-act="skill-scan" data-value="' + x + '">' + x + "</button>").join("") + "</div></div></div></div>";
    } else {
      const rows = [
        { time: "10:12", event: "tool.approval.requested", subject: "alice · shell.exec", result: "pending" },
        { time: "10:07", event: "policy.denied", subject: "bob · fs.write ~/.ssh", result: "blocked" },
        { time: "09:40", event: "login.failed", subject: "unknown · 3 次", result: "locked" },
      ];
      body = dataTable("security-audit", rows, [
        { key: "time", label: "时间", sortable: true, render: (r) => '<span class="mono">' + esc(r.time) + "</span>" },
        { key: "event", label: "事件", sortable: true, render: (r) => esc(r.event) },
        { key: "subject", label: "主体", render: (r) => esc(r.subject) },
        { key: "result", label: "结果", render: (r) => '<span class="tag ' + (r.result === "blocked" ? "red" : r.result === "pending" ? "amber" : "") + ' sm">' + esc(r.result) + "</span>" },
      ], { key: (r) => r.time + r.event, search: (r) => r.time + " " + r.event + " " + r.subject + " " + r.result, placeholder: "搜索事件、主体、结果", empty: "没有审计记录" });
    }
    return '<div class="main"><div class="page">' +
      cfgHead("安全防护", "配置工具审批、文件访问、敏感信息、命令防护与技能扫描。",
        '<button class="btn primary" data-act="security-save">保存全部安全设置</button>') +
      innerTabs([["hitl", "工具审批"], ["filesystem", "文件访问"], ["pii", "敏感信息"], ["toolGuard", "命令防护"], ["skillScan", "技能扫描"], ["audit", "审计"]], "securityTab", tab) +
      '<div style="margin-top:16px">' + body + "</div>" +
      '<div class="hint" style="margin-top:10px">保存后运行中的专家会自动重新加载配置。</div></div></div>';
  }

  function renderAdminAdvanced() {
    const tab = state.advTab || "env";
    let body = "";
    if (tab === "env") {
      body = '<div class="card"><div class="card-b"><table class="table"><thead><tr><th>变量名</th><th>值</th><th></th></tr></thead><tbody>' +
        state.envRows.map(([k, v], i) =>
          '<tr><td><input class="input mono" id="env-key-' + i + '" value="' + esc(k) + '" style="width:220px" /></td>' +
          '<td><input class="input" id="env-val-' + i + '" value="' + esc(v) + '" /></td>' +
          '<td><button class="btn sm text danger" data-act="env-remove" data-idx="' + i + '">删除</button></td></tr>').join("") +
        "</tbody></table>" +
        (state.envError ? '<div class="field-error" style="margin-top:10px">' + esc(state.envError) + "</div>" : "") +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="env-add">添加变量</button><span class="spacer"></span><button class="btn primary" data-act="env-save">保存</button></div></div></div>';
    } else if (tab === "backup") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>创建备份</b><span>包含控制面数据库、配置与工作区清单</span></div><button class="btn primary" data-act="backup-run">立即备份</button></div>' +
        '<div class="setting-row"><div class="label"><b>最近备份</b><span>' + esc(state.lastBackup) + '</span></div><button class="btn" data-act="backup-download">下载</button></div>' +
        '<div class="setting-row"><div class="label"><b>恢复</b><span>上传备份包并覆盖当前实例</span></div><button class="btn danger" data-act="backup-restore">上传恢复</button></div></div></div>';
    } else if (tab === "https") {
      body = '<div class="card"><div class="card-b"><div class="field"><label class="hint">域名</label><input class="input" id="https-domain" value="octop.example.com" /></div>' +
        '<div class="field"><label class="hint">证书（PEM）</label><textarea class="input mono" id="https-cert" rows="5" placeholder="-----BEGIN CERTIFICATE-----"></textarea></div>' +
        '<div class="field"><label class="hint">私钥（PEM）</label><textarea class="input mono" id="https-key" rows="5" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="https-check">检测证书</button><span class="spacer"></span><button class="btn primary" data-act="https-save">保存并重启</button></div></div></div>';
    } else if (tab === "updates") {
      body = '<div class="card"><div class="card-b"><div class="row"><div><b>当前版本 v0.1.0</b><div class="hint">最新版本 v0.1.0 · 已是最新</div></div><span class="spacer"></span><button class="btn" data-act="update-check">检查更新</button></div>' +
        '<div class="divider"></div><div class="setting-row"><div class="label"><b>只更新稳定版</b><span>不提醒 alpha / beta / rc</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-row"><div class="label"><b>重启服务</b><span>升级后需要重启；会中断进行中的任务</span></div><button class="btn danger" data-act="service-restart">重启服务</button></div></div></div>';
    } else {
      body = '<div class="card"><div class="card-b"><div class="field"><label class="hint">RP ID（域名，不含端口）</label><input class="input" id="webauthn-rp" value="octop.example.com" /></div>' +
        '<div class="field"><label class="hint">允许的 Origin（每行一个）</label><textarea class="input mono" id="webauthn-origin" rows="4">https://octop.example.com</textarea></div>' +
        '<div class="setting-row"><div class="label"><b>登录页显示「使用通行密钥登录」</b><span>默认关闭；关闭后仍可用于二次验证</span></div>' + toggle(false) + "</div>" +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="webauthn-fill">填入当前站点</button><span class="spacer"></span><button class="btn primary" data-act="webauthn-save">保存</button></div></div></div>';
    }
    return '<div class="main"><div class="page">' +
      cfgHead("应用设置", "管理环境变量、备份、HTTPS、系统更新与通行密钥。") +
      innerTabs([["env", "环境变量"], ["backup", "备份与恢复"], ["https", "HTTPS"], ["updates", "应用更新"], ["webauthn", "通行密钥"]], "advTab", tab) +
      '<div style="margin-top:16px">' + body + "</div></div></div>";
  }

  /* ---------------- render: knowledge ---------------- */
  function renderKnowledge() {
    const kb = KBS.find((k) => k.id === state.kb) || KBS[0];
    const docs = DOCS[kb.id] || [];
    return '<div class="main"><div class="page"><div class="row" style="align-items:flex-start">' +
      '<div><div class="page-title">' + esc(kb.name) + '</div><div class="page-sub">' + kb.docs + " 篇文档 · " + kb.chunks + " 个切片 · " + esc(kb.id) + "</div></div>" +
      '<div class="spacer"></div><button class="btn" data-act="kb-newfile">' + icon("file", "ic-sm") + "新建文件</button>" +
      '<button class="btn" data-act="kb-newfolder">' + icon("folder", "ic-sm") + "新建文件夹</button>" +
      '<button class="btn primary" data-act="kb-upload">' + icon("upload", "ic-sm") + "上传文档</button></div>" +
      '<div class="row" style="margin-top:14px;flex-wrap:wrap"><span class="hint">知识库</span>' +
      KBS.map((k) => '<button class="chip ' + (state.kb === k.id ? "on" : "") + '" data-act="kb-select" data-id="' + k.id + '">' +
        esc(k.name) + ' <span class="hint">' + k.docs + "</span></button>").join("") +
      '<button class="chip" data-act="kb-new">+ 新建</button></div>' +
      '<div class="tabs" style="margin:16px -24px 0;padding:0 24px">' +
      [["docs", "文档"], ["retrieval", "检索测试"], ["settings", "设置"]].map(([id, label]) =>
        '<button class="tab ' + (state.kbTab === id ? "active" : "") + '" data-act="kb-tab" data-id="' + id + '">' + label + "</button>").join("") + "</div>" +
      (state.kbTab === "retrieval" ? renderRetrieval(kb) : state.kbTab === "settings" ? renderKbSettings(kb) : renderDocs(docs, kb)) +
      "</div></div>";
  }

  function renderDocs(docs, kb) {
    const q = (state.kbSearch || "").toLowerCase();
    const filtered = docs.filter((d) => !q || d[0].toLowerCase().includes(q));
    const processing = docs.find((d) => d[2] === "processing");
    const selected = state.kbSelected || [];
    if (!docs.length) {
      return '<div class="card" style="margin-top:14px"><div class="empty" style="padding:56px"><div class="glyph">' + icon("book") + "</div><b>还没有文档</b><p>拖拽文件到此处，或点击上传；支持 PDF / Word / Markdown / 表格 / 图片 OCR。</p>" +
        '<button class="btn primary" data-act="kb-upload">' + icon("upload", "ic-sm") + "上传文档</button></div></div>";
    }
    if (!filtered.length) {
      return '<div class="card" style="margin-top:14px"><div class="empty" style="padding:48px"><div class="glyph">' + icon("search") + "</div><b>没有匹配的文档</b><p>换个关键词，或清空搜索。</p>" +
        '<button class="btn" data-act="kb-search-clear">清空搜索</button></div></div>';
    }
    const selectAllOn = filtered.every((d) => selected.includes(d[0]));
    return '<div class="card" style="margin-top:14px"><div class="kb-toolbar">' +
      '<span class="hint">' + icon("folder", "ic-sm") + " 根目录" + (state.kbFolder && state.kbFolder !== "root" ? " / " + esc(state.kbFolder) : "") + "</span>" +
      '<div class="spacer"></div><input class="input" id="kb-search" data-input="kb-search" placeholder="搜索文档" value="' + esc(state.kbSearch || "") + '" style="width:180px;height:28px" />' +
      '<button class="chip ' + (state.kbView === "table" ? "on" : "") + '" data-act="kb-view" data-value="table">表格</button>' +
      '<button class="chip ' + (state.kbView === "card" ? "on" : "") + '" data-act="kb-view" data-value="card">卡片</button>' +
      '<button class="icon-btn" data-act="kb-refresh" title="刷新">' + icon("refresh", "ic-sm") + "</button></div>" +
      (selected.length ? '<div class="bulkbar"><b>已选 ' + selected.length + " 项</b><span class=\"spacer\"></span>" +
        '<button class="btn sm" data-act="kb-bulk-reindex">重建索引</button>' +
        '<button class="btn sm danger" data-act="kb-bulk-delete">删除</button></div>' : "") +
      (processing ? '<div style="padding:0 12px"><div class="kb-uploadbar">' + icon("upload", "ic-sm") + "正在上传 " + esc(processing[0]) + ' <div class="progress" style="flex:1;max-width:220px"><i style="width:62%"></i></div><span class="hint">62%</span></div></div>' : "") +
      '<div class="kb-layout" style="padding:12px">' +
      '<div class="kb-tree"><div class="group-label" style="padding-top:0">文件导航</div>' +
      '<div class="tree-row file" data-act="kb-folder" data-value="root">' + icon("folder", "ic-sm") + "<b>根目录</b></div>" +
      [["发布流程", 3], ["事故复盘", 2], ["接口文档", 1]].map(([f, n]) =>
        '<div class="tree-row" style="padding-left:18px" data-act="kb-folder" data-value="' + f + '">' + icon("folder", "ic-sm") + "<span>" + f + '</span><span class="sub">' + n + "</span></div>").join("") +
      "</div>" +
      '<div class="kb-main">' + (state.kbView === "card"
        ? '<div class="agent-grid" style="padding:0">' + filtered.map((d) =>
            '<div class="agent-card"><div class="row"><span class="checkbox ' + (selected.includes(d[0]) ? "on" : "") + '" data-act="kb-toggle-doc" data-name="' + esc(d[0]) + '">' + icon("check") + "</span>" +
            '<span class="avatar blue">' + icon("file", "ic-sm") + '</span>' +
            '<div><b class="agent-name">' + esc(d[0]) + '</b><div class="agent-desc">' + d[3] + " 个分块 · " + esc(d[4]) + "</div></div>" +
            '<span class="spacer"></span><span class="tag ' + (d[2] === "ready" ? "green" : d[2] === "failed" ? "red" : "amber") + ' sm">' +
            ({ ready: "就绪", failed: "失败", processing: "解析中" }[d[2]] || d[2]) + "</span></div>" +
            '<div class="agent-foot"><button class="btn sm text" data-act="doc-preview" data-name="' + esc(d[0]) + '">预览</button>' +
            '<button class="btn sm text" data-act="doc-reindex" data-name="' + esc(d[0]) + '">重建</button><span class="spacer"></span>' +
            '<button class="btn sm text danger" data-act="doc-delete" data-name="' + esc(d[0]) + '">删除</button></div></div>').join("") + "</div>"
        : '<table class="table"><thead><tr><th style="width:28px"><span class="checkbox ' + (selectAllOn ? "on" : "") + '" data-act="kb-select-all">' + icon("check") + "</span></th><th>文件名</th><th>状态</th><th>分块</th><th>更新时间</th><th style=\"text-align:right\">操作</th></tr></thead><tbody>" +
          filtered.map((d) =>
            '<tr><td><span class="checkbox ' + (selected.includes(d[0]) ? "on" : "") + '" data-act="kb-toggle-doc" data-name="' + esc(d[0]) + '">' + icon("check") + "</span></td>" +
            '<td><div class="kb-doc-name">' + icon("file", "ic-sm") + "<b>" + esc(d[0]) + "</b></div></td>" +
            '<td><span class="tag ' + (d[2] === "ready" ? "green" : d[2] === "failed" ? "red" : "amber") + ' sm">' +
            ({ ready: "就绪", failed: "失败", processing: "解析中" }[d[2]] || d[2]) + "</span></td>" +
            "<td>" + d[3] + "</td><td>" + esc(d[4]) + "</td>" +
            '<td style="text-align:right"><button class="btn sm text" data-act="doc-preview" data-name="' + esc(d[0]) + '">预览</button>' +
            '<button class="btn sm text" data-act="doc-reindex" data-name="' + esc(d[0]) + '">重建</button>' +
            '<button class="btn sm text danger" data-act="doc-delete" data-name="' + esc(d[0]) + '">删除</button></td></tr>').join("") +
          "</tbody></table>") +
      '<div class="row" style="padding:10px 12px;color:var(--text-3);font-size:12px">' + icon("info", "ic-sm") + "支持 md / txt / pdf / docx / xlsx / pptx / 图片 OCR，单文件 ≤ 50 MB。</div>" +
      "</div></div></div>";
  }

  function renderRetrieval(kb) {
    return '<div class="card" style="margin-top:14px"><div class="card-b">' +
      '<div class="row" style="flex-wrap:wrap"><input class="input" id="retrieval-q" placeholder="输入问题，例如：发布流程需要谁审批？" style="max-width:460px" />' +
      '<select class="input" style="width:110px"><option>混合检索</option><option>向量</option><option>关键词</option></select>' +
      '<input class="input" style="width:80px" value="5" title="TopK" />' +
      '<button class="btn primary" data-act="kb-test-run">检索</button></div>' +
      (state.kbTest ? '<div style="margin-top:18px">' + state.kbTest.map((r, i) =>
        '<div class="panel" style="margin-top:10px"><div class="panel-h"><b>#' + (i + 1) + "</b><span class=\"sub\">" + esc(r.src) + "</span>" +
        '<span class="spacer"></span><span class="tag green sm">' + r.score + '</span><span class="tag outline sm">引用</span></div>' +
        '<div class="hint">' + esc(r.text) + "</div></div>").join("") + "</div>" :
        '<div class="empty" style="padding:40px"><div class="glyph">' + icon("search") + "</div><b>还没有检索结果</b><p>输入问题，查看命中的切片、来源与分数。</p></div>") +
      "</div></div>";
  }

  function renderKbSettings(kb) {
    return '<div class="card" style="margin-top:14px"><div class="card-b">' +
      '<div class="setting-row"><div class="label"><b>启用知识库</b><span>实例级开关；关闭后全实例不可用</span></div>' + toggle(true) + "</div>" +
      '<div class="setting-row"><div class="label"><b>向量模型</b><span>本地 ONNX bge-m3 · 1024 维 · 已下载</span></div>' +
      '<div class="row"><button class="btn sm" data-act="kb-vector-check">检测</button><select class="input" data-act="kb-vector" style="width:150px"><option>bge-m3</option><option>bge-small-zh</option></select></div></div>' +
      '<div class="setting-row"><div class="label"><b>图片与扫描件 OCR</b><span>可选；启用后可索引图片与扫描 PDF</span></div>' +
      '<select class="input" style="width:150px"><option>关闭</option><option>本地 ONNX</option><option>在线视觉模型</option></select></div>' +
      '<div class="setting-grid">' +
      agentField("切片大小", '<input class="input" type="number" value="800" />') +
      agentField("切片重叠", '<input class="input" type="number" value="120" />') +
      agentField("文档数量上限", '<input class="input" type="number" value="100" />') +
      agentField("单文件上限（MB）", '<input class="input" type="number" value="50" />') +
      "</div>" +
      '<div class="setting-row"><div class="label"><b>检索模式</b><span>混合检索（向量 + 关键词）</span></div><button class="btn sm" data-act="kb-retrieval-config">配置</button></div>' +
      '<div class="setting-row"><div class="label"><b>共享范围</b><span>仅自己 · 共享后其他人可读可选用</span></div><button class="btn sm" data-act="kb-share-config">修改</button></div>' +
      '<div class="row" style="margin-top:12px"><span class="hint">切换向量模型会重建全部索引</span><span class="spacer"></span><button class="btn primary" data-act="kb-settings-save">保存设置</button></div>' +
      "</div></div>";
  }

  /* ---------------- render: agents ---------------- */
  function renderAgents() {
    const extra = {
      ag_1: ["12 工具", "运维手册", "1,204 记忆", "2 分钟前"],
      ag_2: ["9 工具", "API 文档", "860 记忆", "8 分钟前"],
      ag_3: ["3 工具", "全部知识库", "2,431 记忆", "1 小时前"],
      ag_4: ["6 工具", "—", "120 记忆", "昨天"],
    };
    return '<div class="main"><div class="page"><div class="row" style="align-items:flex-start">' +
      '<div><div class="page-title">专家</div><div class="page-sub">我的专家、团队与模板库。</div></div>' +
      '<div class="spacer"></div><button class="btn" data-act="nav" data-route="personalization">' + icon("spark", "ic-sm") + "个性化</button>" +
      '<button class="btn" data-act="agent-template">从模板创建</button>' +
      '<button class="btn primary" data-act="agent-new">' + icon("plus", "ic-sm") + "新建专家</button></div>" +
      '<div class="agent-grid">' +
      AGENTS.map((a) => {
        const [tools, kb, mem, last] = extra[a.id] || ["—", "—", "—", "—"];
        const dot = a.status === "运行中" ? "green" : a.status === "空闲" ? "blue" : "";
        return '<div class="agent-card" data-act="agent-open" data-id="' + a.id + '">' +
          '<div class="row" style="align-items:flex-start">' +
          '<span class="avatar ' + a.color + '" style="width:42px;height:42px;font-size:17px;border-radius:10px">' + esc(a.name[0]) + "</span>" +
          '<div style="min-width:0"><div class="row" style="gap:8px"><b class="agent-name">' + esc(a.name) + '</b>' +
          '<span class="dot ' + dot + '"></span></div>' +
          '<div class="agent-desc">' + esc(a.desc) + "</div></div>" +
          '<span class="spacer"></span><button class="icon-btn" data-act="agent-open" data-id="' + a.id + '">' + icon("more", "ic-sm") + "</button></div>" +
          '<div class="agent-meta"><span class="tag outline">' + esc(a.model) + "</span>" +
          '<span class="tag sm">' + esc(tools) + "</span>" + (kb !== "—" ? '<span class="tag sm">' + esc(kb) + "</span>" : "") + "</div>" +
          '<div class="agent-stats">' + esc(mem) + " · 最近活跃 " + esc(last) + "</div>" +
          '<div class="agent-foot"><button class="btn sm" data-act="agent-open" data-id="' + a.id + '">打开</button>' +
          '<button class="btn sm text" data-act="agent-test">试运行</button><span class="spacer"></span>' +
          '<span class="hint">' + a.sessions + " 会话</span></div></div>";
      }).join("") +
      '<div class="agent-card agent-new" data-act="agent-new"><div class="empty" style="padding:22px">' +
      '<div class="glyph">' + icon("plus") + "</div><b>新建专家</b><p>从空白或模板开始。</p></div></div>" +
      "</div></div></div>";
  }

  function renderAgentDrawer(a) {
    if (!a) return "";
    const tabs = [["basic", "基本信息"], ["runtime", "模型与运行"], ["prompt", "配置文件"], ["skills", "技能"],
      ["subagents", "子智能体"], ["workspace", "工作区"], ["heartbeat", "心跳与主动"], ["persona", "人格与记忆"], ["versions", "版本"]];
    return '<div class="drawer-mask" data-act="close-drawer"></div><aside class="drawer">' +
      '<div class="drawer-h"><span class="avatar ' + a.color + '" style="width:34px;height:34px">' + esc(a.name[0]) + "</span>" +
      "<div><b>" + esc(a.name) + '</b><div class="hint">' + esc(a.model) + " · " + esc(a.status) + ' · v3</div></div>' +
      '<span class="tag amber sm" style="margin-left:6px">有未保存修改</span>' +
      '<div class="spacer"></div><button class="btn sm" data-act="agent-test">试运行</button>' +
      '<button class="btn sm primary" data-act="agent-publish">发布</button>' +
      '<button class="icon-btn" data-act="close-drawer">' + icon("x") + "</button></div>" +
      '<div class="tabs" style="padding:0 18px">' + tabs.map(([id, label]) =>
        '<button class="tab ' + (state.agentTab === id ? "active" : "") + '" data-act="agent-tab" data-id="' + id + '">' + label + "</button>").join("") + "</div>" +
      '<div class="drawer-b">' + renderAgentTab(a) + "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="agent-export">导出 .poly</button><span class="spacer"></span>' +
      '<button class="btn" data-act="close-drawer">取消</button><button class="btn primary" data-act="agent-save">保存</button></div></aside>';
  }

  function agentField(label, control, hint) {
    return '<div class="field"><label class="hint">' + label + "</label>" + control +
      (hint ? '<div class="hint" style="margin-top:4px">' + hint + "</div>" : "") + "</div>";
  }

  function renderAgentTab(a) {
    if (state.agentTab === "runtime") {
      return '<div class="setting-grid">' +
        agentField("默认模型", '<select class="input"><option>' + esc(a.model) + '（默认）</option><option>claude-sonnet</option><option>gpt-5</option></select>') +
        agentField("会话模式", '<select class="input"><option>Act · 可执行</option><option>Ask · 只读</option><option>Plan · 先计划</option></select>') +
        agentField("最大迭代", '<input class="input" type="number" value="30" />') +
        agentField("最大输入长度", '<input class="input" type="number" value="128000" />') +
        agentField("Temperature", '<input class="input" type="number" value="0.7" step="0.1" />') +
        agentField("Top P", '<input class="input" type="number" value="1" step="0.1" />') +
        "</div>" +
        '<div class="setting-row"><div class="label"><b>记录运行轨迹</b><span>写入轨迹，可在聊天页查看</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-row"><div class="label"><b>运行后端</b><span>本机 · 创建后不可修改（编辑时禁用）</span></div><span class="tag sm">本机</span></div>' +
        '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "运行中的专家修改模型/后端，只影响新会话；进行中的会话锁定旧配置。</div>";
    }
    if (state.agentTab === "prompt") {
      const files = [["SOUL.md", "灵魂设定"], ["IDENTITY.md", "身份设定"], ["USER.md", "用户档案"], ["AGENTS.md", "行动指南"], ["TOOLS.md", "工具说明"], ["HEARTBEAT.md", "心跳任务"]];
      return '<div class="row" style="margin-bottom:10px"><span class="hint">配置文件（' + files.length + '）</span><span class="spacer"></span>' +
        '<button class="btn sm text" data-act="nav" data-route="workbench">打开工作区</button><button class="btn sm" data-act="agent-newfile">新建文件</button></div>' +
        files.map(([f, label]) => '<div class="setting-row" style="padding:9px 0"><div class="label"><b class="mono">' + f + '</b><span>' + label + " · 点击编辑</span></div>" +
          '<button class="btn sm text" data-act="agent-file-edit" data-name="' + f + '">编辑</button></div>').join("") +
        '<div class="divider"></div>' +
        agentField("SOUL.md", '<textarea class="input" rows="8"># ' + esc(a.name) + "\n\n你是" + esc(a.desc) + "。\n先确认事实，再给出可执行结论；不确定时明确说明。</textarea>") +
        '<div class="alert info">' + icon("info", "ic-sm") + "保存文件后，运行中的专家会在下次会话重载。</div>";
    }
    if (state.agentTab === "skills") {
      return [["weather", "天气查询", "内置 · 当前会话可用", true], ["github-trending", "GitHub 趋势", "工作区 · 只读网络", true], ["qrcode", "二维码生成", "内置 · 无外部权限", false]].map(([key, name, meta, on]) =>
        '<div class="setting-row"><div class="label"><b class="mono">' + key + '</b><span>' + name + " · " + meta + "</span></div>" + toggle(on) + "</div>").join("") +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="nav" data-route="skills">管理技能</button><span class="hint">安装/卸载后需重载专家</span></div>';
    }
    if (state.agentTab === "subagents") {
      return [["调研员", "负责检索与事实核对", true], ["写手", "负责初稿与改写", false]].map(([n, d, on]) =>
        '<div class="setting-row"><div class="label"><b>' + n + "</b><span>" + d + "</span></div>" + toggle(on) + "</div>").join("") +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="nav" data-route="personalization">浏览子智能体市场</button></div>';
    }
    if (state.agentTab === "workspace") {
      return agentField("存储后端", '<select class="input"><option>本地文件系统</option><option>腾讯云 COS</option><option>Docker 沙箱</option></select>', "编辑时只读；创建后不可修改。") +
        agentField("根目录", '<input class="input" value="/data/workspaces/business-expert" />', "保存前会探测目录可写性。") +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="nav" data-route="workbench">打开工作区</button>' +
        '<button class="btn text" data-act="agent-import">导入压缩包</button><button class="btn text" data-act="agent-export-zip">导出压缩包</button></div>' +
        '<div class="alert warn" style="margin-top:12px">' + icon("alert", "ic-sm") + "替换导入会清空本地工作区；合并导入会覆盖同名文件。</div>";
    }
    if (state.agentTab === "heartbeat") {
      return '<div class="setting-row"><div class="label"><b>启用心跳</b><span>按间隔执行 HEARTBEAT.md 中的任务</span></div>' + toggle(true) + "</div>" +
        agentField("执行间隔", '<input class="input" value="1h" placeholder="30m / 1h / 2h30m" />', "支持 30m、1h、2h30m。") +
        '<div class="divider"></div>' +
        '<div class="setting-row"><div class="label"><b>开启主动关心</b><span>仅在关心时段、对话空闲时发一句</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-grid">' +
        agentField("检查频率", '<input class="input" value="1h" />') +
        agentField("同话题冷却（小时）", '<input class="input" type="number" value="8" />') +
        agentField("关心时段", '<input class="input" value="09:00 – 21:00" />') +
        agentField("免打扰", '<input class="input" value="22:00 – 08:00" />') +
        "</div>";
    }
    if (state.agentTab === "persona") {
      return '<div class="setting-row"><div class="label"><b>MBTI 人格</b><span>当前 ' + esc(state.mbti) + ' · 理性、长期主义</span></div><button class="btn sm" data-act="mbti-retest">重新测试</button></div>' +
        '<div class="setting-row"><div class="label"><b>记忆</b><span>1,204 条原子 · 36 条待确认草稿</span></div><button class="btn sm" data-act="memory-view">查看记忆</button></div>' +
        '<div class="setting-row"><div class="label"><b>清理低置信度记忆</b><span>删除过期或低置信度条目，不可恢复</span></div><button class="btn sm danger" data-act="memory-clear">清理</button></div>' +
        '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "记忆写入受白名单限制；工具结果与外部网页不会直接写入长期记忆。</div>";
    }
    if (state.agentTab === "versions") {
      return [["v3", "当前", "2026-11-05 10:02"], ["v2", "已发布", "2026-11-03 18:20"], ["v1", "初始", "2026-10-28 09:10"]].map(([v, s, t], i) =>
        '<div class="setting-row"><div class="label"><b>' + v + ' · ' + s + '</b><span>' + t + "</span></div>" +
        (i === 0 ? '<span class="tag green sm">当前</span>' : '<button class="btn sm" data-act="agent-rollback">回滚</button>') + "</div>").join("") +
        '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "回滚只影响新会话；进行中的会话继续使用当前版本。</div>";
    }
    // basic
    return '<div class="row" style="align-items:flex-start;gap:14px;margin-bottom:10px">' +
      '<span class="avatar ' + a.color + '" style="width:54px;height:54px;font-size:20px;border-radius:14px">' + esc(a.name[0]) + "</span>" +
      '<div><button class="btn sm" data-act="agent-avatar">更换头像</button><button class="btn sm text" data-act="agent-avatar-remove">移除</button>' +
      '<div class="hint" style="margin-top:6px">PNG/JPEG/WebP/GIF ≤ 5 MB；未设置时使用配色图标。</div></div></div>' +
      agentField("名称", '<input class="input" value="' + esc(a.name) + '" />') +
      agentField("描述", '<textarea class="input" rows="2">' + esc(a.desc) + "</textarea>") +
      agentField("欢迎语", '<textarea class="input" rows="2">今天想先处理哪件事？</textarea>') +
      '<div class="setting-grid">' +
      agentField("默认模式", '<select class="input"><option>Act · 可执行</option><option>Ask · 只读</option><option>Plan · 先计划</option></select>') +
      agentField("默认模型", '<select class="input"><option>' + esc(a.model) + '</option><option>claude-sonnet</option></select>') +
      agentField("可见范围", '<select class="input"><option>仅自己</option><option>所有人</option><option>指定分组</option></select>') +
      agentField("配色", '<div class="swatches">' + ["tech", "rose", "indigo", "teal", "violet", "emerald", "amber", "slate"].map((c, i) =>
        '<button class="swatch ' + ((state.agentColor || "tech") === c ? "active" : "") + '" data-act="agent-color" data-value="' + c + '"><span style="background:' + ["#1677ff", "#e11d48", "#4f46e5", "#0d9488", "#7c3aed", "#059669", "#d97706", "#475569"][i] + '"></span></button>').join("") + "</div>") +
      "</div>" +
      '<div class="setting-row"><div class="label"><b>记录运行轨迹</b><span>写入轨迹，可在聊天页查看</span></div>' + toggle(true) + "</div>";
  }

  /* ---------------- render: connections / extensions / usage / settings ---------------- */
  function renderConnections() {
    const tab = state.connTab || "enabled";
    const enabled = [
      { id: "feishu", name: "飞书", kind: "feishu", status: "已连接", desc: "研发群 · 文档与日程", tools: 12, def: true },
      { id: "github", name: "GitHub", kind: "github", status: "已连接", desc: "acme/api · 代码与 issue", tools: 12, def: true },
      { id: "mail", name: "工作邮箱", kind: "mail", status: "已过期", desc: "ops@acme.com · 需要重新授权", tools: 6, def: false },
    ];
    const catalog = [
      ["飞书", "办公协作", "文档、表格、日历、消息", true],
      ["企业微信", "办公协作", "消息、日程、审批", false],
      ["钉钉", "办公协作", "消息、待办、日历", false],
      ["QQ", "办公协作", "群聊、文件", false],
      ["腾讯文档", "办公协作", "在线文档", false],
      ["Notion", "笔记与知识", "页面、数据库", true],
      ["语雀", "笔记与知识", "知识库、文档", false],
      ["Obsidian", "笔记与知识", "本地 Markdown", false],
      ["邮箱", "通讯与效率", "IMAP / SMTP", true],
      ["Agent Mail", "通讯与效率", "收发邮件（需授权）", false],
      ["企查查", "专业工具", "企业信息查询", false],
      ["自定义 MCP", "自托管 / 扩展", "HTTP / Stdio", true],
    ];
    const tabs = [["enabled", "已启用连接器"], ["builtin", "内置连接器"], ["custom", "自定义连接器"]];
    let body = "";
    if (tab === "enabled" && state.connectorsEmpty) {
      body = '<div class="card" style="margin-top:14px"><div class="empty" style="padding:56px"><div class="glyph">' + icon("plug") + "</div><b>还没有连接器</b><p>连接飞书、GitHub 或邮箱，专家才能在对话中读写你的工作资料。</p>" +
        '<div class="row" style="justify-content:center"><button class="btn primary" data-act="conn-add">' + icon("plus", "ic-sm") + "添加连接器</button>" +
        '<button class="btn" data-act="conn-tab" data-id="builtin">浏览内置连接器</button></div></div></div>';
    } else if (tab === "enabled") {
      body = '<div class="agent-grid">' + enabled.map((c) =>
        '<div class="agent-card"><div class="row"><span class="avatar ' + (c.status === "已过期" ? "amber" : "blue") + '">' + c.name[0] + '</span>' +
        '<div><div class="row" style="gap:6px"><b class="agent-name">' + c.name + '</b>' +
        '<span class="tag ' + (c.status === "已连接" ? "green" : "amber") + ' sm">' + c.status + "</span></div>" +
        '<div class="agent-desc">' + c.desc + "</div></div><span class=\"spacer\"></span><span class=\"hint\">" + c.tools + " 工具</span></div>" +
        '<div class="agent-meta">' + (c.def ? '<span class="tag blue sm">默认打开</span>' : '<span class="tag sm">手动选择</span>') +
        '<span class="tag outline">仅自己</span></div>' +
        '<div class="agent-foot"><button class="btn sm" data-act="conn-open" data-id="' + c.id + '">配置</button>' +
        '<button class="btn sm text" data-act="conn-probe">测试连接</button><span class="spacer"></span>' +
        '<button class="btn sm text" data-act="conn-default">' + (c.def ? "取消默认" : "设为默认") + "</button>" +
        '<button class="btn sm text danger" data-act="conn-delete">删除</button></div></div>').join("") +
        '<div class="agent-card agent-new" data-act="conn-add"><div class="empty" style="padding:22px"><div class="glyph">' + icon("plus") + '</div><b>添加连接</b><p>从内置连接器或 MCP 开始。</p></div></div></div>';
    } else if (tab === "builtin") {
      body = '<div class="row" style="flex-wrap:wrap;margin-top:14px">' +
        ["全部", "办公协作", "笔记与知识", "通讯与效率", "专业工具", "自托管 / 扩展"].map((c) =>
          '<button class="chip ' + ((state.connCat || "全部") === c ? "on" : "") + '" data-act="conn-cat" data-value="' + c + '">' + c + "</button>").join("") + "</div>" +
        '<div class="agent-grid">' + catalog.filter(([, cat]) => !state.connCat || state.connCat === "全部" || cat === state.connCat).map(([name, cat, desc, configured]) =>
          '<div class="agent-card"><div class="row"><span class="avatar blue">' + name[0] + '</span><div><b class="agent-name">' + name + '</b>' +
          '<div class="agent-desc">' + desc + "</div></div><span class=\"spacer\"></span><span class=\"tag " + (configured ? "green" : "") + ' sm">' + (configured ? "已连接" : "未配置") + "</span></div>" +
          '<div class="agent-meta"><span class="tag outline">' + cat + '</span><span class="tag sm">OAuth / Token</span></div>' +
          '<div class="agent-foot"><button class="btn sm" data-act="' + (configured ? "conn-open" : "conn-add") + '">' + (configured ? "添加实例" : "连接") + "</button>" +
          '<span class="spacer"></span><span class="hint">' + (configured ? "1 个实例" : "点击查看凭证要求") + "</span></div></div>").join("") + "</div>";
    } else {
      body = '<div class="row" style="margin-top:14px"><div class="row"><button class="chip ' + (state.mcpMode === "visual" ? "on" : "") + '" data-act="mcp-mode" data-value="visual">可视化</button>' +
        '<button class="chip ' + (state.mcpMode === "json" ? "on" : "") + '" data-act="mcp-mode" data-value="json">&lt;/&gt; JSON</button></div>' +
        '<span class="spacer"></span><button class="btn sm" data-act="mcp-add" data-value="http">添加 HTTP Server</button>' +
        '<button class="btn sm" data-act="mcp-add" data-value="stdio">添加 Stdio Server</button></div>' +
        (state.mcpMode === "json"
          ? '<div class="card" style="margin-top:12px"><div class="card-b"><textarea class="input mono" rows="14">{\n  "my-knowledge": {\n    "type": "http",\n    "url": "https://mcp.example.com/mcp",\n    "headers": { "Authorization": "Bearer ****" }\n  }\n}</textarea>' +
            '<div class="row" style="margin-top:10px"><button class="btn" data-act="mcp-probe">探测</button><span class="spacer"></span><button class="btn primary" data-act="mcp-save">保存 JSON</button></div></div></div>'
          : '<div class="agent-grid" style="margin-top:12px"><div class="agent-card"><div class="row"><span class="avatar violet">M</span><div><b class="agent-name">my-knowledge</b><div class="agent-desc">https://mcp.example.com/mcp</div></div><span class="spacer"></span><span class="tag green sm">已启用</span></div>' +
            '<div class="agent-meta"><span class="tag outline">HTTP</span><span class="tag sm">8 个工具</span><span class="tag blue sm">默认打开</span></div>' +
            '<div class="agent-foot"><button class="btn sm" data-act="mcp-edit">编辑</button><button class="btn sm text" data-act="mcp-probe">探测</button><span class="spacer"></span><button class="btn sm text danger" data-act="mcp-delete">删除</button></div></div>' +
            '<div class="agent-card agent-new" data-act="mcp-add" data-value="http"><div class="empty" style="padding:22px"><div class="glyph">' + icon("plus") + '</div><b>添加 MCP Server</b><p>支持 HTTP / Stdio、Headers、Args、Env。</p></div></div></div>');
    }
    return '<div class="main"><div class="page">' +
      cfgHead("连接", "连接器、通道与云端协同，在对话中按需使用。",
        '<button class="btn primary" data-act="conn-add">' + icon("plus", "ic-sm") + "添加自定义 MCP</button>") +
      '<div class="tabs" style="margin:16px -24px 0;padding:0 24px">' + tabs.map(([id, label]) =>
        '<button class="tab ' + (tab === id ? "active" : "") + '" data-act="conn-tab" data-id="' + id + '">' + label + "</button>").join("") + "</div>" +
      body + "</div></div>";
  }

  function renderConnectorDrawer() {
    const c = state.connector;
    if (!c) return "";
    const creds = c.kind === "feishu"
      ? agentField("App ID", '<input class="input" value="cli_xxxxxxxx" />') + agentField("App Secret", '<input class="input" type="password" value="••••••••" />')
      : c.kind === "mail"
        ? agentField("邮箱", '<input class="input" value="ops@acme.com" />') + agentField("授权码 / 密码", '<input class="input" type="password" value="••••••••" />')
        : agentField("Personal Token", '<input class="input" type="password" value="••••••••" />', "从服务授权页复制；也可点「从剪贴板粘贴」。");
    return '<div class="drawer-mask" data-act="close-connector"></div><aside class="drawer" style="width:500px">' +
      '<div class="drawer-h"><span class="avatar ' + (c.status === "已过期" ? "amber" : "blue") + '" style="width:34px;height:34px">' + c.name[0] + "</span>" +
      "<div><b>" + esc(c.name) + '</b><div class="hint">' + esc(c.kind) + " · " + esc(c.status) + "</div></div><span class=\"spacer\"></span>" +
      '<span class="tag ' + (c.status === "已连接" ? "green" : "amber") + ' sm">' + esc(c.status) + "</span>" +
      '<button class="icon-btn" data-act="close-connector">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      agentField("显示名称", '<input class="input" id="conn-name" value="' + esc(c.name) + '" />') +
      agentField("描述", '<input class="input" id="conn-desc" value="' + esc(c.desc) + '" />') +
      creds +
      '<div class="oauth-box"><div class="row"><b>授权状态</b><span class="tag ' + (c.status === "已过期" ? "amber" : "green") + ' sm">' + (c.status === "已过期" ? "已过期" : "已授权") + '</span></div>' +
      '<div class="hint">OAuth 令牌由服务端加密保存；过期后可重新授权，不影响历史会话。</div>' +
      '<div class="row"><button class="btn sm" data-act="conn-oauth" data-id="' + c.id + '">' + icon("refresh", "ic-sm") + "重新授权</button>" +
      '<button class="btn sm text" data-act="conn-probe">测试连接</button></div></div>' +
      agentField("认证方式", '<select class="input"><option>' + (c.kind === "feishu" ? "OAuth · 飞书应用" : c.kind === "mail" ? "IMAP / 授权码" : "Personal Token") + "</option></select>") +
      '<div class="setting-row"><div class="label"><b>对话默认选中</b><span>关闭后需在对话中手动勾选</span></div>' + toggle(c.def) + "</div>" +
      '<div class="setting-row"><div class="label"><b>共享范围</b><span>共享后其他人可选用，但不能改配置</span></div><select class="input" style="width:160px"><option>仅自己</option><option>所有人</option><option>指定分组</option></select></div>' +
      '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "保存后可「测试连接」探测可用工具数；OAuth 过期需重新授权。</div>" +
      "</div><div class=\"drawer-f\"><button class=\"btn\" data-act=\"conn-probe\">测试连接</button>" +
      '<button class="btn text danger" data-act="conn-delete">删除</button><span class="spacer"></span>' +
      '<button class="btn" data-act="close-connector">取消</button><button class="btn primary" data-act="conn-save">保存</button></div></aside>';
  }

  function renderExtensions() {
    const view = state.extView || "installed";
    const switchRow = '<div class="row" style="margin-top:14px"><button class="chip ' + (view === "installed" ? "on" : "") + '" data-act="plugin-view" data-id="installed">已安装</button>' +
      '<button class="chip ' + (view === "market" ? "on" : "") + '" data-act="plugin-view" data-id="market">插件市场</button>' +
      '<span class="spacer"></span><span class="hint">' + (view === "installed" ? PLUGINS.length + " 个已安装" : PLUGIN_MARKET.length + " 个可安装") + "</span></div>";
    let body = "";
    if (view === "market") {
      body = '<div class="agent-grid" style="margin-top:14px">' + PLUGIN_MARKET.map((p) => {
        const installed = PLUGINS.find((x) => x.name === p.name);
        return '<div class="agent-card"><div class="row"><span class="avatar blue">' + icon("puzzle", "ic-sm") + "</span>" +
          '<div><b class="agent-name">' + esc(p.name) + '</b><div class="agent-desc">' + esc(p.desc) + "</div></div>" +
          '<span class="spacer"></span><span class="tag sm">v' + p.version + "</span></div>" +
          '<div class="agent-meta">' + p.perms.map((x) => '<span class="tag outline sm">' + x + "</span>").join("") + "</div>" +
          '<div class="agent-foot"><button class="btn sm ' + (installed ? "" : "primary") + '" data-act="' + (installed ? "plugin-update" : "plugin-install-one") + '" data-name="' + p.name + '">' +
          (installed ? (installed.version === p.version ? "已安装" : "更新到 v" + p.version) : "安装") + "</button>" +
          (installed ? '<span class="hint">已安装 v' + installed.version + "</span>" : "") + "</div></div>";
      }).join("") + "</div>";
    } else {
      body = '<div class="card" style="margin-top:14px;overflow:hidden"><table class="table"><thead><tr><th>插件</th><th>版本</th><th>权限</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
        PLUGINS.map((p) => {
          const latest = PLUGIN_MARKET.find((x) => x.name === p.name);
          const updatable = latest && latest.version !== p.version;
          return "<tr><td><b>" + esc(p.name) + '</b><div class="hint">' + esc(p.desc) + "</div></td><td>" + esc(p.version) +
            (updatable ? ' <span class="tag blue sm">v' + latest.version + "</span>" : "") + "</td>" +
            "<td>" + (p.perms.length ? p.perms.map((x) => '<span class="tag sm outline">' + x + "</span>").join(" ") : '<span class="hint">无</span>') + "</td>" +
            '<td><span class="tag ' + (p.on ? "green" : "") + ' sm">' + (p.on ? "已启用" : "已禁用") + "</span></td>" +
            '<td style="text-align:right">' + (updatable ? '<button class="btn sm text" data-act="plugin-update" data-name="' + p.name + '">更新</button>' : "") +
            '<button class="btn sm text danger" data-act="plugin-remove" data-name="' + p.name + '">卸载</button>' +
            '<button class="switch ' + (p.on ? "on" : "") + '" data-act="plugin-toggle" data-name="' + p.name + '"></button></td></tr>';
        }).join("") + "</tbody></table></div>";
    }
    return '<div class="main"><div class="page"><div class="row"><div><div class="page-title">扩展</div><div class="page-sub">插件、技能与技能包。</div></div>' +
      '<div class="spacer"></div><button class="btn primary" data-act="plugin-install">' + icon("plus", "ic-sm") + "安装插件</button></div>" +
      switchRow + body + "</div></div>";
  }

  function renderUsage() {
    const view = state.usageView || "summary";
    const days = [42, 58, 51, 74, 66, 88, 61, 70, 82, 55, 48, 63, 71, 90];
    const labels = ["10-24", "10-25", "10-26", "10-27", "10-28", "10-29", "10-30", "10-31", "11-01", "11-02", "11-03", "11-04", "11-05", "11-06"];
    const tabs = [["summary", "概览"], ["day", "按天"], ["expert", "按专家"], ["model", "按模型"]];
    const exps = [["业务专家", "62%", "¥115.6", "774K", "64"], ["代码助手", "24%", "¥44.7", "299K", "28"], ["知识库问答", "9%", "¥16.8", "112K", "18"], ["发布管家", "5%", "¥9.3", "55K", "18"]];
    const models = [["deepseek-v4", "58%", "¥108.2", "724K"], ["glm-4.6", "26%", "¥48.5", "325K"], ["qwen3-max", "11%", "¥20.4", "136K"], ["bge-m3", "5%", "¥9.3", "55K"]];
    let body = "";
    if (view === "summary") {
      body = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px">' +
        [["总 token", "1.24M", "+12%"], ["总成本", "¥186.40", "+8%"], ["工单", "128", "+21%"], ["人工干预率", "0.42", "-6%"]].map(([l, v, d]) =>
          '<div class="card"><div class="stat"><span>' + l + '</span><b>' + v + '</b><span>' + d + " vs 上周</span></div></div>").join("") + "</div>" +
        '<div class="card" style="margin-top:16px"><div class="card-h"><b class="card-title">每日成本</b><span class="card-sub">近 14 天 · 单位 ¥</span>' +
        '<span class="spacer"></span><span class="hint">峰值 ¥18.2 · 均值 ¥12.6</span></div><div class="card-b">' +
        '<div class="usage-chart"><div class="chart-y"><span>¥20</span><span>¥10</span><span>0</span></div>' +
        '<div class="chart-main"><div class="bars">' + days.map((d, i) => '<i style="--h:' + d + '%" title="' + labels[i] + " · ¥" + (d / 5).toFixed(1) + '"></i>').join("") + "</div>" +
        '<div class="bar-x">' + labels.map((x) => "<span>" + x + "</span>").join("") + "</div></div></div></div></div>" +
        '<div class="card" style="margin-top:16px"><div class="card-h"><b class="card-title">按专家</b><span class="card-sub">成本占比</span></div><div class="card-b">' +
        exps.map(([n, p, c, t]) => '<div class="row" style="margin:10px 0"><span style="width:110px">' + n + "</span>" +
          '<div class="progress" style="flex:1"><i style="width:' + p + '"></i></div><span class="hint" style="width:56px;text-align:right">' + t + '</span><span class="hint" style="width:70px;text-align:right">' + c + "</span></div>").join("") +
        "</div></div>";
    } else if (view === "day") {
      body = '<div class="card" style="margin-top:16px"><div class="card-h"><b class="card-title">按天明细</b><span class="card-sub">近 7 天</span></div><table class="table"><thead><tr><th>日期</th><th>Token</th><th>成本</th><th>模型调用</th><th>会话</th></tr></thead><tbody>' +
        [["11-06", "128K", "¥18.2", "86", "12"], ["11-05", "112K", "¥16.4", "74", "10"], ["11-04", "96K", "¥14.1", "68", "9"], ["11-03", "88K", "¥12.8", "61", "8"], ["11-02", "102K", "¥15.2", "70", "9"], ["11-01", "76K", "¥10.9", "54", "7"], ["10-31", "64K", "¥9.6", "42", "6"]].map((r) =>
          "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
    } else if (view === "expert") {
      body = '<div class="card" style="margin-top:16px"><div class="card-h"><b class="card-title">按专家</b><span class="card-sub">成本 / token / 会话</span></div><table class="table"><thead><tr><th>专家</th><th>占比</th><th>Token</th><th>成本</th><th>会话</th></tr></thead><tbody>' +
        exps.map(([n, p, c, t, s]) => "<tr><td><b>" + n + "</b></td><td>" + p + "</td><td>" + t + "</td><td>" + c + "</td><td>" + s + "</td></tr>").join("") + "</tbody></table></div>";
    } else {
      body = '<div class="card" style="margin-top:16px"><div class="card-h"><b class="card-title">按模型</b><span class="card-sub">调用量与成本</span></div><table class="table"><thead><tr><th>模型</th><th>占比</th><th>Token</th><th>成本</th></tr></thead><tbody>' +
        models.map(([n, p, c, t]) => '<tr><td class="mono">' + n + "</td><td>" + p + "</td><td>" + t + "</td><td>" + c + "</td></tr>").join("") + "</tbody></table></div>";
    }
    return '<div class="main"><div class="page"><div class="row" style="align-items:flex-start"><div><div class="page-title">Token 统计</div>' +
      '<div class="page-sub">账户级用量、成本与模型分布。</div></div><div class="spacer"></div>' +
      '<button class="btn" data-act="usage-export">' + icon("download", "ic-sm") + "导出 CSV</button></div>" +
      '<div class="tabs" style="margin:16px -24px 0;padding:0 24px">' + tabs.map(([id, label]) =>
        '<button class="tab ' + (view === id ? "active" : "") + '" data-act="usage-tab" data-id="' + id + '">' + label + "</button>").join("") + "</div>" +
      '<div class="row" style="margin-top:12px"><span class="hint">时间范围</span>' +
      [["7d", "近 7 天"], ["30d", "近 30 天"], ["90d", "近 90 天"]].map(([id, label]) =>
        '<button class="chip ' + (state.usageRange === id ? "on" : "") + '" data-act="usage-range" data-id="' + id + '">' + label + "</button>").join("") +
      '<span class="spacer"></span><span class="hint">数据更新于 5 分钟前</span></div>' + body + "</div></div>";
  }

  function renderSettings() {
    const tabs = [["appearance", "外观"], ["notifications", "通知"], ["shortcuts", "快捷键"], ["account", "账号"]];
    let body = "";
    if (state.settingsTab === "appearance") {
      const palettes = [["tech", "#1677ff"], ["rose", "#e11d48"], ["indigo", "#4f46e5"], ["teal", "#0d9488"], ["violet", "#7c3aed"], ["emerald", "#059669"], ["amber", "#d97706"], ["slate", "#475569"]];
      body = '<div class="card"><div class="card-b">' +
        '<div class="setting-row"><div class="label"><b>显示名称</b><span>在界面中展示的名称，最长 64 个字符</span></div>' +
        '<div class="row"><input class="input" id="display-name" style="width:180px" value="' + esc(state.displayName) + '" /><button class="btn sm" data-act="profile-save">保存</button></div></div>' +
        '<div class="setting-row"><div class="label"><b>页面布局</b><span>经典模式保留双栏；极简模式将导航与记录合并到左侧</span></div>' +
        '<div class="row"><button class="chip ' + (state.layout === "classic" ? "on" : "") + '" data-act="layout-set" data-value="classic">经典模式</button>' +
        '<button class="chip ' + (state.layout === "minimal" ? "on" : "") + '" data-act="layout-set" data-value="minimal">极简模式</button></div></div>' +
        '<div class="setting-row"><div class="label"><b>语言</b><span>选择界面显示语言</span></div>' +
        '<div class="row"><button class="chip ' + (state.lang === "zh" ? "on" : "") + '" data-act="lang-set" data-value="zh">中文</button>' +
        '<button class="chip ' + (state.lang === "en" ? "on" : "") + '" data-act="lang-set" data-value="en">English</button></div></div>' +
        '<div class="setting-row"><div class="label"><b>主题</b><span>浅色 / 深色 / 跟随系统，切换立即生效</span></div>' +
        '<div class="row"><button class="chip ' + (state.theme === "light" ? "on" : "") + '" data-act="theme-set" data-value="light">浅色</button>' +
        '<button class="chip ' + (state.theme === "dark" ? "on" : "") + '" data-act="theme-set" data-value="dark">深色</button>' +
        '<button class="chip ' + (state.theme === "system" ? "on" : "") + '" data-act="theme-set" data-value="system">跟随系统</button></div></div>' +
        '<div class="setting-row"><div class="label"><b>配色</b><span>选择界面品牌配色，与浅色 / 深色模式独立</span></div>' +
        '<div class="swatches">' + palettes.map(([id, c]) =>
          '<button class="swatch ' + (state.palette === id ? "active" : "") + '" data-act="palette" data-value="' + id + '" title="' + id + '"><span style="background:' + c + '"></span></button>').join("") +
        '<input type="color" id="custom-color" data-input="custom-color" value="' + esc(state.customColor) + '" title="自定义颜色" style="width:34px;height:28px;padding:2px;border:1px solid var(--line-2);border-radius:6px;background:var(--surface)" />' +
        "</div></div>" +
        '<div class="setting-row"><div class="label"><b>密度</b><span>紧凑模式会缩小字号与间距</span></div>' +
        '<div class="row"><button class="chip ' + (state.density === "default" ? "on" : "") + '" data-act="density" data-value="default">默认</button>' +
        '<button class="chip ' + (state.density === "compact" ? "on" : "") + '" data-act="density" data-value="compact">紧凑</button></div></div>' +
        '<div class="setting-row"><div class="label"><b>预览</b><span>当前配色下的按钮、标签与进度</span></div>' +
        '<div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary sm">主按钮</button>' +
        '<button class="btn sm">次按钮</button><button class="btn sm danger">危险</button>' +
        '<span class="tag blue">标签</span><span class="tag green">完成</span>' +
        '<div class="progress" style="width:120px"><i style="width:62%"></i></div></div></div>' +
        "</div></div>" +
        '<div class="card" style="margin-top:14px"><div class="card-h"><b class="card-title">单点登录</b><span class="card-sub">将多个登录方式绑定到当前账号，任意一种均可登录</span></div><div class="card-b">' +
        [["飞书", "已绑定 · @admin", true], ["企业微信", "未绑定", false], ["钉钉", "未绑定", false]].map(([n, d, on]) =>
          '<div class="setting-row"><div class="label"><b>' + n + "</b><span>" + d + "</span></div>" +
          '<button class="btn sm ' + (on ? "" : "primary") + '" data-act="sso-toggle">' + (on ? "解除绑定" : "绑定") + "</button></div>").join("") +
        "</div></div>";
    } else if (state.settingsTab === "notifications") {
      body = '<div class="card"><div class="card-b">' +
        [["approval", "审批与提问", "有人需要你决定时提醒"], ["task", "任务完成", "工单结束时通知"], ["budget", "预算告警", "接近预算上限时提醒"], ["weekly", "周报", "每周一汇总用量"]].map(([key, t, d]) =>
          '<div class="setting-row"><div class="label"><b>' + t + "</b><span>" + d + "</span></div>" + toggle(state.notifications[key], key) + "</div>").join("") +
        "</div></div>";
    } else if (state.settingsTab === "shortcuts") {
      const rows = [["palette", "命令面板"], ["newChat", "新建对话"], ["inbox", "收件箱"], ["stop", "停止生成"]];
      body = '<div class="card"><div class="card-h"><b class="card-title">快捷键</b><span class="card-sub">⌘ 表示 Command / Ctrl；修改后立即生效</span></div><div class="card-b">' +
        rows.map(([k, d]) => '<div class="setting-row"><div class="label"><b>' + d + "</b></div>" +
          '<input class="input" data-keymap="' + k + '" value="' + esc(state.keymap[k]) + '" style="width:140px" /></div>').join("") +
        '<div class="setting-row"><div class="label"><b>任务列表上下</b><span>固定快捷键</span></div><span class="kbd">J / K</span></div>' +
        '<div class="setting-row"><div class="label"><b>发送 / 关闭</b><span>固定快捷键</span></div><span class="kbd">Enter / Esc</span></div>' +
        '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-act="keymap-reset">恢复默认</button>' +
        '<button class="btn primary" data-act="keymap-save">保存快捷键</button></div>' +
        "</div></div>";
    } else {
      body = '<div class="card"><div class="card-b"><div class="dl"><dt>用户名</dt><dd>admin</dd><dt>角色</dt><dd>管理员</dd>' +
        '<dt>邮箱</dt><dd>' + esc(state.email) + '</dd><dt>语言</dt><dd>中文</dd><dt>API Key</dt><dd>3 个</dd></div>' +
        '<div class="row" style="margin-top:16px"><button class="btn" data-act="account-password">修改密码</button>' +
        '<button class="btn" data-act="account-keys">管理 API Key</button>' +
        '<button class="btn danger" data-act="account-logout">退出登录</button></div></div></div>';
    }
    return '<div class="main"><div class="page"><div class="page-title">个人设置</div><div class="page-sub">账户、外观、语言与安全。</div>' +
      '<div class="profile-card" style="margin-top:16px"><span class="avatar ' + state.avatarColor + '" style="width:52px;height:52px;font-size:20px;border-radius:14px">A</span>' +
      '<div><div class="profile-name">' + esc(state.displayName) + ' <span class="tag blue sm">管理员</span></div><div class="profile-sub">@admin · ' + esc(state.email) + '</div></div>' +
      '<span class="spacer"></span><button class="btn sm" data-act="profile-avatar">更换头像</button><button class="btn sm" data-act="profile-edit">修改资料</button></div>' +
      '<div style="max-width:1080px;margin-top:16px">' + body + "</div></div></div>";
  }

  function renderAdmin() {
    if (state.adminEmpty) {
      return '<div class="main"><div class="page"><div class="page-title">管理</div><div class="page-sub">实例级配置、健康与审计。</div>' +
        '<div class="card" style="margin-top:16px"><div class="empty" style="padding:64px"><div class="glyph">' + icon("shield") + "</div><b>还没有可管理的成员</b><p>先邀请成员或配置模型，管理数据会出现在这里。</p>" +
        '<div class="row" style="justify-content:center"><button class="btn primary" data-act="user-invite">邀请成员</button>' +
        '<button class="btn" data-act="nav" data-route="admin-models">配置模型</button></div></div></div></div></div>';
    }
    const items = [
      ["admin-users", "用户管理", "账号、角色与用户分组", "users"],
      ["admin-models", "模型配置", "对话 / 向量 / 语音 / 搜索", "cpu"],
      ["admin-storage", "存储管理", "本地、对象存储、沙箱、数据库", "database"],
      ["admin-plugins", "插件管理", "服务器插件与权限", "puzzle"],
      ["admin-security", "安全防护", "审批、命令、文件、敏感信息", "shield"],
      ["admin-advanced", "应用设置", "环境变量、备份、HTTPS、更新", "sliders"],
    ];
    return '<div class="main"><div class="page"><div class="page-title">管理</div><div class="page-sub">实例级配置、健康与审计。</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px">' +
      [["活跃会话", "12"], ["队列深度", "3"], ["错误率", "0.4%"], ["p95 延迟", "1.2s"]].map(([l, v]) =>
        '<div class="card"><div class="stat"><span>' + l + "</span><b>" + v + "</b></div></div>").join("") + "</div>" +
      '<div class="agent-grid">' + items.map(([route, title, desc, ic]) =>
        '<div class="agent-card" data-act="nav" data-route="' + route + '"><div class="row"><span class="avatar blue">' + icon(ic, "ic-sm") + "</span>" +
        '<div><b class="agent-name">' + title + '</b><div class="agent-desc">' + desc + "</div></div><span class=\"spacer\"></span><span class=\"hint\">进入 →</span></div></div>").join("") + "</div>" +
      '<div class="card" style="margin-top:16px"><div class="card-h"><b class="card-title">数据地图</b><span class="card-sub">存储与容量</span></div><div class="card-b">' +
      [["控制面数据库", "PostgreSQL", "1.8 GB", "正常"], ["工作区", "S3 / cos-prod", "42 GB", "正常"], ["产物", "S3 / cos-prod", "180 GB", "正常"], ["向量", "pgvector", "7.2 GB", "正常"]].map(([a, b, c, s]) =>
        '<div class="setting-row"><div class="label"><b>' + a + "</b><span>" + b + "</span></div><span class=\"hint\">" + c + '</span><span class="tag green sm">' + s + "</span></div>").join("") +
      "</div></div></div></div>";
  }

  function renderWorkbench() {
    const cards = [
      ["wb-terminal", "terminal", "blue", "终端", "在浏览器中运行交互式 Shell"],
      ["wb-browser", "globe", "violet", "浏览器", "查看并接管专家的网页操作"],
      ["nav", "monitor", "amber", "远程桌面", "主机桌面与手机画面", "remote"],
      ["nav", "git-branch", "blue", "ACP Runner", "OpenCode / Claude Code / Codex", "acp"],
    ];
    return '<div class="main"><div class="page"><div class="row"><div><div class="page-title">工作台</div>' +
      '<div class="page-sub">终端、浏览器与远程设备。</div></div><div class="spacer"></div>' +
      '<button class="btn" data-act="nav" data-route="remote">' + icon("monitor", "ic-sm") + "远程桌面</button>" +
      '<button class="btn" data-act="nav" data-route="acp">' + icon("git-branch", "ic-sm") + "ACP 协作</button></div>" +
      '<div class="agent-grid">' + cards.map(([act, ic, color, title, desc, route]) =>
        '<div class="agent-card" data-act="' + act + '"' + (route ? ' data-route="' + route + '"' : "") + '><div class="row">' +
        '<span class="avatar ' + color + '">' + icon(ic, "ic-sm") + "</span><div><b class=\"agent-name\">" + title +
        '</b><div class="agent-desc">' + desc + "</div></div></div></div>").join("") +
      "</div></div></div>";
  }

  function pageSubnavHTML() {
    const navTab = (route, label, active) =>
      '<button class="tab ' + (active ? "active" : "") + '" data-act="nav" data-route="' + route + '">' + label + "</button>";
    const actTab = (act, id, label, active) =>
      '<button class="tab ' + (active ? "active" : "") + '" data-act="' + act + '" data-id="' + id + '">' + label + "</button>";
    let tabs = null;
    if (state.route.startsWith("settings")) {
      tabs = [["appearance", "外观"], ["notifications", "通知"], ["shortcuts", "快捷键"], ["account", "账号"]]
        .map(([id, label]) => actTab("settings-tab", id, label, state.settingsTab === id)).join("");
    } else if (state.route.startsWith("admin")) {
      tabs = [["admin", "概览"], ["admin-users", "用户"], ["admin-models", "模型"], ["admin-storage", "存储"],
        ["admin-plugins", "插件"], ["admin-security", "安全"], ["admin-advanced", "应用设置"]]
        .map(([route, label]) => navTab(route, label, state.route === route)).join("");
    } else if (state.route.startsWith("extensions") || state.route.startsWith("skills")) {
      tabs = navTab("extensions", "插件", state.route.startsWith("extensions")) + navTab("skills", "技能包", state.route.startsWith("skills"));
    } else if (state.route.startsWith("connections") || /^(channels|bridge|acp)/.test(state.route)) {
      tabs = navTab("connections", "连接器", state.route.startsWith("connections")) +
        navTab("channels", "通道", state.route.startsWith("channels")) +
        navTab("bridge", "云端协同", state.route.startsWith("bridge")) +
        navTab("acp", "ACP", state.route.startsWith("acp"));
    } else if (state.route.startsWith("workbench") || state.route.startsWith("remote")) {
      tabs = navTab("workbench", "工作台", state.route.startsWith("workbench")) + navTab("remote", "远程桌面", state.route.startsWith("remote"));
    }
    return tabs ? '<div class="tabs page-tabs" style="margin:0 0 16px">' + tabs + "</div>" : "";
  }

  function renderLoginPage() {
    return '<div class="auth-page"><div class="auth-card"><div class="auth-logo">P</div><h1>登录 PolyOpus</h1>' +
      '<p class="hint">会话已过期，请重新登录；本地草稿会保留。</p>' +
      '<div class="field"><label>邮箱</label><input class="input" id="login-email" value="' + esc(state.email) + '" /></div>' +
      '<div class="field"><label>密码</label><input class="input" id="login-pass" type="password" placeholder="••••••••" /></div>' +
      (state.loginError ? '<div class="field-error">' + esc(state.loginError) + "</div>" : "") +
      '<button class="btn primary block" data-act="login-submit" style="margin-top:14px">登录</button>' +
      '<div class="hint" style="margin-top:12px">原型演示：任意非空密码即可登录</div></div></div>';
  }

  function renderErrorPage(code) {
    const info = {
      401: ["登录已过期", "请重新登录后继续操作。", "重新登录", "error-login"],
      403: ["没有访问权限", "当前角色不能访问这个页面；可以请求管理员授权，或切换角色演示。", "请求访问", "error-request"],
      409: ["版本冲突", "数据已被其他人修改，请刷新后重试。", "刷新", "error-retry"],
      500: ["服务暂时不可用", "请求失败，请稍后重试；草稿已保留在本地。", "重试", "error-retry"],
    }[Number(code)] || ["出错了", "请稍后重试。", "重试", "error-retry"];
    return '<div class="main"><div class="page"><div class="error-page"><div class="error-code">' + Number(code) + "</div>" +
      "<h1>" + info[0] + "</h1><p>" + info[1] + "</p>" +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-act="' + info[3] + '">' + info[2] + "</button>" +
      (Number(code) === 403 ? '<button class="btn" data-act="role-set" data-value="admin">切换为管理员</button>' : "") +
      (Number(code) === 409 ? '<button class="btn danger" data-act="error-overwrite">覆盖保存</button>' : "") +
      '<button class="btn" data-act="nav" data-route="chat">返回对话</button></div></div></div></div>';
  }

  function renderMain() {
    if (state.errorDemo) return renderErrorPage(state.errorDemo);
    if (/^admin/.test(state.route) && !can("admin")) return renderErrorPage(403);
    if (/^(connections|channels|bridge|acp)/.test(state.route) && !can("connections")) return renderErrorPage(403);
    if (/^(extensions|skills)/.test(state.route) && !can("extensions")) return renderErrorPage(403);
    if (/^(workbench|remote)/.test(state.route) && !can("workbench")) return renderErrorPage(403);
    if (/^agents/.test(state.route) && !can("agents")) return renderErrorPage(403);
    let html;
    if (state.route.startsWith("chat")) html = renderChat();
    else if (state.route.startsWith("tasks")) html = renderTasks();
    else if (state.route.startsWith("automation")) html = renderAutomation();
    else if (state.route.startsWith("ticket")) html = renderTicket();
    else if (state.route.startsWith("inbox")) html = renderInbox();
    else if (state.route.startsWith("knowledge")) html = renderKnowledge();
    else if (state.route.startsWith("agents")) html = renderAgents();
    else if (state.route.startsWith("connections")) html = renderConnections();
    else if (state.route.startsWith("extensions")) html = renderExtensions();
    else if (state.route.startsWith("usage")) html = renderUsage();
    else if (state.route.startsWith("settings")) html = renderSettings();
    else if (state.route.startsWith("personalization")) html = renderPersonalization();
    else if (state.route.startsWith("channels")) html = renderChannels();
    else if (state.route.startsWith("skills")) html = renderSkills();
    else if (state.route.startsWith("bridge")) html = renderBridge();
    else if (state.route.startsWith("acp")) html = renderACP();
    else if (state.route.startsWith("remote")) html = renderRemote();
    else if (state.route.startsWith("admin-users")) html = renderAdminUsers();
    else if (state.route.startsWith("admin-models")) html = renderAdminModels();
    else if (state.route.startsWith("admin-storage")) html = renderAdminStorage();
    else if (state.route.startsWith("admin-plugins")) html = renderAdminPlugins();
    else if (state.route.startsWith("admin-security")) html = renderAdminSecurity();
    else if (state.route.startsWith("admin-advanced")) html = renderAdminAdvanced();
    else if (state.route.startsWith("admin")) html = renderAdmin();
    else if (state.route.startsWith("workbench")) html = renderWorkbench();
    else html = renderChat();
    const sub = pageSubnavHTML();
    if (!sub) return html;
    if (html.includes('<div class="page-sub">')) {
      return html.replace(/(<div class="page-sub">[\s\S]*?<\/div>)/, "$1" + sub);
    }
    return html.replace('<div class="page">', '<div class="page">' + sub);
  }

  /* ---------------- overlays ---------------- */
  function renderUserPopover() {
    const tchip = (v, label) =>
      '<button class="chip ' + (state.theme === v ? "on" : "") + '" data-act="theme-set" data-value="' + v + '">' + label + "</button>";
    const mi = (ic, label, act, hint) =>
      '<button class="user-menu-item" data-act="' + act + '">' + icon(ic, "ic-sm") + "<span>" + label + "</span>" +
      (hint ? '<span class="hint">' + hint + "</span>" : "") + "</button>";
    return '<div class="user-mask" data-act="close-user"></div>' +
      '<div class="user-pop"><div class="user-pop-head"><span class="avatar blue">A</span>' +
      '<div><div class="user-pop-name">' + esc(state.displayName) + ' <span class="tag blue sm">' + ROLE_LABEL[state.role] + '</span></div>' +
      '<div class="user-pop-handle">@admin · ' + esc(state.email) + '</div></div></div>' +
      '<div class="user-pop-body">' +
      '<div class="user-appearance"><div class="cap">角色（演示）</div><div class="row">' +
      ["admin", "member", "auditor"].map((r) => '<button class="chip ' + (state.role === r ? "on" : "") + '" data-act="role-set" data-value="' + r + '">' + ROLE_LABEL[r] + "</button>").join("") + "</div></div>" +
      '<div class="user-appearance"><div class="cap">错误页（演示）</div><div class="row">' +
      [401, 403, 409, 500].map((c) => '<button class="chip" data-act="error-demo" data-value="' + c + '">' + c + "</button>").join("") +
      '<button class="chip" data-act="list-fail">列表失败</button></div></div>' +
      '<div class="user-appearance"><div class="cap">外观</div><div class="row">' +
      tchip("light", "浅色") + tchip("dark", "深色") + tchip("system", "跟随系统") + "</div></div>" +
      mi("help", "帮助与反馈", "user-help") +
      mi("globe", "项目地址", "user-project") +
      mi("sliders", "自定义导航", "user-customize") +
      mi("settings", "个人设置", "user-settings", "⌘,") +
      mi("shield", "账户安全", "user-security") +
      mi("refresh", "检查更新", "user-update") +
      '<div class="user-divider"></div>' +
      '<button class="user-menu-item danger" data-act="user-logout">' + icon("logout", "ic-sm") + "<span>退出登录</span></button>" +
      "</div></div>";
  }

  function renderOverlays() {
    let out = "";
    if (state.userMenu) out += renderUserPopover();
    if (state.connector) out += renderConnectorDrawer();
    if (state.modal) out += renderModal();
    if (state.drawer === "agent") out += renderAgentDrawer(AGENTS.find((a) => a.id === state.agent));
    if (state.menu) {
      out += '<div style="position:fixed;inset:0;z-index:55" data-act="close-menu"></div>' +
        '<div class="dropdown" style="left:' + state.menu.x + "px;top:" + state.menu.y + "px\">" +
        (state.menu.label ? '<div class="menu-label">' + esc(state.menu.label) + "</div>" : "") +
        state.menu.items.map((it) =>
          it.sep ? '<div class="menu-sep"></div>' :
            '<div class="menu-item ' + (it.active ? "active" : "") + '" data-act="' + (it.act || "menu-noop") + '" data-value="' + esc(it.value || "") + '" data-route="' + esc(it.route || it.value || "") + '">' +
            (it.icon ? icon(it.icon, "ic-sm") : "") + "<span>" + esc(it.label) + "</span>" +
            (it.hint ? '<span class="hint">' + esc(it.hint) + "</span>" : "") + "</div>").join("") + "</div>";
    }
    if (state.cmd) out += renderCommandPalette();
    return out;
  }

  const SLASH_ITEMS = [
    ["/new", "新建对话", "plus"], ["/clear", "清空当前会话", "trash"],
    ["/compact", "压缩上下文", "minimize"], ["/plan", "切换到 Plan 模式", "list"],
    ["/ask", "切换到 Ask 模式", "spark"], ["/model", "切换模型", "cpu"],
    ["/stop", "停止生成", "stop"], ["/export", "导出会话", "download"],
  ];
  function renderSlashList() {
    const q = (state.slashQ || "").toLowerCase();
    const list = SLASH_ITEMS.filter((x) => !q || (x[0] + x[1]).toLowerCase().includes(q));
    if (!list.length) return '<div class="empty" style="padding:22px"><b>没有匹配的命令</b></div>';
    return list.map(([cmd, desc, ic]) =>
      '<div class="mention-item" data-act="slash-run" data-value="' + cmd + '"><span class="mono" style="color:var(--primary)">' +
      cmd + "</span><span>" + desc + '</span><span class="spacer"></span>' + icon(ic, "ic-sm") + "</div>").join("");
  }

  const MENTION_ITEMS = [
    ["src/auth.ts", "文件", "file"], ["tests/auth.spec.ts", "文件", "file"],
    ["weekly.xlsx", "表格", "file"], ["ops-handbook", "知识库", "book"],
    ["业务专家", "专家", "bot"], ["调研员", "子智能体", "bot"],
  ];
  function renderMentionList() {
    const q = (state.mentionQ || "").toLowerCase();
    const list = MENTION_ITEMS.filter((x) => !q || x[0].toLowerCase().includes(q));
    if (!list.length) return '<div class="empty" style="padding:22px"><b>没有匹配项</b></div>';
    return list.map(([name, kind, ic]) =>
      '<div class="mention-item" data-act="mention-insert" data-value="' + esc(name) + '">' +
      icon(ic, "ic-sm") + "<span>" + esc(name) + '</span><span class="hint">' + kind + "</span></div>").join("");
  }

  function renderModal() {
    const m = state.modal;
    let body = "";
    if (m.type === "confirm") {
      body = '<div class="modal-b">' + m.body + "</div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button>' +
        '<button class="btn ' + (m.danger ? "danger" : "primary") + '" data-act="modal-confirm">' + esc(m.confirmLabel || "确认") + "</button></div>";
    } else if (m.type === "budget") {
      body = '<div class="modal-b"><div class="field"><label>追加金额（¥）</label><input class="input" id="budget-input" type="number" value="1.00" min="0.1" step="0.5" /></div>' +
        '<div class="hint" style="margin-top:8px">当前 ' + money(m.task.cost) + " / " + money(m.task.budget) + "；追加后立即恢复执行。</div></div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="budget-save">确认追加</button></div>';
    } else if (m.type === "answer") {
      body = '<div class="modal-b"><div class="field"><label>回答</label><textarea class="input" id="answer-input" rows="4" placeholder="例如：用 camelCase，和现有 API 保持一致"></textarea></div></div>' +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="answer-save">提交回答</button></div>';
    } else if (m.type === "upload") {
      body = '<div class="modal-b"><div class="field"><label>文件</label><input class="input" type="file" /></div>' +
        '<div class="hint" style="margin-top:8px">支持 PDF / Word / Markdown / 图片；上传后进入解析队列。</div></div>' +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="upload-save">上传</button></div>';
    } else if (m.type === "new-task") {
      body = '<div class="modal-b"><div class="field"><label>任务标题</label><input class="input" id="new-task-title" placeholder="例如：修复登录超时" /></div>' +
        '<div class="field"><label>来源</label><select class="input"><option>GitHub</option><option>飞书</option><option>邮件</option></select></div>' +
        '<div class="hint" style="margin-top:8px">手动建单会跳过 Gate 与 Eval，直接使用默认授权范围。</div></div>' +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="new-task-save">创建</button></div>';
    } else if (m.type === "agent-new") {
      body = '<div class="modal-b"><div class="field"><label>名称</label><input class="input" id="agent-name" placeholder="例如：发布管家" /></div>' +
        '<div class="field"><label>模板</label><select class="input"><option>空白</option><option>业务专家</option><option>代码助手</option></select></div></div>' +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="agent-create">创建</button></div>';
    } else if (m.type === "customize") {
      body = '<div class="modal-b"><div class="alert info" style="margin-bottom:12px">' + icon("info", "ic-sm") + '拖动排序、分组与隐藏；原型中开关仅改变当前预览。</div>' +
        [["对话", "常用", true], ["专家", "常用", true], ["自动化", "常用", true], ["Token 统计", "常用", true],
         ["个性化", "设置", true], ["通道", "设置", true], ["连接器", "设置", true],
         ["用户管理", "管理", true], ["模型配置", "管理", true], ["安全防护", "管理", true]].map(([n, g, on]) =>
          '<div class="setting-row" style="padding:8px 0"><div class="label"><b>' + n + '</b><span>' + g + '</span></div>' +
          '<button class="switch ' + (on ? "on" : "") + '" data-act="toggle-switch"></button></div>').join("") + "</div>" +
        '<div class="modal-f"><button class="btn" data-act="customize-reset">恢复默认</button><span class="spacer"></span>' +
        '<button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="modal-done">保存</button></div>';
    } else if (m.type === "security") {
      const rows = [
        ["验证器应用", "未启用 · 使用 TOTP 二次验证", "设置验证器"],
        ["通行密钥", "0 个 · 使用指纹 / 面容 / 锁屏密码", "添加通行密钥"],
        ["恢复码", "未生成 · 验证器丢失时的备用码", "生成恢复码"],
        ["登录密码", "上次修改：30 天前", "修改密码"],
      ];
      body = '<div class="modal-b">' + rows.map(([n, d, a]) =>
        '<div class="setting-row"><div class="label"><b>' + n + "</b><span>" + d + "</span></div>" +
        '<button class="btn sm" data-act="security-action">' + a + "</button></div>").join("") +
        '<div class="hint" style="margin-top:10px">修改安全设置前需要再次输入密码。</div></div>' +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">完成</button></div>';
    } else if (m.type === "invite") {
      body = '<div class="modal-b"><div class="field"><label>邮箱</label><input class="input" id="invite-email" placeholder="name@company.com" /></div>' +
        (state.inviteError ? '<div class="field-error">' + esc(state.inviteError) + "</div>" : "") +
        '<div class="field"><label>角色</label><select class="input" id="invite-role"><option>成员</option><option>管理员</option></select></div></div>' +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="invite-send">发送邀请</button></div>';
    } else if (m.type === "shortcuts") {
      const rows = [["⌘K", "命令面板"], ["⌘N", "新建对话"], ["⌘⇧A", "收件箱"], ["⌘.", "停止生成"], ["Enter", "发送 / 下一题"], ["Shift+Enter", "换行"], ["Esc", "关闭弹层"], ["?", "本快捷键表"]];
      body = '<div class="modal-b">' + rows.map(([k, d]) =>
        '<div class="setting-row" style="padding:9px 0"><div class="label"><b>' + d + '</b></div><span class="kbd">' + k + "</span></div>").join("") + "</div>" +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">知道了</button></div>';
    } else if (m.type === "conflict") {
      body = '<div class="modal-b"><div class="alert error">' + icon("alert", "ic-sm") + esc(m.body || "数据已被其他人修改。") + "</div></div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button>' +
        '<button class="btn" data-act="conflict-refresh">刷新</button>' +
        '<button class="btn danger" data-act="conflict-overwrite">覆盖保存</button></div>';
    } else if (m.type === "workbench") {
      body = '<div class="modal-b">' + (m.mode === "terminal"
        ? '<div class="mono" style="background:var(--surface-2);border-radius:8px;padding:14px;font-size:12px;line-height:1.8">$ pwd<br/>/data/workspaces/business-expert<br/>$ ls<br/>SOUL.md  IDENTITY.md  AGENTS.md<br/><span class="hint">终端为原型展示，未接入真实 Shell。</span></div>'
        : '<div class="empty" style="padding:36px"><div class="glyph">' + icon("globe") + "</div><b>浏览器画面</b><p>原型中不渲染真实网页；可在专家会话中查看浏览轨迹。</p></div>") + "</div>" +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">关闭</button></div>';
    } else if (m.type === "model-manage") {
      body = '<div class="modal-b"><div class="hint" style="margin-bottom:8px">' + esc(m.name) + " · 模型列表</div>" +
        ["deepseek-v4", "deepseek-r1", "gpt-5", "gpt-5-mini"].map((x, i) => '<div class="setting-row"><div class="label"><b class="mono">' + x + "</b><span>" + (i < 2 ? "对话 / 推理" : "对话") + '</span></div><span class="tag ' + (i < 2 ? "green" : "") + ' sm">' + (i < 2 ? "已启用" : "未启用") + "</span></div>").join("") + "</div>" +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">关闭</button></div>';
    } else if (m.type === "role-edit") {
      body = '<div class="modal-b"><div class="hint" style="margin-bottom:8px">角色：' + esc(m.name) + "</div>" +
        ["查看对话", "创建专家", "管理连接器", "查看审计", "管理用户"].map((p) => '<label class="setting-row" style="cursor:pointer"><div class="label"><b>' + p + "</b></div><input type=\"checkbox\" checked /></label>").join("") + "</div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="role-save">保存权限</button></div>';
    } else if (m.type === "role-members") {
      body = '<div class="modal-b"><div class="hint" style="margin-bottom:8px">角色：' + esc(m.name) + "</div>" +
        state.adminUsers.filter((u) => u.role === m.name || (m.name === "成员" && u.role === "成员")).map((u) => '<div class="setting-row"><div class="label"><b>' + esc(u.n) + "</b><span>" + esc(u.e) + "</span></div><span class=\"tag sm\">" + esc(u.status) + "</span></div>").join("") + "</div>" +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">关闭</button></div>';
    } else if (m.type === "bridge-peers") {
      body = '<div class="modal-b"><div class="hint" style="margin-bottom:8px">对端 6 个专家，显示可用的 2 个：</div>' +
        ["业务专家", "代码助手"].map((n) => '<div class="setting-row"><div class="label"><b>' + n + '</b><span>对端 · 公司云端</span></div><button class="btn sm" data-act="nav" data-route="chat">对话</button></div>').join("") + "</div>" +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">关闭</button></div>';
    } else if (m.type === "subagent-skills") {
      body = '<div class="modal-b"><div class="row"><span class="avatar violet">' + icon("bot", "ic-sm") + '</span><div><b>' + esc(m.name || "子智能体") + '</b><div class="hint">可用的工具与技能</div></div></div>' +
        '<div class="setting-row"><div class="label"><b>技能</b></div><div class="row"><span class="tag outline">web-search</span><span class="tag outline">pdf-reader</span></div></div>' +
        '<div class="setting-row"><div class="label"><b>工具</b></div><div class="row"><span class="tag outline">fs.read</span><span class="tag outline">http.get</span></div></div></div>' +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">关闭</button></div>';
    } else if (m.type === "memory") {
      body = '<div class="modal-b"><div class="setting-row"><div class="label"><b>用户偏好</b><span>代码使用 camelCase</span></div><span class="tag green sm">高置信</span></div>' +
        '<div class="setting-row"><div class="label"><b>发布窗口</b><span>周三 14:00–17:00</span></div><span class="tag green sm">高置信</span></div>' +
        '<div class="setting-row"><div class="label"><b>常用仓库</b><span>acme/api</span></div><span class="tag amber sm">待确认</span></div></div>' +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">关闭</button></div>';
    } else if (m.type === "plugin-detail") {
      const p = PLUGINS.find((x) => x.name === m.name);
      body = '<div class="modal-b">' + (p ? '<div class="row"><span class="avatar blue">' + icon("puzzle", "ic-sm") + '</span><div><b>' + esc(p.name) + '</b><div class="hint">v' + esc(p.version) + " · " + (p.on ? "已启用" : "已禁用") + "</div></div></div>" +
        '<div class="setting-row"><div class="label"><b>权限</b><span>安装时授予，变更需重新确认</span></div><div class="row">' +
        (p.perms.length ? p.perms.map((x) => '<span class="tag outline">' + x + "</span>").join("") : '<span class="hint">无</span>') + "</div></div>" +
        '<div class="field"><label>说明</label><div class="hint">' + esc(p.desc) + "</div></div>" : '<div class="hint">插件不存在</div>') + "</div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">关闭</button>' + (p ? '<button class="btn danger" data-act="plugin-remove" data-name="' + esc(p.name) + '">卸载</button>' : "") + "</div>";
    } else if (m.type === "oauth") {
      const step = m.step || 0;
      body = '<div class="modal-b"><div class="oauth-head"><span class="avatar blue">' + esc((m.provider || "O")[0]) + "</span><div><b>" + esc(m.provider) + " 授权</b>" +
        '<div class="hint">' + (step === 2 ? "已获得访问令牌" : step === 1 ? "等待浏览器完成授权" : "将打开服务商授权页") + "</div></div></div>" +
        (step === 0 ? '<div class="oauth-step"><p>授权后 PolyOpus 可读取你允许的文档、消息与日程。令牌加密保存，可随时撤销。</p><div class="row"><button class="btn primary" data-act="oauth-start">打开授权页</button></div></div>'
          : step === 1 ? '<div class="oauth-step"><div class="oauth-wait"><span class="spinner"></span>正在等待授权…</div><p class="hint">若浏览器未打开，请检查弹窗拦截。授权码：FEISHU-8K2P</p></div>'
            : '<div class="oauth-step"><div class="oauth-success">' + icon("check", "ic-sm") + "授权成功</div><p class=\"hint\">连接已恢复，可继续测试或保存配置。</p><div class=\"row\"><button class=\"btn primary\" data-act=\"oauth-complete\">完成</button></div></div>") +
        "</div>" + (step < 2 ? '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button></div>' : "");
    } else if (m.type === "doc-preview") {
      const isMd = /\.(md|txt)$/i.test(m.name);
      body = '<div class="modal-b"><div class="doc-preview">' + (isMd
        ? "<h3>发布流程</h3><p>1. 提交发布申请，填写变更范围与回滚点。</p><p>2. SRE 负责人审批；紧急发布需值班经理确认。</p><p>3. 发布窗口：周三 14:00–17:00。</p><p>4. 发布后 30 分钟内完成健康检查。</p>"
        : '<div class="empty" style="padding:26px"><div class="glyph">' + icon("file") + "</div><b>该格式暂不支持在线预览</b><p>可下载原文件查看。</p></div>") + "</div></div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">关闭</button><button class="btn" data-act="doc-locate">定位到列表</button><button class="btn primary" data-act="doc-download">下载原文件</button></div>';
    } else if (m.type === "slash") {
      body = '<div class="modal-b" style="padding-top:0"><div class="search" style="margin:0 0 8px">' + icon("slash", "ic-sm") +
        '<input id="slash-search" placeholder="搜索命令，例如 /plan…" value="' + esc(state.slashQ) + '" /></div>' +
        '<div class="mention-list" id="slash-list">' + renderSlashList() + "</div></div>";
    } else if (m.type === "mention") {
      body = '<div class="modal-b" style="padding-top:0"><div class="search" style="margin:0 0 8px">' + icon("search", "ic-sm") +
        '<input id="mention-search" placeholder="搜索文件、文档、专家…" value="' + esc(state.mentionQ) + '" /></div>' +
        '<div class="mention-list" id="mention-list">' + renderMentionList() + "</div></div>";
    } else if (m.type === "context") {
      body = '<div class="modal-b"><div class="row" style="gap:16px"><div class="ring" style="width:64px;height:64px"><span style="font-size:13px">' + state.contextPct + '%</span></div>' +
        '<div><b>79,360 / 128,000 tokens</b><div class="hint">系统提示 12.4k · 历史 38.2k · 工具结果 21.1k · 记忆 7.6k</div></div></div>' +
        '<div class="divider"></div><div class="setting-row"><div class="label"><b>上下文压缩</b><span>达到 80% 时自动压缩较早轮次</span></div>' + toggle(true) + "</div>" +
        '<div class="setting-row"><div class="label"><b>工具结果清理</b><span>保留最近 3 轮工具输出</span></div>' + toggle(true) + "</div></div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">关闭</button><button class="btn primary" data-act="context-compress">立即压缩</button></div>';
    } else if (m.type === "form") {
      body = '<div class="modal-b">' + (m.saveError ? '<div class="field-error" style="margin-bottom:10px">' + esc(m.saveError) + ' <button class="btn sm text" data-act="modal-retry">重试</button></div>' : "") +
        (m.fields || []).map((f) => {
          const fv = m.draft && m.draft[f.id] != null ? m.draft[f.id] : (f.value || "");
          return '<div class="field"><label>' + esc(f.label) + (f.required ? ' <span style="color:var(--red)">*</span>' : "") + "</label>" +
        (f.type === "select"
          ? '<select class="input" id="' + f.id + '">' + f.options.map((o) => "<option" + (fv === o ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>"
          : '<input class="input" id="' + f.id + '" placeholder="' + esc(f.placeholder || "") + '" value="' + esc(fv) + '" />') +
        (state.formErrors && state.formErrors[f.id] ? '<div class="field-error">' + esc(state.formErrors[f.id]) + "</div>" : "") + "</div>";
        }).join("") +
        (m.hint ? '<div class="hint" style="margin-top:8px">' + esc(m.hint) + "</div>" : "") + "</div>" +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button>' +
        '<button class="btn primary" data-act="form-save" data-kind="' + esc(m.kind || "") + '">' + esc(m.confirmLabel || "保存") + "</button></div>";
    }
    return '<div class="mask" data-act="modal-mask"><div class="modal" data-act="modal-noop"><div class="modal-h">' + esc(m.title || "") + "</div>" + body + "</div></div>";
  }

  function renderCommandPalette() {
    const cmds = [
      ["聊天：新建对话", "新建一个会话", "nav", "chat", "chat"],
      ["任务：任务中心", "查看进行中与待决", "nav", "tasks", "inbox"],
      ["任务：收件箱", "处理需要你决定的事", "nav", "inbox", "alert"],
      ["知识：知识库", "文档与检索", "nav", "knowledge", "book"],
      ["专家：我的专家", "配置与发布", "nav", "agents", "bot"],
      ["设置：外观", "主题、强调色、密度", "nav", "settings", "sliders"],
      ["切换主题", "浅色 / 深色", "theme", "", "moon"],
    ];
    const list = cmds.filter((c) => (c[0] + c[1]).toLowerCase().includes(state.cmdQ.toLowerCase()));
    return '<div class="mask" style="padding-top:14vh;align-items:flex-start" data-act="cmd-close">' +
      '<div class="modal" style="width:560px;padding:0" data-act="cmd-noop"><input class="input" id="cmd-input" placeholder="搜索或输入命令…" style="border:0;border-bottom:1px solid var(--line);border-radius:0;height:48px;font-size:14px" value="' + esc(state.cmdQ) + '" />' +
      '<div style="padding:6px">' + (list.length ? list.map((c) =>
        '<div class="menu-item" data-act="cmd-run" data-route="' + c[3] + '" data-kind="' + c[2] + '">' + icon(c[4], "ic-sm") +
        "<span>" + c[0] + '</span><span class="hint">' + c[1] + "</span></div>").join("") :
        '<div class="empty" style="padding:24px"><b>没有匹配的命令</b></div>') + "</div></div></div>";
  }

  /* ---------------- render root ---------------- */
  function renderMobileNav() {
    const items = [["chat", "chat", "对话"], ["tasks", "inbox", "任务"], ["agents", "bot", "专家"], ["knowledge", "book", "知识"], ["settings", "sliders", "我的"]];
    return '<nav class="mobile-nav">' + items.map(([r, ic, label]) =>
      '<button class="' + (state.route.startsWith(r) || (r === "tasks" && /^(inbox|ticket)/.test(state.route)) ? "active" : "") + '" data-act="nav" data-route="' + r + '">' +
      icon(ic) + "<span>" + label + "</span></button>").join("") + "</nav>";
  }

  function applyPermissions() {
    document.querySelectorAll("[data-act]").forEach((el) => {
      const perm = ACTION_PERM[el.dataset.act];
      if (!perm || can(perm)) return;
      if (el.tagName === "BUTTON") el.disabled = true;
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("title", "当前角色无权限");
      el.classList.add("perm-disabled");
    });
  }

  function applyA11y() {
    document.querySelectorAll("button").forEach((b) => {
      if (!b.getAttribute("aria-label")) {
        const label = b.getAttribute("title") || (b.innerText || "").trim() || b.dataset.act || "按钮";
        b.setAttribute("aria-label", label);
      }
    });
    document.querySelectorAll("input,textarea,select").forEach((el) => {
      if (!el.getAttribute("aria-label")) {
        const label = el.getAttribute("placeholder") || el.id || el.getAttribute("data-input") || "输入";
        el.setAttribute("aria-label", label);
      }
    });
    document.querySelectorAll("[data-act]:not(button)").forEach((el) => {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      if (!el.hasAttribute("role")) el.setAttribute("role", "button");
      if (!el.getAttribute("aria-label")) {
        const label = el.innerText.trim().split("\n")[0] || el.dataset.act;
        if (label) el.setAttribute("aria-label", label);
      }
    });
  }

  function closeModal() {
    const m = state.modal;
    if (!m) return;
    if (m.dirty && m.type !== "confirm") {
      state.modal = { type: "confirm", title: "放弃未保存的修改？", body: "当前表单有未保存的内容，关闭后会丢失。", confirmLabel: "放弃修改", danger: true, onConfirm: () => { state.modal = null; render(); } };
      render();
      return;
    }
    state.modal = null;
    render();
  }

  function render() {
    applyTheme();
    const app = $("#app");
    if (state.loggedOut) {
      app.innerHTML = renderLoginPage();
      applyA11y();
      return;
    }
    app.innerHTML = '<div class="app">' + renderRail() + renderSide() + renderMain() + "</div>" + renderOverlays() + renderMobileNav();
    if (state.route.startsWith("chat")) {
      const msgs = $("#msgs");
      if (msgs) {
        if (state.pendingScroll != null) {
          msgs.scrollTop = state.pendingScroll;
          state.pendingScroll = null;
        } else if (state.autoScroll) {
          msgs.scrollTop = msgs.scrollHeight;
        }
        const sync = () => {
          const atBottom = msgs.scrollHeight <= msgs.clientHeight + 8 ||
            msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 48;
          state.autoScroll = atBottom;
          const btn = $("#scroll-bottom");
          if (btn) btn.classList.toggle("show", !atBottom);
        };
        msgs.addEventListener("scroll", sync);
        setTimeout(sync, 0);
      }
      const ta = $("#composer");
      if (ta) {
        ta.addEventListener("input", () => {
          state.draft = ta.value;
          const btn = $(".composer .send");
          if (btn && !state.streaming) btn.disabled = !ta.value.trim();
        });
        ta.addEventListener("keydown", (e) => {
          if (e.key === "/" && !ta.value) { e.preventDefault(); state.slashQ = ""; state.modal = { type: "slash" }; render(); return; }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
        });
      }
      const editTa = $("[data-input='edit-message']");
      if (editTa) {
        editTa.focus();
        editTa.selectionStart = editTa.value.length;
        editTa.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const btn = $("[data-act='edit-save']"); if (btn) btn.click(); }
          if (e.key === "Escape") { const btn = $("[data-act='edit-cancel']"); if (btn) btn.click(); }
        });
      }
      const fileInput = $("#attach-input");
      if (fileInput) fileInput.addEventListener("change", () => {
        state.attachments = state.attachments.concat(Array.from(fileInput.files || []).map((f) => ({ name: f.name, size: f.size })));
        render();
      });
    }
    if (state.cmd) {
      const inp = $("#cmd-input");
      if (inp) {
        inp.focus();
        inp.addEventListener("input", () => { state.cmdQ = inp.value; render(); });
      }
    }
    if (state.modal && state.modal.type === "slash") {
      const inp = $("#slash-search");
      if (inp) {
        inp.focus();
        inp.addEventListener("input", () => { state.slashQ = inp.value; const list = $("#slash-list"); if (list) list.innerHTML = renderSlashList(); });
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); const first = $("[data-act='slash-run']"); if (first) first.click(); }
          if (e.key === "Escape") { state.modal = null; render(); }
        });
      }
    }
    if (state.modal && state.modal.type === "mention") {
      const inp = $("#mention-search");
      if (inp) {
        inp.focus();
        inp.addEventListener("input", () => { state.mentionQ = inp.value; const list = $("#mention-list"); if (list) list.innerHTML = renderMentionList(); });
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); const first = $("[data-act='mention-insert']"); if (first) first.click(); }
          if (e.key === "Escape") { state.modal = null; render(); }
        });
      }
    }
    applyA11y();
    applyPermissions();
  }

  /* ---------------- actions ---------------- */
  function doSend() {
    if (state.chatError || state.modelMissing) { toast("先恢复模型或重新加载会话", "error"); return; }
    if (state.offline) { toast("网络已断开，恢复后再发送", "error"); return; }
    const text = state.draft.trim();
    if (!text && !state.attachments.length) { toast("先输入内容", "error"); return; }
    state.chatWelcome = false;
    state.draft = "";
    const atts = state.attachments.slice();
    state.attachments = [];
    if (state.streaming) {
      state.queue.push(text);
      toast("已加入队列，本轮结束后发送");
      render();
      return;
    }
    state.messages.push({ role: "user", id: uid(), text: text || "（附件）", attachments: atts, time: now(), divider: state.messages.length > 0 });
    state.autoScroll = true;
    startStream();
  }

  function startStream() {
    state.streaming = true;
    const reply = { role: "assistant", text: "", time: now(), steps: [], streaming: true };
    state.messages.push(reply);
    render();
    const full = "收到，我继续排查。先补一个失败用例复现 502，然后跑测试；如果 CI 配置需要改，我会再向你确认。";
    let i = 0;
    state.streamTimer = setInterval(() => {
      i += 3;
      reply.text = full.slice(0, i);
      const el = $("#stream-text");
      if (el) el.innerHTML = esc(reply.text) + '<span class="typing"><i></i><i></i><i></i></span>';
      if (state.autoScroll) { const box = $("#msgs"); if (box) box.scrollTop = box.scrollHeight; }
      if (i >= full.length) {
        clearInterval(state.streamTimer);
        state.streamTimer = null;
        reply.streaming = false;
        reply.steps = [["读取 2 个文件", "0.6s"], ["生成回归测试", "1.1s"], ["运行测试", "3.2s"]];
        if (state.mode === "Plan") reply.plan = { path: "/plans/plan-" + uid().slice(0, 6) + ".md", status: "ready" };
        reply.text = full;
        state.streaming = false;
        render();
        toast("本轮完成");
        if (state.queue.length) {
          const next = state.queue.shift();
          state.messages.push({ role: "user", text: next, time: now(), divider: true });
          setTimeout(startStream, 300);
        }
      }
    }, 45);
  }

  function stopStream() {
    if (state.streamTimer) clearInterval(state.streamTimer);
    state.streamTimer = null;
    state.streaming = false;
    const last = state.messages[state.messages.length - 1];
    if (last && last.streaming) { last.streaming = false; last.text = last.text || "（已停止）"; }
    render();
    toast("已停止本轮");
  }

  function approve(attId, scope) {
    const found = attentionById(attId);
    if (!found) return;
    found.att.resolved = true;
    found.task.bucket = "running";
    render();
    toast(scope === "session" ? "已允许，本会话内同类操作不再询问" : "已允许，本轮继续");
  }

  function deny(attId) {
    const found = attentionById(attId);
    if (!found) return;
    found.att.resolved = true;
    found.task.bucket = "done";
    found.task.state = "ended";
    found.task.summary = "已拒绝，任务结束";
    render();
    toast("已拒绝，任务已结束");
  }

  function resolveAttention(attId) {
    const found = attentionById(attId);
    if (!found) return;
    found.att.resolved = true;
    found.task.bucket = found.task.bucket === "attention" ? "running" : found.task.bucket;
    const list = attentions();
    state.selectedAttention = list.length ? list[0].att.id : null;
    render();
  }

  /* ---------------- menus ---------------- */
  function openMenu(anchor, label, items) {
    const r = anchor.getBoundingClientRect();
    let x = r.left;
    let y = r.bottom + 6;
    if (x + 240 > window.innerWidth) x = window.innerWidth - 250;
    if (y + items.length * 34 > window.innerHeight) y = Math.max(8, r.top - items.length * 34 - 6);
    state.menu = { x: x, y: y, label: label, items: items };
    render();
  }

  /* ---------------- event delegation ---------------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    const val = el.dataset.value;
    const id = el.dataset.id;
    switch (act) {
      case "nav": navigate(el.dataset.route); return;
      case "subtab": state[el.dataset.group] = val; render(); return;
      case "table-retry": state.listError = false; render(); toast("列表已重新加载"); return;
      case "table-cols": {
        const ts = tableState(el.dataset.table);
        state.tableColId = el.dataset.table;
        openMenu(el, "显示列", ts.columns.map((c) => ({ label: c.label, act: "table-col", value: c.key, active: !ts.hidden.includes(c.key) })));
        return;
      }
      case "table-col": {
        const ts = tableState(state.tableColId);
        const key = val;
        ts.hidden = ts.hidden.includes(key) ? ts.hidden.filter((x) => x !== key) : ts.hidden.concat(key);
        state.menu = null; render(); return;
      }
      case "table-sort": {
        const ts = tableState(el.dataset.table);
        const key = el.dataset.key;
        if (ts.sort === key) ts.dir = ts.dir === "asc" ? "desc" : "asc";
        else { ts.sort = key; ts.dir = "asc"; }
        ts.page = 1; render(); return;
      }
      case "table-page": tableState(el.dataset.table).page = Number(el.dataset.page); render(); return;
      case "table-size": {
        const ts = tableState(el.dataset.table);
        ts.size = Number(el.value); ts.page = 1; render(); return;
      }
      case "table-select": {
        const ts = tableState(el.dataset.table);
        const key = el.dataset.key;
        ts.selected = ts.selected.includes(key) ? ts.selected.filter((x) => x !== key) : ts.selected.concat(key);
        render(); return;
      }
      case "table-select-all": {
        const ts = tableState(el.dataset.table);
        const keys = ts.pageKeys || [];
        ts.selected = keys.every((k) => ts.selected.includes(k)) ? ts.selected.filter((k) => !keys.includes(k)) : Array.from(new Set(ts.selected.concat(keys)));
        render(); return;
      }
      case "table-bulk": {
        const id = el.dataset.table;
        const value = el.dataset.value;
        const ts = tableState(id);
        const selected = ts.selected.slice();
        if (id === "admin-users") {
          if (value === "delete") {
            state.modal = { type: "confirm", title: "批量删除用户", body: "将删除 " + selected.length + " 个用户，操作不可撤销。", confirmLabel: "删除", danger: true, onConfirm: () => { state.adminUsers = state.adminUsers.filter((u) => !selected.includes(u.u)); ts.selected = []; state.modal = null; render(); toast("已删除 " + selected.length + " 个用户"); } };
            render();
          } else {
            state.adminUsers.forEach((u) => { if (selected.includes(u.u)) u.status = value === "enable" ? "已启用" : "已禁用"; });
            ts.selected = []; render(); toast("已更新用户状态");
          }
        } else if (id === "admin-plugins") {
          if (value === "remove") {
            for (let i = PLUGINS.length - 1; i >= 0; i--) if (selected.includes(PLUGINS[i].name)) PLUGINS.splice(i, 1);
          } else PLUGINS.forEach((p) => { if (selected.includes(p.name)) p.on = value === "enable"; });
          ts.selected = []; render(); toast("已更新插件");
        } else if (id.startsWith("skills-")) {
          selected.forEach((k) => { state.skillToggle[k] = value === "enable"; });
          ts.selected = []; render(); toast("已更新技能状态");
        } else if (id === "admin-models") {
          state.providers.forEach((p) => { if (selected.includes(p.id)) p.status = "已授权"; });
          ts.selected = []; render(); toast("已测试并授权所选提供商");
        }
        return;
      }
      case "wb-terminal": state.modal = { type: "workbench", mode: "terminal" }; render(); return;
      case "wb-browser": state.modal = { type: "workbench", mode: "browser" }; render(); return;
      case "security-save": loadingThen(el, 500, () => toast("安全设置已保存，运行中的专家将自动重载")); return;
      case "pii-strategy": state.piiStrategy = val; render(); toast("脱敏策略：" + val); return;
      case "skill-scan": state.skillScan = val; render(); toast("技能扫描模式：" + val); return;
      case "security-reset-rules":
        { const ta = $("#toolguard-yaml"); if (ta) ta.value = 'rules:\\n  - id: rm-rf-root\\n    severity: critical\\n    pattern: "rm -rf /"\\n    action: block'; }
        toast("已恢复默认规则，保存后生效"); return;
      case "security-save-rules": {
        const ta = $("#toolguard-yaml");
        if (!ta || !ta.value.trim()) { toast("规则不能为空", "error"); return; }
        if (!/rules:/.test(ta.value)) { ta.style.borderColor = "var(--red)"; toast("YAML 需包含 rules: 根节点", "error"); return; }
        loadingThen(el, 450, () => toast("命令防护规则已保存"));
        return;
      }
      case "user-invite": state.inviteError = ""; state.modal = { type: "invite", title: "邀请成员" }; render(); return;
      case "invite-send": {
        const email = (($("#invite-email") || {}).value || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          state.inviteError = "请输入有效邮箱，例如 name@company.com";
          render(); return;
        }
        loadingThen(el, 450, () => {
          const role = (($("#invite-role") || {}).value) || "成员";
          state.adminUsers.push({ u: email.split("@")[0], n: email.split("@")[0], e: email, role, auth: "邀请", status: "待接受" });
          state.modal = null; state.inviteError = ""; render(); toast("邀请邮件已发送到 " + email);
        });
        return;
      }
      case "user-new":
        state.formErrors = {};
        state.modal = { type: "form", kind: "user", title: "新建用户", confirmLabel: "创建用户", fields: [
          { label: "用户名", id: "u-name", placeholder: "例如 alice", required: true },
          { label: "显示名称（可选）", id: "u-display", placeholder: "Alice Chen" },
          { label: "邮箱（可选）", id: "u-email", placeholder: "alice@acme.com" },
          { label: "账号类型", id: "u-role", type: "select", options: ["成员", "管理员"] },
          { label: "初始密码", id: "u-pass", placeholder: "至少 8 位，含字母和数字", required: true },
        ], hint: "创建后用户需首次登录修改密码；管理员不受资源策略限制。" };
        render(); return;
      case "role-edit": state.modal = { type: "role-edit", name: el.dataset.name }; render(); return;
      case "role-members": state.modal = { type: "role-members", name: el.dataset.name }; render(); return;
      case "role-save": state.modal = null; render(); toast("角色权限已保存"); return;
      case "group-edit": state.formErrors = {}; state.modal = { type: "form", kind: "group", title: "编辑分组", confirmLabel: "保存", fields: [{ label: "分组 ID", id: "g-id", value: el.dataset.name || "", required: true }, { label: "说明", id: "g-desc", placeholder: "分组说明" }] }; render(); return;
      case "group-delete": state.modal = { type: "confirm", title: "删除分组", body: "删除分组不会删除成员，只会解除分组关系。", confirmLabel: "删除", danger: true, onConfirm: () => { state.modal = null; render(); toast("分组已删除"); } }; render(); return;
      case "user-reset": toast("密码重置链接已生成"); return;
      case "user-toggle": {
        const u = state.adminUsers.find((x) => x.u === el.dataset.user);
        if (u) u.status = u.status === "已启用" ? "已禁用" : "已启用";
        render(); toast("已更新用户状态"); return;
      }
      case "user-delete": {
        const name = el.dataset.user;
        state.modal = { type: "confirm", title: "删除用户", body: "删除 " + name + " 后，其专家、会话与工作区将不可访问。", confirmLabel: "删除", danger: true, onConfirm: () => { state.adminUsers = state.adminUsers.filter((x) => x.u !== name); state.modal = null; render(); toast("已删除用户"); } };
        render(); return;
      }
      case "provider-add":
      case "provider-config": {
        state.formErrors = {};
        const p = state.providers.find((x) => x.name === el.dataset.name);
        state.modal = { type: "form", kind: "provider", title: act === "provider-add" ? "添加自定义提供商" : "配置提供商", confirmLabel: "保存", fields: [
          { label: "提供商 ID", id: "p-id", placeholder: "openai / deepseek", value: p ? p.id : "", required: true },
          { label: "显示名称", id: "p-name", placeholder: "例如 DeepSeek", value: p ? p.name : "", required: true },
          { label: "接入地址", id: "p-url", placeholder: "https://api.deepseek.com/v1", required: true },
          { label: "API 密钥", id: "p-key", placeholder: "sk-..." },
          { label: "协议类型", id: "p-proto", type: "select", options: ["默认（OpenAI 兼容）", "Anthropic Messages"] },
        ], hint: "密钥留空表示保持当前密钥；保存后可点「测试」探测连通性。" };
        render(); return;
      }
      case "provider-test": {
        const p = state.providers.find((x) => x.name === el.dataset.name);
        loadingThen(el, 550, () => {
          if (p) p.status = "已授权";
          render(); toast((p ? p.name : "提供商") + " 连通性测试通过");
        });
        return;
      }
      case "storage-add":
      case "storage-config": {
        state.formErrors = {};
        const s = state.storages.find((x) => x.name === el.dataset.name);
        state.modal = { type: "form", kind: "storage", title: act === "storage-add" ? "添加存储后端" : "配置存储后端", confirmLabel: "保存", fields: [
          { label: "名称", id: "s-name", placeholder: "例如 cos-prod", value: s ? s.name : "", required: true },
          { label: "类型", id: "s-kind", type: "select", options: ["本地文件系统", "腾讯云 COS", "Amazon S3", "PostgreSQL", "Docker 沙箱"], required: true },
          { label: "Endpoint / 路径", id: "s-url", placeholder: "https://cos.ap-guangzhou.myqcloud.com", required: true },
          { label: "Bucket / 数据库名", id: "s-bucket", placeholder: "bucket 名称", required: true },
          { label: "Access Key / 用户名", id: "s-key", placeholder: "凭证" },
          { label: "Secret Key / 密码", id: "s-secret", placeholder: "凭证" },
        ], hint: "保存后可点「探测」验证写入、读取与删除。" };
        render(); return;
      }
      case "storage-probe": {
        const s = state.storages.find((x) => x.name === el.dataset.name);
        loadingThen(el, 550, () => {
          if (s) s.status = "已配置";
          render(); toast((s ? s.name : "存储") + " 探测成功：写入 / 读取 / 删除正常");
        });
        return;
      }
      case "channel-new":
      case "channel-config":
        state.modal = { type: "form", kind: "channel", title: act === "channel-new" ? "新建通道" : "通道配置", confirmLabel: "保存", fields: [
          { label: "通道类型", id: "c-kind", type: "select", options: ["飞书", "企业微信", "QQ", "钉钉", "Discord", "Telegram"] },
          { label: "显示名称", id: "c-name", placeholder: "例如 研发群机器人" },
          { label: "App ID / Bot Token", id: "c-id", placeholder: "从开放平台复制" },
          { label: "App Secret", id: "c-secret", placeholder: "从开放平台复制" },
          { label: "机器人前缀", id: "c-prefix", placeholder: "@poly" },
        ], hint: "保存后点「检测连接」验证凭据；控制台通道不可关闭。" };
        render(); return;
      case "channel-check": toast("凭据验证通过，连接正常（演示）"); return;
      case "acp-config": state.formErrors = {}; state.modal = { type: "form", kind: "acp-config", title: "配置 ACP Runner", confirmLabel: "保存", fields: [{ label: "Runner", id: "acp-name", value: el.dataset.name || "", required: true }, { label: "启动命令", id: "acp-cmd", value: "opencode --acp", required: true }] }; render(); return;
      case "acp-detect": loadingThen(el, 600, () => toast((el.dataset.name || "Runner") + " 检测通过")); return;
      case "remote-connect": loadingThen(el, 700, () => { state.remoteConnected = true; render(); toast("已连接到主机"); }); return;
      case "remote-disconnect": state.remoteConnected = false; render(); toast("已断开远程桌面"); return;
      case "bridge-reconnect": loadingThen(el, 600, () => { state.bridgeConnected = true; render(); toast("已重新连接公司云端"); }); return;
      case "bridge-edit":
        state.formErrors = {};
        state.modal = { type: "form", kind: "bridge", title: "编辑云端协同", confirmLabel: "保存", fields: [
          { label: "显示名", id: "b-name", value: "公司云端", required: true },
          { label: "对端地址", id: "b-url", value: "https://octop.example.com", required: true },
          { label: "对端账号", id: "b-user", value: "admin", required: true },
          { label: "密码", id: "b-pass", placeholder: "留空表示不修改" },
        ] };
        render(); return;
      case "bridge-disconnect": state.modal = { type: "confirm", title: "断开连接", body: "断开后对端专家将不可用，可随时重新连接。", confirmLabel: "断开", danger: true, onConfirm: () => { state.bridgeConnected = false; state.modal = null; render(); toast("已断开连接"); } }; render(); return;
      case "bridge-peers": state.modal = { type: "bridge-peers", title: "对端专家" }; render(); return;
      case "bridge-add":
        state.modal = { type: "form", kind: "bridge", title: "添加云端协同", confirmLabel: "保存并连接", fields: [
          { label: "显示名", id: "b-name", placeholder: "例如 公司云端" },
          { label: "对端地址", id: "b-url", placeholder: "https://octop.example.com" },
          { label: "对端账号", id: "b-user", placeholder: "admin" },
          { label: "密码", id: "b-pass", placeholder: "••••••••" },
        ], hint: "请从能访问到对端的一侧发起；探测成功后再握手保存。" };
        render(); return;
      case "acp-new":
        state.modal = { type: "form", kind: "acp", title: "添加 ACP Runner", confirmLabel: "创建", fields: [
          { label: "Runner ID", id: "a-id", placeholder: "例如 my-runner" },
          { label: "启动命令", id: "a-cmd", placeholder: "例如 opencode --acp" },
          { label: "参数（每行一个）", id: "a-args", placeholder: "--model\n--read-only" },
          { label: "环境变量（KEY=VALUE）", id: "a-env", placeholder: "API_KEY=..." },
        ], hint: "仅允许字母、数字、下划线与连字符；保存后按专家开启 acp_runner。" };
        render(); return;
      case "skill-tab": state.skillTab = id; render(); return;
      case "skill-install": {
        const key = el.dataset.key;
        if (!state.extraSkills.find((x) => x.key === key)) state.extraSkills.push({ key, name: el.dataset.name, src: el.dataset.src, ver: el.dataset.ver });
        render(); toast("技能已安装"); return;
      }
      case "skill-update":
        state.skillVersion[el.dataset.key] = "2.1.0";
        render(); toast("技能已更新"); return;
      case "skill-toggle": {
        const key = el.dataset.key;
        state.skillToggle[key] = state.skillToggle[key] === false ? true : false;
        render(); toast(state.skillToggle[key] ? "技能已启用" : "技能已停用"); return;
      }
      case "skill-import": toast("选择技能包 .zip 后上传（原型未接入文件）"); return;
      case "skill-create": toast("打开技能创建向导（原型演示）"); return;
      case "model-manage": state.modal = { type: "model-manage", name: el.dataset.name }; render(); return;
      case "plugin-detail": state.modal = { type: "plugin-detail", name: el.dataset.name }; render(); return;
      case "plugin-view": state.extView = id; render(); return;
      case "plugin-install": state.extView = "market"; render(); toast("从市场选择插件，安装前会展示权限"); return;
      case "plugin-install-one": {
        const p = PLUGIN_MARKET.find((x) => x.name === el.dataset.name);
        if (p && !PLUGINS.find((x) => x.name === p.name)) PLUGINS.push({ name: p.name, desc: p.desc, version: p.version, on: true, perms: p.perms.slice() });
        render(); toast("插件已安装并启用"); return;
      }
      case "plugin-update": {
        const p = PLUGIN_MARKET.find((x) => x.name === el.dataset.name);
        const local = PLUGINS.find((x) => x.name === el.dataset.name);
        if (p && local) local.version = p.version;
        render(); toast("插件已更新到最新版本"); return;
      }
      case "plugin-remove": {
        const i = PLUGINS.findIndex((x) => x.name === el.dataset.name);
        if (i >= 0) PLUGINS.splice(i, 1);
        if (state.modal && state.modal.type === "plugin-detail") state.modal = null;
        render(); toast("插件已卸载"); return;
      }
      case "cron-filter": state.cronFilter = val; render(); return;
      case "conn-tab": state.connTab = id; render(); return;
      case "conn-cat": state.connCat = val; render(); return;
      case "conn-open": {
        const map = {
          feishu: { name: "飞书", kind: "feishu", status: "已连接", desc: "研发群 · 文档与日程", def: true },
          github: { name: "GitHub", kind: "github", status: "已连接", desc: "acme/api · 代码与 issue", def: true },
          mail: { name: "工作邮箱", kind: "mail", status: "已过期", desc: "ops@acme.com · 需要重新授权", def: false },
        };
        state.connector = map[id] || map.feishu;
        render(); return;
      }
      case "close-connector": state.connector = null; render(); return;
      case "conn-save": {
        const nameEl = $("#conn-name");
        const name = nameEl ? nameEl.value.trim() : "";
        if (!name) { if (nameEl) nameEl.style.borderColor = "var(--red)"; toast("显示名称不能为空", "error"); return; }
        if (/fail/i.test(name)) { toast("保存失败：服务端拒绝，已回滚到上次配置", "error"); return; }
        loadingThen(el, 500, () => { state.connector = null; render(); toast("连接器配置已保存"); });
        return;
      }
      case "conn-probe": toast("连接正常，发现 12 个工具"); return;
      case "conn-oauth": state.modal = { type: "oauth", provider: (state.connector && state.connector.name) || "连接器", step: 0 }; render(); return;
      case "oauth-start":
        if (!state.modal || state.modal.type !== "oauth") return;
        state.modal.step = 1; render();
        setTimeout(() => {
          if (state.modal && state.modal.type === "oauth" && state.modal.step === 1) { state.modal.step = 2; render(); }
        }, 1600);
        return;
      case "oauth-complete":
        if (state.connector) state.connector.status = "已连接";
        state.modal = null; render(); toast("授权成功，连接已恢复"); return;
      case "conn-default": toast("已更新对话默认选中（演示）"); return;
      case "conn-add":
        state.modal = { type: "form", kind: "connector", title: "添加连接", confirmLabel: "创建", fields: [
          { label: "服务", id: "n-kind", type: "select", options: ["飞书", "企业微信", "钉钉", "Notion", "邮箱", "自定义 MCP"] },
          { label: "显示名称", id: "n-name", placeholder: "例如 研发群飞书" },
          { label: "App ID / Client ID", id: "n-id", placeholder: "从开放平台复制" },
          { label: "App Secret / Token", id: "n-secret", placeholder: "从开放平台复制" },
          { label: "共享范围", id: "n-share", type: "select", options: ["仅自己", "所有人", "指定用户分组"] },
        ], hint: "保存后可点「测试连接」探测工具；OAuth 类服务会先打开授权页。" };
        render(); return;
      case "conn-delete":
        state.modal = { type: "confirm", title: "删除连接器", body: "删除后使用该实例的专家将无法调用其工具；此操作不可撤销。", confirmLabel: "删除", danger: true, onConfirm: () => { state.connector = null; state.modal = null; render(); toast("已删除（演示）"); } };
        render(); return;
      case "mcp-mode": state.mcpMode = val; render(); return;
      case "mcp-add": case "mcp-edit":
        state.modal = { type: "form", kind: "mcp", title: act === "mcp-add" ? "添加 MCP Server" : "编辑 MCP Server", confirmLabel: "保存", fields: [
          { label: "显示名称", id: "m-name", placeholder: "例如 我的知识库" },
          { label: "Server ID", id: "m-id", placeholder: "仅字母/数字/下划线/连字符" },
          { label: "Transport", id: "m-transport", type: "select", options: ["HTTP", "Stdio"] },
          { label: "URL / Command", id: "m-url", placeholder: "https://mcp.example.com/mcp" },
          { label: "Headers / Args / Env", id: "m-extra", placeholder: "每行 Key: Value 或 KEY=VALUE" },
        ], hint: "保存前可探测；需要 OAuth 的 MCP 会先引导授权。" };
        render(); return;
      case "mcp-probe": toast("MCP 探测成功，发现 8 个工具（演示）"); return;
      case "mcp-save": toast("MCP 配置已保存（演示）"); return;
      case "mcp-delete":
        state.modal = { type: "confirm", title: "删除 MCP Server", body: "已保存的服务器会立即删除；使用它的专家将不再加载这些工具。", confirmLabel: "删除", danger: true, onConfirm: () => { state.modal = null; render(); toast("已删除（演示）"); } };
        render(); return;
      case "cron-new":        state.modal = { type: "form", kind: "cron", title: "创建定时任务", confirmLabel: "创建", fields: [
          { label: "任务名称", id: "c-name", placeholder: "例如 每日科技新闻" },
          { label: "调度方式", id: "c-mode", type: "select", options: ["固定频率", "Cron 表达式", "一次性"] },
          { label: "Cron 表达式", id: "c-cron", placeholder: "0 9 * * *" },
          { label: "任务类型", id: "c-type", type: "select", options: ["智能体（AI 处理请求）", "文本（发送固定消息）"] },
          { label: "发送给智能体的指令", id: "c-prompt", placeholder: "例如：总结今天的科技新闻，10 条以内" },
          { label: "发送通道", id: "c-channel", type: "select", options: ["控制台", "飞书", "企业微信"] },
        ], hint: "未选通道时投递到 Dashboard 默认会话；任务创建后默认启用。" };
        render(); return;
      case "cron-run": toast("任务已触发，结果稍后显示（演示）"); return;
      case "cron-delete":
        state.modal = { type: "confirm", title: "删除定时任务", body: "确定要删除此定时任务吗？历史执行记录会保留。", confirmLabel: "删除", danger: true, onConfirm: () => { state.modal = null; render(); toast("已删除（演示）"); } };
        render(); return;
      case "form-save": {
        const kind = el.dataset.kind;
        const modal = state.modal;
        if (!modal) return;
        const values = {};
        (modal.fields || []).forEach((f) => { const inp = $("#" + f.id); values[f.id] = inp ? inp.value.trim() : ""; });
        modal.draft = values;
        if (Object.values(values).some((v) => /conflict/i.test(v))) {
          state.modal = { type: "conflict", title: "保存冲突", body: "这条记录已被其他人修改（409）。请刷新后重试，或用当前内容覆盖。" };
          render(); return;
        }
        if (Object.values(values).some((v) => /fail/i.test(v))) {
          modal.saveError = "保存失败：服务端暂时不可用，输入已保留，可重试。";
          render(); return;
        }
        const errors = {};
        if (kind === "user") {
          if (!/^[a-z0-9._-]{3,32}$/.test(values["u-name"] || "")) errors["u-name"] = "3–32 位小写字母、数字、点、下划线或短横线";
          if (values["u-email"] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values["u-email"])) errors["u-email"] = "邮箱格式不正确";
          if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(values["u-pass"] || "")) errors["u-pass"] = "至少 8 位，且包含字母和数字";
        } else if (kind === "profile") {
          if (!values["pf-name"] || values["pf-name"].length < 2 || values["pf-name"].length > 32) errors["pf-name"] = "显示名称需为 2–32 个字符";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values["pf-email"] || "")) errors["pf-email"] = "邮箱格式不正确";
        } else if (kind === "subagent") {
          if (!values["sa-name"]) errors["sa-name"] = "名称不能为空";
        } else if (kind === "bridge") {
          if (!values["b-name"]) errors["b-name"] = "显示名不能为空";
          try { new URL(values["b-url"]); } catch (e) { errors["b-url"] = "请输入有效的 https 地址"; }
          if (!values["b-user"]) errors["b-user"] = "对端账号不能为空";
        } else if (kind === "provider") {
          if (!/^[a-z0-9._-]{2,32}$/.test(values["p-id"] || "")) errors["p-id"] = "2–32 位小写字母、数字、点、下划线或短横线";
          if (!values["p-name"]) errors["p-name"] = "显示名称不能为空";
          try { new URL(values["p-url"]); } catch (e) { errors["p-url"] = "请输入有效的 https 地址"; }
        } else if (kind === "storage") {
          if (!values["s-name"]) errors["s-name"] = "名称不能为空";
          if (!values["s-url"]) errors["s-url"] = "Endpoint / 路径不能为空";
          if (!values["s-bucket"]) errors["s-bucket"] = "Bucket / 数据库名不能为空";
          if (!values["s-kind"].includes("本地")) { try { new URL(values["s-url"]); } catch (e) { errors["s-url"] = "请输入有效的 Endpoint 地址"; } }
        }
        if (Object.keys(errors).length) {
          state.formErrors = errors;
          render();
          toast("请检查表单中的错误", "error");
          return;
        }
        state.formErrors = {};
        loadingThen(el, 500, () => {
          if (kind === "session-rename") {
            const s = SESSIONS.find((x) => x.id === modal.sessionId);
            if (s && values["session-name"]) s.title = values["session-name"];
          } else if (kind === "user") {
            state.adminUsers.push({ u: values["u-name"], n: values["u-display"] || values["u-name"], e: values["u-email"] || "—", role: values["u-role"], auth: "密码", status: "已启用" });
          } else if (kind === "profile") {
            state.displayName = values["pf-name"];
            state.email = values["pf-email"];
            localStorage.setItem("poly.displayName", state.displayName);
            localStorage.setItem("poly.email", state.email);
          } else if (kind === "subagent") {
            if (modal.oldName) {
              const s = state.personalSubagents.find((x) => x.name === modal.oldName);
              if (s) { s.name = values["sa-name"]; s.desc = values["sa-desc"]; }
            } else state.personalSubagents.push({ name: values["sa-name"], desc: values["sa-desc"] || "自定义子智能体", status: "空闲" });
          } else if (kind === "bridge") {
            state.bridgeConnected = true;
          } else if (kind === "provider") {
            const p = state.providers.find((x) => x.id === values["p-id"]);
            if (p) { p.name = values["p-name"]; p.status = "已授权"; }
            else state.providers.push({ name: values["p-name"], id: values["p-id"], status: "已授权", models: values["p-proto"] || "自定义模型" });
          } else if (kind === "storage") {
            const s = state.storages.find((x) => x.name === values["s-name"]);
            if (s) { s.status = "已配置"; s.detail = values["s-kind"] + " · " + values["s-bucket"]; }
            else state.storages.push({ name: values["s-name"], id: values["s-kind"], status: "已配置", detail: values["s-kind"] + " · " + values["s-bucket"] });
          }
          state.modal = null;
          state.formErrors = {};
          render();
          toast(kind === "session-rename" ? "会话已重命名" : "已保存");
        });
        return;
      }
      case "rail-toggle": state.railCollapsed = !state.railCollapsed; savePrefs(); render(); return;
      case "modal-retry": if (state.modal) { state.modal.saveError = ""; render(); } return;
      case "conflict-refresh": state.modal = null; state.errorDemo = null; render(); toast("已刷新到最新版本"); return;
      case "conflict-overwrite": state.modal = null; render(); toast("已按当前内容覆盖保存"); return;
      case "login-submit": {
        const email = ($("#login-email") || {}).value || "";
        const pass = ($("#login-pass") || {}).value || "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { state.loginError = "请输入有效邮箱"; render(); return; }
        if (!pass) { state.loginError = "请输入密码"; render(); return; }
        loadingThen(el, 500, () => { state.loggedOut = false; state.loginError = ""; navigate("chat"); toast("已登录"); });
        return;
      }
      case "error-login": state.errorDemo = null; state.loggedOut = true; render(); return;
      case "list-fail": state.listError = true; state.userMenu = false; render(); return;
      case "role-set": state.role = val; state.userMenu = false; render(); toast("已切换角色：" + ROLE_LABEL[val]); return;
      case "error-demo":
        if (Number(val) === 401) { state.loggedOut = true; state.userMenu = false; render(); return; }
        state.errorDemo = Number(val); state.userMenu = false; render(); return;
      case "error-retry": state.errorDemo = null; render(); toast("已重试"); return;
      case "error-overwrite": state.errorDemo = null; render(); toast("已覆盖保存最新版本"); return;
      case "error-request": toast("访问申请已发送，等待管理员审批"); return;
      case "user-menu": state.userMenu = !state.userMenu; render(); return;
      case "close-user": state.userMenu = false; render(); return;
      case "user-help": state.userMenu = false; render(); toast("帮助与反馈（原型演示）"); return;
      case "user-project": state.userMenu = false; render(); toast("项目地址：github.com/polyopus/polyopus（演示）"); return;
      case "user-customize": state.userMenu = false; state.modal = { type: "customize", title: "自定义导航" }; render(); return;
      case "user-settings": state.userMenu = false; navigate("settings"); return;
      case "user-security": state.userMenu = false; state.modal = { type: "security", title: "账户安全" }; render(); return;
      case "user-update": state.userMenu = false; render(); toast("当前已是最新版本 v0.1.0"); return;
      case "user-logout":
        state.userMenu = false;
        state.modal = { type: "confirm", title: "退出登录", body: "退出后需要重新登录才能访问工作区与任务。", confirmLabel: "退出登录", danger: true, onConfirm: () => { state.modal = null; state.loggedOut = true; render(); } };
        render(); return;
      case "session":
        if (state.streaming) { toast("当前会话正在生成，先停止再切换", "error"); return; }
        if (state.activeSession) {
          state.threads[state.activeSession] = state.messages;
          state.sessionState[state.activeSession] = {
            draft: state.draft, dockOpen: state.dockOpen, dockTab: state.dockTab,
            scrollTop: ($("#msgs") || {}).scrollTop || 0,
          };
        }
        state.activeSession = id;
        state.messages = (state.threads[id] || SESSION_THREADS[id] || []).map((m, i) =>
          m.role === "user" && !m.id ? { ...m, id: id + "_u" + i } : m);
        {
          const meta = state.sessionState[id] || {};
          state.draft = meta.draft || "";
          state.dockOpen = meta.dockOpen === true;
          state.dockTab = meta.dockTab || "files";
          state.pendingScroll = typeof meta.scrollTop === "number" ? meta.scrollTop : null;
          state.autoScroll = state.pendingScroll == null;
        }
        state.chatWelcome = false;
        state.queue = [];
        render();
        return;
      case "new-chat":
        if (state.streaming) { toast("当前会话正在生成，先停止再新建", "error"); return; }
        if (state.activeSession) state.threads[state.activeSession] = state.messages;
        state.chatWelcome = true;
        state.messages = [];
        state.activeSession = null;
        state.queue = [];
        state.draft = "";
        state.chatError = false;
        state.dockOpen = false;
        state.dockTab = "files";
        state.pendingScroll = null;
        navigate("chat");
        return;
      case "session-menu":
        openMenu(el, "会话操作", [
          { label: "置顶 / 取消置顶", act: "session-pin", value: id, icon: "file" },
          { label: "重命名", act: "session-rename", value: id, icon: "edit" },
          { label: "创建分支", act: "session-fork", value: id, icon: "git-branch" },
          { sep: true },
          { label: "删除会话", act: "session-delete", value: id, icon: "trash" },
        ]);
        return;
      case "session-pin": toast("已更新置顶状态"); state.menu = null; render(); return;
      case "session-rename":
        state.modal = { type: "form", kind: "session-rename", title: "重命名会话", confirmLabel: "保存", sessionId: id, fields: [
          { label: "会话名称", id: "session-name", value: (SESSIONS.find((s) => s.id === id) || {}).title || "" },
        ] };
        render(); return;
      case "session-fork": toast("已创建分支会话（演示）"); state.menu = null; render(); return;
      case "session-delete":
        state.modal = { type: "confirm", title: "删除会话", body: "删除后该会话的消息与运行轨迹将不可恢复。", confirmLabel: "删除", danger: true, sessionId: id, onConfirm: () => {
          const idx = SESSIONS.findIndex((s) => s.id === id);
          if (idx >= 0) SESSIONS.splice(idx, 1);
          state.activeSession = SESSIONS[0] ? SESSIONS[0].id : null;
          state.modal = null; render(); toast("已删除会话");
        } };
        render(); return;
      case "prompt":
        state.draft = val; state.chatWelcome = false; doSend(); return;
      case "load-earlier": {
        if (state.activeSession !== "s1") { toast("没有更早的消息了"); return; }
        const box = $("#msgs");
        const keep = box ? box.scrollHeight : 0;
        state.messages = [
          { role: "user", text: "错误日志里有没有 502？", time: "09:48" },
          { role: "assistant", time: "09:49", text: "有 3 次 502，集中在 10:00–10:02，和 issue 描述一致。" },
          ...state.messages,
        ];
        state.olderLoaded = true;
        state.pendingScroll = keep;
        render();
        return;
      }
      case "scroll-bottom": {
        const box = $("#msgs");
        if (box) box.scrollTop = box.scrollHeight;
        state.autoScroll = true;
        $("#scroll-bottom")?.classList.remove("show");
        return;
      }
      case "chat-plus": openMenu(el, "添加", [
        { label: "模型", hint: state.model, act: "menu-model", icon: "spark" },
        { label: "技能", hint: state.selectedSkills.length + " 个", act: "menu-skills", icon: "puzzle" },
        { label: "知识库", hint: state.kbCount + " 个", act: "menu-kb", icon: "book" },
        { label: "连接器", hint: state.selectedConnectors.length + " 个", act: "menu-connectors", icon: "plug" },
        { label: "子智能体", hint: "2 个", act: "menu-subagents", icon: "bot" },
      ]); return;
      case "theme": state.theme = state.theme === "dark" ? "light" : "dark"; savePrefs(); render(); return;
      case "theme-set": state.theme = val; savePrefs(); render(); return;
      case "layout-set": state.layout = val; savePrefs(); render(); toast("已切换为" + (val === "classic" ? "经典模式" : "极简模式")); return;
      case "lang-set":
        state.lang = val; render();
        toast(val === "zh" ? "界面语言：中文" : "English 正在接入（原型仅展示中文）");
        return;
      case "backup-run": loadingThen(el, 600, () => { state.lastBackup = new Date().toLocaleString("zh-CN") + " · 1.8 GB · 成功"; render(); toast("备份已完成"); }); return;
      case "backup-download": {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify({ createdAt: state.lastBackup, note: "prototype backup" })], { type: "application/json" }));
        a.download = "polyopus-backup.json"; a.click(); URL.revokeObjectURL(a.href); toast("备份文件已开始下载"); return;
      }
      case "backup-restore": state.modal = { type: "confirm", title: "恢复备份", body: "恢复会覆盖当前实例配置，进行中的任务会中断。", confirmLabel: "恢复", danger: true, onConfirm: () => { state.modal = null; render(); toast("已从备份恢复"); } }; render(); return;
      case "https-check": {
        const cert = ($("#https-cert") || {}).value || "";
        const key = ($("#https-key") || {}).value || "";
        if (!/BEGIN CERTIFICATE/.test(cert) || !/BEGIN (RSA )?PRIVATE KEY/.test(key)) { toast("证书或私钥格式不正确", "error"); return; }
        loadingThen(el, 500, () => toast("证书链与私钥匹配")); return;
      }
      case "https-save": {
        const domain = ($("#https-domain") || {}).value || "";
        if (!domain.trim()) { toast("域名不能为空", "error"); return; }
        loadingThen(el, 600, () => toast("HTTPS 配置已保存，服务将重启")); return;
      }
      case "update-check": loadingThen(el, 500, () => toast("当前已是最新版本 v0.1.0")); return;
      case "service-restart": state.modal = { type: "confirm", title: "重启服务", body: "进行中的任务会中断，确定重启？", confirmLabel: "重启", danger: true, onConfirm: () => { state.modal = null; render(); toast("服务已重启"); } }; render(); return;
      case "webauthn-fill": {
        const rp = $("#webauthn-rp"), origin = $("#webauthn-origin");
        if (rp) rp.value = location.hostname || "localhost";
        if (origin) origin.value = location.origin;
        toast("已填入当前站点"); return;
      }
      case "webauthn-save": {
        const origin = ($("#webauthn-origin") || {}).value || "";
        if (!/^https?:\/\//.test(origin)) { toast("Origin 需以 http(s):// 开头", "error"); return; }
        loadingThen(el, 450, () => toast("通行密钥配置已保存")); return;
      }
      case "env-add": state.envRows = state.envRows.concat([["NEW_KEY", ""]]); state.envError = ""; render(); return;
      case "env-remove": state.envRows.splice(Number(el.dataset.idx), 1); state.envError = ""; render(); return;
      case "env-save": {
        const before = state.envRows.map((r) => r.slice());
        const rows = state.envRows.map((_, i) => [($("#env-key-" + i) || {}).value || "", ($("#env-val-" + i) || {}).value || ""]);
        const keys = rows.map((r) => r[0].trim());
        if (rows.some((r) => !r[0].trim() || !r[1].trim())) { state.envError = "变量名和值都不能为空"; render(); return; }
        if (rows.some((r) => !/^[A-Z][A-Z0-9_]*$/.test(r[0].trim()))) { state.envError = "变量名只能使用大写字母、数字和下划线"; render(); return; }
        if (new Set(keys).size !== keys.length) { state.envError = "变量名不能重复"; render(); return; }
        if (rows.some((r) => /fail/i.test(r[1]))) {
          state.envRows = before; state.envError = "保存失败：服务端拒绝，已回滚到上次配置"; render(); return;
        }
        loadingThen(el, 450, () => { state.envRows = rows; state.envError = ""; render(); toast("环境变量已保存"); });
        return;
      }
      case "keymap-save": {
        const next = { ...state.keymap };
        let ok = true;
        document.querySelectorAll("[data-keymap]").forEach((inp) => {
          const k = inp.dataset.keymap;
          const v = inp.value.trim();
          if (!v) { ok = false; inp.style.borderColor = "var(--red)"; return; }
          next[k] = v;
        });
        if (!ok) { toast("快捷键不能为空", "error"); return; }
        state.keymap = next; savePrefs(); render(); toast("快捷键已保存并生效"); return;
      }
      case "keymap-reset": state.keymap = { ...KEYMAP_DEFAULT }; savePrefs(); render(); toast("已恢复默认快捷键"); return;
      case "profile-avatar": {
        const colors = ["blue", "violet", "teal", "amber", "rose"];
        state.avatarColor = colors[(colors.indexOf(state.avatarColor) + 1) % colors.length];
        render(); toast("头像颜色已更新"); return;
      }
      case "profile-edit":
        state.formErrors = {};
        state.modal = { type: "form", kind: "profile", title: "修改资料", confirmLabel: "保存", fields: [
          { label: "显示名称", id: "pf-name", value: state.displayName, required: true },
          { label: "邮箱", id: "pf-email", value: state.email, required: true },
        ] };
        render(); return;
      case "profile-save": {
        const inp = $("#display-name");
        const v = inp ? inp.value.trim() : "";
        if (v.length < 2 || v.length > 32) {
          if (inp) inp.style.borderColor = "var(--red)";
          toast("显示名称需为 2–32 个字符", "error");
          return;
        }
        loadingThen(el, 350, () => {
          state.displayName = v;
          localStorage.setItem("poly.displayName", v);
          render();
          toast("显示名称已保存");
        });
        return;
      }
      case "sso-toggle": toast("单点登录绑定状态已更新（演示）"); return;
      case "palette": state.palette = val; savePrefs(); render(); return;
      case "density": state.density = val; savePrefs(); render(); return;
      case "cmd": state.cmd = true; state.cmdQ = ""; render(); return;
      case "cmd-close": state.cmd = false; render(); return;
      case "cmd-run":
        state.cmd = false;
        if (el.dataset.kind === "theme") { state.theme = state.theme === "dark" ? "light" : "dark"; savePrefs(); render(); }
        else navigate(el.dataset.route);
        return;
      case "chat-retry": state.chatError = false; render(); toast("已重新加载会话"); return;
      case "offline-retry": state.offline = false; render(); toast("网络已恢复"); return;
      case "send": doSend(); return;
      case "stop": stopStream(); return;
      case "queue-remove": state.queue.splice(Number(el.dataset.idx), 1); render(); toast("已撤回队列消息"); return;
      case "approve": approve(id, "once"); return;
      case "approve-session": approve(id, "session"); return;
      case "deny": deny(id); return;
      case "approval-detail": toast("完整参数：npm test -- auth（工作目录 /t_412）"); return;
      case "files-toggle": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (m && m.files) { m.files.open = !m.files.open; render(); }
        return;
      }
      case "ask-option": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (!m || !m.ask) return;
        const q = m.ask.questions[Number(el.dataset.q)];
        const st = m.ask.state;
        const ans = st.answers[Number(el.dataset.q)];
        const v = el.dataset.value;
        if (q.multi_select) ans.picked = ans.picked.includes(v) ? ans.picked.filter((x) => x !== v) : ans.picked.concat(v);
        else ans.picked = [v];
        render();
        return;
      }
      case "ask-next": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (!m || !m.ask) return;
        const st = m.ask.state;
        const ans = st.answers[st.current] || { picked: [], other: "" };
        if (!ans.picked.length && !(ans.other || "").trim()) { toast("先选一个选项或填写补充", "error"); return; }
        if (st.current >= m.ask.questions.length - 1) st.reviewing = true;
        else st.current += 1;
        render();
        return;
      }
      case "ask-back": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (m && m.ask) { m.ask.state.reviewing = false; render(); }
        return;
      }
      case "ask-submit": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (m && m.ask) { m.ask.status = "answered"; render(); toast("答案已提交，专家继续"); }
        return;
      }
      case "ask-skip": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (m && m.ask) { m.ask.status = "skipped"; render(); toast("已跳过本次提问"); }
        return;
      }
      case "plan-execute": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (m && m.plan) { m.plan.status = "running"; render(); toast("开始执行计划"); }
        return;
      }
      case "plan-edit": {
        const m = state.messages.find((x) => x.id === el.dataset.mid);
        if (m && m.plan) { m.plan.status = "editing"; render(); toast("已回到计划编辑（演示）"); }
        return;
      }
      case "toggle-tool": el.classList.toggle("open"); return;
      case "copy": navigator.clipboard && navigator.clipboard.writeText("已复制的消息内容（原型演示）"); toast("已复制"); return;
      case "regenerate": toast("正在重新生成…"); stopStream(); setTimeout(startStream, 200); return;
      case "edit": {
        const m = state.messages.find((x) => x.id === id);
        if (m) { state.editingMessage = id; state.editDraft = m.text; render(); }
        return;
      }
      case "edit-cancel": state.editingMessage = null; state.editDraft = ""; render(); return;
      case "edit-save": {
        const idx = state.messages.findIndex((x) => x.id === id);
        if (idx < 0) return;
        const text = state.editDraft.trim();
        if (!text) { toast("内容不能为空", "error"); return; }
        state.messages = state.messages.slice(0, idx);
        state.editingMessage = null;
        state.editDraft = "";
        state.draft = text;
        state.autoScroll = true;
        doSend();
        return;
      }
      case "fork": toast("已创建分支会话"); return;
      case "menu-mode": openMenu(el, "会话模式", [
        { label: "Ask · 只读", act: "set-mode", value: "ask", icon: "chat", active: state.mode === "Ask" },
        { label: "Plan · 先计划", act: "set-mode", value: "plan", icon: "file", active: state.mode === "Plan" },
        { label: "Act · 可执行", act: "set-mode", value: "act", icon: "spark", active: state.mode === "Act" },
      ]); return;
      case "menu-model": openMenu(el, "选择模型", [
        { label: "deepseek-v4", hint: "默认", act: "set-model", value: "deepseek-v4", active: state.model === "deepseek-v4" },
        { label: "claude-sonnet", hint: "代码", act: "set-model", value: "claude-sonnet", active: state.model === "claude-sonnet" },
        { label: "gpt-5", hint: "通用", act: "set-model", value: "gpt-5", active: state.model === "gpt-5" },
      ]); return;
      case "menu-kb": openMenu(el, "知识库", [
        { label: "运维手册", act: "set-kb", value: "ops", active: state.kbCount === 2 },
        { label: "API 文档", act: "set-kb", value: "api", active: state.kbCount === 1 },
        { label: "不启用知识库", act: "set-kb", value: "none", active: state.kbCount === 0 },
      ]); return;
      case "menu-skills": openMenu(el, "技能", [
        { label: "天气查询", hint: "内置", act: "set-skill", value: "weather", active: state.selectedSkills.includes("weather") },
        { label: "GitHub 趋势", hint: "工作区", act: "set-skill", value: "github", active: state.selectedSkills.includes("github") },
        { label: "二维码生成", hint: "内置", act: "set-skill", value: "qrcode", active: state.selectedSkills.includes("qrcode") },
      ]); return;
      case "menu-connectors": openMenu(el, "连接器", [
        { label: "飞书", hint: "已连接", act: "set-connector", value: "feishu", active: state.selectedConnectors.includes("feishu") },
        { label: "GitHub", hint: "已连接", act: "set-connector", value: "github", active: state.selectedConnectors.includes("github") },
        { label: "工作邮箱", hint: "已过期", act: "set-connector", value: "mail", active: state.selectedConnectors.includes("mail") },
      ]); return;
      case "menu-subagents": openMenu(el, "子智能体", [
        { label: "调研员", hint: "检索与事实核对", act: "set-subagent", value: "researcher", active: state.selectedSubagents.includes("researcher") },
        { label: "写手", hint: "初稿与改写", act: "set-subagent", value: "writer", active: state.selectedSubagents.includes("writer") },
      ]); return;
      case "set-subagent":
        state.selectedSubagents = state.selectedSubagents.includes(val) ? state.selectedSubagents.filter((x) => x !== val) : state.selectedSubagents.concat(val);
        state.menu = null; render(); toast("已更新本轮子智能体"); return;
      case "remove-skill": state.selectedSkills = state.selectedSkills.filter((x) => x !== val); render(); return;
      case "remove-subagent": state.selectedSubagents = state.selectedSubagents.filter((x) => x !== val); render(); return;
      case "set-skill":
        state.selectedSkills = state.selectedSkills.includes(val) ? state.selectedSkills.filter((x) => x !== val) : state.selectedSkills.concat(val);
        state.menu = null; render(); toast("已更新本轮技能"); return;
      case "set-connector":
        state.selectedConnectors = state.selectedConnectors.includes(val) ? state.selectedConnectors.filter((x) => x !== val) : state.selectedConnectors.concat(val);
        state.menu = null; render(); toast("已更新本轮连接器"); return;
      case "context-info": state.modal = { type: "context", title: "上下文用量" }; render(); return;
      case "context-compress": state.contextPct = 32; state.modal = null; render(); toast("上下文已压缩到 32%"); return;
      case "menu-tools": openMenu(el, "工具", [
        { label: "文件系统", hint: "5", act: "menu-noop" },
        { label: "Shell（需审批）", hint: "1", act: "menu-noop" },
        { label: "知识检索", hint: "1", act: "menu-noop" },
        { sep: true },
        { label: "管理工具…", act: "nav", value: "agents" },
      ]); return;
      case "mention-open": state.mentionQ = ""; state.modal = { type: "mention" }; render(); return;
      case "mention-insert":
        state.draft = (state.draft ? state.draft + " " : "") + "@" + val;
        state.modal = null; render();
        { const ta = $("#composer"); if (ta) ta.focus(); }
        return;
      case "menu-mention": openMenu(el, "提及", [
        { label: "src/auth.ts", hint: "文件", act: "insert", value: "@src/auth.ts", icon: "file" },
        { label: "acme/api", hint: "仓库", act: "insert", value: "@acme/api", icon: "folder" },
        { label: "业务专家", hint: "专家", act: "insert", value: "@业务专家", icon: "bot" },
      ]); return;
      case "slash-open": state.slashQ = ""; state.modal = { type: "slash" }; render(); return;
      case "slash-run": {
        const cmd = String(val);
        state.modal = null;
        if (cmd === "/new") {
          if (state.activeSession) state.threads[state.activeSession] = state.messages;
          state.chatWelcome = true; state.messages = []; state.activeSession = null; state.draft = ""; state.queue = [];
        } else if (cmd === "/clear") {
          state.messages = []; state.chatWelcome = true;
          toast("已清空当前会话");
        } else if (cmd === "/compact") {
          toast("上下文已压缩，保留最近 8 轮");
        } else if (cmd === "/plan") {
          state.mode = "Plan"; toast("已切换到 Plan 模式");
        } else if (cmd === "/ask") {
          state.mode = "Ask"; toast("已切换到 Ask 模式");
        } else if (cmd === "/stop") {
          if (state.streaming) stopStream();
        } else if (cmd === "/export") {
          const blob = new Blob([JSON.stringify(state.messages, null, 2)], { type: "application/json" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "conversation.json"; a.click();
          URL.revokeObjectURL(a.href); toast("会话已导出");
        } else {
          state.draft = (state.draft ? state.draft + " " : "") + cmd + " ";
        }
        render();
        return;
      }
      case "menu-slash": openMenu(el, "命令", [
        { label: "/compact", hint: "压缩上下文", act: "insert", value: "/compact" },
        { label: "/new", hint: "新建会话", act: "new-chat" },
        { label: "/model", hint: "切换模型", act: "insert", value: "/model" },
        { label: "/help", hint: "帮助", act: "insert", value: "/help" },
      ]); return;
      case "set-mode":
        state.mode = val === "ask" ? "Ask" : val === "plan" ? "Plan" : "Act";
        state.menu = null; render(); toast("已切换为 " + state.mode); return;
      case "set-model": state.model = val; state.menu = null; render(); toast("已切换模型：" + val); return;
      case "set-kb": state.kbCount = val === "ops" ? 2 : val === "api" ? 1 : 0; state.menu = null; render();
        toast(state.kbCount ? "知识库已启用 · " + state.kbCount + " 个" : "已关闭知识库"); return;
      case "insert":
        state.draft = (state.draft ? state.draft + " " : "") + val;
        state.menu = null; render();
        { const ta = $("#composer"); if (ta) ta.focus(); }
        return;
      case "close-menu": state.menu = null; render(); return;
      case "attach": { const input = $("#attach-input"); if (input) input.click(); return; }
      case "attach-remove": state.attachments.splice(Number(el.dataset.idx), 1); render(); return;
      case "menu-hitl": openMenu(el, "工具审批策略", [
        { label: "每次执行前询问", hint: "推荐", act: "set-hitl", value: "ask", active: state.hitl === "ask" },
        { label: "本会话全部允许", hint: "高风险", act: "set-hitl", value: "all", active: state.hitl === "all" },
        { sep: true },
        { label: "管理需审批工具", act: "nav", value: "admin-security", route: "admin-security" },
      ]); return;
      case "set-hitl": state.hitl = val; state.menu = null; render(); toast(val === "all" ? "本会话将不再询问工具审批" : "已恢复每次询问"); return;
      case "voice": toast("语音输入需要麦克风权限（原型未接入）"); return;
      case "chat-share":
        if (navigator.clipboard) navigator.clipboard.writeText(location.href).catch(() => {});
        toast("会话链接已复制"); return;
      case "agent-profile": state.agent = "ag_1"; state.agentTab = "basic"; state.drawer = "agent"; render(); return;
      case "queue-steer":
        { const item = state.queue.splice(Number(el.dataset.idx), 1)[0]; if (item) state.messages.push({ role: "system", text: "已插话： " + esc(item) }); render(); toast("已插入本轮，模型会在下一步看到"); }
        return;
      case "dock-tab": state.dockTab = id; state.dockOpen = true; render(); return;
      case "dock-close": state.dockOpen = false; render(); return;
      case "dock-open": state.dockOpen = true; render(); return;
      case "dock-open-workspace": state.dockOpen = true; state.dockTab = "workspace"; render(); return;
      case "dock-open-traj": state.dockOpen = true; state.dockTab = "traj"; render(); return;
      case "dock-open-browser": state.dockOpen = true; state.dockTab = "browser"; render(); return;
      case "dock-file": toast("打开文件预览（原型演示）"); return;

      case "bucket": state.bucket = id; render(); return;
      case "filter-source": state.sourceFilter = state.sourceFilter === val ? "all" : val; render(); return;
      case "clear-filter": state.bucket = "all"; state.sourceFilter = "all"; state.q = ""; render(); return;
      case "task-select": state.selectedTask = id; navigate("tasks/" + id); return;
      case "task-stop":
        state.modal = { type: "confirm", title: "停止任务", body: "停止后该任务线不会再自动接单，授权（Mandate）会失效。已产生的产物会保留。", confirmLabel: "停止任务", danger: true, onConfirm: () => {
          const t = taskById(id); if (t) { t.bucket = "done"; t.state = "ended"; t.summary = "已由人停止"; t.attention = null; }
          state.modal = null; render(); toast("已停止，该线程不再自动接单");
        } };
        render(); return;
      case "task-assign":
        { const cur = (taskById(id) || {}).executor;
          openMenu(el, "选择执行器", [
            { label: "内置", hint: "通用", act: "assign-exec", value: "内置", active: cur === "内置" },
            { label: "Claude Code", hint: "编码", act: "assign-exec", value: "Claude Code", active: cur === "Claude Code" },
            { label: "Codex", hint: "编码", act: "assign-exec", value: "Codex", active: cur === "Codex" },
          ]); }
        return;
      case "assign-exec":
        { const t = taskById(state.selectedTask); if (t) { t.executor = val; t.summary = "已重新派工给 " + val; } state.menu = null; render(); toast("已派给 " + val); }
        return;
      case "task-budget":
        state.modal = { type: "budget", title: "追加预算", task: taskById(id) || taskById(state.selectedTask) || state.tasks[0] };
        render(); return;
      case "budget-save":
        { const input = $("#budget-input"); const add = Number(input && input.value) || 1; const t = taskById(state.selectedTask) || state.tasks[0];
          t.budget = Number((t.budget + add).toFixed(2)); t.bucket = "running"; t.attention = null; state.modal = null; render(); toast("预算已追加 " + money(add)); }
        return;
      case "budget-add": { const found = attentionById(id); if (found) { found.task.budget += 1; found.task.bucket = "running"; found.att.resolved = true; } render(); toast("已追加 ¥1.00"); return; }
      case "task-export": toast("已导出报告（JSONL）"); return;
      case "task-new": state.modal = { type: "new-task", title: "新建任务" }; render(); return;
      case "new-task-save":
        { const title = ($("#new-task-title") || {}).value || "未命名任务";
          state.tasks.unshift({ id: "tk_" + uid(), title: title, bucket: "queued", state: "open", source: "github", sourceLabel: "GitHub", ref: "手动创建", actor: "you", actorColor: "blue", executor: "内置", strength: "explicit", policy: 7, progress: 0, cost: 0, budget: 1, createdAt: "刚刚", summary: "等待执行器", timeline: [["刚刚", "Ticket", "manual · opened", ""]], reports: [], artifacts: [] });
          state.modal = null; render(); toast("任务已创建"); }
        return;
      case "filter-open": toast("筛选面板（原型演示）"); return;

      case "attention-select": state.selectedAttention = id; navigate("inbox"); return;
      case "att-filter": state.attFilter = val; state.selectedAttention = null; render(); return;
      case "answer-open": state.selectedAttention = id; state.modal = { type: "answer", title: "回答问题" }; render(); return;
      case "answer-submit": state.modal = { type: "answer", title: "回答问题" }; render(); return;
      case "answer-save":
        { const v = ($("#answer-input") || {}).value || "（空）"; toast("已提交回答，Agent 继续"); state.modal = null; resolveAttention(state.selectedAttention); return; }
      case "to-chat": navigate("chat"); toast("已转为对话"); return;
      case "snooze": openMenu(el, "稍后提醒", [
        { label: "10 分钟", act: "snooze-set", value: "10m" },
        { label: "1 小时", act: "snooze-set", value: "1h" },
        { label: "明天", act: "snooze-set", value: "1d" },
      ]); return;
      case "snooze-set": state.menu = null; render(); toast("已设为稍后：" + val); return;
      case "inbox-read-all": state.tasks.forEach((t) => { if (t.attention) t.attention.resolved = true; }); render(); toast("已全部标记处理"); return;

      case "kb-select": state.kb = id; state.kbTab = "docs"; state.kbTest = null; state.kbSelected = []; state.kbSearch = ""; render(); return;
      case "kb-tab": state.kbTab = id; render(); return;
      case "kb-view": state.kbView = val; render(); return;
      case "kb-folder": state.kbFolder = val; render(); toast("当前目录：" + (val === "root" ? "根目录" : val)); return;
      case "doc-check": el.classList.toggle("on"); return;
      case "kb-toggle-doc": {
        const name = el.dataset.name;
        state.kbSelected = state.kbSelected.includes(name) ? state.kbSelected.filter((x) => x !== name) : state.kbSelected.concat(name);
        render(); return;
      }
      case "kb-select-all": {
        const kb = KBS.find((k) => k.id === state.kb) || KBS[0];
        const q = (state.kbSearch || "").toLowerCase();
        const names = (DOCS[kb.id] || []).filter((d) => !q || d[0].toLowerCase().includes(q)).map((d) => d[0]);
        state.kbSelected = state.kbSelected.length === names.length ? [] : names;
        render(); return;
      }
      case "kb-search-clear": state.kbSearch = ""; render(); return;
      case "kb-refresh": render(); toast("文档列表已刷新"); return;
      case "kb-bulk-delete": {
        const kb = KBS.find((k) => k.id === state.kb) || KBS[0];
        const n = state.kbSelected.length;
        state.modal = { type: "confirm", title: "删除 " + n + " 个文档", body: "切片与向量会一并移除，且不可恢复。", confirmLabel: "删除", danger: true, onConfirm: () => { DOCS[kb.id] = (DOCS[kb.id] || []).filter((d) => !state.kbSelected.includes(d[0])); state.kbSelected = []; state.modal = null; render(); toast("已删除 " + n + " 个文档"); } };
        render(); return;
      }
      case "kb-bulk-reindex": {
        const kb = KBS.find((k) => k.id === state.kb) || KBS[0];
        (DOCS[kb.id] || []).forEach((d) => { if (state.kbSelected.includes(d[0])) d[2] = "ready"; });
        state.kbSelected = []; render(); toast("已加入重建队列"); return;
      }
      case "kb-newfile":
        state.modal = { type: "form", kind: "kb-file", title: "新建文件", confirmLabel: "创建", fields: [
          { label: "文件名", id: "kf-name", placeholder: "例如 notes.md" },
          { label: "格式", id: "kf-type", type: "select", options: ["Markdown", "TXT"] },
          { label: "内容", id: "kf-content", placeholder: "在此编写文档内容…" },
        ], hint: "创建后会进入解析与索引队列。" };
        render(); return;
      case "kb-newfolder":
        state.modal = { type: "form", kind: "kb-folder", title: "新建文件夹", confirmLabel: "创建", fields: [
          { label: "文件夹名称", id: "kf-folder", placeholder: "例如 发布流程" },
        ], hint: "文件夹用于组织文档，不参与检索。" };
        render(); return;
      case "kb-vector-check": loadingThen(el, 450, () => toast("向量模型可用，维度 1024")); return;
      case "kb-vector": toast("已选择向量模型：" + el.value); return;
      case "kb-retrieval-config": openMenu(el, "检索模式", [
        { label: "混合检索（向量 + 关键词）", act: "kb-retrieval", value: "hybrid", active: true },
        { label: "仅向量", act: "kb-retrieval", value: "vector" },
        { label: "仅关键词", act: "kb-retrieval", value: "keyword" },
      ]); return;
      case "kb-share-config": openMenu(el, "共享范围", [
        { label: "仅自己", act: "kb-share", value: "self", active: true },
        { label: "所有人可读", act: "kb-share", value: "all" },
        { label: "指定分组", act: "kb-share", value: "groups" },
      ]); return;
      case "kb-retrieval": state.kbRetrieval = val; state.menu = null; render(); toast("检索模式已更新"); return;
      case "kb-share": state.kbShare = val; state.menu = null; render(); toast("共享范围已更新"); return;
      case "kb-settings-save": loadingThen(el, 500, () => toast("知识库设置已保存")); return;
      case "kb-upload": if (!requirePerm("knowledge:write")) return; state.modal = { type: "upload", title: "上传文档" }; render(); return;
      case "upload-save":
        { const k = state.kb; (DOCS[k] || (DOCS[k] = [])).unshift(["new-doc.pdf", "PDF", "processing", 0, "刚刚"]); state.modal = null; render(); toast("已上传，进入解析队列"); }
        return;
      case "kb-test-run":
        { const q = ($("#retrieval-q") || {}).value || ""; if (!q) { toast("先输入问题", "error"); return; }
          state.kbTest = [
            { src: "deploy.md · 第 3 节", score: "0.92", text: "发布审批由 SRE 负责人 @alice 与业务 owner 共同确认；紧急发布需值班经理批准。" },
            { src: "incident-runbook.pdf · 第 2 页", score: "0.81", text: "发布窗口：周三 14:00–17:00；回滚需在 30 分钟内完成。" },
          ];
          render(); }
        return;
      case "kb-test-open": state.kbTab = "retrieval"; render(); return;
      case "doc-preview": state.modal = { type: "doc-preview", title: "预览 · " + (el.dataset.name || "文档"), name: el.dataset.name || "文档" }; render(); return;
      case "doc-reindex": {
        const kb = KBS.find((k) => k.id === state.kb) || KBS[0];
        const d = (DOCS[kb.id] || []).find((x) => x[0] === el.dataset.name);
        if (d) d[2] = "processing";
        render(); toast("已加入重建索引队列"); return;
      }
      case "doc-delete": {
        const name = el.dataset.name;
        const kb = KBS.find((k) => k.id === state.kb) || KBS[0];
        state.modal = { type: "confirm", title: "删除文档", body: "确定删除 " + name + "？切片与向量会一并移除。", confirmLabel: "删除", danger: true, onConfirm: () => { DOCS[kb.id] = (DOCS[kb.id] || []).filter((d) => d[0] !== name); state.kbSelected = state.kbSelected.filter((x) => x !== name); state.modal = null; render(); toast("已删除"); } };
        render(); return;
      }

      case "agent-open": state.agent = id; state.agentTab = "basic"; state.drawer = "agent"; render(); return;
      case "agent-color": state.agentColor = val; render(); return;
      case "agent-avatar": {
        const a = AGENTS.find((x) => x.id === state.agent);
        const colors = ["blue", "violet", "teal", "amber", "rose"];
        if (a) a.color = colors[(colors.indexOf(a.color) + 1) % colors.length];
        render(); toast("专家头像已更新"); return;
      }
      case "agent-avatar-remove": {
        const a = AGENTS.find((x) => x.id === state.agent);
        if (a) a.color = "blue";
        render(); toast("已移除自定义头像"); return;
      }
      case "subagent-new": state.formErrors = {}; state.modal = { type: "form", kind: "subagent", title: "新建子智能体", confirmLabel: "创建", fields: [{ label: "名称", id: "sa-name", required: true }, { label: "职责", id: "sa-desc", placeholder: "负责检索与事实核对" }] }; render(); return;
      case "subagent-edit": {
        const s = state.personalSubagents.find((x) => x.name === el.dataset.name);
        state.formErrors = {};
        state.modal = { type: "form", kind: "subagent", title: "编辑子智能体", confirmLabel: "保存", oldName: s ? s.name : "", fields: [{ label: "名称", id: "sa-name", value: s ? s.name : "", required: true }, { label: "职责", id: "sa-desc", value: s ? s.desc : "" }] };
        render(); return;
      }
      case "subagent-skills": state.modal = { type: "subagent-skills", name: el.dataset.name }; render(); return;
      case "mbti-set": state.mbti = val; render(); toast("人格已切换为 " + val); return;
      case "mbti-retest": state.mbti = "ENFP 竞选者"; render(); toast("重新测试完成：ENFP 竞选者"); return;
      case "memory-view": state.modal = { type: "memory" }; render(); return;
      case "memory-clear": state.modal = { type: "confirm", title: "清理记忆", body: "将删除低置信度与过期记忆，不可恢复。", confirmLabel: "清理", danger: true, onConfirm: () => { state.modal = null; render(); toast("低置信度记忆已清理"); } }; render(); return;
      case "agent-tab": state.agentTab = id; render(); return;
      case "close-drawer": state.drawer = null; render(); return;
      case "agent-save": loadingThen(el, 550, () => { state.drawer = null; render(); toast("已保存，发布后新会话生效"); }); return;
      case "agent-publish": loadingThen(el, 550, () => { state.drawer = null; render(); toast("已发布 v4，新会话生效"); }); return;
      case "agent-test": toast("已启动试运行会话（演示）"); return;
      case "doc-download": toast("开始下载原文件（演示）"); return;
      case "doc-locate":
        if (state.modal && state.modal.name) state.kbSearch = state.modal.name;
        state.modal = null; render(); toast("已定位到文档"); return;
      case "agent-export": {
        const blob = new Blob([JSON.stringify({ name: "业务专家", version: "v3", files: ["SOUL.md", "IDENTITY.md", "AGENTS.md"], exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "business-expert.poly.json";
        a.click();
        URL.revokeObjectURL(a.href);
        toast("已导出 .poly.json");
        return;
      }
      case "agent-rollback": state.modal = { type: "confirm", title: "回滚到 v2", body: "回滚只影响新会话；进行中的会话继续使用当前版本。", confirmLabel: "回滚", danger: true, onConfirm: () => { state.modal = null; render(); toast("已回滚到 v2"); } }; render(); return;
      case "agent-new": state.modal = { type: "agent-new", title: "新建专家" }; render(); return;
      case "agent-create": { const name = ($("#agent-name") || {}).value || "新专家"; AGENTS.unshift({ id: "ag_" + uid(), name: name, desc: "自定义专家", model: "deepseek-v4", color: "blue", status: "空闲", sessions: 0 }); state.modal = null; render(); toast("已创建 " + name); return; }
      case "agent-template": toast("模板库（原型演示）"); return;

      case "conn-test": toast("连接测试通过（演示）"); return;
      case "conn-config": toast("打开连接配置（演示）"); return;
      case "plugin-toggle": {
        const p = PLUGINS.find((x) => x.name === el.dataset.name);
        if (p) p.on = !p.on;
        render(); toast(p && p.on ? "插件已启用" : "插件已禁用"); return;
      }

      case "usage-tab": state.usageView = id; render(); return;
      case "usage-range": state.usageRange = id; render(); toast("时间范围已切换"); return;
      case "usage-export": {
        const csv = "date,tokens,cost,calls\n2026-11-06,128000,18.2,86\n2026-11-05,112000,16.4,74\n";
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = "token-usage.csv"; a.click(); URL.revokeObjectURL(a.href);
        toast("用量 CSV 已导出"); return;
      }
      case "settings-tab": state.settingsTab = id; render(); return;
      case "toggle-switch": {
        const key = el.dataset.key;
        if (key && state.notifications[key] != null) {
          state.notifications[key] = !state.notifications[key];
          render(); toast(state.notifications[key] ? "已开启" : "已关闭"); return;
        }
        el.classList.toggle("on"); toast(el.classList.contains("on") ? "已开启" : "已关闭"); return;
      }
      case "account-password": toast("修改密码（演示）"); return;
      case "account-keys": toast("API Key 管理（演示）"); return;
      case "account-logout": toast("已退出（演示）"); return;

      case "modal-close": case "modal-mask": closeModal(); return;
      case "modal-done": state.modal = null; render(); toast("已保存"); return;
      case "customize-reset": toast("已恢复默认导航"); return;
      case "security-action": toast("安全设置（原型演示）：需再次输入密码"); return;
      case "modal-noop": case "cmd-noop": return;
      case "modal-confirm": {
        const fn = state.modal && state.modal.onConfirm;
        loadingThen(el, 320, () => { state.modal = null; if (fn) fn(); });
        return;
      }
      case "menu-noop": state.menu = null; render(); return;
      default: return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (matchCombo(e, state.keymap.palette)) { e.preventDefault(); state.cmd = true; state.cmdQ = ""; render(); return; }
    if (matchCombo(e, state.keymap.newChat)) {
      e.preventDefault();
      if (state.streaming) { toast("当前会话正在生成，先停止", "error"); return; }
      if (state.activeSession) state.threads[state.activeSession] = state.messages;
      state.chatWelcome = true; state.messages = []; state.activeSession = null;
      state.queue = []; state.draft = ""; state.dockOpen = false; state.chatError = false;
      navigate("chat"); return;
    }
    if (matchCombo(e, state.keymap.inbox)) { e.preventDefault(); navigate("inbox"); return; }
    if (matchCombo(e, state.keymap.stop)) { e.preventDefault(); if (state.streaming) stopStream(); return; }
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.matches && e.target.matches("[data-act]:not(button)")) {
      e.preventDefault(); e.target.click(); return;
    }
    if (e.key === "Enter" && e.target && e.target.id === "kb-search") { e.preventDefault(); render(); return; }
    if (e.key === "?" && !["input", "textarea", "select"].includes(tag)) {
      e.preventDefault(); state.modal = { type: "shortcuts", title: "键盘快捷键" }; render(); return;
    }
    if (e.key === "Escape") {
      if (state.cmd) { state.cmd = false; render(); }
      else if (state.modal) { closeModal(); }
      else if (state.menu) { state.menu = null; render(); }
      else if (state.drawer) { state.drawer = null; render(); }
      return;
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (state.modal && (state.modal.type === "form" || state.modal.type === "invite") && t.closest(".modal")) state.modal.dirty = true;
    if (t.dataset.input === "task-search") {
      state.q = t.value;
      const list = $("#task-list");
      if (list) list.innerHTML = taskListHTML();
    }
    if (t.dataset.input === "session-search") {
      state.sessionQ = t.value;
      const list = $("#session-list");
      if (list) list.innerHTML = chatSessionListHTML();
    }
    if (t.dataset.input === "edit-message") {
      state.editDraft = t.value;
    }
    if (t.dataset.input === "kb-search") {
      const pos = t.selectionStart;
      state.kbSearch = t.value;
      render();
      const again = $("#kb-search");
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
    if (t.dataset.tableSearch) {
      const id = t.dataset.tableSearch;
      const pos = t.selectionStart;
      const ts = tableState(id);
      ts.q = t.value; ts.page = 1;
      render();
      const again = $('[data-table-search="' + id + '"]');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
    if (t.dataset.input === "ask-other") {
      const m = state.messages.find((x) => x.id === t.dataset.mid);
      if (m && m.ask && m.ask.state) {
        const ans = m.ask.state.answers[Number(t.dataset.q)];
        if (ans) ans.other = t.value;
        const btn = $("[data-act='ask-next']");
        if (btn && ans) btn.disabled = !(t.value.trim() || ans.picked.length);
      }
    }
    if (t.id === "custom-color") {
      state.customColor = t.value;
      state.palette = "custom";
      document.documentElement.dataset.palette = "custom";
      document.documentElement.style.setProperty("--primary", t.value);
      return;
    }
  });

  /* ---------------- boot ---------------- */
  const bootParams = new URLSearchParams(location.search);
  if (bootParams.get("theme")) state.theme = bootParams.get("theme");
  if (bootParams.get("palette")) state.palette = bootParams.get("palette");
  if (bootParams.get("menu") === "user") state.userMenu = true;
  if (bootParams.get("agent")) { state.agent = bootParams.get("agent"); state.agentTab = "basic"; state.drawer = "agent"; }
  if (bootParams.get("connector")) state.connector = { name: "飞书", kind: "feishu", status: "已连接", desc: "研发群 · 文档与日程", def: true };
  if (bootParams.get("kb")) state.kb = bootParams.get("kb");
  if (bootParams.get("kbtab")) state.kbTab = bootParams.get("kbtab");
  if (bootParams.get("conntab")) state.connTab = bootParams.get("conntab");
  if (bootParams.get("kbview")) state.kbView = bootParams.get("kbview");
  if (bootParams.get("welcome")) { state.chatWelcome = true; state.activeSession = null; }
  if (bootParams.get("session")) {
    state.activeSession = bootParams.get("session");
    state.messages = SESSION_THREADS[state.activeSession] || [];
  }
  if (bootParams.get("dock") === "1") state.dockOpen = true;
  if (bootParams.get("ext")) state.extView = bootParams.get("ext");
  if (bootParams.get("skilltab")) state.skillTab = bootParams.get("skilltab");
  if (bootParams.get("edit") === "1") {
    state.editingMessage = "m1";
    state.editDraft = "帮我修一下 issue #412 的登录超时，先只读定位，别直接改。";
  }
  const demoState = bootParams.get("state");
  if (bootParams.get("role")) state.role = bootParams.get("role");
  if (bootParams.get("error")) {
    const code = Number(bootParams.get("error"));
    if (code === 401) state.loggedOut = true;
    else state.errorDemo = code;
  }
  if (demoState === "error") state.chatError = true;
  if (demoState === "nomodel") state.modelMissing = true;
  if (demoState === "offline") state.offline = true;
  if (demoState === "noconn") state.connectorsEmpty = true;
  if (demoState === "adminempty") state.adminEmpty = true;
  if (demoState === "listfail") state.listError = true;
  applyTheme();
  state.route = parseRoute();
  render();
})();
