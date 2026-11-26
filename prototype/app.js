/* PolyOpus interactive prototype */
(function () {
  "use strict";

  /* 原型自检：任何未捕获错误都会写到 <html data-js-error>，便于评审时排查 */
  window.addEventListener("error", (e) => {
    document.documentElement.setAttribute("data-js-error", String((e && e.message) || "error"));
  });

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
    {
      id: "tk_406", title: "修复登录超时的回归用例", bucket: "attention", state: "open",
      source: "github", sourceLabel: "GitHub", ref: "#406 · acme/api",
      actor: "alice", actorColor: "violet", executor: "Claude Code", strength: "explicit",
      policy: 7, progress: 0.5, cost: 0.31, budget: 1.5, createdAt: "1 小时前",
      summary: "TEST_FAILED · 2 个用例未通过", outcome: "failed",
      attention: {
        id: "at_4", kind: "failed",
        question: "执行失败：TEST_FAILED（2 个用例未通过）",
        detail: "已完成：定位 auth.ts:88 并新增回归用例；未提交、未推送。可重试或放弃。",
      },
      timeline: [
        ["09:12", "Trigger", "issue_comment #406 · @alice「补一个回归用例」", "info"],
        ["09:13", "Ticket", "opened", ""],
        ["09:20", "Assign", "claude_code → session cc_44", ""],
        ["09:31", "Report", "failed · TEST_FAILED（2 个用例未通过）", "warn"],
      ],
      reports: [["09:31", "failed", "2 个用例未通过；日志与 patch 已保留。"]],
      artifacts: [["file", "test.log", "22 KB"]],
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
    { id: "ag_1", name: "业务专家", desc: "SOP、流程、风险评估", model: "deepseek-v4", color: "teal", status: "运行中", sessions: 24, published: true, version: "v3" },
    { id: "ag_2", name: "代码助手", desc: "读代码、改代码、跑测试", model: "claude-sonnet", color: "violet", status: "运行中", sessions: 18, published: true, version: "v3" },
    { id: "ag_3", name: "知识库问答", desc: "基于内部文档回答", model: "deepseek-v4", color: "blue", status: "空闲", sessions: 41, published: true, version: "v2" },
    { id: "ag_4", name: "发布管家", desc: "发布检查、周报、通知", model: "deepseek-v4", color: "amber", status: "已停止", sessions: 6, published: true, version: "v1" },
  ];

  const KBS = [
    { id: "kb_ops", name: "运维手册", docs: 24, chunks: 1820, status: "ready", desc: "发布流程、事故复盘与 oncall 规范", owner: "admin" },
    { id: "kb_api", name: "API 文档", docs: 12, chunks: 940, status: "ready", desc: "对外接口、错误码与示例", owner: "admin" },
    { id: "kb_hr", name: "人事制度", docs: 8, chunks: 310, status: "indexing", desc: "考勤、假期与报销制度", owner: "carol" },
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

  /* ---------------- 可变业务数据（原型内真实增删改） ---------------- */
  const CONNECTOR_LIST = [
    { id: "feishu", name: "飞书", kind: "feishu", status: "已连接", desc: "研发群 · 文档与日程", tools: 12, def: true },
    { id: "github", name: "GitHub", kind: "github", status: "已连接", desc: "acme/api · 代码与 issue", tools: 12, def: true },
    { id: "mail", name: "工作邮箱", kind: "mail", status: "已过期", desc: "ops@acme.com · 需要重新授权", tools: 6, def: false },
  ];
  const CHANNEL_LIST = [
    { id: "dashboard", name: "控制台", status: "已连接", prefix: "—", msgs: "—", on: true, required: true, icon: "monitor", tone: "blue", desc: "内置控制台通道，Web 端直接对话，无需额外配置。" },
    { id: "feishu", name: "飞书", status: "已连接", prefix: "@poly", msgs: "1,284", on: true, icon: "send", tone: "blue", desc: "配置飞书机器人通道，支持私聊与群聊，消息双向同步到专家。" },
    { id: "wecom", name: "企业微信", status: "已连接", prefix: "@poly", msgs: "326", on: true, icon: "chat", tone: "green", desc: "配置企业微信机器人通道，支持应用消息、单聊与群聊场景。" },
    { id: "qq", name: "QQ", status: "未连接", prefix: "@poly", msgs: "—", on: false, icon: "chat", tone: "violet", desc: "配置 QQ 机器人通道，支持私聊与群聊消息，接入后可在 QQ 中直接对话。" },
    { id: "dingtalk", name: "钉钉", status: "未连接", prefix: "@poly", msgs: "—", on: false, icon: "send", tone: "amber", desc: "配置钉钉机器人通道，支持单聊与群聊，适合团队办公场景。" },
    { id: "discord", name: "Discord", status: "已连接", prefix: "@poly", msgs: "48", on: true, icon: "globe", tone: "indigo", desc: "配置 Discord 机器人通道，支持服务器频道消息与 Bot API 接入。" },
    { id: "telegram", name: "Telegram", status: "未连接", prefix: "@poly", msgs: "—", on: false, icon: "send", tone: "teal", desc: "配置 Telegram Bot 通道，支持私聊与群聊消息，经 Bot API 接入。" },
    { id: "wechat", name: "微信", status: "未连接", prefix: "@poly", msgs: "—", on: false, icon: "chat", tone: "green", desc: "配置个人微信通道，用户可通过微信私聊与你的助手实时互动。" },
  ];
  const SKILL_PACKAGES = [
    { id: "p1", name: "测试", desc: "暂无描述", owner: "admin", shared: true, skills: ["weather"] },
    { id: "p2", name: "运维工具包", desc: "发布、巡检与排障常用技能", owner: "admin", shared: false, skills: ["github-trending", "qrcode"] },
  ];
  const SKILL_MARKET = [
    ["多引擎搜索", "16 个搜索引擎（7 国内 + 9 国际）并行检索", "11,309,401"],
    ["编程专家 Skill", "P8 级编程助手，覆盖 Java/PHP/小程序/APP", "1,456,028"],
    ["腾讯文档 DOCs", "在线文档平台，创建、编辑、管理文档的首选", "2,701,198"],
    ["育儿专家", "覆盖衣食住行、发育里程碑、情绪安抚", "587,994"],
    ["技能开发", "在 core 与 system 域构建技能开发能力", "295,160"],
    ["技能包结构设计", "设计并打包高质量技能的完整方法论", "265,179"],
    ["培训工坊", "自动生成培训材料的技能", "5,014,911"],
    ["全网搜索", "通过自然语言检索公开网页并总结", "1,047,836"],
    ["视频转短视频", "把长视频拆解成适配各平台的短视频", "1,885,120"],
    ["反诈专家", "识别电诈与钓鱼，给出处置建议", "1,726,572"],
    ["ima-skills", "支持文档、知识库的读取与检索", "1,726,081"],
    ["WPS Office 全家桶", "WPS/Office 全套能力，含文档、表格、演示", "1,181,418"],
    ["金融爬虫", "金融机构数据抓取与分析", "1,053,496"],
    ["律师助手", "从接案到结案的全流程提效", "746,842"],
    ["专利检索", "全球专利检索与统计分析", "279,125"],
    ["kdocs skill", "金山文档（WPS 云文档）官方技能", "611,254"],
  ];
  const CRON_LIST = [
    { id: "cr_1", name: "每日科技新闻", cron: "0 9 * * *", desc: "每天 09:00", type: "智能体", last: "今天 09:00 · 成功", next: "明天 09:00", on: true, prompt: "总结今天的科技新闻，10 条以内", channel: "控制台" },
    { id: "cr_2", name: "周一发布周报", cron: "0 10 * * 1", desc: "每周一 10:00", type: "智能体", last: "周一 10:00 · 成功", next: "下周一 10:00", on: true, prompt: "生成本周发布周报", channel: "飞书" },
    { id: "cr_3", name: "收件箱摘要", cron: "0 18 * * *", desc: "每天 18:00", type: "文本", last: "昨天 18:00 · 已暂停", next: "—", on: false, prompt: "整理今天的待决事项", channel: "控制台" },
  ];
  const ACP_LIST = [
    { id: "opencode", name: "OpenCode", cmd: "opencode --acp", status: "已安装", on: true },
    { id: "codebuddy", name: "CodeBuddy", cmd: "codebuddy --acp", status: "已安装", on: true },
    { id: "claude", name: "Claude Code", cmd: "claude --acp", status: "未安装", on: false },
    { id: "codex", name: "Codex", cmd: "codex acp", status: "未安装", on: false },
    { id: "cursor", name: "Cursor CLI", cmd: "agent acp", status: "未安装", on: false },
    { id: "kimi", name: "Kimi Code", cmd: "kimi acp", status: "未安装", on: false },
  ];
  const KB_FOLDERS = {
    kb_ops: ["发布流程", "事故复盘", "接口文档"],
    kb_api: ["导出接口"],
    kb_hr: [],
  };
  const DOC_FOLDER = {
    "deploy.md": "发布流程",
    "incident-runbook.pdf": "事故复盘",
    "legacy-notes.docx": "事故复盘",
    "oncall.md": "接口文档",
    "openapi.yaml": "导出接口",
    "auth.md": "导出接口",
  };
  const TASK_KIND_LABEL = { approval: ["审批", "red"], question: ["提问", "blue"], blocked: ["受阻", "amber"], failed: ["失败", "red"] };
  const OUTCOME_LABEL = { completed: ["已完成", "green"], failed: ["失败", "red"], cancelled: ["已取消", ""], stopped: ["已停止", ""] };

  const KEYMAP_DEFAULT = { palette: "⌘K", newChat: "⌘N", inbox: "⌘⇧A", stop: "⌘." };
  const ROLE_PERMS = {
    admin: ["*"],
    member: ["chat", "tasks", "inbox", "attention", "automation", "agents", "knowledge", "personalization", "channels", "connections", "skills", "bridge", "workbench", "remote", "acp", "usage", "extensions", "settings"],
    auditor: ["chat", "tasks", "inbox", "knowledge", "usage", "settings", "audit"],
  };
  const ROLE_LABEL = { admin: "管理员", member: "成员", auditor: "只读审计" };
  const ACTION_PERM = {
    /* 对话 */
    "new-chat": "chat:write", send: "chat:write", "edit-save": "chat:write", attach: "chat:write",
    "queue-steer": "chat:write", "chat-share": "chat:write", "plan-execute": "chat:write", "ask-submit": "chat:write",
    /* 任务与待决 */
    "task-new": "tasks:write", "task-stop": "tasks:write", "task-assign": "tasks:write", "assign-exec": "tasks:write",
    "task-budget": "tasks:write", "budget-save": "tasks:write", "budget-add": "tasks:write", "task-retry": "tasks:write",
    "ticket-stop": "tasks:write", "ticket-budget": "tasks:write", "ticket-retry": "tasks:write",
    "approve": "attention:write", "approve-session": "attention:write", "deny": "attention:write",
    "ticket-approve": "attention:write", "ticket-deny": "attention:write",
    "answer-open": "attention:write", "answer-submit": "attention:write", "answer-save": "attention:write",
    "snooze": "attention:write", "inbox-read-all": "attention:write", "inbox-bulk": "attention:write",
    /* 自动化 */
    "cron-new": "automation:write", "cron-edit": "automation:write", "cron-delete": "automation:write",
    "cron-run": "automation:write", "cron-toggle": "automation:write",
    /* 专家 */
    "agent-new": "agents:write", "agent-save": "agents:write", "agent-publish": "agents:write",
    "agent-create": "agents:write", "agent-rollback": "agents:write", "agent-delete": "agents:write",
    "agent-duplicate": "agents:write", "agent-file-edit": "agents:write", "agent-file-save": "agents:write",
    "agent-newfile": "agents:write", "agent-import": "agents:write", "agent-export-zip": "agents:write",
    /* 连接 */
    "conn-add": "connections:write", "conn-save": "connections:write", "conn-delete": "connections:write",
    "conn-default": "connections:write", "conn-oauth": "connections:write", "conn-toggle": "connections:write",
    "mcp-add": "connections:write", "mcp-edit": "connections:write", "mcp-save": "connections:write", "mcp-delete": "connections:write",
    "channel-new": "connections:write", "channel-config": "connections:write", "channel-check": "connections:write", "channel-toggle": "connections:write",
    "acp-new": "connections:write", "acp-config": "connections:write", "acp-detect": "connections:write", "acp-toggle": "connections:write",
    "bridge-add": "connections:write", "bridge-disconnect": "connections:write", "bridge-edit": "connections:write",
    "remote-connect": "connections:write", "remote-disconnect": "connections:write",
    /* 知识 */
    "kb-new": "knowledge:write", "kb-rename": "knowledge:write", "kb-delete": "knowledge:write",
    "kb-upload": "knowledge:write", "kb-newfile": "knowledge:write", "kb-newfolder": "knowledge:write",
    "doc-delete": "knowledge:write", "doc-reindex": "knowledge:write", "doc-retry": "knowledge:write",
    "kb-bulk-delete": "knowledge:write", "kb-bulk-reindex": "knowledge:write", "kb-settings-save": "knowledge:write",
    /* 扩展 */
    "skill-install": "extensions:write", "skill-update": "extensions:write", "skill-toggle": "extensions:write",
    "skill-import": "extensions:write", "skill-create": "extensions:write",
    "plugin-install": "extensions:write", "plugin-install-one": "extensions:write", "plugin-update": "extensions:write",
    "plugin-remove": "extensions:write", "plugin-toggle": "extensions:write",
    /* 管理端 */
    "security-save": "admin", "security-save-rules": "admin", "security-reset-rules": "admin",
    "env-save": "admin", "env-add": "admin", "env-remove": "admin",
    "user-invite": "admin", "user-new": "admin", "user-delete": "admin", "user-reset": "admin", "user-toggle": "admin",
    "role-save": "admin", "role-edit": "admin", "group-delete": "admin", "group-edit": "admin",
    "provider-add": "admin", "provider-config": "admin", "provider-test": "admin",
    "storage-add": "admin", "storage-config": "admin", "storage-probe": "admin",
    "backup-run": "admin", "backup-download": "admin", "backup-restore": "admin",
    "https-save": "admin", "https-check": "admin", "service-restart": "admin", "update-check": "admin",
    "webauthn-save": "admin", "webauthn-fill": "admin", "list-fail": "admin",
    /* 个人设置 */
    "profile-save": "settings:write", "profile-edit": "settings:write", "keymap-save": "settings:write",
    "account-password": "settings:write", "account-keys": "settings:write",
  };
  const READ_ONLY_ACTS = new Set(["secure-demo"]);

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
    security: { hitl: true, tools: ["shell.exec", "fs.write", "git.push", "http.post"], filesystem: true, pii: true, cmdScan: true, stableOnly: true, webauthnLogin: false },
    persToggles: {},
    mcpServers: [{ id: "my-knowledge", name: "my-knowledge", transport: "HTTP", url: "https://mcp.example.com/mcp", tools: 8, on: true, def: true }],
    groups: [
      { id: "design-team", name: "设计团队", members: 6, on: true },
      { id: "ops-team", name: "运维值班", members: 4, on: true },
      { id: "contractors", name: "外部顾问", members: 2, on: false },
    ],
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
    auditEvents: [],
    taskTimers: {},
    connectors: CONNECTOR_LIST.map((c) => ({ ...c })),
    channels: CHANNEL_LIST.map((c) => ({ ...c })),
    cronJobs: CRON_LIST.map((j) => ({ ...j })),
    cronHistory: {},
    acpRunners: ACP_LIST.map((r) => ({ ...r })),
    kbs: KBS,
    kbFolders: JSON.parse(JSON.stringify(KB_FOLDERS)),
    inboxSelected: [],
    taskSort: "updated",
    filterOpen: false,
    detailOpen: false,
    agentDraft: null,
    agentFilter: "all",
    drawerDirty: false,
    kbDirty: false,
    kbCfg: {},
    selectedTask: "tk_412",
    selectedAttention: "at_1",
    bucket: "attention",
    sourceFilter: "all",
    executorFilter: "all",
    attFilter: "all",
    q: "",
    messages: [
      { role: "system", text: "已从 GitHub #412 创建任务 · 授权 explicit · 策略 v7 · 10:02" },
      { role: "user", id: "m1", text: "帮我修一下 issue #412 的登录超时，先看下相关代码，别直接改。", time: "10:02" },
      {
        role: "assistant", id: "m2", time: "10:03",
        steps: [["读取 3 个文件", "0.8s"], ["检索知识库", "2 条引用"]],
        thinking: "先确认 401 是不是 token 过期；如果是，重试前必须清空 refreshToken，否则会带着过期凭证死循环。\n定位到 auth.ts:88 的重试分支没有清理动作，先只读结论，不改代码。\n引用 ops-handbook · 发布流程与 issue #412，避免重复排查。",
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
    kbView: "card",
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
    const parts = state.route.split("/");
    if ((parts[0] === "tasks" || parts[0] === "ticket") && taskById(parts[1])) state.selectedTask = parts[1];
    render();
  });

  function loadingThen(el, ms, fn) {
    if (!el || el.disabled || el.classList.contains("loading")) return;
    el.classList.add("loading");
    el.disabled = true;
    setTimeout(() => {
      el.classList.remove("loading");
      el.disabled = false;
      fn();
    }, ms);
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

  /* ---------------- 闭环辅助 ---------------- */
  function pushEvent(t, kind, text, tone) {
    if (!t) return;
    if (!Array.isArray(t.timeline)) t.timeline = [];
    t.timeline.push([now(), kind, text, tone || ""]);
    t.updatedAt = Date.now();
    state.auditEvents.unshift({ at: now(), taskId: t.id, title: t.title, kind: kind, text: text });
    if (state.auditEvents.length > 200) state.auditEvents.length = 200;
  }
  function outcomeOf(t) {
    if (!t) return "completed";
    if (t.outcome) return t.outcome;
    if (t.bucket === "done") return /停止/.test(t.summary || "") ? "stopped" : "completed";
    return "completed";
  }
  function setBucket(t, bucket) {
    if (!t) return;
    t.bucket = bucket;
    t.updatedAt = Date.now();
  }
  function syncKbCounts() {
    KBS.forEach((k) => {
      const list = DOCS[k.id] || [];
      k.docs = list.length;
      k.chunks = list.reduce((n, d) => n + (Number(d[3]) || 0), 0);
    });
  }
  const kbById = (id) => KBS.find((k) => k.id === id) || KBS[0];
  const docOf = (name) => (DOCS[state.kb] || []).find((d) => d[0] === name);
  function folderOf(name) { return DOC_FOLDER[name] || ""; }
  function auditTabHTML(t) {
    const rows = state.auditEvents.filter((e) => !t || e.taskId === t.id).slice(0, 30);
    return '<div class="panel"><div class="panel-h"><b>决策与审计</b><span class="sub">' + (t ? "仅显示本工单" : "最近 30 条") + " · 谁在何时批准 / 停止 / 追加</span></div>" +
      (rows.length ? rows.map((e) => '<div class="tl info"><div class="row"><span class="time">' + esc(e.at) + '</span><span class="kind">' + esc(e.kind) +
        '</span><span class="txt">' + esc(e.text) + '</span></div></div>').join("")
        : '<div class="hint">还没有决策记录。批准、拒绝、停止、追加预算都会写在这里。</div>') + "</div>";
  }
  function openForm(kind, title, fields, opts) {
    state.formErrors = {};
    state.modal = Object.assign({ type: "form", kind: kind, title: title, confirmLabel: "保存", fields: fields }, opts || {});
    render();
  }
  /* 对话内任务卡：创建一条真实任务并挂到消息上（先"建议"，用户确认后才建单） */
  function spawnChatTicket(m, opts) {
    const id = "tk_" + uid();
    const t = {
      id: id, title: "修改 auth.ts 的重试次数", bucket: "queued", state: "suggested", suggested: true,
      source: "github", sourceLabel: "GitHub", ref: "#412 · acme/api",
      actor: "alice", actorColor: "violet", executor: "内置", strength: "explicit",
      policy: 7, progress: 0, cost: 0, budget: 0.5, createdAt: "刚刚", summary: "调用 write_file(auth.ts) · 需要授权后才能执行",
      updatedAt: Date.now(),
      timeline: [["刚刚", "Trigger", "对话内显式请求「把重试次数改成 3 并跑测试」", "info"],
        ["刚刚", "Eval", "accept · explicit · scope fs:workspace · confidence 0.9", "ok"]],
      reports: [], artifacts: [],
    };
    state.tasks.unshift(t);
    m.ticket = { taskId: id };
    if (!opts || !opts.silent) {
      render();
      toast("已生成任务卡，确认后才会执行");
    }
    return t;
  }

  function taskRunTick(t) {
    if (!t || state.taskTimers[t.id]) return;
    t.bucket = "running"; t.state = "open"; t.outcome = null; t.suggested = false;
    t.progress = Math.min(t.progress || 0, 0.2);
    state.taskTimers[t.id] = setInterval(() => {
      t.progress = Math.min(1, Number(((t.progress || 0) + 0.2).toFixed(2)));
      if (t.progress >= 1) {
        clearInterval(state.taskTimers[t.id]);
        delete state.taskTimers[t.id];
        t.bucket = "done"; t.state = "ended"; t.outcome = "completed";
        t.summary = "已改 1 个文件；测试通过";
        t.cost = Number(((t.cost || 0) + 0.18).toFixed(2));
        t.artifacts = [["file", "patch-auth.diff", "6.2 KB"], ["globe", "PR #419（已创建）", "已合并"]];
        pushEvent(t, "Report", "progress 100% · 3 个用例通过", "ok");
        pushEvent(t, "Ticket", "ended · completed", "ok");
        render(); toast("任务完成：" + t.title);
      } else render();
    }, 900);
    render();
  }

  function startTask(t) {
    if (!t) return;
    if (t.attention && !t.attention.resolved) { toast("先处理待决项再开始执行", "error"); return; }
    t.suggested = false;
    t.attention = { id: "at_" + uid(), kind: "approval", question: "是否允许执行「" + t.title + "」？", detail: "影响：工作区文件（写操作）；授权范围 fs:workspace · tool:shell.exec。" };
    t.bucket = "attention"; t.summary = "等待工具授权";
    pushEvent(t, "Ticket", "opened · 等待工具授权", "");
    render(); toast("已建单，等待你授权");
  }

  function cancelTask(t, reason) {
    if (!t) return;
    if (state.taskTimers[t.id]) { clearInterval(state.taskTimers[t.id]); delete state.taskTimers[t.id]; }
    t.bucket = "done"; t.state = "ended"; t.outcome = "cancelled";
    t.summary = reason || "已取消，未执行工具";
    if (t.attention) { t.attention.resolved = true; }
    pushEvent(t, "Ticket", "ended · cancelled（" + (reason || "用户取消") + "）", "");
  }

  /* ---------------- render: shell ---------------- */
  const RAIL_GROUPS = [
    { label: "", items: [
      ["chat", "chat", "对话"],
      ["tasks", "inbox", "任务"],
      ["inbox", "alert", "收件箱"],
      ["agents", "bot", "专家"],
      ["automation", "clock", "自动化"],
      ["usage", "chart", "Token 统计"],
    ] },
    { label: "设置", items: [
      ["personalization", "spark", "个性化"],
      ["channels", "send", "通道"],
      ["connections", "plug", "连接器"],
      ["skills", "package", "技能包"],
      ["knowledge", "book", "知识库"],
      ["bridge", "cloud", "云端协同"],
    ] },
    { label: "控制", items: [
      ["workbench", "monitor", "工作台"],
      ["remote", "terminal", "远程桌面"],
      ["acp", "cpu", "智能体协作"],
    ] },
    { label: "管理", items: [
      ["admin-users", "users", "用户管理"],
      ["admin-models", "key", "模型配置"],
      ["admin-storage", "database", "存储管理"],
      ["admin-plugins", "puzzle", "插件管理"],
      ["admin-security", "shield", "安全防护"],
      ["admin-advanced", "sliders", "应用设置"],
    ] },
  ];

  function renderRail() {
    const n = attentions().length;
    const ACTIVE = {
      chat: /^chat/, tasks: /^(tasks|ticket)/, inbox: /^inbox/, agents: /^agents/, automation: /^automation/, usage: /^usage/,
      personalization: /^personalization/, channels: /^channels/, connections: /^connections/, skills: /^(skills|extensions)/,
      knowledge: /^knowledge/, bridge: /^bridge/, workbench: /^workbench/, remote: /^remote/, acp: /^acp/,
      "admin-users": /^admin-users/, "admin-models": /^admin-models/, "admin-storage": /^admin-storage/,
      "admin-plugins": /^admin-plugins/, "admin-security": /^admin-security/, "admin-advanced": /^admin-advanced/,
    };
    const isActive = (r) => (ACTIVE[r] || new RegExp("^" + r)).test(state.route);
    const item = ([r, i, label]) =>
      '<button class="rail-item ' + (isActive(r) ? "active" : "") + '" data-act="nav" data-route="' + r + '" title="' + label + '">' +
      icon(i) + '<span class="label">' + label + "</span>" +
      (r === "inbox" && n ? '<span class="badge">' + n + "</span>" : "") + "</button>";
    const groups = RAIL_GROUPS.map((g) => {
      const items = g.items.filter(([r]) => can(r));
      if (!items.length) return "";
      return (g.label ? '<div class="rail-group">' + g.label + "</div>" : "") + items.map(item).join("");
    }).join("");
    return '<aside class="rail ' + (state.railCollapsed ? "collapsed" : "") + '">' +
      '<div class="rail-brand"><button class="logo" data-act="rail-toggle" title="' + (state.railCollapsed ? "展开导航" : "收起导航") + '">P</button>' +
      '<div class="brand-text"><b>PolyOpus</b><span>v0.1 · 原型</span></div>' +
      '<button class="icon-btn rail-collapse" data-act="rail-toggle" title="' + (state.railCollapsed ? "展开导航" : "收起导航") + '">' + icon("chev", "ic-sm") + "</button></div>" +
      '<nav class="rail-nav">' + groups + "</nav>" +
      '<div class="rail-foot"><button class="rail-user" data-act="user-menu" title="账户与设置">' +
      '<span class="avatar blue">A</span><span class="meta"><span class="name">' + esc(state.displayName) + '</span><span class="role">' + ROLE_LABEL[state.role] + ' · 个人账户</span></span>' +
      '<span class="chev">' + icon("chev", "ic-xs") + "</span></button></div></aside>";
  }

  function chatSessionListHTML() {
    const q = (state.sessionQ || "").trim().toLowerCase();
    const list = SESSIONS.filter((s) => !q || (s.title + " " + s.preview).toLowerCase().includes(q))
      .slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
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
    const scope = state.chatScope || "expert";
    const expert = AGENTS[0];
    return '<aside class="side"><div class="side-head" style="padding-bottom:6px">' +
      '<div class="search" style="flex:1">' + icon("search", "ic-sm") +
      '<input placeholder="搜索专家或会话" data-input="session-search" value="' + esc(state.sessionQ) + '" /></div></div>' +
      '<div class="side-tabs">' + [["expert", "专家"], ["team", "团队"], ["cloud", "云端"]].map(([id, label]) =>
        '<button class="side-tab ' + (scope === id ? "active" : "") + '" data-act="chat-scope" data-value="' + id + '">' + label + "</button>").join("") + "</div>" +
      '<div style="padding:2px 10px 8px"><button class="btn block" data-act="agent-new">' + icon("plus", "ic-sm") + "创建专家</button></div>" +
      '<div class="side-body" id="session-list">' +
      '<div class="expert-mini" data-act="agent-profile">' +
      '<span class="avatar ' + expert.color + '">' + esc(expert.name[0]) + "</span>" +
      '<div class="expert-mini-main"><b>' + esc(expert.name) + "</b><div class=\"hint\">" + esc(expert.desc) + "</div></div>" +
      '<span class="spacer"></span><span class="dot green"></span></div>' +
      chatSessionListHTML() + "</div>" +
      '<div class="side-foot" style="display:block"><button class="btn block" data-act="new-chat">' + icon("plus", "ic-sm") + "新建对话</button></div></aside>";
  }

  function renderTasksSide() {
    const srcs = [["github", "GitHub", "GH"], ["feishu", "飞书", "FS"], ["email", "邮件", "EM"]];
    const execs = ["内置", "Claude Code", "Codex"];
    const cnt = (v) => state.tasks.filter((t) => (v === "all" ? true : t.source === v)).length;
    return '<aside class="side"><div class="side-head"><div><div class="side-title">筛选</div>' +
      '<div class="side-sub">' + state.tasks.length + " 个任务 · 待决 " + attentions().length + "</div></div></div>" +
      '<div style="padding:0 12px 10px"><div class="search">' + icon("search", "ic-sm") +
      '<input placeholder="搜索任务、发起人或 PR" data-input="task-search" value="' + esc(state.q) + '" /></div></div>' +
      '<div class="side-body"><div class="group-label">来源</div>' +
      '<div class="side-nav ' + (state.sourceFilter === "all" ? "active" : "") + '" data-act="filter-source" data-value="all">' + icon("grid", "ic-sm") +
      '<span>全部来源</span><span class="count">' + state.tasks.length + "</span></div>" +
      srcs.map(([v, label, tag]) =>
        '<div class="side-nav ' + (state.sourceFilter === v ? "active" : "") + '" data-act="filter-source" data-value="' + v + '">' +
        '<span class="tag outline">' + tag + "</span><span>" + label + "</span>" +
        '<span class="count">' + cnt(v) + "</span></div>").join("") +
      '<div class="group-label">执行器</div>' +
      '<div class="side-nav ' + (!state.executorFilter || state.executorFilter === "all" ? "active" : "") + '" data-act="filter-executor" data-value="all">' +
      '<span class="dot blue"></span><span>全部执行器</span><span class="count">' + state.tasks.length + "</span></div>" +
      execs.map((e) =>
        '<div class="side-nav ' + (state.executorFilter === e ? "active" : "") + '" data-act="filter-executor" data-value="' + e + '">' +
        '<span class="dot ' + (e === "内置" ? "blue" : "") + '"></span><span>' + e + "</span>" +
        '<span class="count">' + state.tasks.filter((t) => t.executor === e).length + "</span></div>").join("") +
      '<div class="group-label">快捷</div>' +
      '<div class="side-nav" data-act="nav" data-route="inbox">' + icon("inbox", "ic-sm") + '<span>待我决定</span><span class="count">' + attentions().length + "</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="automation">' + icon("clock", "ic-sm") + "<span>自动化</span></div>" +
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
      ["failed", "失败", "refresh"],
    ];
    return '<aside class="side"><div class="side-head"><div><div class="side-title">待决分类</div>' +
      '<div class="side-sub">' + list.length + " 件待你决定</div></div></div>" +
      '<div class="side-body">' +
      items.map(([k, label, ic]) =>
        '<div class="side-nav ' + (state.attFilter === k ? "active" : "") + '" data-act="att-filter" data-value="' + k + '">' +
        icon(ic, "ic-sm") + "<span>" + label + "</span><span class=\"count\">" + count(k) + "</span></div>").join("") +
      '<div class="divider"></div>' +
      '<div class="side-nav" data-act="nav" data-route="tasks">' + icon("inbox", "ic-sm") + "<span>返回任务中心</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="automation">' + icon("clock", "ic-sm") + "<span>自动化</span></div>" +
      "</div>" +
      '<div class="side-foot">' + icon("info", "ic-sm") + "<span>审批 / 提问 / 受阻 / 失败会进入这里</span></div></aside>";
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

  function renderKnowledgeSide2() {
    const kb = kbById(state.kb);
    return '<aside class="side"><div class="side-head"><div><div class="side-title">知识库</div>' +
      '<div class="side-sub">' + KBS.length + ' 个库 · ' + KBS.reduce((n, k) => n + (DOCS[k.id] || []).length, 0) + " 篇文档</div></div>" +
      '<button class="icon-btn" data-act="kb-new" title="新建知识库">' + icon("plus") + "</button></div>" +
      '<div class="side-body">' +
      KBS.map((k) => '<div class="list-item ' + (state.kb === k.id ? "active" : "") + '" data-act="kb-select" data-id="' + k.id + '">' +
        '<div class="li-main"><div class="list-title">' + esc(k.name) + '</div><div class="list-sub">' + (DOCS[k.id] || []).length + " 篇 · " + k.chunks + " 切片</div></div>" +
        '<span class="dot ' + (k.status === "ready" ? "green" : "amber") + '"></span></div>').join("") +
      '<div class="divider"></div>' +
      '<div class="side-nav" data-act="kb-upload">' + icon("upload", "ic-sm") + "<span>上传文档</span></div>" +
      '<div class="side-nav" data-act="kb-newfile">' + icon("file", "ic-sm") + "<span>新建文件</span></div>" +
      '<div class="side-nav" data-act="kb-newfolder">' + icon("folder", "ic-sm") + "<span>新建文件夹</span></div>" +
      '<div class="side-nav" data-act="kb-menu">' + icon("more", "ic-sm") + "<span>重命名 / 删除</span></div>" +
      "</div>" +
      '<div class="side-foot"><span class="dot ' + (kb.status === "ready" ? "green" : "amber") + '"></span>' +
      "<span>" + esc(kb.name) + " · 解析完成后可检索</span></div></aside>";
  }

  function renderAgentsSide2() {
    const count = (k) => AGENTS.filter((a) => (k === "all" ? true : k === "running" ? a.status === "运行中" : k === "idle" ? a.status === "空闲" : a.status === "已停止")).length;
    return '<aside class="side"><div class="side-head"><div><div class="side-title">专家</div>' +
      '<div class="side-sub">' + AGENTS.length + " 个 · " + count("running") + " 个运行中</div></div>" +
      '<button class="icon-btn" data-act="agent-new" title="新建专家">' + icon("plus") + "</button></div>" +
      '<div class="side-body">' +
      [["all", "全部专家", "bot"], ["running", "运行中", "play"], ["idle", "空闲", "clock"], ["stopped", "已停止", "stop"]].map(([k, label, ic]) =>
        '<div class="side-nav ' + ((state.agentFilter || "all") === k ? "active" : "") + '" data-act="agent-filter" data-value="' + k + '">' +
        icon(ic, "ic-sm") + "<span>" + label + '</span><span class="count">' + count(k) + "</span></div>").join("") +
      '<div class="group-label">创建与配置</div>' +
      '<div class="side-nav" data-act="agent-template">' + icon("grid", "ic-sm") + "<span>从模板创建</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="personalization">' + icon("spark", "ic-sm") + "<span>个性化与子智能体</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="skills">' + icon("package", "ic-sm") + "<span>技能包</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="usage">' + icon("chart", "ic-sm") + "<span>用量与成本</span></div>" +
      "</div>" +
      '<div class="side-foot">' + icon("info", "ic-sm") + "<span>编辑后需发布，新会话生效</span></div></aside>";
  }

  function renderConnectionsSide2() {
    const expired = state.connectors.filter((c) => c.status === "已过期").length;
    return '<aside class="side"><div class="side-head"><div><div class="side-title">连接</div>' +
      '<div class="side-sub">' + state.connectors.length + " 个连接器 · " + expired + " 个待授权</div></div>" +
      '<button class="icon-btn" data-act="conn-add" title="添加连接">' + icon("plus") + "</button></div>" +
      '<div class="side-body">' +
      [["enabled", "已启用连接器", "plug", state.connectors.length], ["builtin", "内置连接器", "grid", ""], ["custom", "自定义 MCP", "terminal", state.mcpServers.length]].map(([v, label, ic, n]) =>
        '<div class="side-nav ' + (state.connTab === v ? "active" : "") + '" data-act="conn-tab" data-id="' + v + '">' +
        icon(ic, "ic-sm") + "<span>" + label + "</span>" + (n !== "" ? '<span class="count">' + n + "</span>" : "") + "</div>").join("") +
      '<div class="group-label">相关</div>' +
      '<div class="side-nav" data-act="nav" data-route="channels">' + icon("chat", "ic-sm") + "<span>通道</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="bridge">' + icon("cloud", "ic-sm") + "<span>云端协同</span></div>" +
      '<div class="side-nav" data-act="nav" data-route="acp">' + icon("terminal", "ic-sm") + "<span>ACP 协作</span></div>" +
      "</div>" +
      '<div class="side-foot">' + icon(expired ? "alert" : "check", "ic-sm") + "<span>" + (expired ? expired + " 个授权过期，需重新授权" : "全部连接器授权正常") + "</span></div></aside>";
  }

  function renderChannelsSide() {
    const on = state.channels.filter((c) => c.on).length;
    return '<aside class="side"><div class="side-head"><div><div class="side-title">通道</div>' +
      '<div class="side-sub">' + state.channels.length + " 个 · " + on + " 个启用</div></div></div>" +
      '<div class="side-body">' +
      '<div class="side-nav ' + (state.channelTab === "all" ? "active" : "") + '" data-act="subtab" data-group="channelTab" data-value="all">' +
      icon("grid", "ic-sm") + '<span>全部通道</span><span class="count">' + state.channels.length + "</span></div>" +
      state.channels.map((c) => '<div class="side-nav ' + (state.channelTab === c.id ? "active" : "") + '" data-act="subtab" data-group="channelTab" data-value="' + c.id + '">' +
        '<span class="dot ' + (c.status === "已连接" ? "green" : "") + '"></span><span>' + esc(c.name) + "</span>" +
        (c.required ? '<span class="hint">必开</span>' : c.on ? '<span class="count">开</span>' : "") + "</div>").join("") +
      "</div></aside>";
  }

  function renderUsageSide() {
    return '<aside class="side"><div class="side-head"><div><div class="side-title">用量</div>' +
      '<div class="side-sub">账户级 · 含工具调用</div></div></div>' +
      '<div class="side-body">' +
      [["summary", "概览", "chart"], ["day", "按天", "clock"], ["expert", "按专家", "bot"], ["model", "按模型", "cpu"]].map(([v, label, ic]) =>
        '<div class="side-nav ' + ((state.usageView || "summary") === v ? "active" : "") + '" data-act="usage-tab" data-id="' + v + '">' +
        icon(ic, "ic-sm") + "<span>" + label + "</span></div>").join("") +
      '<div class="group-label">时间范围</div>' +
      [["7d", "近 7 天"], ["30d", "近 30 天"], ["90d", "近 90 天"]].map(([v, label]) =>
        '<div class="side-nav ' + ((state.usageRange || "30d") === v ? "active" : "") + '" data-act="usage-range" data-id="' + v + '">' +
        icon("clock", "ic-sm") + "<span>" + label + "</span></div>").join("") +
      "</div>" +
      '<div class="side-foot">' + icon("info", "ic-sm") + "<span>预算告警可在任务详情追加</span></div></aside>";
  }

  function renderSide() {
    // 只有对话保留会话二级栏；其余页面统一「页头 + 页内 Tab + 内容」单栏布局
    return state.route.startsWith("chat") ? renderChatSide() : "";
  }

  /* ---------------- render: chat ---------------- */
  // 粗略 token 估算：中文按 1.6 字/token，英文按 4 字符/token，只用于原型展示。
  function tokenEstimate(m) {
    const text = String((m && m.text) || "") + ((m && m.steps) || []).map((s) => s.join(" ")).join(" ");
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const rest = text.length - cjk;
    const n = Math.round(cjk / 1.6 + rest / 4);
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  function chatTokenLine() {
    const sum = (role) => state.messages.filter((m) => (role === "user" ? m.role === "user" : m.role !== "user"))
      .reduce((a, m) => a + String(m.text || "").length, 0);
    const f = (chars) => { const t = Math.round(chars / 2.2); return t >= 1000 ? (t / 1000).toFixed(1) + "k" : String(t); };
    return f(sum("user")) + " 输入 / " + f(sum("bot")) + " 输出";
  }

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
    if (steps) html += '<details class="think"><summary>' + (m.steps || []).length + " 步执行过程</summary>" +
      '<div class="think-body">' + (m.thinking
        ? '<div class="think-text">' + m.thinking.split("\n").map((line) => "<p>" + esc(line) + "</p>").join("") + "</div>"
        : "") + '<div class="process">' + steps + "</div></div></details>";
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
    if (m.ticket) html += renderTicketCard(m);
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
      '<button class="icon-btn" data-act="fork" title="分支">' + icon("git-branch", "ic-sm") + "</button>" +
      '<span class="spacer"></span><span class="msg-model">' + esc(state.model) + "</span>" +
      '<span class="msg-tokens">' + tokenEstimate(m) + " tokens</span></div>";
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
      '<span class="timer">' + esc(att.expires || "剩 28:14") + "</span></div>" +
      '<div class="approval-b">工具 <code>shell.exec</code> · 命令 <code>npm test -- auth</code><br/>' +
      "影响：在仓库 <code>acme/api</code> 内运行测试，只读代码、写临时缓存。</div>" +
      '<div class="approval-acts">' +
      '<button class="btn sm danger" data-act="deny" data-id="' + att.id + '">拒绝</button>' +
      '<button class="btn sm" data-act="approve" data-id="' + att.id + '">仅本次允许</button>' +
      '<button class="btn sm primary" data-act="approve-session" data-id="' + att.id + '">本会话允许</button>' +
      '<button class="btn sm text" data-act="approval-detail" data-id="' + att.id + '">查看完整参数</button>' +
      "</div></div>";
  }

  function renderTicketCard(m) {
    const t = taskById(m.ticket.taskId);
    if (!t) return "";
    const att = t.attention && !t.attention.resolved ? t.attention : null;
    const outcome = outcomeOf(t);
    let tone = "blue", title = "", desc = "", meta = "", acts = "", progress = "";
    if (t.suggested) {
      title = "这一步需要创建任务";
      desc = "调用 write_file(auth.ts) 并运行测试，属于有副作用的操作，需要授权、预算与审计。";
      meta = "范围 fs:workspace · 预算 ¥0.50 · 可停止";
      acts = '<button class="btn sm primary" data-act="ticket-start" data-id="' + t.id + '">开始任务</button>' +
        '<button class="btn sm" data-act="ticket-cancel" data-id="' + t.id + '">取消</button>' +
        '<button class="btn sm text" data-act="ticket-why" data-id="' + t.id + '">为什么需要任务？</button>';
    } else if (att) {
      tone = att.kind === "failed" ? "red" : att.kind === "blocked" ? "amber" : "amber";
      title = att.kind === "approval" ? "等待你授权" : att.kind === "question" ? "等待你回答" : att.kind === "blocked" ? "预算已用尽" : "执行失败";
      desc = att.question;
      meta = "任务 " + t.id + " · " + (t.executor || "内置") + " 执行器 · " + esc(att.expires || "28 分钟后超时");
      acts = att.kind === "approval"
        ? '<button class="btn sm danger" data-act="ticket-deny" data-id="' + t.id + '">拒绝</button>' +
          '<button class="btn sm" data-act="ticket-approve" data-id="' + t.id + '">仅本次允许</button>' +
          '<button class="btn sm primary" data-act="ticket-approve-session" data-id="' + t.id + '">本会话允许</button>' +
          '<button class="btn sm text" data-act="ticket-view" data-id="' + t.id + '">查看任务</button>'
        : att.kind === "question"
          ? '<button class="btn sm primary" data-act="ticket-answer" data-id="' + t.id + '">回答</button>' +
            '<button class="btn sm text" data-act="ticket-view" data-id="' + t.id + '">查看任务</button>'
          : att.kind === "blocked"
            ? '<button class="btn sm primary" data-act="ticket-budget" data-id="' + t.id + '">追加预算</button>' +
              '<button class="btn sm danger" data-act="ticket-stop" data-id="' + t.id + '">停止</button>'
            : '<button class="btn sm primary" data-act="ticket-retry" data-id="' + t.id + '">重试</button>' +
              '<button class="btn sm danger" data-act="ticket-stop" data-id="' + t.id + '">放弃</button>' +
              '<button class="btn sm text" data-act="ticket-view" data-id="' + t.id + '">查看日志</button>';
      if (att.kind === "failed") desc = att.question || "TEST_FAILED";
    } else if (t.bucket === "running") {
      tone = "blue";
      title = "任务 " + t.id + " 运行中";
      desc = t.summary || "正在执行";
      meta = "进度 " + pct(t.progress) + " · 预算 " + money(t.cost) + " / " + money(t.budget);
      progress = '<div class="progress" style="margin:10px 0"><i style="width:' + pct(t.progress) + '"></i></div>';
      acts = '<button class="btn sm" data-act="ticket-stop" data-id="' + t.id + '">停止</button>' +
        '<button class="btn sm text" data-act="ticket-view" data-id="' + t.id + '">查看运行轨迹</button>';
    } else if (outcome === "completed") {
      tone = "green"; title = "任务已完成";
      desc = "已改 1 个文件，测试通过；产物 2 个（diff 与 PR）。";
      meta = "成本 " + money(t.cost) + " · 审计已记录";
      acts = '<button class="btn sm primary" data-act="ticket-view" data-id="' + t.id + '">查看报告</button>' +
        '<button class="btn sm" data-act="ticket-rerun" data-id="' + t.id + '">重新执行</button>';
    } else {
      tone = ""; title = "已取消，未执行工具";
      desc = "工作区没有变化，未产生费用。";
      meta = "可随时重新发起";
      acts = '<button class="btn sm primary" data-act="ticket-rerun" data-id="' + t.id + '">重新发起</button>';
    }
    return '<div class="ticket-card ' + tone + '">' +
      '<div class="ticket-head"><span class="ticket-flag">' + icon("alert", "ic-sm") + "</span><b>" + esc(title) + "</b>" +
      '<span class="spacer"></span><span class="hint">' + esc(t.ref) + "</span></div>" +
      '<div class="ticket-body"><div class="ticket-desc">' + esc(desc) + "</div>" + progress +
      '<div class="ticket-meta">' + esc(meta) + "</div></div>" +
      '<div class="ticket-acts">' + acts + "</div></div>";
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
      '<div class="composer-meta"><span>本次对话：' + chatTokenLine() + '</span><span class="spacer"></span><span>上下文 ' + state.contextPct + "%</span></div>" +
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
  const BUCKETS = [["all", "全部"], ["attention", "待我决定"], ["running", "进行中"], ["queued", "已排队"], ["done", "已结束"]];

  function taskStatusTag(t) {
    if (t.bucket === "attention" && t.attention && !t.attention.resolved) {
      const k = TASK_KIND_LABEL[t.attention.kind] || ["待决", "red"];
      return '<span class="tag ' + k[1] + ' sm">' + k[0] + "</span>";
    }
    if (t.bucket === "running") return t.stalled ? '<span class="tag amber sm">可能卡住</span>' : '<span class="tag green sm">运行中</span>';
    if (t.bucket === "queued") return t.suggested ? '<span class="tag sm">待确认</span>' : '<span class="tag sm">排队中</span>';
    const o = OUTCOME_LABEL[outcomeOf(t)] || ["已完成", "green"];
    return '<span class="tag ' + o[1] + ' sm">' + o[0] + "</span>";
  }

  function taskActions(t, compact) {
    const sm = " sm";
    const b = (act, label, cls) => '<button class="btn' + sm + " " + (cls || "") + '" data-act="' + act + '" data-id="' + t.id + '">' + label + "</button>";
    if (t.suggested) return compact ? b("ticket-start", "开始任务", "primary") + b("ticket-cancel", "取消", "text") : b("ticket-start", "开始任务", "primary") + b("ticket-cancel", "取消", "");
    const att = t.attention && !t.attention.resolved ? t.attention : null;
    if (att) {
      if (att.kind === "approval") return compact
        ? b("ticket-deny", "拒绝", "danger") + b("ticket-approve", "允许", "primary")
        : b("ticket-deny", "拒绝", "danger") + b("ticket-approve", "仅本次允许", "") + b("ticket-approve-session", "本会话允许", "primary") + b("ticket-view", "查看任务", "text");
      if (att.kind === "question") return compact ? b("ticket-answer", "回答", "primary") : b("ticket-answer", "回答", "primary") + b("ticket-view", "查看任务", "text");
      if (att.kind === "blocked") return compact ? b("ticket-budget", "追加预算", "primary") : b("ticket-budget", "追加预算", "primary") + b("ticket-stop", "停止", "danger");
      return compact ? b("ticket-retry", "重试", "primary") : b("ticket-retry", "重试", "primary") + b("ticket-stop", "放弃", "danger") + b("ticket-view", "查看日志", "text");
    }
    if (t.bucket === "running") return compact ? b("ticket-stop", "停止", "danger") : b("ticket-budget", "追加预算", "") + b("ticket-stop", "停止", "danger");
    if (t.bucket === "queued") return compact ? b("ticket-start", "执行", "primary") : b("ticket-start", "立即执行", "primary") + b("task-assign", "派工", "");
    const o = outcomeOf(t);
    if (o === "completed") return compact ? b("ticket-view", "报告", "") : b("ticket-view", "查看报告", "primary") + b("ticket-rerun", "重新执行", "");
    return compact ? b("ticket-rerun", "重发", "") : b("ticket-rerun", "重新发起", "primary");
  }

  function taskCard(t) {
    const cls = (t.bucket === "running" && t.stalled ? "stalled" : t.bucket) + (outcomeOf(t) === "failed" ? " failed" : "");
    const sel = state.selectedTask === t.id ? " sel" : "";
    let inner = '<div class="task-top">' + sourceTag(t.source) + "<span>" + esc(t.ref) + '</span><span class="spacer"></span><span>' + esc(t.createdAt) + "</span></div>" +
      '<div class="task-title">' + esc(t.title) + "</div>" +
      '<div class="task-meta"><span class="avatar-xs">' + esc((t.actor || "?")[0].toUpperCase()) + "</span>" + esc(t.actor) +
      '<span class="tag outline sm">' + esc(t.executor) + "</span>" + taskStatusTag(t) + "</div>";
    if (t.bucket === "attention" && t.attention && !t.attention.resolved) {
      inner += '<div class="task-q">' + icon("alert", "ic-sm") + '<span class="q-text">' + esc(t.attention.question) + "</span>" +
        '<span class="acts">' + taskActions(t, true) + "</span></div>";
    } else if (t.bucket === "running") {
      inner += '<div class="progress ' + (t.stalled ? "amber" : "") + '" style="margin-top:9px"><i style="width:' + pct(t.progress) + '"></i></div>' +
        '<div class="task-foot"><span>' + esc(t.summary) + '</span><span class="spacer"></span><span>' + money(t.cost) + "</span></div>";
    } else {
      inner += '<div class="task-foot"><span>' + esc(t.summary) + '</span><span class="spacer"></span><span>' + (t.bucket === "done" ? money(t.cost) : "") + "</span></div>";
    }
    return '<div class="task ' + cls + sel + '" data-act="task-select" data-id="' + t.id + '">' + inner + "</div>";
  }

  function filteredTasks() {
    const list = state.tasks.filter((t) => {
      if (state.bucket !== "all" && t.bucket !== state.bucket) return false;
      if (state.sourceFilter !== "all" && t.source !== state.sourceFilter) return false;
      if (state.executorFilter && state.executorFilter !== "all" && t.executor !== state.executorFilter) return false;
      if (state.q && !(t.title + " " + t.ref + " " + t.actor + " " + t.summary).toLowerCase().includes(state.q.toLowerCase())) return false;
      return true;
    });
    const s = state.taskSort || "updated";
    list.sort((a, b) => {
      if (s === "title") return String(a.title).localeCompare(String(b.title), "zh");
      if (s === "created") return String(b.createdAt).localeCompare(String(a.createdAt));
      if (s === "status") return String(a.bucket).localeCompare(String(b.bucket));
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return list;
  }

  function taskListHTML() {
    const list = filteredTasks();
    if (!list.length) {
      const filtered = state.bucket !== "all" || state.sourceFilter !== "all" || state.executorFilter || state.q;
      return '<div class="empty"><div class="glyph">' + icon("inbox") + "</div><b>" +
        (filtered ? "没有匹配的任务" : "还没有任务") + "</b><p>" +
        (filtered ? "清除筛选或换个关键词；也可以在对话里直接发起。" : "任务的来源是对话、GitHub、飞书或邮件；也可以手动新建。") + "</p>" +
        (filtered ? '<button class="btn sm" data-act="clear-filter">清除筛选</button>' : '<button class="btn sm primary" data-act="task-new">新建任务</button>') + "</div>";
    }
    return list.map(taskCard).join("");
  }

  function renderTasks() {
    const counts = {
      all: bucketCount("all"), attention: bucketCount("attention"), running: bucketCount("running"),
      queued: bucketCount("queued"), done: bucketCount("done"),
    };
    const attn = attentions().length;
    const srcs = [["all", "全部"], ["github", "GitHub"], ["feishu", "飞书"], ["email", "邮件"]];
    const execs = [["all", "全部"], ["内置", "内置"], ["Claude Code", "Claude Code"], ["Codex", "Codex"]];
    const srcCount = (v) => (v === "all" ? state.tasks.length : state.tasks.filter((t) => t.source === v).length);
    const execCount = (v) => (v === "all" ? state.tasks.length : state.tasks.filter((t) => t.executor === v).length);
    const curSrc = state.sourceFilter || "all";
    const curExec = state.executorFilter || "all";
    const chip = (on, act, value, label, n) => '<button class="chip ' + (on ? "on" : "") + '" data-act="' + act + '" data-value="' + value + '">' +
      label + '<span class="chip-n">' + n + "</span></button>";
    const toolbar = '<div class="task-toolbar">' +
      '<div class="chip-row"><span class="chip-label">来源</span>' +
      srcs.map(([v, label]) => chip(curSrc === v, "filter-source", v, label, srcCount(v))).join("") + "</div>" +
      '<span class="vsep"></span>' +
      '<div class="chip-row"><span class="chip-label">执行器</span>' +
      execs.map(([v, label]) => chip(curExec === v, "filter-executor", v, label, execCount(v))).join("") + "</div>" +
      '<span class="spacer"></span>' +
      '<div class="search" style="width:200px">' + icon("search", "ic-sm") +
      '<input placeholder="搜索任务、发起人或 PR" data-input="task-search" value="' + esc(state.q || "") + '" /></div>' +
      '<select class="input" style="width:124px" data-act="task-sort" aria-label="排序">' +
      [["updated", "按更新时间"], ["created", "按创建时间"], ["status", "按状态"], ["title", "按标题"]].map(([v, l]) =>
        '<option value="' + v + '"' + ((state.taskSort || "updated") === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>";
    return '<div class="main">' +
      '<div class="page" style="padding-bottom:0;flex:0 0 auto">' +
      '<div class="page-head"><div><div class="page-title">任务</div>' +
      '<div class="page-sub">Agent 正在处理的工作；需要你决定的事会出现在最上面。审批、停止、追加预算都会写入审计。</div></div>' +
      '<div class="page-actions"><button class="btn" data-act="nav" data-route="inbox">' + icon("inbox", "ic-sm") + "收件箱" +
      (attn ? ' <span class="tag red sm">' + attn + "</span>" : "") + "</button>" +
      '<button class="btn" data-act="nav" data-route="automation">' + icon("clock", "ic-sm") + "自动化</button>" +
      '<button class="btn primary" data-act="task-new">' + icon("plus", "ic-sm") + "新建任务</button></div></div>" +
      '<div class="tabs" style="margin:4px 0 0">' +
      BUCKETS.map(([id, label]) =>
        '<button class="tab ' + (state.bucket === id ? "active" : "") + '" data-act="bucket" data-id="' + id + '">' +
        label + '<span class="count ' + (id === "attention" && counts.attention ? "red" : "") + '">' + counts[id] + "</span></button>").join("") +
      "</div>" + toolbar + "</div>" +
      '<div class="task-split' + (state.detailOpen ? " show-detail" : "") + '"><div class="task-list" id="task-list">' + taskListHTML() + "</div>" +
      '<div class="detail" id="task-detail">' + renderTaskDetail(taskById(state.selectedTask) || filteredTasks()[0] || state.tasks[0]) + "</div></div></div>";
  }

  function renderTaskDetail(t, isTicket) {
    if (!t) return '<div class="empty" style="padding:60px"><b>没有任务</b><p>从左侧选择或在对话中发起。</p></div>';
    const att = t.attention && !t.attention.resolved ? t.attention : null;
    const chips = taskStatusTag(t) + '<span class="tag blue">' + esc(t.strength) + "</span>" +
      '<span class="tag outline">策略 v' + t.policy + "</span>" + '<span class="tag outline">' + esc(t.executor) + " 执行器</span>" +
      '<span class="hint">' + esc(t.sourceLabel) + " · @" + esc(t.actor) + " · " + esc(t.createdAt) + "</span>";
    const tl = (t.timeline || []).map(([time, kind, txt, tone]) =>
      '<div class="tl ' + (tone || "") + '"><div class="row"><span class="time">' + esc(time) + '</span><span class="kind">' + esc(kind) + '</span><span class="txt">' + txt + "</span></div></div>").join("");
    const timeline = tl || '<div class="hint">还没有事件。</div>';
    let attentionPanel = "";
    if (att) {
      attentionPanel = '<div class="panel attention-panel">' +
        '<div class="panel-h"><b>' + esc(att.question) + '</b><span class="spacer"></span><span class="tag ' +
        (TASK_KIND_LABEL[att.kind] || ["", ""])[1] + ' sm">' + (TASK_KIND_LABEL[att.kind] || ["待决"])[0] + "</span></div>" +
        '<div class="hint" style="margin-bottom:12px">' + esc(att.detail || "") + "</div>" +
        (att.kind === "question"
          ? '<textarea class="input" id="answer-inline" rows="3" placeholder="输入回答，提交后 Agent 继续"></textarea>' +
            '<div class="row" style="margin-top:10px"><span class="hint">提交后会写入任务线与审计</span><span class="spacer"></span>' +
            '<button class="btn primary" data-act="answer-inline-submit" data-id="' + att.id + '">提交回答</button></div>'
          : '<div class="row" style="flex-wrap:wrap">' + taskActions(t, false) + "</div>") +
        "</div>";
    }
    return '<button class="btn sm text detail-back" data-act="detail-back">' + icon("chev", "ic-xs") + " 返回列表</button>" +
      '<div class="detail-top"><div><h2>' + esc(t.title) + '</h2><div class="chips">' + chips + "</div></div>" +
      '<div class="detail-actions">' +
      (isTicket ? "" : '<button class="btn sm text" data-act="ticket-view" data-id="' + t.id + '">打开完整工单</button>') +
      (att ? "" : taskActions(t, false)) + "</div></div>" +
      attentionPanel +
      '<div class="panel"><div class="panel-h"><b>授权范围</b><span class="sub">Mandate · 不可变</span><span class="spacer"></span><span class="tag outline">policy v' + t.policy + "</span></div>" +
      '<dl class="dl"><dt>scope</dt><dd><code class="inline">repo:acme/api</code> <code class="inline">path:src/auth</code> <code class="inline">tool:shell.exec</code></dd>' +
      "<dt>strength</dt><dd>" + esc(t.strength) + "（用户明确请求）</dd>" +
      '<dt>发起人</dt><dd>' + esc(t.sourceLabel) + ":" + esc(t.actor) + ' · 命中规则 <code class="inline">allow-assigned</code></dd>' +
      "<dt>预算</dt><dd>" + money(t.cost) + " / " + money(t.budget) + '<div class="progress" style="margin-top:6px;max-width:240px"><i style="width:' + pct(Math.min(1, (t.cost || 0) / (t.budget || 1))) + '"></i></div></dd></dl></div>' +
      '<div class="panel"><div class="panel-h"><b>任务线</b><span class="sub">Trigger → Eval → Ticket → Report</span></div><div class="timeline">' + timeline + "</div></div>" +
      auditTabHTML(t) +
      '<div class="panel"><div class="panel-h"><b>产物</b><span class="sub">Artifacts</span><span class="spacer"></span><button class="btn sm text" data-act="task-export" data-id="' + t.id + '">导出</button></div>' +
      ((t.artifacts && t.artifacts.length) ? '<div>' + t.artifacts.map(([ic, name, sub]) =>
        '<div class="row" style="padding:6px"><span style="color:var(--text-3)">' + icon(ic, "ic-sm") + "</span><span>" + esc(name) + '</span><span class="spacer"></span><span class="hint">' + esc(sub) + "</span></div>").join("") + "</div>" :
        '<div class="hint">还没有产物。任务完成后会出现 diff、日志或 PR。</div>') + "</div>";
  }

  function renderTicket() {
    const t = taskById(state.selectedTask) || state.tasks[0];
    if (!t) return '<div class="main"><div class="page"><div class="empty"><b>任务不存在</b><p>可能已被删除。</p><button class="btn" data-act="nav" data-route="tasks">返回任务中心</button></div></div></div>';
    const att = t.attention && !t.attention.resolved ? t.attention : null;
    const chips = taskStatusTag(t) + '<span class="tag blue sm">' + esc(t.strength) + "</span>" +
      '<span class="tag outline sm">策略 v' + t.policy + "</span>" + '<span class="tag outline sm">' + esc(t.executor) + "</span>";
    const tl = (t.timeline || []).map(([time, kind, txt, tone]) =>
      '<div class="tl ' + (tone || "") + '"><div class="row"><span class="time">' + esc(time) + '</span><span class="kind">' + esc(kind) + '</span><span class="txt">' + txt + "</span></div></div>").join("");
    const attentionPanel = att ? '<div class="panel attention-panel">' +
      '<div class="panel-h"><b>' + esc(att.question) + '</b><span class="spacer"></span><span class="tag ' +
      (TASK_KIND_LABEL[att.kind] || ["", ""])[1] + ' sm">' + (TASK_KIND_LABEL[att.kind] || ["待决"])[0] + "</span></div>" +
      '<div class="hint" style="margin-bottom:12px">' + esc(att.detail || "") + "</div>" +
      (att.kind === "question"
        ? '<textarea class="input" id="answer-inline" rows="3" placeholder="输入回答，提交后 Agent 继续"></textarea>' +
          '<div class="row" style="margin-top:10px"><span class="hint">提交后会写入任务线与审计</span><span class="spacer"></span>' +
          '<button class="btn primary" data-act="answer-inline-submit" data-id="' + att.id + '">提交回答</button></div>'
        : '<div class="row" style="flex-wrap:wrap">' + taskActions(t, false) + "</div>") + "</div>" : "";
    const mandate = '<div class="panel"><div class="panel-h"><b>授权范围</b><span class="sub">Mandate · 不可变</span>' +
      '<span class="spacer"></span><span class="tag outline sm">policy v' + t.policy + "</span></div>" +
      '<dl class="dl"><dt>scope</dt><dd><code class="inline">repo:acme/api</code> <code class="inline">path:src/auth</code> <code class="inline">tool:shell.exec</code></dd>' +
      "<dt>strength</dt><dd>" + esc(t.strength) + "（用户明确请求）</dd>" +
      '<dt>发起人</dt><dd>' + esc(t.sourceLabel) + ":" + esc(t.actor) + ' · 命中规则 <code class="inline">allow-assigned</code></dd>' +
      '<dt>关联</dt><dd>' + esc(t.ref) + ' · 会话 <code class="inline">session_' + esc(String(t.id).slice(-4)) + "</code></dd></dl></div>";
    const timeline = '<div class="panel"><div class="panel-h"><b>任务线</b><span class="sub">Trigger → Eval → Ticket → Report</span></div>' +
      (tl ? '<div class="timeline">' + tl + "</div>" : '<div class="hint">还没有事件。</div>') + "</div>";
    const budget = Math.min(1, (t.cost || 0) / (t.budget || 1));
    const costCard = '<div class="panel"><div class="panel-h"><b>预算与成本</b><span class="spacer"></span>' +
      '<span class="tag ' + (budget > 0.9 ? "red" : budget > 0.7 ? "amber" : "green") + ' sm">' + Math.round(budget * 100) + "%</span></div>" +
      '<div class="cost-row"><b>' + money(t.cost) + "</b><span>/ " + money(t.budget) + "</span></div>" +
      '<div class="progress" style="margin-top:8px"><i style="width:' + pct(budget * 100) + '"></i></div>' +
      '<div class="mini-row" style="margin-top:10px"><span class="hint">剩余</span><span class="spacer"></span><span class="num">' + money(Math.max(0, (t.budget || 0) - (t.cost || 0))) + "</span></div>" +
      '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="ticket-budget" data-id="' + t.id + '">追加预算</button></div></div>';
    const artifacts = '<div class="panel"><div class="panel-h"><b>产物</b><span class="sub">Artifacts</span><span class="spacer"></span>' +
      '<button class="btn sm text" data-act="task-export" data-id="' + t.id + '">' + icon("download", "ic-xs") + "导出</button></div>" +
      ((t.artifacts && t.artifacts.length) ? t.artifacts.map(([ic, name, sub]) =>
        '<div class="artifact-row"><span class="artifact-ic">' + icon(ic, "ic-sm") + "</span><span>" + esc(name) + "</span>" +
        '<span class="spacer"></span><span class="hint">' + esc(sub) + "</span></div>").join("")
        : '<div class="hint">还没有产物。任务完成后会出现 diff、日志或 PR。</div>') + "</div>";
    const related = '<div class="panel"><div class="panel-h"><b>来源与关联</b></div>' +
      '<div class="mini-row"><span class="hint">来源</span><span class="spacer"></span><span>' + esc(t.sourceLabel) + " · " + esc(t.ref) + "</span></div>" +
      '<div class="mini-row"><span class="hint">会话</span><span class="spacer"></span><button class="btn sm text" data-act="nav" data-route="chat">session_' + esc(String(t.id).slice(-4)) + "</button></div>" +
      '<div class="mini-row"><span class="hint">知识库</span><span class="spacer"></span><span>运维手册 · 2 条引用</span></div>' +
      '<div class="mini-row"><span class="hint">连接器</span><span class="spacer"></span><span>GitHub · issue #412</span></div></div>';
    return '<div class="main"><div class="page">' +
      '<div class="crumb"><button class="btn sm text" data-act="nav" data-route="tasks">' + icon("chev", "ic-xs") + "任务</button>" +
      '<span class="crumb-sep">/</span><span class="mono">' + esc(t.id) + "</span></div>" +
      '<div class="page-head"><div><div class="page-title">' + esc(t.title) + "</div>" +
      '<div class="page-sub">' + esc(t.ref) + " · " + esc(t.sourceLabel) + " · @" + esc(t.actor) + " · " + esc(t.createdAt) + "</div>" +
      '<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">' + chips + "</div></div>" +
      '<div class="page-actions">' + (att ? "" : taskActions(t, false)) +
      '<button class="btn" data-act="nav" data-route="inbox">' + icon("inbox", "ic-sm") + "收件箱</button></div></div>" +
      '<div class="ticket-layout"><div class="ticket-main">' + attentionPanel + mandate + timeline + auditTabHTML(t) + "</div>" +
      '<aside class="ticket-aside">' + costCard + artifacts + related + "</aside></div>" +
      '<div class="row" style="margin-top:14px;gap:8px"><button class="btn" data-act="nav" data-route="tasks">返回任务中心</button>' +
      '<button class="btn text" data-act="nav" data-route="inbox">去收件箱</button></div></div></div>';
  }

  /* ---------------- render: automation (cron) ---------------- */
  function renderAutomationSide() {
    const jobs = state.cronJobs;
    const n = (k) => (k === "all" ? jobs.length : k === "on" ? jobs.filter((j) => j.on).length : jobs.filter((j) => !j.on).length);
    return '<aside class="side"><div class="side-head"><div><div class="side-title">调度筛选</div>' +
      '<div class="side-sub">' + jobs.length + " 个定时任务 · " + n("on") + " 个启用</div></div>" +
      '<button class="icon-btn" data-act="cron-new" title="创建定时任务">' + icon("plus") + "</button></div>" +
      '<div class="side-body">' +
      [["all", "全部任务", "clock"], ["on", "已启用", "play"], ["off", "已暂停", "stop"]].map(([v, label, ic]) =>
        '<div class="side-nav ' + (state.cronFilter === v ? "active" : "") + '" data-act="cron-filter" data-value="' + v + '">' +
        icon(ic, "ic-sm") + "<span>" + label + '</span><span class="count">' + n(v) + "</span></div>").join("") +
      '<div class="divider"></div>' +
      '<div class="side-nav" data-act="nav" data-route="tasks">' + icon("inbox", "ic-sm") + "<span>返回任务</span></div>" +
      "</div></aside>";
  }

  function renderAutomation() {
    const filter = state.cronFilter || "all";
    const jobs = state.cronJobs.filter((j) => (filter === "on" ? j.on : filter === "off" ? !j.on : true));
    const onJobs = state.cronJobs.filter((j) => j.on);
    const runs = Object.keys(state.cronHistory).reduce((acc, id) => acc.concat((state.cronHistory[id] || []).map((r) => ({ ...r, id: id }))), [])
      .sort((a, b) => b.at - a.at).slice(0, 6);
    const EXAMPLES = [
      ["每个工作日 [09:00] 列出今日待办并按优先级排序", "0 9 * * 1-5", "列出今日待办并按优先级排序"],
      ["每周日 [20:00] 复盘本周完成事项，并给出下周计划", "0 20 * * 0", "复盘本周完成事项，并给出下周计划"],
      ["每天 [22:00] 提醒我整理明天要处理的三件事", "0 22 * * *", "提醒我整理明天要处理的三件事"],
    ];
    const row = (j) => '<div class="cron-row"><div class="cron-main"><div class="row" style="gap:8px">' +
      "<b>" + esc(j.name) + '</b><span class="tag sm">' + esc(j.type) + "</span>" +
      (j.on ? '<span class="tag green sm">已启用</span>' : '<span class="tag sm">已暂停</span>') + "</div>" +
      '<div class="hint">' + esc(j.cron) + " · " + esc(j.desc) + " · 上次 " + esc(j.last) + "</div></div>" +
      '<span class="cron-next">下次<b>' + esc(j.on ? j.next : "—") + "</b></span>" +
      toggle(j.on, j.id, "cron") +
      '<button class="btn sm" data-act="cron-run" data-id="' + j.id + '">立即执行</button>' +
      '<button class="icon-btn" data-act="cron-menu" data-id="' + j.id + '" title="更多">' + icon("more", "ic-sm") + "</button></div>";
    const empty = '<div class="cron-empty"><div class="cron-mascot">' + icon("clock") + "</div>" +
      "<b>开启你的第一个定时任务吧</b><p>选择下方示例，或点「创建定时任务」从头开始</p>" +
      '<div class="example-list">' + EXAMPLES.map(([label, cron, prompt]) =>
        '<button class="example-row" data-act="cron-example" data-cron="' + esc(cron) + '" data-value="' + esc(prompt) + '">' +
        "<span>" + esc(label) + "</span>" + icon("chev", "ic-xs") + "</button>").join("") + "</div>" +
      '<button class="btn primary" data-act="cron-new">' + icon("plus", "ic-sm") + "创建定时任务</button></div>";
    const list = '<div class="cron-list">' + jobs.map(row).join("") + "</div>";
    return '<div class="main"><div class="page">' +
      '<div class="page-head"><div><div class="page-title">自动化</div>' +
      '<div class="page-sub">创建和管理专家定期执行的计划任务，也可以立刻手动运行</div></div>' +
      '<div class="page-actions"><button class="btn primary" data-act="cron-new">' + icon("plus", "ic-sm") + "创建定时任务</button></div></div>" +
      '<div class="filter-row"><span class="expert-chip">专家<span class="dot green"></span>业务专家' + icon("chev", "ic-xs") + "</span>" +
      '<div class="seg-text" style="margin-left:8px">' + [["all", "全部"], ["on", "已启用"], ["off", "已暂停"]].map(([id, label]) =>
        '<button class="seg ' + (filter === id ? "active" : "") + '" data-act="cron-filter" data-value="' + id + '">' + label + "</button>").join("") +
      "</div><span class=\"spacer\"></span><span class=\"hint\">" + onJobs.length + " 个任务已启用 · 按服务端时区调度</span></div>" +
      (state.cronJobs.length ? list : empty) +
      '<div class="card" style="margin-top:14px"><div class="card-h"><b class="card-title">最近执行</b>' +
      '<span class="card-sub">手动触发与定时触发都记录在这里</span></div><div class="card-b">' +
      (runs.length ? runs.map((r) => '<div class="mini-row"><span class="mono hint" style="width:74px">' + esc(r.at) + "</span>" +
        "<span>" + esc((state.cronJobs.find((j) => j.id === r.id) || {}).name || r.id) + '</span><span class="spacer"></span>' +
        '<span class="tag ' + (r.ok ? "green" : "red") + ' sm">' + (r.ok ? "成功" : "失败") + "</span></div>").join("")
        : '<div class="hint">还没有执行记录。点「立即执行」可产生一条。</div>') + "</div></div></div></div>";
  }

  function renderCronDrawer() {
    const d = state.cronDraft;
    if (!d) return "";
    const field = (label, control, hint, required) => '<div class="dfield"><label>' + (required ? '<i>*</i>' : "") + label + "</label>" + control +
      (hint ? '<div class="hint">' + hint + "</div>" : "") + "</div>";
    return '<div class="drawer-mask" data-act="cron-close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="创建定时任务">' +
      '<div class="drawer-h"><b>' + (d.id ? "编辑定时任务" : "创建定时任务") + "</b><span class=\"spacer\"></span>" +
      '<button class="icon-btn" data-act="cron-close" title="关闭">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      '<div class="form-section"><div class="form-section-h">基础信息</div>' +
      field("任务名称", '<input class="input" data-input="cron-name" value="' + esc(d.name) + '" placeholder="例如：每日科技新闻" maxlength="80" />',
        "设置任务名称和启用状态，开启后任务将按计划自动执行。", true) +
      '<div class="setting-row" style="padding:10px 0"><div class="label"><b>启用任务</b><span>关闭后只保存配置，不触发</span></div>' + toggle(d.on, "on", "cronDraft") + "</div>" +
      "</div>" +
      '<div class="form-section"><div class="form-section-h">执行计划</div>' +
      field("调度方式", '<select class="input" data-input="cron-type"><option' + (d.type === "智能体" ? " selected" : "") + '>智能体</option><option' + (d.type === "文本" ? " selected" : "") + ">文本</option></select>",
        "任务可以只发一次，也可以按固定频率或 Cron 表达式重复执行。", true) +
      field("执行频率", '<input class="input mono" data-input="cron-cron" value="' + esc(d.cron) + '" placeholder="0 9 * * *" />',
        "支持 0 9 * * * 这类 5 段 Cron；创建后可随时暂停或改期。", true) +
      field("时区", '<input class="input" value="Asia/Shanghai" disabled />', "默认跟随服务端时区。") +
      "</div>" +
      '<div class="form-section"><div class="form-section-h">任务内容</div>' +
      field("任务类型", '<select class="input" data-input="cron-mode"><option' + (d.kind === "text" ? " selected" : "") + '>文本（发送固定消息）</option><option' + (d.kind !== "text" ? " selected" : "") + ">智能体（执行指令）</option></select>") +
      field("发送给智能体的指令", '<textarea class="input" rows="4" data-input="cron-prompt" placeholder="例如：帮我看看今天的天气并总结最新的邮件">' + esc(d.prompt) + "</textarea>", "", true) +
      field("发送通道", '<select class="input" data-input="cron-channel">' + ["控制台", "飞书", "企业微信"].map((c) =>
        "<option" + (d.channel === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select>",
        "未选通道时投递到控制台默认会话。") +
      '<div class="setting-row" style="padding:10px 0"><div class="label"><b>每次执行新会话</b><span>避免与上一轮上下文串味</span></div>' + toggle(d.fresh, "fresh", "cronDraft") + "</div>" +
      "</div></div>" +
      '<div class="drawer-f"><button class="btn" data-act="cron-close">取消</button>' +
      '<button class="btn primary" data-act="cron-save">' + (d.id ? "保存" : "创建") + "</button></div></aside>";
  }

  /* ---------------- render: inbox ---------------- */
  function renderInbox() {
    const all = attentions();
    const list = state.attFilter === "all" ? all : all.filter((x) => x.att.kind === state.attFilter);
    const unread = all.filter((x) => !x.att.read).length;
    const sel = state.inboxSelected.filter((x) => all.some((y) => y.att.id === x));
    if (!list.length) {
      const filtered = all.length > 0;
      return '<div class="main"><div class="page"><div class="page-title">收件箱</div><div class="page-sub">' +
        (filtered ? "该分类下没有待决事项。" : "没有待你决定的事。") + "</div>" +
        '<div class="empty"><div class="glyph">' + icon("check") + "</div><b>" +
        (filtered ? "这个分类是空的" : "收件箱是空的") + "</b><p>" +
        (filtered ? "切换到其他分类，或查看全部。" : "Agent 会继续处理进行中的任务；新的审批与提问会出现在这里。") + "</p>" +
        (filtered ? '<button class="btn sm" data-act="att-filter" data-value="all">查看全部</button>' :
          '<button class="btn sm" data-act="nav" data-route="tasks">查看进行中</button>') + "</div></div></div>";
    }
    const current = list.find((x) => x.att.id === state.selectedAttention) || list[0];
    const left = list.map(({ task, att }) => {
      const active = current.att.id === att.id ? " active" : "";
      const kind = TASK_KIND_LABEL[att.kind] || ["待决", ""];
      return '<div class="list-item' + active + (att.read ? " read" : "") + '" data-act="attention-select" data-id="' + att.id + '">' +
        '<span class="checkbox ' + (sel.includes(att.id) ? "on" : "") + '" data-act="att-check" data-id="' + att.id + '" role="checkbox" aria-checked="' + (sel.includes(att.id) ? "true" : "false") + '">' + icon("check") + "</span>" +
        '<div class="li-main"><div class="list-title">' + (!att.read ? '<span class="dot blue"></span>' : "") + esc(task.title) +
        '</div><div class="list-sub">' + esc(att.question) + "</div></div>" +
        '<span class="tag ' + kind[1] + ' sm">' + kind[0] + "</span></div>";
    }).join("");
    const kinds = [["all", "全部"], ["approval", "审批"], ["question", "提问"], ["blocked", "受阻"], ["failed", "失败"]];
    const kcount = (k) => (k === "all" ? all.length : all.filter((x) => x.att.kind === k).length);
    const toolbar = '<div class="task-toolbar"><div class="chip-row"><span class="chip-label">类型</span>' +
      kinds.map(([k, label]) => '<button class="chip ' + (state.attFilter === k ? "on" : "") + '" data-act="att-filter" data-value="' + k + '">' +
        label + '<span class="chip-n">' + kcount(k) + "</span></button>").join("") + "</div>" +
      '<span class="spacer"></span><span class="hint">已选 ' + sel.length + " 件 · 处理后自动消失</span></div>";
    return '<div class="main"><div class="page" style="padding-bottom:0;flex:0 0 auto">' +
      '<div class="page-head"><div><div class="page-title">收件箱</div>' +
      '<div class="page-sub">' + list.length + " 件需要你决定 · " + unread + " 件未读；处理后会自动消失。</div></div>" +
      '<div class="page-actions">' + (unread ? '<button class="btn" data-act="inbox-read-all">标记已读</button>' : "") +
      '<button class="btn ' + (sel.length ? "primary" : "") + '" data-act="inbox-bulk" data-value="approve"' + (sel.length ? "" : " disabled") + ">批量批准" + (sel.length ? "（" + sel.length + "）" : "") + "</button>" +
      '<button class="btn" data-act="inbox-bulk" data-value="deny"' + (sel.length ? "" : " disabled") + ">批量拒绝</button></div></div>" +
      toolbar + "</div>" +
      '<div class="task-split' + (state.detailOpen ? " show-detail" : "") + '"><div class="task-list inbox-list">' + left + "</div>" +
      '<div class="detail">' + renderAttentionDetail(current.task, current.att) + "</div></div></div>";
  }

  function renderAttentionDetail(task, att) {
    const kind = TASK_KIND_LABEL[att.kind] || ["待决", ""];
    const expires = att.kind === "approval" || att.kind === "question" ? '<span class="tag amber sm">28 分钟后超时</span>' : "";
    let acts = "";
    if (att.kind === "approval") {
      acts = '<button class="btn danger" data-act="deny" data-id="' + att.id + '">拒绝</button>' +
        '<button class="btn" data-act="approve" data-id="' + att.id + '">仅本次允许</button>' +
        '<button class="btn primary" data-act="approve-session" data-id="' + att.id + '">本会话允许</button>' +
        '<button class="btn text" data-act="approval-detail" data-id="' + att.id + '">查看完整参数</button>';
    } else if (att.kind === "blocked") {
      acts = '<button class="btn primary" data-act="budget-add" data-id="' + att.id + '">追加 ¥1.00 并继续</button>' +
        '<button class="btn danger" data-act="deny" data-id="' + att.id + '">停止任务</button>';
    } else if (att.kind === "failed") {
      acts = '<button class="btn primary" data-act="task-retry" data-id="' + task.id + '">重试</button>' +
        '<button class="btn danger" data-act="task-stop" data-id="' + task.id + '">放弃</button>' +
        '<button class="btn text" data-act="ticket-view" data-id="' + task.id + '">查看日志</button>';
    } else {
      acts = '<textarea class="input" id="answer-inline" rows="3" placeholder="输入回答，提交后 Agent 继续；会写入任务线与审计"></textarea>' +
        '<div class="row" style="margin-top:10px"><span class="hint">回答会作为任务事件记录</span><span class="spacer"></span>' +
        '<button class="btn primary" data-act="answer-inline-submit" data-id="' + att.id + '">提交回答</button></div>';
    }
    return '<div class="detail-top"><div><h2>' + esc(task.title) + '</h2><div class="chips">' +
      '<span class="tag ' + kind[1] + '">' + kind[0] + "</span>" + expires +
      '<span class="tag outline">' + esc(task.ref) + "</span>" +
      '<span class="tag outline">@' + esc(task.actor) + "</span>" +
      '<span class="hint">' + esc(task.executor) + " 执行器 · " + esc(task.createdAt) + "</span></div></div>" +
      '<div class="detail-actions"><button class="btn sm text" data-act="ticket-view" data-id="' + task.id + '">打开工单</button>' +
      '<button class="btn sm text" data-act="snooze" data-id="' + att.id + '">稍后提醒</button></div></div>' +
      '<div class="panel"><div class="panel-h"><b>' + esc(att.question) + '</b><span class="spacer"></span>' +
      '<span class="tag ' + kind[1] + ' sm">' + kind[0] + "</span></div>" +
      '<div class="hint" style="margin-bottom:14px">' + esc(att.detail || "") + "</div>" + acts + "</div>" +
      (att.kind === "approval"
        ? '<div class="panel"><div class="panel-h"><b>批准范围</b><span class="sub">这次批准只对本次调用生效；本会话允许会在本会话内放行同类工具</span></div>' +
          '<dl class="dl"><dt>工具</dt><dd><code class="inline">shell.exec</code> · <code class="inline">fs.write</code></dd>' +
          '<dt>工作目录</dt><dd><code class="inline">/data/workspaces/business-expert</code></dd>' +
          '<dt>影响</dt><dd>写 1 个文件、运行测试；不提交、不推送</dd>' +
          '<dt>记得</dt><dd>决策会写入审计，可在工单里回看</dd></dl></div>' : "") +
      '<div class="panel"><div class="panel-h"><b>任务上下文</b><span class="sub">最近 6 条</span></div>' +
      '<div class="timeline">' + (task.timeline || []).slice(-6).map(([time, k, txt, tone2]) =>
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
    return '<div class="page-head"><div><div class="page-title">' + esc(title) + "</div>" +
      '<div class="page-sub">' + esc(sub) + "</div></div><div class=\"spacer\"></div>" + (actions || "") + "</div>";
  }

  function innerTabs(items, group, current) {
    return '<div class="tabs" style="margin:14px -24px 0;padding:0 24px">' + items.map(([value, label]) =>
      '<button class="tab ' + (current === value ? "active" : "") + '" data-act="subtab" data-group="' + group + '" data-value="' + value + '">' + label + "</button>").join("") + "</div>";
  }

  function toggle(on, key, scope) {
    return '<button class="switch ' + (on ? "on" : "") + '" data-act="toggle-switch"' +
      (key ? ' data-key="' + key + '"' : "") + (scope ? ' data-scope="' + scope + '"' : "") +
      ' role="switch" aria-checked="' + (on ? "true" : "false") + '" aria-label="' +
      (key ? esc(key) : "开关") + '"></button>';
  }

  function renderPersonalization() {
    const mod = state.persTab || "skills";
    const MODS = [["skills", "技能", "puzzle"], ["subagents", "子智能体", "bot"], ["tools", "工具", "terminal"],
      ["plugins", "插件", "package"], ["mbti", "MBTI", "spark"], ["memory", "记忆", "database"], ["channels", "通道", "globe"]];
    const modLabel = (MODS.find((m) => m[0] === mod) || MODS[0])[1];
    const on = (name, def) => (state.persToggles && state.persToggles[name] != null ? state.persToggles[name] : def);
    const SKILLS = [
      ["weather", "天气查询", "内置 · 已启用", "查询全球城市天气与未来预报，在聊天中展示天气卡片", true, "blue", "cloud"],
      ["github-trending", "GitHub 趋势", "工作区 · 只读网络", "按语言与时间范围查看 GitHub 新增仓库排行", true, "violet", "git-branch"],
      ["qrcode", "二维码生成", "内置 · 无外部权限", "把文本或链接生成二维码卡片，适合分享入口", false, "teal", "grid"],
      ["pdf-tools", "PDF 编辑", "插件 · 文件", "用自然语言修改 PDF 中的文字与标题，保留版式", true, "amber", "file"],
      ["sheet-ops", "表格处理", "插件 · 文件", "读写 xlsx / csv，做透视、图表与公式补全", true, "green", "chart"],
      ["kb-search", "知识库检索", "内置 · 只读", "在已选知识库内做混合检索并返回引用", true, "blue", "book"],
    ];
    const SUBAGENTS = (state.personalSubagents || []).map((s) => [s.name, s.desc, s.status, "violet"]);
    const TOOL_GROUPS = [
      ["文件与终端", [["ls", "列出目录", true], ["read_file", "读取文件", true], ["write_file", "写入文件", true], ["edit_file", "编辑文件", true], ["grep", "搜索内容", true], ["execute", "执行命令", false]]],
      ["规划与子智能体", [["write_todos", "编写计划", true], ["task", "子智能体任务", true]]],
      ["用户交互", [["ask_user_question", "向用户提问", true]]],
      ["网页与浏览器", [["web_fetch", "抓取网页", true], ["browser_use", "使用浏览器", false], ["web_search", "联网搜索", true]]],
      ["记忆", [["memory_search", "检索记忆", true], ["memory_save", "保存记忆", true]]],
    ];
    const PLUGIN_ROWS = [["weather-card", "天气卡片", "UI 插件 · 网络", "0.2.2", true], ["demo-card", "交互卡片示例", "UI 插件 · 工作区", "0.1.0", false],
      ["calendar-sync", "日历同步", "工具插件 · 网络", "1.2.0", true], ["notion-export", "Notion 导出", "工具插件 · 网络", "0.9.0", false]];
    const tile = (iconName, colorCls, title, meta, desc, foot) => '<div class="tile">' +
      '<div class="tile-head"><span class="tile-icon ' + colorCls + '">' + icon(iconName, "ic-sm") + "</span><b>" + esc(title) + "</b></div>" +
      '<div class="tile-meta">' + meta + "</div><p class=\"tile-desc\">" + esc(desc) + "</p>" +
      '<div class="tile-foot">' + foot + "</div></div>";
    let body = "";
    if (mod === "skills") {
      const sub = state.persSkillTab || "installed";
      const subs = [["installed", "已安装技能", SKILLS.length], ["builtin", "内置技能", 24], ["market", "技能市场", SKILL_MARKET.length], ["packages", "技能包", SKILL_PACKAGES.length]];
      const subTabs = '<div class="tabs">' + subs.map(([id, label, n]) =>
        '<button class="tab ' + (sub === id ? "active" : "") + '" data-act="subtab" data-group="persSkillTab" data-value="' + id + '">' + label + " <span class=\"count\">" + n + "</span></button>").join("") + "</div>";
      if (sub === "market") {
        const COLS = [["为你推荐", SKILL_MARKET.slice(0, 4)], ["近期飙升", SKILL_MARKET.slice(4, 8)], ["下载热榜", SKILL_MARKET.slice(8, 12)], ["最近上新", SKILL_MARKET.slice(12)]];
        body = subTabs + '<div class="market-bar"><div class="search" style="width:340px">' + icon("search", "ic-sm") +
          '<input placeholder="搜索技能名称、描述或分类" /></div>' +
          '<button class="btn sm text" data-act="refresh">SkillHub 市场</button><button class="btn sm" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button></div>" +
          '<div class="market-4col">' + COLS.map(([title, items]) => '<div class="market-col"><div class="market-col-h">' + title + "</div>" +
            items.map(([name, desc, installs]) => '<div class="market-row"><div class="market-row-main"><b>' + esc(name) + '</b>' +
              '<div class="hint">' + esc(desc) + '</div><div class="market-row-meta">' + icon("download", "ic-xs") + " " + esc(installs) + "</div></div>" +
              '<button class="btn sm primary" data-act="skill-install" data-name="' + esc(name) + '">安装</button></div>').join("") +
            "</div>").join("") + "</div>";
      } else if (sub === "packages") {
        body = subTabs + '<div class="tile-grid">' + SKILL_PACKAGES.map((p) =>
          tile("package", "violet", p.name, '<span class="tag sm">' + p.skills.length + " 个技能</span>" +
            (p.shared ? '<span class="tag brand sm">已共享</span>' : ""), p.desc || "暂无描述",
            '<button class="btn sm text" data-act="nav" data-route="skills">管理</button><span class="spacer"></span>' +
            (p.shared ? '<span class="hint">已共享给同实例</span>' : ""))).join("") +
          '<div class="tile tile-new" data-act="nav" data-route="skills"><div class="empty" style="padding:18px"><div class="glyph">' +
          icon("plus") + "</div><b>创建技能包</b></div></div></div>";
      } else {
        body = subTabs + '<div class="filter-row" style="margin-top:12px"><span class="hint">共 ' + (sub === "builtin" ? 24 : SKILLS.length) + " 个技能</span>" +
          '<span class="spacer"></span><div class="search" style="width:220px">' + icon("search", "ic-sm") + '<input placeholder="搜索技能名称、描述" /></div>' +
          '<div class="seg-text view"><button class="seg active">' + icon("grid", "ic-xs") + '卡片</button><button class="seg">' + icon("file", "ic-xs") + "表格</button></div>" +
          '<button class="btn" data-act="refresh">' + icon("download", "ic-sm") + "导出技能</button>" +
          '<button class="btn" data-act="refresh">' + icon("upload", "ic-sm") + "导入技能</button>" +
          '<button class="btn primary" data-act="refresh">' + icon("plus", "ic-sm") + "创建技能</button></div>" +
          '<div class="tile-grid">' + SKILLS.map(([key, name, meta, desc, def, color, ic]) => tile(ic, color, name,
            '<span class="tag sm">' + (meta.includes("内置") ? "内置" : "插件") + "</span><span class=\"tag " + (on(key, def) ? "green" : "") + ' sm">' + (on(key, def) ? "已启用" : "已禁用") + "</span>",
            desc, '<button class="btn sm text" data-act="refresh">查看详情</button><span class="spacer"></span>' + toggle(on(key, def), key, "pers"))).join("") + "</div>";
      }
    } else if (mod === "subagents") {
      body = '<div class="filter-row" style="margin-top:12px"><div class="search" style="width:260px">' + icon("search", "ic-sm") + '<input placeholder="搜索子智能体" /></div>' +
        '<div class="market-cats">' + ["全部", "检索", "写作", "数据", "运维"].map((c, i) => '<button class="chip ' + (i === 0 ? "on" : "") + '">' + c + "</button>").join("") + "</div></div>" +
        '<div class="tile-grid">' + SUBAGENTS.map(([name, desc, status, color]) =>
          tile("bot", color, name, '<span class="tag ' + (status === "运行中" ? "green" : "") + ' sm">' + esc(status) + "</span>", desc,
            '<button class="btn sm text" data-act="subagent-edit" data-name="' + esc(name) + '">编辑</button><span class="spacer"></span>' +
            '<button class="btn sm" data-act="subagent-skills" data-name="' + esc(name) + '">查看技能</button>')).join("") +
        '<div class="tile tile-new" data-act="subagent-new"><div class="empty" style="padding:18px"><div class="glyph">' + icon("plus") + "</div><b>新建子智能体</b></div></div></div>";
    } else if (mod === "tools") {
      body = TOOL_GROUPS.map(([group, items]) => '<div class="tool-group"><div class="tool-group-h">' + esc(group) + "</div><div class=\"tool-grid\">" +
        items.map(([key, label, def]) => '<div class="tool-card"><div class="tool-main"><b>' + esc(label) + '</b><span class="mono hint">' + esc(key) + "</span></div>" +
          toggle(on(key, def), key, "pers") + "</div>").join("") + "</div></div>").join("");
    } else if (mod === "plugins") {
      body = '<div class="tile-grid">' + PLUGIN_ROWS.map(([key, name, meta, ver, def]) =>
        tile("package", "amber", name, '<span class="tag sm">v' + ver + "</span><span class=\"hint\">" + meta + "</span>",
          "安装后可在个性化里按专家启用，权限按插件声明生效。",
          '<button class="btn sm text" data-act="nav" data-route="extensions">插件市场</button><span class="spacer"></span>' + toggle(on(key, def), key, "pers"))).join("") + "</div>";
    } else if (mod === "mbti") {
      const TYPES = [["INTJ 建筑师", "富有想象力的战略家", [["内向 I", 78], ["直觉 N", 82], ["思考 T", 75], ["判断 J", 72]]],
        ["ENFP 竞选者", "热情、有创造力的自由灵魂", [["外向 E", 76], ["直觉 N", 80], ["情感 F", 68], ["感知 P", 74]]],
        ["ISTJ 物流师", "务实、注重事实的可靠执行者", [["内向 I", 72], ["实感 S", 78], ["思考 T", 74], ["判断 J", 80]]],
        ["ENTP 辩论家", "聪明、好奇，喜欢智力挑战", [["外向 E", 74], ["直觉 N", 82], ["思考 T", 68], ["感知 P", 78]]]];
      body = '<div class="row" style="margin-top:14px"><div><b>当前人格：' + esc(state.mbti || "INTJ 建筑师") + '</b>' +
        '<div class="hint">影响表达风格与决策偏好，不改能力。</div></div><span class="spacer"></span>' +
        '<button class="btn primary" data-act="mbti-retest">' + icon("spark", "ic-sm") + "测一测</button></div>" +
        '<div class="mbti-grid">' + TYPES.map(([name, tagline, dims]) =>
          '<div class="mbti-card' + (state.mbti === name ? " active" : "") + '" data-act="mbti-set" data-value="' + esc(name) + '">' +
          "<b>" + esc(name) + "</b><div class=\"hint\">" + esc(tagline) + "</div><div class=\"mbti-dims\">" +
          dims.map(([d, v]) => '<div class="mbti-dim"><span>' + esc(d) + "</span><i><em style=\"width:" + v + '%"></em></i><b>' + v + "%</b></div>").join("") +
          "</div></div>").join("") + "</div>";
    } else if (mod === "memory") {
      body = '<div class="kpi-strip four" style="margin-top:14px">' +
        [["长期记忆", "1,204"], ["待确认草稿", "36"], ["记忆主题", "7"], ["最近写入", "2 分钟前"]].map(([l, v]) =>
          '<div class="kpi-cell"><span>' + l + "</span><b>" + v + "</b></div>").join("") + "</div>" +
        '<div class="card" style="margin-top:14px"><div class="card-h"><b class="card-title">记忆流水线</b><span class="card-sub">最近一轮对话的沉淀结果</span></div>' +
        '<div class="card-b">' + [["对话 1 轮", "已采集"], ["提炼原子", "3 条"], ["待你确认", "1 条"], ["写入长期记忆", "2 条"]].map(([k, v], i) =>
          '<div class="pipeline-step"><span class="dot ' + (i === 3 ? "green" : "blue") + '"></span><b>' + k + '</b><span class="spacer"></span><span class="hint">' + v + "</span></div>").join("") +
        "</div></div>" +
        '<div class="card" style="margin-top:14px"><div class="card-h"><b class="card-title">最近记忆</b><span class="spacer"></span>' +
        '<button class="btn sm" data-act="memory-view">查看全部</button></div><div class="card-b">' +
        [["用户偏好用 camelCase", "事实 · 置信 0.91", "今天 10:12"], ["发布窗口每周三 14:00–17:00", "事实 · 置信 0.88", "周一 09:20"], ["review 时先跑 smoke 再切流量", "偏好 · 置信 0.83", "上周"]].map(([t, m, at]) =>
          '<div class="setting-row"><div class="label"><b>' + esc(t) + '</b><span>' + esc(m) + '</span></div><span class="hint">' + esc(at) + "</span></div>").join("") +
        '<div class="row" style="margin-top:12px"><span class="hint">删除低置信度或过期记忆会写审计</span><span class="spacer"></span>' +
        '<button class="btn sm danger" data-act="memory-clear">清理低置信度</button></div></div></div>';
    } else {
      body = '<div class="tile-grid">' + [["控制台", "dashboard", "已连接", true], ["飞书", "feishu", "已连接", true], ["企业微信", "wecom", "已连接", true],
        ["QQ", "qq", "未连接", false], ["钉钉", "dingtalk", "未连接", false], ["Discord", "discord", "已连接", true]].map(([name, id, status, connected]) =>
        tile("globe", connected ? "blue" : "teal", name, '<span class="tag ' + (connected ? "green" : "") + ' sm">' + status + "</span>",
          "在对话中按需使用该通道；绑定与凭据在「通道」页面配置。",
          '<button class="btn sm text" data-act="nav" data-route="channels">去配置</button><span class="spacer"></span>' +
          '<span class="hint mono">' + id + "</span>")).join("") + "</div>";
    }
    return '<div class="main"><div class="page">' +
      '<div class="page-head"><div><div class="page-title">个性化 / ' + modLabel + '</div>' +
      '<div class="page-sub">配置当前专家的技能、工具、插件、子智能体、通道、人格与记忆</div></div>' +
      '<div class="page-actions">' + MODS.map(([id, label, ic]) =>
        '<button class="btn sm ' + (mod === id ? "primary" : "") + '" data-act="subtab" data-group="persTab" data-value="' + id + '">' + icon(ic, "ic-xs") + label + "</button>").join("") + "</div></div>" +
      '<div class="filter-row" style="margin-top:12px"><span class="expert-chip">专家<span class="dot green"></span>业务专家' + icon("chev", "ic-xs") + "</span></div>" +
      body + "</div></div>";
  }

  function renderChannels() {
    const list = state.channels;
    const onCount = list.filter((c) => c.required || c.on).length;
    const card = (c) => {
      const on = c.required || c.on;
      return '<div class="channel-card' + (on ? " on" : "") + '"><div class="channel-top">' +
        '<span class="channel-ic tone-' + (c.tone || "blue") + '">' + icon(c.icon || "chat", "ic-sm") + "</span>" +
        "<b>" + esc(c.name) + '</b><span class="spacer"></span>' +
        (c.required ? '<span class="tag sm">必开</span>' : toggle(on, c.id, "channel")) + "</div>" +
        '<div class="channel-desc">' + esc(c.desc || "") + "</div>" +
        '<div class="channel-foot">' + (on ? '<span class="tag green sm">已启用</span>' : '<span class="tag sm">未启用</span>') +
        '<span class="spacer"></span>' +
        (c.status === "已连接" ? '<button class="btn sm text" data-act="channel-check" data-id="' + c.id + '">检测</button>' : "") +
        '<button class="btn sm" data-act="channel-open" data-id="' + c.id + '">' + (on ? "配置" : "去配置") + "</button></div></div>";
    };
    return '<div class="main"><div class="page">' +
      '<div class="page-head"><div><div class="page-title">通道</div>' +
      '<div class="page-sub">管理 IM 渠道与 Webhook 接入，让专家在外部会话中回复</div></div>' +
      '<div class="page-actions"><button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>" +
      '<button class="btn primary" data-act="channel-open" data-id="wechat">' + icon("plus", "ic-sm") + "新建通道</button></div></div>" +
      '<div class="kb-count">当前支持 ' + list.length + " 个通道，已配置 " + onCount + " 个</div>" +
      '<div class="channel-grid">' + list.map(card).join("") + "</div>" +
      '<div class="channel-more"><button class="btn sm text" data-act="refresh">更多通道（2）</button></div>' +
      '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "控制台通道由系统保持启用；关闭其他通道只停止收发，不删除配置。</div></div></div>";
  }

  function channelCfgOf(id) {
    if (!state.channelCfg) state.channelCfg = {};
    if (!state.channelCfg[id]) state.channelCfg[id] = { reply: "final", thinking: false, tools: false };
    return state.channelCfg[id];
  }

  function renderChannelDrawer() {
    const c = state.channels.find((x) => x.id === state.channelDrawer) || state.channels[0];
    if (!c) return "";
    const cfg = channelCfgOf(c.id);
    const isWechatLike = c.id !== "dashboard";
    return '<div class="drawer-mask" data-act="channel-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="新建通道">' +
      '<div class="drawer-h"><b>' + (c.status === "已连接" ? "配置通道 · " + esc(c.name) : "新建通道 · " + esc(c.name)) + "</b>" +
      '<span class="spacer"></span><button class="icon-btn" data-act="channel-close">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      (isWechatLike
        ? '<div class="qr-steps"><span class="on">1 打开 ' + esc(c.name) + "</span><span>2 扫码登录</span><span>3 手机确认</span></div>" +
          '<div class="qr-box"><div class="qr-fake"><i></i><i></i><i></i></div>' +
          '<div class="hint">使用 ' + esc(c.name) + " 扫码登录个人账号</div>" +
          '<button class="btn sm text" data-act="channel-qr">重新生成</button></div>'
        : '<div class="alert info" style="margin-bottom:12px">' + icon("info", "ic-sm") + "控制台通道由系统内置，无需扫码或凭据。</div>") +
      '<div class="form-section"><div class="form-section-h">通道设置</div>' +
      '<div class="setting-row"><div class="label"><b>启用频道</b><span>关闭后停止收发，不删除配置</span></div>' + toggle(c.required || c.on, "enabled", "channelCfg") + "</div>" +
      '<div class="setting-row"><div class="label"><b>回复方式</b><span>实时过程会边生成边发送</span></div>' +
      '<div class="row"><button class="chip ' + (cfg.reply !== "realtime" ? "on" : "") + '" data-act="channel-reply" data-value="final">仅最终回复</button>' +
      '<button class="chip ' + (cfg.reply === "realtime" ? "on" : "") + '" data-act="channel-reply" data-value="realtime">实时过程</button></div></div>' +
      '<div class="setting-row"><div class="label"><b>显示思考过程</b><span>在通道里展示模型的思考片段</span></div>' + toggle(cfg.thinking, "thinking", "channelCfg") + "</div>" +
      '<div class="setting-row"><div class="label"><b>显示工具调用提示</b><span>工具开始或结束时发一条提示</span></div>' + toggle(cfg.tools, "tools", "channelCfg") + "</div>" +
      "</div></div>" +
      '<div class="drawer-f"><button class="btn" data-act="channel-close">取消</button>' +
      '<button class="btn primary" data-act="channel-save">保存</button></div></aside>';
  }

  function renderSkills() {
    if (!state.skillPkg) state.skillPkg = SKILL_PACKAGES[0].id;
    const cur = SKILL_PACKAGES.find((p) => p.id === state.skillPkg) || SKILL_PACKAGES[0];
    const META = {
      weather: ["天气查询", "查询全球城市天气与未来预报，在聊天中展示天气卡片", "cloud"],
      "github-trending": ["GitHub 趋势", "按语言与时间范围查看 GitHub 新增仓库排行", "git-branch"],
      qrcode: ["二维码生成", "把文本或链接生成二维码卡片", "grid"],
      "web-search": ["联网搜索", "检索公开网页并总结要点", "globe"],
    };
    const rows = cur.skills.map((k) => {
      const c = (state.skillMeta || {})[k];
      const m = c ? [c.name, c.desc, c.ic || "spark"] : (META[k] || [k, "来自技能包的技能", "puzzle"]);
      return { key: k, name: m[0], desc: m[1], ic: m[2], emoji: c ? c.emoji : "", on: state.skillToggle[k] == null ? true : state.skillToggle[k] };
    });
    const pkgCard = (p) => '<div class="kb-item ' + (p.id === cur.id ? "active" : "") + '" data-act="skillpkg-select" data-id="' + p.id + '">' +
      '<div class="kb-item-top"><span class="kb-item-ic">' + icon(p.icon || "package", "ic-sm") + "</span><b>" + esc(p.name) + "</b>" +
      '<span class="spacer"></span>' + (p.shared ? '<span class="tag brand sm">已共享</span>' : "") +
      '<button class="icon-btn" data-act="skillpkg-menu" data-id="' + p.id + '">' + icon("more", "ic-sm") + "</button></div>" +
      '<div class="kb-item-desc">' + esc(p.desc || "暂无描述") + "</div>" +
      '<div class="kb-item-foot"><span>创建者：' + esc(p.owner) + "</span><span>" + p.skills.length + " 个技能</span></div></div>";
    const card = (s) => '<div class="tile"><div class="tile-head"><span class="tile-icon ' + (s.on ? "blue" : "teal") + '">' +
      (s.emoji ? '<span style="font-size:15px;line-height:1">' + s.emoji + "</span>" : icon(s.ic, "ic-sm")) + "</span><b>" + esc(s.name) + "</b></div>" +
      '<div class="tile-meta"><span class="tag sm">技能包</span><span class="tag ' + (s.on ? "green" : "") + ' sm">' + (s.on ? "已启用" : "已禁用") + "</span></div>" +
      '<p class="tile-desc">' + esc(s.desc) + "</p>" +
      '<div class="tile-foot"><button class="btn sm text" data-act="refresh">查看详情</button><span class="spacer"></span>' +
      toggle(s.on, s.key, "skill") + "</div></div>";
    return '<div class="main"><div class="page">' +
      '<div class="page-head"><div><div class="page-title">技能包</div>' +
      '<div class="page-sub">创建和维护可复用的技能包，添加技能后挂载到专家</div></div>' +
      '<div class="page-actions"><button class="btn" data-act="skill-import">' + icon("upload", "ic-sm") + "导入技能</button>" +
      '<button class="btn primary" data-act="skillpkg-create">' + icon("plus", "ic-sm") + "创建技能包</button></div></div>" +
      '<div class="kb-layout"><aside class="kb-col"><div class="kb-col-head"><b>技能包</b><span class="spacer"></span>' +
      '<button class="icon-btn" data-act="refresh">' + icon("refresh", "ic-sm") + "</button></div>" +
      '<button class="btn primary block" data-act="skillpkg-create">' + icon("plus", "ic-sm") + "创建技能包</button>" +
      '<div class="kb-list">' + SKILL_PACKAGES.map(pkgCard).join("") + "</div></aside>" +
      '<section class="kb-panel"><div class="kb-panel-head"><div class="kb-panel-title">' + icon("package", "ic-sm") + "<b>" + esc(cur.name) + '</b><span class="hint">共 ' + rows.length + " 个技能</span></div>" +
      '<span class="spacer"></span>' +
      '<div class="seg-text view"><button class="seg active">' + icon("grid", "ic-xs") + '卡片</button><button class="seg">' + icon("file", "ic-xs") + "表格</button></div>" +
      '<button class="icon-btn" data-act="refresh">' + icon("refresh", "ic-sm") + "</button>" +
      '<button class="btn sm" data-act="skill-export-zip">' + icon("download", "ic-sm") + "导出 ZIP</button>" +
      '<button class="btn sm" data-act="skillpkg-market">' + icon("grid", "ic-sm") + "技能市场</button>" +
      '<button class="btn sm" data-act="skill-import">' + icon("upload", "ic-sm") + "导入技能</button>" +
      '<button class="btn primary sm" data-act="skill-add">' + icon("plus", "ic-sm") + "添加技能</button></div>" +
      '<div class="kb-panel-body"><div class="tile-grid">' +
      (rows.length ? rows.map(card).join("")
        : '<div class="empty" style="grid-column:1/-1"><div class="glyph">' + icon("package") + "</div><b>这个技能包还没有技能</b>" +
          '<p>从技能市场添加，或导入一个 SKILL.md。</p><button class="btn primary" data-act="skill-add">添加技能</button></div>') +
      "</div></div></section></div></div></div>";
  }

  const SKILL_ICONS = ["book", "spark", "grid", "shield", "package", "terminal", "bot", "chart", "database", "globe", "puzzle", "users"];
  const SKILL_EMOJIS = ["📦", "🔍", "🛠️", "📊", "🧠", "🌐", "📝", "⚡"];

  function skillPkgDraft() {
    if (!state.skillPkgDraft) state.skillPkgDraft = { name: "", desc: "", icon: "package", policy: "copy", allowDownload: true, share: "self" };
    return state.skillPkgDraft;
  }

  function skillDraft() {
    if (!state.skillDraft) state.skillDraft = { name: "", desc: "", display: "", short: "", emoji: "📦", content: "# My skill\n\n请在此说明这个技能的用途以及如何使用它。专家在选择当前轮次的技能时会读取这段 Markdown，所以请写得清晰、可执行。", mode: "form" };
    return state.skillDraft;
  }

  function renderSkillPkgDrawer() {
    const d = skillPkgDraft();
    return '<div class="drawer-mask" data-act="skillpkg-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="创建技能包">' +
      '<div class="drawer-h"><b>创建技能包</b><span class="spacer"></span><button class="icon-btn" data-act="skillpkg-close">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      '<div class="hint" style="margin-bottom:12px">技能包把一组可复用的技能收在一起。创建后可添加技能，并在专家上挂载使用；需要时再开启共享给其他用户。</div>' +
      '<div class="form-section"><div class="form-section-h">头像</div>' +
      '<div class="kb-icon-grid">' + SKILL_ICONS.map((i) =>
        '<button class="kb-icon ' + (d.icon === i ? "active" : "") + '" data-act="spd-icon" data-value="' + i + '">' + icon(i, "ic-sm") + "</button>").join("") + "</div></div>" +
      '<div class="dfield"><label><i>*</i>技能包名称</label><input class="input" data-input="spd-name" value="' + esc(d.name) + '" placeholder="例如：调研工具包" /></div>' +
      '<div class="dfield"><label>描述</label><textarea class="input" rows="2" data-input="spd-desc" placeholder="可选，简要说明该技能包的用途">' + esc(d.desc) + "</textarea>" +
      '<div class="row" style="justify-content:flex-end;margin-top:4px"><button class="btn sm text" data-act="spd-ai">' + icon("spark", "ic-xs") + "AI 润色</button></div></div>" +
      '<div class="dfield"><label>复制策略</label><div class="row" style="gap:8px"><button class="chip ' + (d.policy === "copy" ? "on" : "") + '" data-act="spd-policy" data-value="copy">可复制</button>' +
      '<button class="chip ' + (d.policy === "readonly" ? "on" : "") + '" data-act="spd-policy" data-value="readonly">可复制（控制台只读）</button>' +
      '<button class="chip ' + (d.policy === "none" ? "on" : "") + '" data-act="spd-policy" data-value="none">禁止复制</button></div></div>' +
      '<div class="setting-row"><div class="label"><b>允许下载</b><span>开启后可导出 ZIP 分享给其他人</span></div>' + toggle(d.allowDownload, "allowDownload", "spd") + "</div>" +
      '<div class="setting-row"><div class="label"><b>谁可以使用</b><span>仅自己时不出现在其他人列表里</span></div>' +
      '<div class="row"><button class="chip ' + (d.share === "self" ? "on" : "") + '" data-act="spd-share" data-value="self">仅自己</button>' +
      '<button class="chip ' + (d.share === "all" ? "on" : "") + '" data-act="spd-share" data-value="all">所有人</button></div></div>' +
      "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="skillpkg-close">取消</button>' +
      '<button class="btn primary" data-act="skillpkg-save">创建</button></div></aside>';
  }

  function renderSkillCreateDrawer() {
    const d = skillDraft();
    return '<div class="drawer-mask" data-act="skill-create-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="创建技能">' +
      '<div class="drawer-h"><b>创建技能</b><span class="spacer"></span>' +
      '<div class="seg-text view" style="margin-right:8px"><button class="seg ' + (d.mode !== "source" ? "active" : "") + '" data-act="skd-mode" data-value="form">表单</button>' +
      '<button class="seg ' + (d.mode === "source" ? "active" : "") + '" data-act="skd-mode" data-value="source">源码</button></div>' +
      '<button class="icon-btn" data-act="skill-create-close">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      (d.mode === "source"
        ? '<div class="dfield"><label><i>*</i>SKILL.md 源码</label><textarea class="input mono" rows="18" data-input="skd-content">' + esc(d.content) + "</textarea>" +
          '<div class="hint">包含 YAML frontmatter（name / description）与正文 Markdown。</div></div>'
        : '<div class="dfield"><label><i>*</i>名称</label><input class="input" data-input="skd-name" value="' + esc(d.name) + '" placeholder="例如：天气查询 / weather-query" /></div>' +
          '<div class="dfield"><label><i>*</i>描述</label><textarea class="input" rows="2" data-input="skd-desc" placeholder="简要描述这个技能在何种情境下会被使用">' + esc(d.desc) + "</textarea>" +
          '<div class="row" style="justify-content:flex-end;margin-top:4px"><button class="btn sm text" data-act="skd-ai">' + icon("spark", "ic-xs") + "AI 润色</button></div></div>" +
          '<div class="form-section"><div class="form-section-h">界面展示</div>' +
          '<div class="hint" style="margin:-4px 0 8px">按界面语言分别填写，未填时回退到技能名称与描述。</div>' +
          '<div class="dfield"><label>展示名称</label><input class="input" data-input="skd-display" value="' + esc(d.display) + '" placeholder="界面为中文时显示的名称" /></div>' +
          '<div class="dfield"><label>简短描述</label><input class="input" data-input="skd-short" value="' + esc(d.short) + '" placeholder="用于技能卡片的中文简短描述" /></div>' +
          "</div>" +
          '<div class="dfield"><label>Emoji</label><div class="row" style="flex-wrap:wrap;gap:6px">' +
          SKILL_EMOJIS.map((e) => '<button class="emoji-pick ' + (d.emoji === e ? "active" : "") + '" data-act="skd-emoji" data-value="' + e + '">' + e + "</button>").join("") + "</div>" +
          '<div class="hint">从列表中选择技能卡片图标。</div></div>' +
          '<div class="dfield"><div class="row"><label style="margin:0">Metadata</label><span class="spacer"></span>' +
          '<button class="btn sm text" data-act="skd-meta">+ 添加字段</button></div></div>' +
          '<div class="dfield"><label><i>*</i>技能实现内容</label><textarea class="input mono" rows="10" data-input="skd-content">' + esc(d.content) + "</textarea></div>") +
      "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="skill-create-close">取消</button>' +
      '<button class="btn primary" data-act="skill-create-save">创建</button></div></aside>';
  }

  function renderBridge() {
    const connected = state.bridgeConnected !== false;
    if (!connected) {
      return '<div class="main"><div class="page">' +
        cfgHead("云端协同", "连接另一台 Octop，在本机浏览器对端专家并跨实例对话",
          '<button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>" +
          '<button class="btn primary" data-act="bridge-add">' + icon("plus", "ic-sm") + "添加连接</button>") +
        '<div class="conn-empty" style="margin-top:24px"><div class="conn-mascot">' + icon("cloud") + "</div>" +
        "<b>暂无云端协同</b><p>把本机连接到另一台 Octop，就能在这边使用对端的专家和团队。</p>" +
        '<div class="conn-steps">' +
        [["云端协同是什么", "一条连接把本机 Octop 接到另一台实例。可以浏览对端专家和团队，并在本机发起对话；对话记录留在专家所在的那一侧。"],
          ["怎么添加", "点「添加连接」，填写对端地址、账号和密码。建议先「探测」确认账号可达；保存并连接。请从能访问对端的一侧发起。"],
          ["怎么聊天", "连接成功后，对端专家和团队会出现在聊天页的「云端」里。专家页签也会带上云端专家，团队页签会带上云端团队。"]].map(([t, d], i) =>
          '<div class="conn-step"><span class="conn-step-n">' + (i + 1) + "</span><div><b>" + t + "</b><p>" + d + "</p></div></div>").join("") +
        "</div>" +
        '<button class="btn primary" data-act="bridge-add">' + icon("plus", "ic-sm") + "添加连接</button></div></div></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("云端协同", "连接另一台 Octop，在本机浏览器对端专家并跨实例对话",
        '<button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>" +
        '<button class="btn primary" data-act="bridge-add">' + icon("plus", "ic-sm") + "添加连接</button>") +
      '<div class="card" style="margin-top:16px"><div class="card-b"><div class="row">' +
      '<span class="avatar blue">' + esc("公司云端"[0]) + "</span><div><div class=\"row\"><b>公司云端</b><span class=\"tag green sm\">已连接</span></div>" +
      '<div class="hint">https://octop.example.com · 对端账号 admin · 6 个专家 / 2 个团队</div></div>' +
      '<span class="spacer"></span><button class="btn sm" data-act="bridge-reconnect">重新连接</button>' +
      '<button class="btn sm text" data-act="bridge-edit">编辑</button>' +
      '<button class="btn sm danger" data-act="bridge-disconnect">断开</button></div>' +
      '<div class="divider"></div><div class="row"><span class="hint">自动重连已开启 · 最近握手 10:02</span><span class="spacer"></span>' +
      '<button class="btn sm" data-act="bridge-peers">浏览对端专家</button></div></div></div>' +
      '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "对话记录保留在专家所在侧；本侧只保存连接与展示信息。</div></div></div>";
  }

  function renderBridgeDrawer() {
    const d = state.bridgeDraft || { name: "", desc: "", url: "", account: "admin", password: "", share: "self" };
    const f = (label, key, type, hint) => '<div class="dfield"><label>' + label + "</label>" +
      '<input class="input" data-input="bridge-' + key + '" type="' + (type || "text") + '" value="' + esc(d[key] || "") + '" />' +
      (hint ? '<div class="hint">' + hint + "</div>" : "") + "</div>";
    return '<div class="drawer-mask" data-act="bridge-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="添加连接">' +
      '<div class="drawer-h"><b>添加连接</b><span class="spacer"></span><button class="icon-btn" data-act="bridge-close">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      '<div class="alert info" style="margin-bottom:8px">显示名用于聊天页分组切换。建议先「探测」确认账号可达；「保存并连接」仅在登录与云端协协商都成功后才会落库。</div>' +
      '<div class="alert info" style="margin-bottom:8px">请从能访问到对端的一侧发起。通常由内网或本机去连公网 / 云端，探测成功只说明账号可用。</div>' +
      '<div class="alert info" style="margin-bottom:12px">每位用户最多 10 条连接；同一对端地址 + 对端账号只能添加一次，也不能连本机。</div>' +
      '<div class="form-section"><div class="form-section-h">显示信息</div>' +
      '<div class="dfield"><label>头像</label><div class="row" style="gap:8px">' +
      '<button class="btn sm">' + icon("upload", "ic-xs") + "上传</button>" +
      '<span class="hint">可选 PNG、JPEG、WebP 或 GIF，不超过 5 MB。未设置时沿用配色圆标。</span></div>' +
      '<div class="kb-icon-grid" style="margin-top:8px;grid-template-columns:repeat(8,1fr)">' +
      ["cloud", "globe", "terminal", "monitor", "package", "users", "shield", "spark"].map((i) =>
        '<button class="kb-icon" data-act="refresh">' + icon(i, "ic-xs") + "</button>").join("") + "</div></div>" +
      f("显示名", "name", "text", "例如：公司云端") +
      '<div class="dfield"><label>描述</label><textarea class="input" rows="2" data-input="bridge-desc" placeholder="可选，只保存在本端，不会改到对端">' + esc(d.desc || "") + "</textarea>" +
      '<div class="row" style="justify-content:flex-end;margin-top:4px"><button class="btn sm text" data-act="bridge-ai">' + icon("spark", "ic-xs") + "AI 润色</button></div></div>" +
      "</div>" +
      '<div class="form-section"><div class="form-section-h">对端账号</div>' +
      f("对端地址", "url", "text", "例如 https://octop.example.com") +
      f("对端账号", "account") +
      f("密码", "password", "password") +
      '</div><div class="setting-row"><div class="label"><b>谁可以使用</b><span>仅自己时不出现在其他人列表里</span></div>' +
      '<div class="row"><button class="chip ' + (d.share !== "all" ? "on" : "") + '" data-act="bridge-share" data-value="self">仅自己</button>' +
      '<button class="chip ' + (d.share === "all" ? "on" : "") + '" data-act="bridge-share" data-value="all">所有人</button></div></div>' +
      "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="bridge-close">取消</button>' +
      '<button class="btn" data-act="bridge-detect">' + icon("search", "ic-sm") + "探测</button>" +
      '<button class="btn primary" data-act="bridge-save">保存并连接</button></div></aside>';
  }

  function renderACP() {
    const rows = state.acpRunners;
    if ((state.acpTab || "runners") === "permissions") {
      return '<div class="main"><div class="page">' +
        cfgHead("ACP · 权限", "外部 Runner 能力矩阵；Shell 与写操作仍需人工审批。") +
        '<div class="card" style="margin-top:16px"><table class="table"><thead><tr><th>Runner</th><th>安装</th><th>文件读取</th><th>文件写入</th><th>Shell</th><th>网络</th></tr></thead><tbody>' +
        rows.map((r) => "<tr><td><b>" + esc(r.name) + "</b></td><td>" + (r.status === "已安装" ? '<span class="tag green sm">已安装</span>' : '<span class="tag sm">未安装</span>') + "</td>" +
          (r.status === "已安装"
            ? '<td><span class="tag green sm">允许</span></td><td><span class="tag amber sm">需审批</span></td><td><span class="tag amber sm">需审批</span></td><td><span class="tag green sm">允许</span></td>'
            : '<td><span class="hint">—</span></td><td><span class="hint">—</span></td><td><span class="hint">—</span></td><td><span class="hint">—</span></td>') + "</tr>").join("") +
        "</tbody></table></div>" +
        '<div class="alert warn" style="margin-top:14px">' + icon("alert", "ic-sm") + "权限由安全防护的策略统一约束；修改后运行中的专家会在下次会话生效。</div></div></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("智能体协作", "连接支持 ACP 协议的外部编程专家，并按专家开启协作。",
        '<button class="btn primary" data-act="acp-new">' + icon("plus", "ic-sm") + "添加 Runner</button>") +
      '<div class="stat-strip">' +
      [["Runner", state.acpRunners.length, "外部 CLI"], ["已安装", state.acpRunners.filter((r) => r.status === "已安装").length, "检测通过"],
        ["已启用", state.acpRunners.filter((r) => r.on).length, "可被专家调用"], ["未安装", state.acpRunners.filter((r) => r.status !== "已安装").length, "需先安装 CLI"]].map(([l, v, note]) =>
        '<div class="stat-card"><span>' + l + '</span><b>' + v + '</b><span class="delta ' + (l === "未安装" && v ? "down" : "up") + '">' + esc(note) + "</span></div>").join("") +
      "</div>" +
      dataTable("acp", rows, [
        { key: "name", label: "Runner", sortable: true, render: (r) => "<b>" + esc(r.name) + "</b>" },
        { key: "cmd", label: "启动命令", render: (r) => '<span class="mono">' + esc(r.cmd) + "</span>" },
        { key: "status", label: "安装状态", sortable: true, render: (r) => '<span class="tag ' + (r.status === "已安装" ? "green" : "") + ' sm">' + esc(r.status) + "</span>" },
        { key: "on", label: "启用", render: (r) => toggle(r.on, r.id, "acp") },
        { key: "actions", label: "操作", align: "right", render: (r) =>
          '<button class="btn sm text" data-act="acp-config" data-id="' + r.id + '">配置</button>' +
          '<button class="btn sm" data-act="acp-detect" data-id="' + r.id + '">检测</button>' +
          '<button class="btn sm text danger" data-act="acp-delete" data-id="' + r.id + '">删除</button>' },
      ], {
        selectable: true, key: (r) => r.id, search: (r) => r.name + " " + r.cmd + " " + r.status,
        placeholder: "搜索 Runner 或命令", empty: "还没有 Runner",
        bulk: [{ label: "启用", value: "enable" }, { label: "停用", value: "disable" }],
      }) +
      '<div class="alert warn" style="margin-top:14px">' + icon("alert", "ic-sm") + "外部 Runner 需要在本机安装对应 CLI；未检测到可执行文件时无法启用。</div></div></div>";
  }

  function renderRemote() {
    const tab = state.remoteTab || "desktop";
    const viewLabel = tab === "phone" ? "手机画面" : "桌面画面";
    if (state.remoteConnected) {
      return '<div class="main"><div class="page">' +
        cfgHead("远程桌面", "查看并操控 LSH AI 主机" + (tab === "phone" ? "手机" : "桌面") + "，远程完成操作。",
          '<button class="btn danger" data-act="remote-disconnect">断开连接</button>') +
        '<div class="card" style="margin-top:16px"><div class="card-b"><div class="row"><span class="avatar green">' + icon("monitor", "ic-sm") + '</span><div><b>已连接 LSH AI 主机</b><div class="hint">' +
        (tab === "phone" ? "1080×2400 · 延迟 32ms · 触控已接管" : "1920×1080 · 延迟 28ms · 键鼠已接管") + '</div></div><span class="spacer"></span><span class="tag green sm">已连接</span></div>' +
        '<div class="empty" style="padding:80px;background:var(--surface-2);border-radius:8px;margin-top:14px"><div class="glyph">' + icon("monitor") + "</div><b>" + viewLabel + "</b><p>原型中不渲染真实画面；断开后可重新连接。</p></div></div></div></div></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("远程桌面", "查看并操控 LSH AI 主机" + (tab === "phone" ? "手机" : "桌面") + "，远程完成操作。",
        '<button class="btn primary" data-act="remote-connect">' + icon("monitor", "ic-sm") + "连接主机</button>") +
      '<div class="empty" style="margin-top:40px"><div class="glyph">' + icon("monitor") + "</div><b>尚未连接</b><p>连接后可在这里看到" + viewLabel + "、键鼠/触控与剪贴板同步。</p></div></div></div>";
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
      (pages > 1 ? '<div class="table-foot"><span class="hint">第 ' + t.page + " / " + pages + ' 页</span><span class="spacer"></span>' +
        '<select class="input" style="width:76px;height:28px" data-act="table-size" data-table="' + id + '">' +
        [6, 10, 20, 50].map((n) => '<option value="' + n + '"' + (t.size === n ? " selected" : "") + ">" + n + " / 页</option>").join("") + "</select>" +
        '<button class="btn sm" data-act="table-page" data-table="' + id + '" data-page="' + (t.page - 1) + '"' + (t.page <= 1 ? " disabled" : "") + ">上一页</button>" +
        '<button class="btn sm" data-act="table-page" data-table="' + id + '" data-page="' + (t.page + 1) + '"' + (t.page >= pages ? " disabled" : "") + ">下一页</button></div>" : "") +
      "</div>";
  }

  const SSO_KINDS = {
    feishu: {
      tab: "飞书登录", name: "飞书 / Lark", badge: "OAUTH",
      desc: "飞书开放平台网页登录。回调地址与 OpenID Connect 不同，请分别登记。",
      fields: [["提供方显示名称", "飞书"], ["App ID", ""], ["App Secret", ""]],
      select: ["区域", ["飞书（feishu.cn）", "Lark（larksuite.com）"]],
    },
    wecom: {
      tab: "企微登录", name: "企业微信", badge: "OAUTH",
      desc: "企业微信自建应用网页登录（wwlogin）。填写企业 CorpID、应用 ID 与 Secret。",
      fields: [["提供方显示名称", "企业微信"], ["企业 ID（CorpID）", ""], ["应用 Secret", ""], ["应用 ID", ""]],
    },
    dingtalk: {
      tab: "钉钉登录", name: "钉钉", badge: "OAUTH",
      desc: "钉钉企业内部应用网页登录，仅本组织员工可用。",
      fields: [["提供方显示名称", "钉钉"], ["App ID", ""], ["App Secret", ""]],
    },
    oidc: {
      tab: "通用 OIDC", name: "OpenID Connect", badge: "OIDC",
      desc: "接入 Azure AD、Google、Keycloak、Okta 或其他 OIDC 签发者。",
      fields: [["提供方显示名称", ""], ["签发者 URL", ""], ["客户端 ID", ""], ["客户端密钥", ""]],
      scopes: ["openid", "profile", "email"],
    },
    ldap: {
      tab: "LDAP", name: "LDAP 目录", badge: "LDAP",
      desc: "接入 Active Directory、OpenLDAP 等目录服务登录。用户在现有登录表单中直接输入域账号与密码。",
      fields: [["提供方显示名称", ""], ["服务器地址", ""], ["绑定 DN", ""], ["绑定密码", ""]],
      switches: [["StartTLS", "绑定前将明文 ldap:// 连接升级为 TLS。"], ["校验 TLS 证书", "仅在自签名证书的测试服务器上关闭。"]],
      extra: [["用户检索"], ["用户基准 DN", ""]],
    },
  };

  function ssoCfgOf(kind) {
    state.ssoCfg = state.ssoCfg || {};
    if (!state.ssoCfg[kind]) {
      const k = SSO_KINDS[kind];
      const cfg = { enabled: false, values: {}, starttls: false, verify: true };
      (k.fields || []).forEach(([label, val]) => { cfg.values[label] = val || ""; });
      state.ssoCfg[kind] = cfg;
    }
    return state.ssoCfg[kind];
  }

  function renderSsoPanel(kind) {
    const k = SSO_KINDS[kind];
    const cfg = ssoCfgOf(kind);
    const field = (label, val, hint) => '<div class="dfield"><label>' + esc(label) + "</label>" +
      '<input class="input" data-sso-field="' + esc(label) + '" value="' + esc(val || "") + '" />' +
      (hint ? '<div class="hint">' + hint + "</div>" : "") + "</div>";
    const steps = ["填写 App ID 与密钥", "复制回调地址", "保存配置", "测试连接", "启用登录"];
    return '<div class="sso-head"><div class="row" style="gap:10px"><span class="sso-logo">' + esc(k.name[0]) + "</span>" +
      "<div><b>" + esc(k.name) + '</b><div class="hint">' + esc(k.desc) + "</div></div></div>" +
      '<span class="spacer"></span><span class="tag outline sm">' + k.badge + '</span><span class="tag sm">' + (cfg.enabled ? "已启用" : "未启用") + "</span>" +
      toggle(cfg.enabled, kind, "sso") + "</div>" +
      '<div class="sso-layout"><div class="sso-main">' +
      '<div class="card"><div class="card-h"><b class="card-title">身份提供商</b><span class="card-sub">显示名称会出现在登录按钮上</span></div>' +
      '<div class="card-b">' +
      (k.fields[0] ? field(k.fields[0][0], cfg.values[k.fields[0][0]]) : "") +
      (k.select ? '<div class="dfield"><label>' + k.select[0] + '</label><select class="input">' + k.select[1].map((o) => "<option>" + o + "</option>").join("") + "</select></div>" : "") +
      (k.scopes ? '<div class="dfield"><label>授权范围</label><div class="row" style="flex-wrap:wrap;gap:6px">' +
        k.scopes.map((s) => '<span class="tag brand">' + s + " ×</span>").join("") + "</div></div>" : "") +
      "</div></div>" +
      (k.fields.length > 1 ? '<div class="card"><div class="card-h"><b class="card-title">应用凭证</b><span class="card-sub">来自开放平台应用注册</span></div>' +
        '<div class="card-b"><div class="setting-grid">' +
        k.fields.slice(1).map(([label, val]) => field(label, cfg.values[label], label.indexOf("Secret") >= 0 || label.indexOf("密码") >= 0 ? "必填。保存后可留空以保留现有密钥。" : "")).join("") +
        "</div>" +
        (k.switches ? k.switches.map(([t, h]) => '<div class="setting-row"><div class="label"><b>' + t + "</b><span>" + h + "</span></div>" +
          toggle(t === "StartTLS" ? cfg.starttls : cfg.verify, t === "StartTLS" ? "starttls" : "verify", "sso") + "</div>").join("") : "") +
        (k.extra ? '<div class="conn-section-h">' + k.extra[0][0] + "</div>" + (k.extra[1] ? field(k.extra[1][0], cfg.values[k.extra[1][0]]) : "") : "") +
        "</div></div>" : "") +
      '<div class="row" style="margin-top:4px"><button class="btn primary" data-act="sso-save" data-value="' + kind + '">' + icon("check", "ic-sm") + "保存</button>" +
      '<button class="btn" data-act="sso-test" data-value="' + kind + '">' + icon("alert", "ic-sm") + "测试连接</button>" +
      '<span class="hint">更改 App ID 或密钥后，请先保存再测试。</span></div></div>' +
      '<aside class="sso-aside">' +
      '<div class="side-panel"><h4>' + icon("check", "ic-sm") + "配置清单</h4>" +
      steps.map((s, i) => '<div class="checklist-row ' + (i === 0 ? "on" : "") + '"><span class="checklist-n">' + (i + 1) + "</span><span>" + s + "</span></div>").join("") +
      "</div>" +
      '<div class="side-panel"><h4>' + icon("user", "ic-sm") + "登录页预览</h4>" +
      '<div class="sso-preview"><button class="btn" disabled>使用' + esc(k.name.split(" ")[0]) + "继续</button></div>" +
      '<div class="hint">仅在启用该登录方式后，登录页才会显示此按钮。</div></div>' +
      '<div class="side-panel"><h4>' + icon("globe", "ic-sm") + "回调地址</h4>" +
      '<div class="hint">请在开放平台将此回调 URL 登记为授权回调地址。</div>' +
      '<div class="sso-callback"><code>http://127.0.0.1:8088/api/auth/oauth/callback</code>' +
      '<button class="btn sm" data-act="sso-copy">' + icon("copy", "ic-xs") + "复制</button></div></div>" +
      "</aside></div>";
  }

  function renderAdminUsers() {
    const tab = state.userTab || "users";
    const BANNER = {
      users: ["账号类型", "管理员可管理系统设置，用户与全栈数据；成员仅使用自有专家与工作区，不能管理其他用户或修改全局配置。自定义角色在账号类型列显示模板名称。"],
      roles: ["角色管理", "角色只提供创建、编辑和邀请的默认值。修改角色不会改写已经创建的用户。"],
      groups: ["用户分组", "分组限制谁能看到资源，不授予偏权限。停用后本组授权暂时失效，重新启用后恢复。"],
    };
    let body = "";
    if (SSO_KINDS[tab]) {
      body = renderSsoPanel(tab);
    } else if (tab === "users") {
      body = '<div class="sso-banner">' + icon("info", "ic-sm") + "<span><b>" + BANNER.users[0] + "</b> " + BANNER.users[1] + "</span></div>" +
        dataTable("admin-users", state.adminUsers, [
          { key: "u", label: "用户名", sortable: true, render: (u) => '<span class="avatar-xs">' + esc(u.u[0].toUpperCase()) + "</span> <b>" + esc(u.u) + "</b>" },
          { key: "e", label: "邮箱", render: (u) => esc(u.e) },
          { key: "auth", label: "登录方式", render: (u) => esc(u.auth) },
          { key: "agents", label: "专家", render: () => "1" },
          { key: "role", label: "角色名称", render: (u) => '<span class="tag ' + (u.role === "管理员" ? "brand" : "") + ' sm">' + esc(u.role) + "</span>" },
          { key: "perm", label: "权限", render: (u) => '<span class="tag ' + (u.role === "管理员" ? "brand" : "") + ' sm">' + (u.role === "管理员" ? "全部（管理员）" : "18 项") + "</span>" },
          { key: "status", label: "已启用", render: (u) => toggle(u.status !== "已禁用", u.u, "user") },
          { key: "created", label: "创建时间", render: () => '<span class="hint">2026/11/04 17:27</span>' },
          { key: "last", label: "最近登录", render: () => '<span class="hint">今天</span>' },
          { key: "lock", label: "登录锁定", render: () => '<span class="hint">—</span>' },
          { key: "actions", label: "操作", align: "right", render: (u) => '<button class="btn sm text" data-act="user-edit" data-user="' + esc(u.u) + '" title="编辑">' + icon("edit", "ic-xs") + "</button>" +
            '<button class="btn sm text" data-act="user-reset" data-user="' + esc(u.u) + '" title="重置密码">' + icon("key", "ic-xs") + "</button>" +
            '<button class="btn sm text danger" data-act="user-delete" data-user="' + esc(u.u) + '" title="删除">' + icon("trash", "ic-xs") + "</button>" },
        ], { selectable: true, key: (u) => u.u, search: (u) => u.u + " " + u.e, placeholder: "搜索用户名、显示名称、邮箱或角色名称", empty: "没有用户" });
    } else if (tab === "roles") {
      const ROLES = [["管理员", "admin", "拥有完整权限且不受资源策略限制。", "全部（管理员）", "未启用"],
        ["用户", "member", "适用于普通用户，默认具备基础设置权限。", "18 项", "未启用"],
        ["只读审计", "auditor", "仅可查看审计日志与用量，不能写入。", "6 项", "未启用"]];
      body = '<div class="sso-banner">' + icon("info", "ic-sm") + "<span><b>" + BANNER.roles[0] + "</b> " + BANNER.roles[1] + "</span></div>" +
        '<div class="filter-row" style="margin:12px 0"><span class="spacer"></span>' +
        '<div class="seg-text view"><button class="seg ' + (state.roleView !== "table" ? "active" : "") + '" data-act="role-view" data-value="cards">' + icon("grid", "ic-xs") + '卡片</button>' +
        '<button class="seg ' + (state.roleView === "table" ? "active" : "") + '" data-act="role-view" data-value="table">' + icon("file", "ic-xs") + "表格</button></div>" +
        '<button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>" +
        '<button class="btn primary" data-act="role-new">' + icon("plus", "ic-sm") + "新建角色</button></div>" +
        '<div class="table-card"><table class="table"><thead><tr><th>角色名称</th><th>角色描述</th><th>用户</th><th>权限</th><th>资源策略</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
        ROLES.map(([n, key, d, perm, policy]) => "<tr><td><div class=\"row\"><span class=\"avatar-xs\">" + esc(n[0]) + "</span><div><b>" + n + '</b><div class="hint">' + key + " · 内置</div></div></div></td>" +
          '<td class="hint">' + d + '</td><td><span class="hint">' + state.adminUsers.filter((u) => u.role === (n === "用户" ? "成员" : n)).length + " 人</span></td>" +
          "<td><span class=\"tag sm\">" + perm + '</span></td><td><span class="hint">' + policy + '</span></td>' +
          '<td style="text-align:right"><button class="btn sm text" data-act="role-edit" data-name="' + n + '">' + icon("edit", "ic-xs") + "</button>" +
          '<button class="btn sm text danger" data-act="role-delete" data-name="' + n + '">' + icon("trash", "ic-xs") + "</button></td></tr>").join("") +
        "</tbody></table></div>";
    } else {
      body = '<div class="sso-banner">' + icon("info", "ic-sm") + "<span><b>" + BANNER.groups[0] + "</b> " + BANNER.groups[1] + "</span></div>" +
        '<div class="filter-row" style="margin:12px 0"><div class="search" style="width:260px">' + icon("search", "ic-sm") + '<input placeholder="搜索分组 ID、名称、说明或成员" /></div>' +
        '<span class="spacer"></span><div class="seg-text view"><button class="seg active">' + icon("grid", "ic-xs") + '卡片</button><button class="seg">' + icon("file", "ic-xs") + "表格</button></div>" +
        '<button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>" +
        '<button class="btn primary" data-act="group-new">' + icon("plus", "ic-sm") + "新建用户分组</button></div>" +
        '<div class="table-card"><table class="table"><thead><tr><th>名称</th><th>说明</th><th>可使用的资源</th><th>成员</th><th>启用</th><th>创建时间</th></tr></thead><tbody>' +
        (state.groups.length ? state.groups.map((g) => "<tr><td><b>" + esc(g.id) + '</b></td><td class="hint">' + esc(g.name) + "</td>" +
          '<td class="hint">' + (g.members || 0) + ' 项</td><td><span class="hint">' + (g.members || 0) + " 人</span></td>" +
          "<td>" + toggle(g.on, g.id, "group") + "</td><td class=\"hint\">2026/11/04</td></tr>").join("")
          : '<tr><td colspan="6"><div class="empty" style="padding:40px"><div class="glyph">' + icon("folder") + "</div><b>还没有用户分组</b>" +
            '<p>分组用于限制可见资源，并支持批量授权。</p><button class="btn sm primary" data-act="group-new">新建用户分组</button></div></td></tr>') +
        "</tbody></table></div>";
    }
    const actions = tab === "users"
      ? '<button class="btn" data-act="user-invite">' + icon("send", "ic-sm") + "邀请用户</button>" +
        '<button class="btn primary" data-act="user-new">' + icon("plus", "ic-sm") + "新建用户</button>"
      : "";
    return '<div class="main"><div class="page">' +
      cfgHead("用户管理", "管理内置账号与登录方式（通用 OIDC、飞书、企微、钉钉）。", actions) +
      body + "</div></div>";
  }

  const PROVIDERS_PRESET = [
    ["Tencent Cloud", "blue", "6 个站点", "tencent"],
    ["Kimi", "indigo", "3 个站点", "kimi"],
    ["MiniMax", "red", "2 个站点", "minimax"],
    ["SiliconFlow", "violet", "2 个站点", "silicon"],
    ["Aliyun", "amber", "7 个站点", "aliyun"],
    ["Volcano Engine", "blue", "3 个站点", "volcano"],
    ["Zhipu", "indigo", "4 个站点", "zhipu"],
    ["iFlytek Astron", "violet", "1 个站点", "iflytek"],
    ["Magpie", "dark", "—", "magpie"],
    ["ModelScope", "violet", "2 个模型", "modelscope"],
    ["Xiaomi MiMo", "amber", "4 个模型", "mimo"]
  ];

  function modelPool() {
    return '<div class="card"><div class="card-h"><b class="card-title">可用模型池</b>' + icon("info", "ic-xs") +
      '<span class="spacer"></span><span class="tag green sm">2 个可用</span></div>' +
      '<div class="card-b"><div class="hint" style="margin-bottom:10px">以下为当前可用模型。自动模式会优先使用你的优先模型；当消息包含图片等当前模型不支持的内容时，系统会自动切换到兼容模型。</div>' +
      '<div class="pool-group"><div class="pool-head"><span class="pool-logo">D</span><b>DeepSeek</b><span class="tag outline sm">openai</span><span class="spacer"></span><span class="hint">2 个</span></div>' +
      [["DeepSeek / DeepSeek Flash", ["推理", "文本", "图像", "上下文 1M", "自动"]], ["DeepSeek / DeepSeek V4 Pro", ["推理", "文本", "上下文 1M", "自动"]]].map(([n, tags]) =>
        '<div class="pool-row"><button class="icon-btn" data-act="prov-fav" title="设为优先"><span class="pool-star">★</span></button><b>' + n + "</b>" +
        '<span class="spacer"></span>' + tags.map((t) => '<span class="tag ' + (t === "自动" ? "brand" : t === "推理" ? "violet" : t === "图像" || t === "文本" ? "green" : "") + ' sm">' + t + "</span>").join("") +
        '<button class="icon-btn" data-act="refresh">' + icon("refresh", "ic-xs") + "</button></div>").join("") +
      "</div></div></div>";
  }

  function providerCard([name, tone, meta, kind], configured) {
    if (configured) {
      return '<div class="prov-card on"><div class="prov-top"><span class="prov-ic tone-' + tone + '">' + esc(name[0]) + "</span><b>" + esc(name) + "</b>" +
        '<span class="spacer"></span><span class="tag green sm">可用</span></div>' +
        '<div class="prov-meta">Base URL: <b>https://api.deepseek.com/v1</b></div>' +
        '<div class="prov-meta">API Key: <b>sk-6******d222</b></div>' +
        '<div class="prov-meta">模型: <b>2 个模型</b></div>' +
        '<div class="prov-foot"><span class="tag outline sm">openai</span><span class="spacer"></span>' +
        toggle(true, name, "prov") + '<button class="icon-btn" data-act="refresh">' + icon("spark", "ic-xs") + "</button>" +
        '<button class="icon-btn" data-act="refresh">' + icon("edit", "ic-xs") + "</button>" +
        '<button class="icon-btn" data-act="refresh">' + icon("trash", "ic-xs") + "</button></div></div>";
    }
    return '<div class="prov-card"><div class="prov-top"><span class="prov-ic tone-' + tone + '">' + esc(name[0]) + "</span><b>" + esc(name) + "</b>" +
      '<span class="spacer"></span><span class="tag sm">未配置</span></div>' +
      '<div class="prov-meta">站点: <b>' + esc(meta) + '</b></div>' +
      '<div class="prov-meta">模型: <b>请先选择站点</b></div>' +
      '<div class="prov-foot"><span class="tag outline sm">openai</span><span class="spacer"></span>' +
      '<button class="btn sm text" data-act="provider-config" data-name="' + esc(name) + '">配置 ' + esc(name) + "</button></div></div>";
  }

  const PROV_TYPES = ["OpenAI 兼容", "Anthropic Messages", "Google Gemini", "Azure OpenAI", "Ollama"];

  function provDraft() {
    if (!state.provDraft) {
      state.provDraft = { mode: state.modelTab || "chat", name: "", type: "OpenAI 兼容", baseUrl: "", apiKey: "", site: "", models: ["deepseek-chat"], image: "", video: "", routeId: "", scope: "全部专家", on: true };
    }
    return state.provDraft;
  }

  function renderProviderDrawer() {
    const d = provDraft();
    const mode = d.mode;
    const title = d.custom ? "自定义供应商" : "配置 " + (d.name || "提供商");
    const f = (label, key, ph, type) => '<div class="dfield"><label>' + label + "</label>" +
      '<input class="input" data-input="pv-' + key + '" type="' + (type || "text") + '" value="' + esc(d[key] || "") + '" placeholder="' + (ph || "") + '" /></div>';
    let body = '<div class="dfield"><label><i>*</i>名称</label><input class="input" data-input="pv-name" value="' + esc(d.name) + '" placeholder="例如 DeepSeek" /></div>' +
      '<div class="dfield"><label><i>*</i>类型</label><select class="input" data-input="pv-type">' +
      PROV_TYPES.map((t) => "<option" + (t === d.type ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
      f("Base URL", "baseUrl", "https://api.deepseek.com/v1");
    if (mode === "chat") {
      body += '<div class="dfield"><label>站点</label><select class="input" data-input="pv-site"><option>请选择站点</option><option>官方站点</option><option>国内加速站点</option></select></div>';
    }
    body += f("API Key", "apiKey", "sk-...", "password");
    if (mode === "chat" || mode === "embedding" || mode === "custom") {
      body += '<div class="conn-section-h">模型</div><div class="model-rows">' +
        d.models.map((m, i) => '<div class="model-row"><input class="input" data-input="pv-model-' + i + '" value="' + esc(m) + '" />' +
          '<button class="icon-btn" data-act="pv-model-del" data-idx="' + i + '">' + icon("x", "ic-xs") + "</button></div>").join("") +
        "</div>" +
        '<div class="row" style="margin-top:6px"><button class="btn sm" data-act="pv-model-add">' + icon("plus", "ic-xs") + "添加模型</button>" +
        '<button class="btn sm text" data-act="pv-fetch">获取模型列表</button></div>';
    }
    if (mode === "generation") {
      body += '<div class="conn-section-h">生成能力</div>' +
        '<div class="setting-row"><div class="label"><b>启用生图工具</b></div>' + toggle(d.imageOn !== false, "imageOn", "pv") + "</div>" +
        f("图片模型", "image", "doubao-seedream-5.0-lite") +
        '<div class="setting-row"><div class="label"><b>启用生视频工具</b></div>' + toggle(d.videoOn !== false, "videoOn", "pv") + "</div>" +
        f("视频模型", "video", "doubao-seedance-2.0-mini") + f("路由 ID", "routeId", "volcengine-default");
    }
    if (mode === "voice") {
      body += '<div class="dfield"><label>服务类型</label><select class="input" data-input="pv-voiceKind"><option>STT（语音输入）</option><option>TTS（语音朗读）</option></select></div>' +
        f("语言", "lang", "zh-CN");
    }
    if (mode === "search") {
      body += f("结果条数", "topk", "10");
    }
    return '<div class="drawer-mask" data-act="prov-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="配置提供商">' +
      '<div class="drawer-h"><b>' + esc(title) + '</b><span class="spacer"></span><button class="icon-btn" data-act="prov-close">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' + body +
      '<div class="dfield" style="margin-top:14px"><label>备注（可选）</label><textarea class="input" rows="2" data-input="pv-note">' + esc(d.note || "") + "</textarea></div></div>" +
      '<div class="drawer-f"><button class="btn" data-act="prov-close">取消</button>' +
      '<button class="btn" data-act="prov-test">' + icon("search", "ic-sm") + "测试连接</button>" +
      '<button class="btn primary" data-act="prov-save">保存</button></div></aside>';
  }

  function renderPluginDrawer() {
    if (!state.pluginDraft) state.pluginDraft = { mode: "install", name: "", version: "", slug: "", perms: ["网络"] };
    const d = state.pluginDraft;
    const zip = d.mode === "zip";
    return '<div class="drawer-mask" data-act="plugin-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="安装插件">' +
      '<div class="drawer-h"><b>' + (zip ? "从 ZIP 安装" : d.name ? "安装插件 · " + esc(d.name) : "安装插件") + "</b><span class=\"spacer\"></span>" +
      '<button class="icon-btn" data-act="plugin-close">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      (zip
        ? '<div class="dfield"><label><i>*</i>ZIP 文件</label><button class="drop-area" data-act="plugin-pick">' + icon("upload") + "<b>选择或拖入插件 ZIP</b><span>包含 plugin.json 与 commands.js，最大 20 MB</span></button></div>" +
          '<div class="dfield"><label><i>*</i>插件 slug</label><input class="input" data-input="pg-slug" value="' + esc(d.slug) + '" placeholder="my-plugin" /></div>'
        : '<div class="dfield"><label><i>*</i>插件名称</label><input class="input" data-input="pg-name" value="' + esc(d.name) + '" placeholder="插件 slug，例如 weather" /></div>' +
          '<div class="dfield"><label>版本</label><div class="row"><span class="pm-badge tone-blue">' + icon("package", "ic-xs") + '</span><b>' + esc(d.version || "v0.1.0") + "</b></div></div>") +
      '<div class="conn-section-h">安装权限</div>' +
      '<div class="row" style="flex-wrap:wrap;gap:8px">' + ["网络", "文件", "工作区", "日历"].map((p) =>
        '<button class="chip ' + ((d.perms || []).includes(p) ? "on" : "") + '" data-act="plugin-perm" data-value="' + p + '">' +
        ((d.perms || []).includes(p) ? icon("check", "ic-xs") : "") + p + "</button>").join("") + "</div>" +
      '<div class="alert warn" style="margin-top:12px">' + icon("alert", "ic-sm") + "权限在安装时一次性授予；卸载会立即回收，重新安装需再次确认。</div>" +
      "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="plugin-close">取消</button>' +
      '<button class="btn primary" data-act="plugin-save">' + (zip ? "导入并安装" : "安装") + "</button></div></aside>";
  }

  function renderAdminModels() {
    const tab = state.modelTab || "chat";
    let body = "";
    if (tab === "chat") {
      body = modelPool() +
        '<div class="sec-head"><b>预置提供商</b><span class="spacer"></span>' +
        '<div class="seg-text view"><button class="seg ' + (state.provScope !== "local" ? "active" : "") + '" data-act="prov-scope" data-value="cloud">云端</button>' +
        '<button class="seg ' + (state.provScope === "local" ? "active" : "") + '" data-act="prov-scope" data-value="local">本地</button></div></div>' +
        '<div class="prov-grid">' + PROVIDERS_PRESET.slice(0, 8).map((p) => providerCard(p, false)).join("") + providerCard(["DeepSeek", "blue", "—", "deepseek"], true) + PROVIDERS_PRESET.slice(8).map((p) => providerCard(p, false)).join("") + "</div>" +
        '<div class="row" style="justify-content:center;margin-top:10px"><button class="btn sm text" data-act="prov-more">' + (state.provMore ? "收起额外提供商" : "更多模型提供商（10）") + '</button></div>' +
        (state.provMore ? '<div class="prov-grid" style="margin-top:10px">' + ["Cloudflare AI Gateway", "Groq", "Mistral", "Together AI", "OpenRouter", "Fireworks"].map((n) => providerCard([n, "indigo", "2 个站点", "extra"], false)).join("") + "</div>" : "") +
        '<div class="sec-head" style="border-top:1px solid var(--line);margin-top:18px;padding-top:16px"><b>自定义提供商</b><span class="spacer"></span>' +
        '<button class="btn primary sm" data-act="prov-custom">' + icon("plus", "ic-sm") + "自定义供应商</button></div>" +
        '<div class="stack-empty"><div class="stack-empty-ic">' + icon("package") + "</div><span>暂无自定义提供商，点击右上角「自定义供应商」添加</span></div>";
    } else if (tab === "embedding") {
      body = '<div class="card"><div class="card-h"><b class="card-title">可用向量模型</b>' + icon("info", "ic-xs") +
        '<span class="spacer"></span><button class="btn sm text" data-act="nav" data-route="knowledge">前往知识库</button><span class="tag green sm">1 个可用</span></div>' +
        '<div class="card-b"><div class="hint" style="margin-bottom:10px">知识库与检索将使用下列模型。</div>' +
        '<div class="pool-group"><div class="pool-head"><span class="pool-logo">D</span><b>DashScope</b><span class="tag outline sm">openai</span><span class="spacer"></span><span class="hint">1 个</span></div>' +
        '<div class="pool-row"><span class="spacer"></span><b>qwen3.7-text-embedding-flash</b><button class="icon-btn" data-act="refresh">' + icon("refresh", "ic-xs") + "</button></div></div></div></div>" +
        '<div class="sec-head"><b>向量服务</b></div>' +
        '<div class="prov-grid">' +
        '<div class="prov-card"><div class="prov-top"><span class="prov-ic tone-green">ON</span><b>ONNX (Local)</b>' +
        '<span class="tag sm">本地</span><span class="spacer"></span><span class="tag sm">服务已关闭</span></div>' +
        '<div class="prov-meta">模型: <b>3 个模型</b></div>' +
        '<div class="prov-hint">本地嵌入组件尚未就绪，开启服务时将自动安装。</div>' +
        '<div class="prov-foot">' + toggle(false, "onnx", "prov") + '<span class="spacer"></span><button class="icon-btn" data-act="refresh">' + icon("edit", "ic-xs") + "</button></div></div>" +
        providerCard(["SiliconFlow", "violet", "4 个模型", "silicon"], false) +
        '<div class="prov-card on"><div class="prov-top"><span class="prov-ic tone-blue">D</span><b>DashScope</b><span class="spacer"></span><span class="tag green sm">可用</span></div>' +
        '<div class="prov-meta">Base URL: <b>https://maas.qianwenaiapi...</b></div><div class="prov-meta">API Key: <b>sk-******k2Xw</b></div>' +
        '<div class="prov-meta">模型: <b>183 个模型</b></div>' +
        '<div class="prov-foot">' + toggle(true, "dashscope", "prov") + '<span class="spacer"></span>' +
        '<button class="icon-btn" data-act="refresh">' + icon("spark", "ic-xs") + "</button><button class=\"icon-btn\" data-act=\"refresh\">" + icon("edit", "ic-xs") + "</button>" +
        '<button class="icon-btn" data-act="refresh">' + icon("trash", "ic-xs") + "</button></div></div>" +
        '<button class="prov-add" data-act="prov-custom"><span>' + icon("plus") + "</span>添加自定义服务</button>" +
        "</div>";
    } else if (tab === "generation") {
      body = '<div class="card"><div class="card-h"><b class="card-title">生成工具路由</b>' + icon("info", "ic-xs") +
        '<span class="spacer"></span>' + toggle(state.mediaOn !== false, "media", "prov") + '<span class="hint" style="margin-left:6px">启用媒体生成</span></div>' +
        '<div class="card-b"><div class="hint" style="margin-bottom:10px">统一控制生成工具开关，并指定图片与视频请求默认使用的厂商实例。</div>' +
        '<div class="setting-grid">' +
        '<div class="dfield"><label>默认生图路由</label><select class="input"><option>Volcengine Ark · doubao-seedream-5.0-lite-260128</option></select></div>' +
        '<div class="dfield"><label>默认生视频路由</label><select class="input"><option>Volcengine Ark · doubao-seedance-2.0-mini-260615</option></select></div>' +
        "</div>" +
        '<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn sm" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>" +
        '<button class="btn primary sm" data-act="media-save">保存路由</button></div></div></div>' +
        '<div class="sec-head"><b>生成模型厂商</b><span class="spacer"></span><button class="btn sm" data-act="provider-add">' + icon("plus", "ic-sm") + "添加服务商</button></div>" +
        '<div class="hint" style="margin:-4px 0 10px">像管理对话模型一样管理生成模型厂商，点击卡片配置凭证、模型和能力；同一厂商可添加多个实例。</div>' +
        '<div class="prov-grid">' +
        '<div class="prov-card on"><div class="prov-top"><span class="prov-ic tone-blue">V</span><div><b>Volcengine Ark</b><div class="prov-sub">volcengine</div></div>' +
        '<span class="spacer"></span><span class="tag sm">未授权</span></div>' +
        '<div class="prov-meta">Base URL: <b>https://ark.cn-beijing.v...</b></div>' +
        '<div class="prov-meta">' + icon("image", "ic-xs") + ' 图片: <b>doubao-seedream-5.0-lite...</b></div>' +
        '<div class="prov-meta">' + icon("video", "ic-xs") + ' 视频: <b>doubao-seedance-2.0-mini...</b></div>' +
        '<div class="prov-meta">路由 ID: <b>volcengine-default</b></div>' +
        '<div class="prov-foot">' + toggle(true, "volc", "prov") + '<span class="spacer"></span>' +
        '<button class="icon-btn" data-act="refresh">' + icon("spark", "ic-xs") + "</button><button class=\"icon-btn\" data-act=\"refresh\">" + icon("edit", "ic-xs") + "</button>" +
        '<button class="icon-btn" data-act="refresh">' + icon("trash", "ic-xs") + "</button></div></div>" +
        '<div class="prov-card"><div class="prov-top"><span class="prov-ic tone-violet">A</span><div><b>Alibaba Cloud Mod...</b><div class="prov-sub">dashscope</div></div>' +
        '<span class="spacer"></span><span class="tag sm">未配置</span></div>' +
        '<div class="prov-meta">Base URL: <b>https://dashscope.aliyun...</b></div>' +
        '<div class="prov-meta">' + icon("image", "ic-xs") + ' 图片: <b>wan2.7-image-pro</b></div>' +
        '<div class="prov-meta">' + icon("video", "ic-xs") + ' 视频: <b>wan3.0-video-prime</b></div>' +
        '<div class="prov-foot"><span class="hint">官方预设</span><span class="spacer"></span><button class="btn sm text" data-act="provider-config" data-name="Alibaba Cloud">点击配置</button></div></div>' +
        '<div class="prov-card"><div class="prov-top"><span class="prov-ic tone-amber">M</span><div><b>MiniMax</b><div class="prov-sub">minimax</div></div>' +
        '<span class="spacer"></span><span class="tag sm">未配置</span></div>' +
        '<div class="prov-meta">Base URL: <b>https://api.minimax.cn</b></div>' +
        '<div class="prov-meta">' + icon("image", "ic-xs") + ' 图片: <b>image-01</b></div>' +
        '<div class="prov-meta">' + icon("video", "ic-xs") + ' 视频: <b>MiniMax-H3</b></div>' +
        '<div class="prov-foot"><span class="hint">官方预设</span><span class="spacer"></span><button class="btn sm text" data-act="provider-config" data-name="MiniMax">点击配置</button></div></div>' +
        "</div>";
    } else if (tab === "voice") {
      const voiceCard = ([n, src, tags, desc, stateLabel]) =>
        '<div class="voice-card' + (stateLabel === "使用中" ? " on" : "") + '"><div class="voice-top"><span class="voice-ic">' + icon("mic", "ic-sm") + "</span>" +
        "<div><b>" + n + "</b><div class=\"prov-sub\">" + src + "</div></div><span class=\"spacer\"></span>" +
        tags.map((t) => '<span class="tag ' + (t === "当前" ? "brand" : t === "免费" ? "green" : "") + ' sm">' + t + "</span>").join("") + "</div>" +
        '<div class="voice-desc">' + desc + "</div>" +
        '<div class="voice-foot">' + (stateLabel === "使用中"
          ? '<button class="btn sm" disabled>使用中</button>'
          : stateLabel === "设为当前" ? '<button class="btn sm primary" data-act="refresh">设为当前</button>'
          : '<button class="btn sm" data-act="provider-config" data-name="' + n + '">' + icon("settings", "ic-xs") + "配置</button>") + "</div></div>";
      body = '<div class="sec-head"><b>语音输入（STT）</b></div><div class="prov-grid">' +
        voiceCard(["Browser Native", "BROWSER", ["当前", "免费"], "Uses the browser Web Speech API — zero account configuration.", "使用中"]) +
        voiceCard(["Tencent Cloud", "TENCENT", ["免费"], "Tencent ASR + TTS with free trial quota for new accounts.", ""]) +
        voiceCard(["OpenAI", "OPENAI", [], "Whisper STT and OpenAI TTS.", ""]) +
        voiceCard(["Xiaomi MiMo STT", "MIMO", [], "Xiaomi MiMo ASR (mimo-v2.5-asr), pay-as-you-go.", ""]) +
        "</div>" +
        '<div class="sec-head" style="margin-top:18px"><b>语音朗读（TTS）</b></div><div class="prov-grid">' +
        voiceCard(["Browser Native", "BROWSER", ["当前", "免费"], "Uses the browser Web Speech API — zero account configuration.", "使用中"]) +
        voiceCard(["Edge TTS", "EDGE", ["免费"], "Free Microsoft Edge neural voices via edge-tts.", "设为当前"]) +
        voiceCard(["Tencent Cloud", "TENCENT", ["免费"], "Tencent ASR + TTS with free trial quota for new accounts.", ""]) +
        voiceCard(["OpenAI", "OPENAI", [], "Whisper STT and OpenAI TTS.", ""]) +
        voiceCard(["Xiaomi MiMo TTS", "MIMO", ["限时免费"], "Xiaomi MiMo TTS (mimo-v2.5-tts). Limited-time free.", ""]) +
        "</div>";
    } else if (tab === "decision") {
      body = '<div class="card"><div class="card-b">' +
        '<div class="hint" style="margin-bottom:12px">聊天模型开口前，先用一个小模型缩小这一轮的技能、工具和团队成员。默认关闭，关闭时和现在一样。</div>' +
        '<div class="setting-row"><div class="label"><b>启用决策模型</b><span>关闭时不会改动现有的技能、工具和成员。打开后，再选择用在哪些地方。</span></div>' +
        toggle(!!state.decisionOn, "decision", "prov") + "</div>" +
        '<div class="row" style="margin-top:10px"><button class="btn primary sm" data-act="refresh">保存</button></div></div></div>';
    } else {
      const searchCard = ([n, src, desc]) => '<div class="prov-card"><div class="prov-top"><span class="prov-ic tone-blue">' + esc(n[0]) + "</span>" +
        "<div><b>" + n + "</b><div class=\"prov-sub\">" + src + "</div></div><span class=\"spacer\"></span><span class=\"tag sm\">未配置</span></div>" +
        '<div class="prov-desc">' + desc + "</div>" +
        '<div class="prov-foot"><button class="btn sm" data-act="provider-config" data-name="' + n + '">' + icon("settings", "ic-xs") + "配置</button></div></div>";
      body = '<div class="sso-banner">' + icon("search", "ic-sm") + "<span><b>当前搜索源：内置搜索</b> 未配置第三方搜索服务时，仍可使用产品内置搜索服务；该服务无需 API Key，但不保证稳定性和可用性。配置第三方服务后会自动切换。</span></div>" +
        '<div class="prov-grid">' +
        searchCard(["Tavily", "TAVILY", "AI 驱动的网络搜索，提供智能摘要答案"]) +
        searchCard(["Brave Search", "BRAVE", "注重隐私的独立搜索引擎"]) +
        searchCard(["DeepSeek Search", "DEEPSEEK", "DeepSeek AI 原生搜索，返回排序结果、摘要和来源链接"]) +
        searchCard(["Google Search", "GOOGLE", "基于 Google 自定义搜索引擎的网络搜索"]) +
        searchCard(["Kimi (Moonshot)", "MOONSHOT", "Moonshot（Kimi）AI 内置联网搜索能力"]) +
        searchCard(["元宝搜索", "YUANBAO", "腾讯元宝搜索，覆盖公开网页与腾讯内容生态"]) +
        "</div>" +
        '<div class="hint" style="margin-top:12px">已配置 0 个搜索提供商（共 6 个）</div>';
    }
    return '<div class="main"><div class="page">' +
      cfgHead("模型配置", "配置对话、向量、生成、语音、搜索和决策所用的模型",
        '<button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>") +
      body + "</div></div>";
  }

  const STORAGE_TYPES = [
    ["腾讯云 COS", "对象存储", "腾讯云对象存储，国内访问延迟低；支持 CDN 加速与大文件分片上传，适合国内部署。", "cloud"],
    ["Amazon S3", "对象存储", "Amazon S3，业界标准对象存储；协议兼容绝大多数云厂商与自建服务，适合跨区域部署。", "cloud"],
    ["阿里云 OSS", "对象存储", "阿里云对象存储 OSS，适合阿里云生态；内网访问免流量费，支持生命周期与冷热分层。", "cloud"],
    ["华为云 OBS", "对象存储", "华为云对象存储 OBS，适合华为云生态；兼容 S3 接口，支持多级存储与并行文件语义。", "cloud"],
    ["火山引擎 TOS", "对象存储", "火山引擎 TOS，使用官方 SDK；需要填写 Bucket、Region 和 Endpoint。", "cloud"],
    ["本地文件系统", "本地", "挂载宿主机本地目录作为工作区，读写最快、无网络依赖；适合开发调试与单机部署。", "disk"],
    ["本地完整环境", "本地", "在宿主机本地 Shell 中执行命令，支持超时与环境变量隔离；专家可直接使用宿主工具链。", "terminal"],
    ["Docker 沙箱", "沙箱", "在本机 Docker 容器内执行代码，不挂载宿主工作区；容器按 sandbox_scope 复用与命名。", "box"],
    ["OpenSandbox", "沙箱", "远程 OpenSandbox 沙箱，专家启动时创建、停止时销毁；启用该后端会自动安装官方 SDK。", "box"],
    ["PostgreSQL", "数据库", "将 PostgreSQL 表用作结构化存储后端，支持 Schema 隔离；多个专家可共享同一实例。", "db"],
    ["自定义（S3 兼容）", "对象存储", "任意 S3 兼容服务，如 MinIO、Ceph、Cloudflare R2；需自行填写 Endpoint 与访问密钥。", "custom"]
  ];

  function renderAdminStorage() {
    const tab = state.storageTab || "mine";
    let body = "";
    if (tab === "types") {
      body = '<div class="prov-grid" style="margin-top:14px">' + STORAGE_TYPES.map(([n, kind, desc, ic]) =>
        '<div class="store-card"><div class="store-top"><span class="store-ic">' + icon(ic === "cloud" ? "cloud" : ic === "db" ? "database" : ic === "box" ? "package" : ic === "custom" ? "plug" : "monitor", "ic-sm") + "</span>" +
        "<div><b>" + n + '</b><span class="tag ' + (kind === "本地" ? "green" : kind === "沙箱" ? "violet" : "") + ' sm">' + kind + "</span></div></div>" +
        '<div class="store-desc">' + desc + "</div>" +
        '<div class="store-foot"><button class="btn sm text" data-act="storage-config" data-name="' + n + '">点击配置此后端</button></div></div>').join("") + "</div>";
    } else {
      body = state.storages.length
        ? '<div class="prov-grid" style="margin-top:14px">' + state.storages.map((s) =>
          '<div class="store-card on"><div class="store-top"><span class="store-ic">' + icon("cloud", "ic-sm") + "</span><div><b>" + esc(s.name) + '</b><span class="tag green sm">已配置</span></div></div>' +
          '<div class="store-desc">' + esc(s.detail) + "</div>" +
          '<div class="store-foot"><button class="btn sm" data-act="storage-config" data-name="' + esc(s.name) + '">配置</button>' +
          '<button class="btn sm text" data-act="storage-probe" data-name="' + esc(s.name) + '">探测</button></div></div>').join("") + "</div>"
        : '<div class="stack-empty" style="margin-top:16px"><div class="stack-empty-ic">' + icon("database") + "</div>" +
          "<span>还没有配置存储后端，去「支持存储类型」里选一个开始</span>" +
          '<button class="btn primary sm" data-act="storage-tab-types">支持存储类型</button></div>';
    }
    return '<div class="main"><div class="page">' +
      cfgHead("存储管理", "管理本地、对象存储、沙箱与数据库等存储后端，供专家使用",
        '<button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>") +
      body + "</div></div>";
  }

  function renderStorageDrawer() {
    const d = state.storageDraft || (state.storageDraft = { name: "", kind: "腾讯云 COS" });
    const f = (label, key, ph, type) => '<div class="dfield"><label>' + (key === "name" || key === "ak" || key === "sk" || key === "bucket" || key === "region" ? "<i>*</i>" : "") + label + "</label>" +
      '<input class="input" data-input="st-' + key + '" type="' + (type || "text") + '" value="' + esc(d[key] || "") + '" placeholder="' + (ph || "") + '" />' +
      (key === "endpoint" ? '<div class="hint">cos-ap-guangzhou.myqcloud.com</div>' : key === "sk" ? "" : "") + "</div>";
    return '<div class="drawer-mask" data-act="storage-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="配置存储">' +
      '<div class="drawer-h"><b>配置 ' + esc(d.kind || "存储后端") + "</b><span class=\"spacer\"></span><button class=\"icon-btn\" data-act=\"storage-close\">" + icon("x") + "</button></div>" +
      '<div class="drawer-b">' +
      f("名称", "name", "admin") +
      '<div class="dfield"><label>类型</label><select class="input" data-input="st-kind">' + STORAGE_TYPES.map(([n]) => "<option" + (n === d.kind ? " selected" : "") + ">" + n + "</option>").join("") + "</select></div>" +
      f("Access Key", "ak", "", "password") + f("Secret Key", "sk", "SKEYxxx", "password") +
      f("Bucket", "bucket", "my-bucket-1250000000") + f("Region", "region", "ap-guangzhou") + f("Endpoint", "endpoint", "") +
      '<details class="adv"><summary>高级配置（JSON）</summary><textarea class="input mono" rows="5" data-input="st-adv">' + esc(d.adv || "{}") + "</textarea></details>" +
      '<div class="dfield"><label>备注</label><textarea class="input" rows="2" data-input="st-note">' + esc(d.note || "") + "</textarea></div>" +
      "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="storage-close">取消</button>' +
      '<button class="btn" data-act="storage-probe" data-name="' + esc(d.kind) + '">' + icon("search", "ic-sm") + "探测</button>" +
      '<button class="btn primary" data-act="storage-save">创建</button></div></aside>';
  }

  const PLUGIN_CATALOG = [
    ["维基摘要", "工具", "v0.1.0", "读取 Wikipedia 条目摘要", "wiki-summary", "blue"],
    ["今天吃什么", "生活", "v0.1.0", "按餐次与口味随机推荐菜品", "what-to-eat", "red"],
    ["天气", "生活", "v0.2.2", "查询全球城市天气与未来预报，在聊天中展示天气卡片", "weather", "blue"],
    ["单位换算", "工具", "v0.1.0", "长度、质量与温度单位互转", "unit-convert", "violet"],
    ["旅行灵感", "生活", "v0.1.0", "按心情推荐目的地与最佳季节", "travel-inspire", "amber"],
    ["俄罗斯方块", "游戏", "v0.2.2", "在聊天卡片里玩俄罗斯方块，支持键盘与按钮操作", "tetris", "dark"],
    ["赛况", "资讯", "v0.1.0", "英超等联赛近期比分（TheSportsDB）", "sports-scores", "green"],
    ["摸鱼日历", "趣味", "v0.1.0", "距周末与节假日倒计时，附今日摸鱼宜忌卡片", "slack-calendar", "indigo"],
    ["短链接", "工具", "v0.1.0", "将长 URL 压缩为 is.gd 短链", "short-link", "blue"],
    ["服务器状态", "运维", "v0.2.2", "在聊天中展示当前服务器的操作系统、内核与 CPU / 内存 / 磁盘负载", "server-status", "dark"],
    ["二维码", "工具", "v0.2.2", "把文本或链接生成二维码图片卡片", "qrcode", "dark"],
    ["番茄钟", "工具", "v0.2.2", "在聊天中启动番茄钟或倒计时卡片", "pomodoro", "red"],
    ["快递查询", "生活", "v0.2.2", "查询国内快递轨迹，失败时提供快递 100 链接", "parcel-tracker", "amber"],
    ["影视搜索", "影音", "v0.1.0", "在 Bangumi 搜索动画与电影条目", "movie-search", "red"],
    ["小游戏", "游戏", "v0.2.2", "井字棋与猜数字，在聊天中展示棋盘与提示", "mini-games", "violet"],
    ["表情包", "趣味", "v0.1.0", "用 memegen.link 生成梗图", "meme-maker", "pink"],
    ["行情", "财经", "v0.2.2", "查询汇率、加密货币与 A 股行情卡片", "market-quotes", "green"],
    ["IP 查询", "工具", "v0.1.0", "查询 IP 归属地与 ISP 信息", "ip-lookup", "teal"],
    ["热榜", "资讯", "v0.2.2", "查看微博、知乎与 Hacker News 热榜，在聊天中展示可点击列表", "hot-topics", "orange"],
    ["GitHub 趋势", "工具", "v0.1.0", "按语言与时间范围查看 GitHub 新增仓库排行", "github-trending", "dark"],
    ["趣味百科", "趣味", "v0.1.0", "随机冷知识与轻松笑话", "fun-facts", "amber"],
    ["抽签运势", "趣味", "v0.2.2", "掷骰子、今日运势与抽签，在聊天中展示结果卡片", "fortune", "violet"],
    ["每日英语", "工具", "v0.1.0", "每日一词：音标、释义与例句", "daily-english", "blue"],
    ["颜色转换", "工具", "v0.1.0", "在 HEX、RGB 与 HSL 之间转换颜色", "color-convert", "violet"],
    ["哔哩哔哩番剧", "影音", "v0.2.4", "在聊天中搜索哔哩哔哩番剧，并支持分集播放与切换", "bilibili-anime", "pink"],
    ["arXiv 论文查询", "工具", "v0.1.0", "查询 arXiv 论文的标题、作者、摘要和原文链接，无需 API Key", "arxiv-search", "red"],
    ["空气质量", "生活", "v0.1.0", "查询城市 PM2.5 与 AQI 指数", "air-quality", "green"]
  ];

  function renderAdminPlugins() {
    const tab = state.pluginTab || "plugins";
    if (tab === "permissions") {
      const allPerms = Array.from(new Set(PLUGINS.reduce((a, p) => a.concat(p.perms), [])));
      return '<div class="main"><div class="page">' +
        cfgHead("插件管理", "安装并管理服务器插件，各专家可在个性化中单独启用",
          '<button class="btn" data-act="plugin-zip">' + icon("upload", "ic-sm") + "从 ZIP 安装</button>" +
          '<button class="btn primary" data-act="plugin-install">' + icon("plus", "ic-sm") + "安装</button>") +
        '<div class="table-card" style="margin-top:14px"><table class="table"><thead><tr><th>插件</th>' +
        allPerms.map((p) => "<th>" + esc(p) + "</th>").join("") + "<th>状态</th></tr></thead><tbody>" +
        PLUGINS.map((p) => "<tr><td><b>" + esc(p.name) + '</b><div class="hint">v' + esc(p.version) + "</div></td>" +
          allPerms.map((perm) => "<td>" + (p.perms.includes(perm) ? '<span class="tag amber sm">已授予</span>' : '<span class="hint">—</span>') + "</td>").join("") +
          '<td><span class="tag ' + (p.on ? "green" : "") + ' sm">' + (p.on ? "已启用" : "已禁用") + "</span></td></tr>").join("") +
        "</tbody></table></div>" +
        '<div class="alert warn" style="margin-top:14px">' + icon("alert", "ic-sm") + "权限为安装时授予；卸载会立即回收，重新安装需再次确认。</div></div></div>";
    }
    if (tab === "market") {
      const cats = ["全部", "生活", "资讯", "财经", "影音", "趣味", "游戏", "工具", "运维"];
      const cat = state.pluginCat || "全部";
      const q = state.pluginQ || "";
      const list = PLUGIN_CATALOG.filter(([n, c, , d]) => (cat === "全部" || c === cat) && (!q || (n + d).indexOf(q) >= 0));
      return '<div class="main"><div class="page">' +
        cfgHead("插件管理", "安装并管理服务器插件，各专家可在个性化中单独启用") +
        '<div class="filter-row" style="margin:14px 0"><span class="hint">共 ' + PLUGIN_CATALOG.length + " 个</span>" +
        '<span class="spacer"></span><div class="search" style="width:280px">' + icon("search", "ic-sm") +
        '<input placeholder="搜索插件市场" data-input="plugin-q" value="' + esc(q) + '" /></div>' +
        '<button class="icon-btn" data-act="refresh">' + icon("refresh", "ic-sm") + "</button></div>" +
        '<div class="market-cats">' + cats.map((c) => '<button class="chip ' + (cat === c ? "on" : "") + '" data-act="plugin-cat" data-value="' + c + '">' + c + "</button>").join("") + "</div>" +
        '<div class="pm-grid">' + list.map(([n, c, v, d, slug, tone]) =>
          '<div class="pm-card"><div class="pm-head"><span class="pm-badge tone-' + tone + '">' + esc(n[0]) + "</span><b>" + esc(n) + "</b></div>" +
          '<div class="pm-meta">tool · ' + c + " · " + v + "</div>" +
          '<div class="pm-desc">' + esc(d) + "</div>" +
          '<div class="pm-foot"><code>' + esc(slug) + '</code><span class="spacer"></span>' +
          '<button class="btn primary sm" data-act="plugin-install" data-name="' + esc(n) + '" data-ver="' + v + '">' + icon("download", "ic-xs") + "安装</button></div></div>").join("") +
        "</div></div></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("插件管理", "安装并管理服务器插件，各专家可在个性化中单独启用",
        '<button class="btn" data-act="plugin-zip">' + icon("upload", "ic-sm") + "从 ZIP 安装</button>" +
        '<button class="btn primary" data-act="plugin-install">' + icon("plus", "ic-sm") + "安装</button>") +
      '<details class="kb-guide"><summary>' + icon("book", "ic-xs") + "如何开发并导入插件</summary>" +
      '<div class="hint">插件是服务端的 tool 集合：在 plugins/&lt;slug&gt; 下写 commands.js + plugin.json，或从 ZIP 导入；安装后需在「个性化 → 插件」里为专家启用。</div></details>' +
      '<div class="filter-row" style="margin:12px 0"><span class="hint">共 ' + PLUGINS.length + " 个插件</span><span class=\"spacer\"></span>" +
      '<div class="seg-text view"><button class="seg active">' + icon("grid", "ic-xs") + '卡片</button><button class="seg">' + icon("file", "ic-xs") + "表格</button></div>" +
      '<span class="hint" style="display:inline-flex;align-items:center;gap:6px">' + toggle(false, "overwrite", "plugin") + "覆盖已安装</span>" +
      '<button class="btn sm" data-act="refresh">重新加载</button>' +
      '<button class="btn sm" data-act="plugin-zip">' + icon("upload", "ic-sm") + "从 ZIP 安装</button>" +
      '<button class="btn primary sm" data-act="plugin-install">' + icon("plus", "ic-sm") + "安装</button></div>" +
      (PLUGINS.length
        ? '<div class="pm-grid">' + PLUGINS.map((p) =>
          '<div class="pm-card"><div class="pm-head"><span class="pm-badge tone-blue">' + esc(p.name[0]) + "</span><b>" + esc(p.name) + "</b></div>" +
          '<div class="pm-meta">tool · ' + esc(p.version) + '</div><div class="pm-desc">' + esc(p.desc) + "</div>" +
          '<div class="pm-foot">' + (p.perms.length ? p.perms.map((x) => '<span class="tag outline sm">' + x + "</span>").join(" ") : '<span class="hint">无权限</span>') +
          '<span class="spacer"></span>' + toggle(p.on, p.name, "plugin") + "</div></div>").join("") + "</div>"
        : '<div class="stack-empty"><div class="stack-empty-ic">' + icon("package") + "</div><b>尚未安装插件</b><span>可前往插件市场，将精选插件安装到本机。</span>" +
          '<button class="btn primary sm" data-act="plugin-tab-market">打开插件市场</button></div>') +
      "</div></div>";
  }

  const SEC_BANNER = {
    hitl: "<b>工具审批</b> 命中的工具在执行前会暂停，等待用户在对话中批准或拒绝；未开启时工具直接执行。",
    filesystem: "<b>文件访问</b> 按路径规则拦截 read / write 类文件工具，支持 glob 与家目录展开。",
    pii: "<b>敏感信息</b> 检测提示词、模型输出与工具结果中的密钥、手机号、身份证等，并按策略脱敏。",
    toolGuard: "<b>命令防护</b> 对 bash / execute 的 command 参数做正则扫描，命中即可阻断或转审批。",
    skillScan: "<b>技能扫描</b> 安装技能包前做静态检查，发现读取密钥、外发请求等风险模式时告警或拦截。",
    audit: "<b>审计日志</b> 记录审批、拦截、登录与策略变更事件，可按时间与主体检索。"
  };

  function renderAdminSecurity() {
    const tab = state.securityTab || "hitl";
    const sec = state.security || (state.security = {});
    let body = "";
    if (tab === "hitl") {
      body = '<div class="card"><div class="card-b">' +
        '<div class="setting-row"><div class="label"><b>启用工具人工审批</b><span>命中的工具执行前暂停，等待用户在对话中批准或拒绝。</span></div>' + toggle(sec.hitl, "hitl", "security") + "</div>" +
        '<div class="setting-row" style="align-items:flex-start"><div class="label"><b>需审批的工具</b><span>点击切换；勾选后命中列表的工具会暂停。</span></div>' +
        '<div class="row" style="flex-wrap:wrap;max-width:520px">' + ["shell.exec", "fs.write", "git.push", "http.post"].map((x) =>
          '<button class="chip ' + ((sec.tools || []).includes(x) ? "on" : "") + '" data-act="sec-tool" data-value="' + x + '">' +
          ((sec.tools || []).includes(x) ? icon("check", "ic-xs") : "") + x + "</button>").join("") + "</div></div>" +
        '<div class="alert warn" style="margin-top:12px">' + icon("alert", "ic-sm") + "开启后 IM 频道需发送 /approve 或 /reject；Dashboard 会弹出审批卡片。</div></div></div>";
    } else if (tab === "filesystem") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>启用文件路径规则</b><span>匹配的路径对 read/write 类文件工具拒绝访问。</span></div>' + toggle(sec.filesystem, "filesystem", "security") + "</div>" +
        '<div class="field" style="margin-top:12px"><label class="hint">敏感路径（每行一条，支持 glob）</label>' +
        '<textarea class="input" rows="6">~/.ssh/**\n~/.aws/**\n/etc/passwd\n**/.env\n**/secrets/**</textarea></div></div></div>';
    } else if (tab === "pii") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>启用 API Key 脱敏</b><span>检测提示词、输出与工具结果中的密钥。</span></div>' + toggle(sec.pii, "pii", "security") + "</div>" +
        '<div class="setting-row"><div class="label"><b>脱敏策略</b><span>命中后如何处理</span></div><div class="row">' +
        ["掩码", "删除", "阻断", "哈希"].map((x, i) => '<button class="chip ' + (state.piiStrategy === x ? "on" : "") + '" data-act="pii-strategy" data-value="' + x + '">' + x + "</button>").join("") + "</div></div></div></div>";
    } else if (tab === "toolGuard") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>启用命令参数扫描</b><span>对 bash/execute 的 command 参数做正则扫描。</span></div>' + toggle(sec.cmdScan, "cmdScan", "security") + "</div>" +
        '<div class="setting-row"><div class="label"><b>命中规则后的动作</b><span>阻断 / 需人工审批 / 仅记录</span></div>' +
        '<select class="input" id="cmd-action" style="width:220px">' + ["阻断（HIGH/CRITICAL）", "需人工审批（含 MEDIUM）", "仅记录警告"].map((x) => '<option' + ((sec.cmdAction || "阻断（HIGH/CRITICAL）") === x ? " selected" : "") + ">" + x + "</option>").join("") + "</select></div>" +
        '<div class="field"><label class="hint">规则 YAML</label><textarea class="input mono" id="toolguard-yaml" rows="10">rules:\n  - id: rm-rf-root\n    severity: critical\n    pattern: "rm -rf /"\n    tools: [bash, execute]\n    action: block\n  - id: curl-pipe-sh\n    severity: high\n    pattern: "curl .* \\| (ba)?sh"\n    action: require_approval</textarea></div>' +
        '<div class="row" style="margin-top:10px"><button class="btn" data-act="security-reset-rules">恢复默认规则</button><span class="spacer"></span><button class="btn primary" data-act="security-save-rules">保存规则</button></div></div></div>';
    } else if (tab === "skillScan") {
      body = '<div class="card"><div class="card-b"><div class="setting-row"><div class="label"><b>技能安装前扫描</b><span>静态扫描技能包中的风险模式。</span></div>' + toggle(state.skillScan !== "关闭", "skillScanOn", "security") + "</div>" +
        '<div class="setting-row"><div class="label"><b>扫描模式</b><span>发现风险后的处理</span></div><div class="row">' +
        ["关闭", "警告", "拦截"].map((x, i) => '<button class="chip ' + (state.skillScan === x ? "on" : "") + '" data-act="skill-scan" data-value="' + x + '">' + x + "</button>").join("") + "</div></div></div></div>";
    } else {
      const rows = [
        { time: "10:12", event: "tool.approval.requested", subject: "alice · shell.exec", result: "pending" },
        { time: "10:07", event: "policy.denied", subject: "bob · fs.write ~/.ssh", result: "blocked" },
        { time: "09:40", event: "login.failed", subject: "unknown · 3 次", result: "locked" },
      ].concat(state.auditEvents.slice(0, 20).map((e) => ({ time: e.at, event: e.kind, subject: e.title + " · " + e.taskId, result: "allow" })));
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
      '<div class="sso-banner">' + icon("shield", "ic-sm") + "<span>" + SEC_BANNER[tab] + "</span></div>" +
      '<div style="margin-top:12px">' + body + "</div>" +
      '<div class="hint" style="margin-top:10px">保存后运行中的专家会自动重新加载配置；审批与停止等决策会实时写入审计。</div></div></div>';
  }

  const ADV_BANNER = {
    env: "<b>环境变量</b> 写入服务端进程环境，保存后新会话生效；含密钥的变量会以掩码展示。",
    backup: "<b>备份与恢复</b> 备份包含控制面数据库、配置与工作区清单；恢复会覆盖当前实例，请先下载现有备份。",
    https: "<b>HTTPS</b> 上传证书与私钥后需要重启服务；也可以在反向代理层终止 TLS。",
    updates: "<b>应用更新</b> 检查新版本并升级；升级后需重启服务，进行中的任务会中断。",
    webauthn: "<b>通行密钥</b> 配置 RP ID 与允许的 Origin 后可启用无密码登录，建议同时保留密码登录作为兜底。"
  };

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
      cfgHead("应用设置", "管理环境变量、备份、HTTPS、系统更新与通行密钥。",
        '<button class="btn" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>") +
      '<div class="sso-banner">' + icon("settings", "ic-sm") + "<span>" + ADV_BANNER[tab] + "</span></div>" +
      '<div style="margin-top:12px">' + body + "</div></div></div>";
  }

  /* ---------------- render: knowledge ---------------- */
  function renderKnowledge() {
    const kb = kbById(state.kb);
    const docs = DOCS[kb.id] || [];
    const cfg = kbCfgOf(kb);
    const tabs = [["docs", "文档"], ["retrieval", "检索测试"]];
    const kbCard = (k) => {
      const ds = DOCS[k.id] || [];
      const kc = kbCfgOf(k);
      return '<div class="kb-item ' + (k.id === kb.id ? "active" : "") + '" data-act="kb-select" data-id="' + k.id + '">' +
        '<div class="kb-item-top"><span class="kb-item-ic">' + icon("book", "ic-sm") + "</span>" +
        "<b>" + esc(k.name) + "</b>" +
        '<span class="spacer"></span><button class="icon-btn" data-act="kb-menu" data-id="' + k.id + '" title="更多">' + icon("more", "ic-sm") + "</button></div>" +
        '<div class="kb-item-desc">' + esc(k.desc || "暂无描述") + "</div>" +
        '<div class="kb-item-foot"><span>创建者：' + esc(k.owner || "ad") + "</span><span>" + ds.length + " 个文档</span>" +
        (kc.enabled ? '<span class="kb-default">默认开启</span>' : "") + "</div></div>";
    };
    const left = '<aside class="kb-col"><div class="kb-col-head"><b>知识库</b><span class="spacer"></span>' +
      '<button class="icon-btn" data-act="kb-refresh" title="刷新">' + icon("refresh", "ic-sm") + "</button></div>" +
      '<button class="btn primary block" data-act="kb-new">' + icon("plus", "ic-sm") + "创建知识库</button>" +
      '<div class="kb-list">' + KBS.map(kbCard).join("") + "</div></aside>";
    const panelHead = '<div class="kb-panel-head"><div class="kb-panel-title">' + icon("book", "ic-sm") + "<b>" + esc(kb.name) + "</b></div>" +
      '<span class="spacer"></span>' +
      '<div class="seg-text view"><button class="seg ' + (state.kbView !== "table" ? "active" : "") + '" data-act="kb-view" data-value="card">' + icon("grid", "ic-xs") + "卡片</button>" +
      '<button class="seg ' + (state.kbView === "table" ? "active" : "") + '" data-act="kb-view" data-value="table">' + icon("file", "ic-xs") + "表格</button></div>" +
      '<button class="btn sm" data-act="kb-newfolder">' + icon("folder", "ic-sm") + "新建文件夹</button>" +
      '<button class="btn sm" data-act="kb-newfile">' + icon("file", "ic-sm") + "新建文件</button>" +
      '<button class="btn primary sm" data-act="kb-upload">' + icon("upload", "ic-sm") + "上传文档</button></div>" +
      '<div class="kb-panel-sub"><span class="hint">' + docs.length + " / " + (cfg.maxDocs || 1000) + ' 个文档</span><span class="spacer"></span>' +
      '<span class="hint">支持文本（md / txt / rst / html / json / yaml 等）、表格（csv / tsv / xls / xlsx / xlsm）、pdf / doc / wps / docx / pptx；单文件不超过 ' +
      (cfg.maxMb || 100) + " MB，可直接拖到本页上传。</span></div>";
    const body = state.kbTab === "retrieval" ? renderRetrieval(kb) : renderDocs(docs, kb);
    return '<div class="main"><div class="page">' +
      '<div class="page-head"><div><div class="page-title">知识库</div>' +
      '<div class="page-sub">上传文档建立索引，在对话中检索引用，也可共享给同实例用户</div></div>' +
      '<div class="page-actions"><button class="btn" data-act="kb-open-settings">' + icon("sliders", "ic-sm") + "知识库设置</button></div></div>" +
      '<div class="kb-layout">' + left + '<section class="kb-panel">' + panelHead +
      '<div class="tabs">' + tabs.map(([id, label]) =>
        '<button class="tab ' + ((state.kbTab || "docs") === id ? "active" : "") + '" data-act="kb-tab" data-id="' + id + '">' + label +
        (id === "docs" ? '<span class="count">' + docs.length + "</span>" : "") + "</button>").join("") + "</div>" +
      '<div class="kb-panel-body">' + body + "</div></section></div></div></div>";
  }

  function docTag(status) {
    return '<span class="tag ' + (status === "ready" ? "green" : status === "failed" ? "red" : "amber") + ' sm">' +
      ({ ready: "就绪", failed: "失败", processing: "解析中" }[status] || status) + "</span>";
  }

  function renderDocs(docs, kb) {
    const q = (state.kbSearch || "").toLowerCase();
    const folder = state.kbFolder && state.kbFolder !== "root" ? state.kbFolder : "";
    const inFolder = (name) => !folder || folderOf(name) === folder;
    const filtered = docs.filter((d) => inFolder(d[0]) && (!q || d[0].toLowerCase().includes(q)));
    const folders = state.kbFolders[kb.id] || [];
    const selected = state.kbSelected || [];
    const processing = docs.filter((d) => d[2] === "processing");
    const failed = docs.filter((d) => d[2] === "failed");
    const sortIcon = (name) => (state.kbView === "table" ? "" : "");
    const folderChips = '<div class="chip-row">' +
      '<button class="chip ' + (!folder ? "on" : "") + '" data-act="kb-folder" data-value="root">全部目录<span class="chip-n">' + docs.length + "</span></button>" +
      folders.map((f) => {
        const n = docs.filter((d) => folderOf(d[0]) === f).length;
        return '<button class="chip ' + (folder === f ? "on" : "") + '" data-act="kb-folder" data-value="' + esc(f) + '">' + esc(f) + '<span class="chip-n">' + n + "</span></button>";
      }).join("") + "</div>";
    const bar = '<div class="kb-doc-bar">' + folderChips + '<span class="spacer"></span>' +
      '<div class="search" style="width:220px">' + icon("search", "ic-sm") +
      '<input id="kb-search" data-input="kb-search" placeholder="搜索文档" value="' + esc(state.kbSearch || "") + '" /></div>' +
      '<button class="icon-btn" data-act="kb-refresh" title="刷新">' + icon("refresh", "ic-sm") + "</button></div>";
    const bulk = selected.length ? '<div class="bulkbar"><b>已选 ' + selected.length + " 项</b><span class=\"spacer\"></span>" +
      '<button class="btn sm" data-act="kb-bulk-reindex">重建索引</button>' +
      '<button class="btn sm danger" data-act="kb-bulk-delete">删除</button></div>' : "";
    const bars = (processing.length ? '<div class="kb-uploadbar">' + icon("upload", "ic-sm") +
      "正在解析 " + esc(processing[0][0]) + ' <div class="progress" style="flex:1;max-width:220px"><i class="indeterminate" style="width:62%"></i></div>' +
      '<span class="hint">完成后自动可检索</span></div>' : "") +
      (failed.length ? '<div class="kb-uploadbar error">' + icon("alert", "ic-sm") +
      failed.length + " 个文档解析失败（" + esc(failed[0][0]) + '）<span class="spacer"></span>' +
      '<button class="btn sm" data-act="doc-retry-all">全部重试</button></div>' : "");
    const docCard = (d) => {
      const ext = (d[0].split(".").pop() || "file").toUpperCase();
      return '<div class="doc-card"><div class="doc-card-top">' +
        '<span class="checkbox ' + (selected.includes(d[0]) ? "on" : "") + '" data-act="kb-toggle-doc" data-name="' + esc(d[0]) + '">' + icon("check") + "</span>" +
        '<span class="doc-ic">' + esc(ext.slice(0, 4)) + "</span>" +
        '<div class="doc-main"><b title="' + esc(d[0]) + '">' + esc(d[0]) + "</b>" +
        '<div class="hint">' + d[3] + " 分块 · " + esc(d[4]) + " · " + esc(folderOf(d[0]) || "根目录") + "</div></div></div>" +
        '<div class="doc-card-foot">' + docTag(d[2]) + '<span class="spacer"></span>' +
        '<button class="icon-btn" data-act="doc-preview" data-name="' + esc(d[0]) + '" title="预览">' + icon("file", "ic-sm") + "</button>" +
        '<button class="icon-btn" data-act="doc-reindex" data-name="' + esc(d[0]) + '" title="重建索引">' + icon("refresh", "ic-sm") + "</button>" +
        '<button class="icon-btn" data-act="doc-delete" data-name="' + esc(d[0]) + '" title="删除">' + icon("trash", "ic-sm") + "</button></div></div>";
    };
    const grid = '<div class="doc-grid">' + filtered.map(docCard).join("") + "</div>";
    const table = '<div class="kb-table-wrap"><table class="table"><thead><tr><th style="width:28px"><span class="checkbox ' +
      (filtered.every((d) => selected.includes(d[0])) ? "on" : "") + '" data-act="kb-select-all">' + icon("check") + '</span></th><th>文件名</th><th style="width:72px">状态</th><th style="width:48px">分块</th><th style="width:84px">更新时间</th><th style="width:120px;text-align:right">操作</th></tr></thead><tbody>' +
      filtered.map((d) => '<tr><td><span class="checkbox ' + (selected.includes(d[0]) ? "on" : "") + '" data-act="kb-toggle-doc" data-name="' + esc(d[0]) + '">' + icon("check") + "</span></td>" +
        '<td><div class="kb-doc-name">' + icon("file", "ic-sm") + "<b>" + esc(d[0]) + '</b><span class="hint">' + esc(folderOf(d[0]) || "根目录") + "</span></div></td>" +
        "<td>" + docTag(d[2]) + "</td><td>" + d[3] + "</td><td>" + esc(d[4]) + "</td>" +
        '<td style="text-align:right"><button class="btn sm text" data-act="doc-preview" data-name="' + esc(d[0]) + '">预览</button>' +
        (d[2] === "failed" ? '<button class="btn sm text" data-act="doc-retry" data-name="' + esc(d[0]) + '">重试</button>'
          : '<button class="btn sm text" data-act="doc-reindex" data-name="' + esc(d[0]) + '">重建</button>') +
        '<button class="btn sm text danger" data-act="doc-delete" data-name="' + esc(d[0]) + '">删除</button></td></tr>').join("") +
      "</tbody></table></div>";
    const empty = '<div class="empty" style="padding:48px 20px"><div class="glyph">' + icon("search") + "</div><b>" +
      (docs.length ? "这个目录下没有文档" : "还没有文档") + "</b><p>" +
      (docs.length ? "清空目录或搜索，或上传一篇文档。" : "拖拽文件到此处，或点击上传；支持 PDF / Word / Markdown / 表格 / 图片 OCR。") + "</p>" +
      '<div class="row"><button class="btn" data-act="kb-search-clear">清空搜索</button>' +
      (folder ? '<button class="btn" data-act="kb-folder" data-value="root">清除目录</button>' : "") +
      '<button class="btn primary" data-act="kb-upload">上传文档</button></div></div>';
    const content = filtered.length ? (state.kbView === "table" ? table : grid) : empty;
    return bar + bulk + bars + content +
      '<div class="kb-hint">' + icon("info", "ic-sm") + "解析完成后自动进入索引；失败可单独重试，删除会同步清理切片。" +
      (state.kbView === "table" ? "" : sortIcon()) + "</div>";
  }

  function renderRetrieval(kb) {
    return '<div class="card" style="margin-top:14px"><div class="card-b">' +
      '<div class="row" style="flex-wrap:wrap;align-items:flex-end;gap:10px">' +
      '<div class="field" style="flex:1;min-width:280px;margin:0"><label class="hint">问题</label>' +
      '<input class="input" id="retrieval-q" placeholder="输入问题，例如：发布流程需要谁审批？" /></div>' +
      '<div class="field" style="margin:0"><label class="hint">检索模式</label><select class="input" id="retrieval-mode" style="width:120px"><option>混合检索</option><option>向量</option><option>关键词</option></select></div>' +
      '<div class="field" style="margin:0"><label class="hint">TopK</label><input class="input" id="retrieval-topk" type="number" value="5" min="1" max="20" style="width:80px" /></div>' +
      '<button class="btn primary" data-act="kb-test-run">检索</button></div>' +
      (state.kbTest ? '<div style="margin-top:18px">' + state.kbTest.map((r, i) =>
        '<div class="panel" style="margin-top:10px"><div class="panel-h"><b>#' + (i + 1) + "</b><span class=\"sub\">" + esc(r.src) + "</span>" +
        '<span class="spacer"></span><span class="tag green sm">score ' + r.score + '</span><span class="tag outline sm">' + (r.ms || 12) + " ms</span>" +
        '<span class="tag sm">' + esc(r.acl || "ACL · 仅自己") + "</span></div>" +
        '<div class="hint">' + esc(r.text) + "</div></div>").join("") +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="kb-test-clear">清空结果</button>' +
        '<span class="hint">分数为 RRF 融合后的相对值，不等于概率。</span></div></div>'
        : '<div class="empty" style="padding:40px"><div class="glyph">' + icon("search") + "</div><b>还没有检索结果</b><p>输入问题，查看命中的切片、来源、分数与耗时；没命中会给出原因。</p>" +
        '<div class="row"><button class="chip" data-act="kb-test-sample" data-value="发布流程需要谁审批？">发布流程需要谁审批？</button>' +
        '<button class="chip" data-act="kb-test-sample" data-value="回滚窗口多长？">回滚窗口多长？</button></div></div>') +
      "</div></div>";
  }

  function kbCfgOf(kb) {
    if (!state.kbCfg[kb.id]) state.kbCfg[kb.id] = { enabled: true, model: "bge-m3", ocr: "关闭", chunk: 800, overlap: 120, maxDocs: 1000, maxMb: 50, retrieval: "hybrid", share: "self" };
    return state.kbCfg[kb.id];
  }

  function kbModelList(cfg) {
    const online = ["qwen3.7-text-embedding", "qwen3.7-text-embedding-flash", "MiniMax/MiniMax-M2.5", "MiniMax/MiniMax-M2.7",
      "MiniMax/MiniMax-M3", "ZHIPU/GLM-5.1", "ZHIPU/GLM-5.3", "cmaas-qwen3.8-flash"];
    const local = ["bge-m3", "bge-small-zh", "bge-large-zh", "text2vec-base-chinese"];
    const list = cfg.modelSource === "online" ? online : local;
    return '<div class="model-pick"><div class="model-search">' + icon("search", "ic-sm") +
      '<input placeholder="搜索模型" data-input="kb-model-q" value="' + esc(state.kbModelQ || "") + '" /></div>' +
      '<div class="model-list">' + list.filter((m) => !state.kbModelQ || m.toLowerCase().includes(String(state.kbModelQ).toLowerCase())).map((m) =>
        '<button class="model-row ' + (cfg.model === m ? "active" : "") + '" data-act="kb-model-set" data-value="' + esc(m) + '">' +
        icon("cpu", "ic-sm") + "<span>" + esc(m) + "</span>" +
        (cfg.model === m ? '<span class="tag brand sm">当前</span>' : "") + "</button>").join("") + "</div></div>";
  }

  function kbSettingsBody(kb) {
    const cfg = kbCfgOf(kb);
    return (state.kbDirty ? '<div class="alert warn" style="margin-bottom:12px">' + icon("alert", "ic-sm") + "有未保存的修改；保存后对全实例生效。</div>" : "") +
      '<div class="setting-row"><div class="label"><b>启用知识库</b><span>实例级开关；关闭后全实例不可用</span></div>' + toggle(cfg.enabled, "enabled", "kbcfg") + "</div>" +
      '<div class="form-section"><div class="form-section-h">选择向量模型</div>' +
      '<div class="seg-text view" style="width:fit-content;margin-bottom:8px">' +
      '<button class="seg ' + (cfg.modelSource !== "online" ? "active" : "") + '" data-act="kb-model-source" data-value="local">' + icon("cpu", "ic-xs") + "本地 ONNX</button>" +
      '<button class="seg ' + (cfg.modelSource === "online" ? "active" : "") + '" data-act="kb-model-source" data-value="online">' + icon("cloud", "ic-xs") + "Online Embedding</button></div>" +
      kbModelList(cfg) +
      '<div class="hint" style="margin-top:6px;color:var(--amber-text)">' + icon("alert", "ic-xs") + " 切换向量模型会重建全部索引，期间检索结果可能不完整。</div></div>" +
      '<div class="setting-row"><div class="label"><b>图片与扫描件 OCR</b><span>可选；启用后可索引图片与扫描 PDF</span></div>' +
      '<select class="input" id="kb-ocr" style="width:170px">' + ["关闭", "本地 ONNX", "在线视觉模型"].map((m) => '<option' + (cfg.ocr === m ? " selected" : "") + ">" + m + "</option>").join("") + "</select></div>" +
      '<div class="setting-grid">' +
      agentField("切片大小", '<input class="input" id="kb-chunk" type="number" value="' + cfg.chunk + '" />') +
      agentField("切片重叠", '<input class="input" id="kb-overlap" type="number" value="' + cfg.overlap + '" />') +
      agentField("文档数量上限", '<input class="input" id="kb-maxdocs" type="number" value="' + cfg.maxDocs + '" />') +
      agentField("单文件上限（MB）", '<input class="input" id="kb-maxmb" type="number" value="' + cfg.maxMb + '" />') +
      "</div>" +
      '<div class="setting-row"><div class="label"><b>检索模式</b><span>' + (cfg.retrieval === "hybrid" ? "混合检索（向量 + 关键词）" : cfg.retrieval === "vector" ? "仅向量" : "仅关键词") + "</span></div><button class=\"btn sm\" data-act=\"kb-retrieval-config\">修改</button></div>" +
      '<div class="setting-row"><div class="label"><b>共享范围</b><span>' + (cfg.share === "self" ? "仅自己" : cfg.share === "all" ? "所有人可读" : "指定分组") + "</span></div><button class=\"btn sm\" data-act=\"kb-share-config\">修改</button></div>";
  }

  function kbEditBody(kb) {
    const d = state.kbEdit || { name: kb.name, desc: kb.desc || "", icon: "book", maxDocs: 1000, enabled: true, share: "self" };
    const ICONS = ["book", "file", "folder", "chart", "users", "puzzle", "globe", "cpu", "database", "package", "shield", "spark"];
    return '<div class="form-section"><div class="form-section-h">图标</div>' +
      '<div class="kb-icon-grid">' + ICONS.map((i) =>
        '<button class="kb-icon ' + (d.icon === i ? "active" : "") + '" data-act="kbedit-icon" data-value="' + i + '" title="' + i + '">' + icon(i, "ic-sm") + "</button>").join("") + "</div></div>" +
      '<div class="dfield"><label><i>*</i>名称</label><input class="input" data-input="kbedit-name" value="' + esc(d.name) + '" /></div>' +
      '<div class="dfield"><label>描述</label><textarea class="input" rows="3" data-input="kbedit-desc" placeholder="一句话说明这个知识库收录什么">' + esc(d.desc) + "</textarea>" +
      '<div class="row" style="justify-content:flex-end;margin-top:4px"><button class="btn sm text" data-act="kb-ai-desc">' + icon("spark", "ic-xs") + "AI 润色</button></div></div>" +
      '<div class="dfield"><label>文档数量上限</label><input class="input" type="number" data-input="kbedit-maxdocs" value="' + (kbCfgOf(kb).maxDocs || 1000) + '" />' +
      '<div class="hint">超过上限后上传会被拒绝；默认 1000。</div></div>' +
      '<div class="setting-row"><div class="label"><b>默认启用</b><span>新会话默认带上这个知识库</span></div>' + toggle(kbCfgOf(kb).enabled, "enabled", "kbcfg") + "</div>" +
      '<div class="setting-row"><div class="label"><b>谁可以使用</b><span>控制共享范围；共享时同一实例的用户可读</span></div>' +
      '<div class="row"><button class="chip ' + (kbCfgOf(kb).share !== "all" ? "on" : "") + '" data-act="kb-share" data-value="self">仅自己</button>' +
      '<button class="chip ' + (kbCfgOf(kb).share === "all" ? "on" : "") + '" data-act="kb-share" data-value="all">所有人</button></div></div>';
  }

  function renderKbDrawer() {
    const kb = kbById(state.kb);
    const isSettings = state.kbDrawer === "settings";
    return '<div class="drawer-mask" data-act="kb-drawer-close"></div>' +
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="' + (isSettings ? "知识库设置" : "编辑知识库") + '">' +
      '<div class="drawer-h"><b>' + (isSettings ? "知识库设置" : "编辑知识库") + "</b><span class=\"spacer\"></span>" +
      '<button class="icon-btn" data-act="kb-drawer-close" title="关闭">' + icon("x") + "</button></div>" +
      '<div class="drawer-b">' + (isSettings ? kbSettingsBody(kb) : kbEditBody(kb)) + "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="kb-drawer-close">取消</button>' +
      '<button class="btn primary" data-act="kb-drawer-save">保存</button></div></aside>';
  }

  /* ---------------- render: agents ---------------- */
  function renderAgents() {
    const tab = state.agentPageTab || "mine";
    const scope = state.agentScope || "all";
    const view = state.agentView || "cards";
    const q = (state.agentQ || "").trim().toLowerCase();
    const list = AGENTS.filter((a) => {
      if (q && !(a.name + a.desc + a.model).toLowerCase().includes(q)) return false;
      if (scope === "cloud" || scope === "shared") return false;
      return true;
    });
    const statusTag = (a) => '<span class="tag ' + (a.status === "运行中" ? "green" : a.status === "空闲" ? "blue" : "") + ' sm">' +
      '<span class="dot ' + (a.status === "运行中" ? "green" : a.status === "空闲" ? "blue" : "") + '" style="margin-right:5px"></span>' + esc(a.status) + "</span>";
    const card = (a) => '<div class="expert-card" data-act="agent-open" data-id="' + a.id + '">' +
      '<div class="expert-top"><span class="avatar ' + a.color + '">' + esc(a.name[0]) + "</span>" +
      '<div class="expert-id"><div class="row" style="gap:7px"><b>' + esc(a.name) + "</b></div>" +
      '<div class="hint mono">ID ' + esc((a.code || a.id).toUpperCase()) + "</div></div>" +
      '<span class="spacer"></span>' + toggle(a.status !== "已停止", a.id, "agent-enable") + "</div>" +
      '<div class="expert-model">' + statusTag(a) + '<span class="tag outline sm">' + esc(a.model) + "</span>" +
      (a.published ? '<span class="tag green sm">已发布 ' + esc(a.version || "v3") + "</span>" : '<span class="tag sm">草稿</span>') + "</div>" +
      '<div class="expert-desc">' + esc(a.desc) + "</div>" +
      '<div class="expert-foot"><button class="icon-btn" data-act="nav" data-route="workbench" title="工作区">' + icon("folder", "ic-sm") + "</button>" +
      '<button class="icon-btn" data-act="agent-test" data-id="' + a.id + '" title="试运行">' + icon("refresh", "ic-sm") + "</button>" +
      '<button class="icon-btn" data-act="agent-open" data-id="' + a.id + '" title="编辑">' + icon("edit", "ic-sm") + "</button>" +
      '<button class="icon-btn" data-act="agent-duplicate" data-id="' + a.id + '" title="复制">' + icon("copy", "ic-sm") + "</button>" +
      '<button class="icon-btn" data-act="agent-menu" data-id="' + a.id + '" title="更多">' + icon("more", "ic-sm") + "</button>" +
      '<span class="spacer"></span><button class="btn sm" data-act="agent-chat" data-id="' + a.id + '">对话' + icon("chev", "ic-xs") + "</button></div></div>";
    const rows = list.map((a) => "<tr>" +
      '<td><div class="row"><span class="avatar ' + a.color + '" style="width:30px;height:30px;border-radius:8px;font-size:13px">' + esc(a.name[0]) + "</span>" +
      "<div><b>" + esc(a.name) + '</b><div class="hint">' + esc(a.desc) + "</div></div></div></td>" +
      "<td>" + esc(a.model) + "</td><td>" + statusTag(a) + '</td><td class="num">' + a.sessions + "</td><td>" + esc(a.version || "—") + "</td>" +
      '<td><button class="btn sm text" data-act="agent-open" data-id="' + a.id + '">编辑</button>' +
      '<button class="btn sm text" data-act="agent-chat" data-id="' + a.id + '">对话</button></td></tr>').join("");
    const MARKET = [
      ["内容推送", "一文多发助手：把 Markdown 一键发布到内容运营平台与公众号", 3],
      ["腾讯云 API 专家", "用自然语言管理腾讯云 200+ 产品资源，自动生成脚本", 1],
      ["工程方法论教练", "探索—计划—TDD—调试—审查—验证的完整工作流", 3],
      ["证券观察员", "行情解读、基本面与技术面分析，按板块轮动复盘", 1],
      ["效率专家", "任务管理与职场记忆，记录 CV、术语与项目上下文", 4],
      ["Ops 运维工程师", "Linux、Kubernetes、Docker、数据库排障与巡检", 0],
      ["办公自动化", "绑定 Excel / PPT / PDF 全套文档能力", 6],
      ["协作编排专家", "把一句话需求拆成有依赖关系的可执行步骤", 0],
    ];
    const marketCards = MARKET.map(([n, d, s]) =>
      '<div class="market-card"><div class="row" style="gap:9px"><span class="avatar blue" style="width:34px;height:34px;border-radius:8px;font-size:14px">' + esc(n[0]) + "</span>" +
      "<b>" + esc(n) + "</b></div><div class=\"market-desc\">" + esc(d) + "</div>" +
      '<div class="market-foot"><span class="hint">' + s + ' 个技能</span><span class="spacer"></span>' +
      '<button class="btn sm primary" data-act="agent-market-create" data-value="' + esc(n) + '">创建</button></div></div>').join("");
    const scopes = [["all", "全部"], ["local", "本地"], ["cloud", "云端"], ["shared", "共享"]];
    const head = '<div class="page-head"><div><div class="page-title">专家</div>' +
      '<div class="page-sub">创建与管理你的 AI 专家，也可以从模板一键新建</div></div></div>';
    const tabs = '<div class="tabs page-tabs">' + [["mine", "我的专家"], ["team", "我的团队"], ["market", "发现专家"]].map(([id, label]) =>
      '<button class="tab ' + (tab === id ? "active" : "") + '" data-act="agent-page-tab" data-value="' + id + '">' + label + "</button>").join("") + "</div>";
    let body = "";
    if (tab === "market") {
      body = '<div class="market-bar"><div class="market-cats">' +
        ["精选", "全部", "内容创作", "技术", "金融", "教育", "医疗健康", "设计"].map((c, i) =>
          '<button class="chip ' + (i === 0 ? "on" : "") + '">' + c + "</button>").join("") + "</div>" +
        '<span class="spacer"></span><div class="search" style="width:220px">' + icon("search", "ic-sm") + '<input placeholder="搜索专家" data-input="agent-search" value="' + esc(state.agentQ || "") + '" /></div>' +
        '<button class="icon-btn" data-act="refresh" title="刷新">' + icon("refresh", "ic-sm") + "</button></div>" +
        '<div class="market-grid">' + marketCards + "</div>";
    } else if (tab === "team") {
      body = '<div class="card"><div class="empty"><div class="glyph">' + icon("users") + "</div><b>还没有团队</b>" +
        '<p>把多个专家编成团队，一句话派发跨专家的任务。</p><div class="row"><button class="btn primary" data-act="refresh">新建团队</button>' +
        '<button class="btn" data-act="agent-page-tab" data-value="market">去专家市场看看</button></div></div></div>';
    } else {
      body = '<div class="filter-row"><span class="hint">共 ' + list.length + " 个专家</span>" +
        '<div class="seg-text">' + scopes.map(([id, label]) =>
          '<button class="seg ' + (scope === id ? "active" : "") + '" data-act="agent-scope" data-value="' + id + '">' + label + "</button>").join("") + "</div>" +
        '<span class="spacer"></span><div class="search" style="width:200px">' + icon("search", "ic-sm") +
        '<input placeholder="搜索专家" data-input="agent-search" value="' + esc(state.agentQ || "") + '" /></div>' +
        '<div class="seg-text view"><button class="seg ' + (view === "cards" ? "active" : "") + '" data-act="agent-view" data-value="cards">' + icon("grid", "ic-xs") + "卡片</button>" +
        '<button class="seg ' + (view === "table" ? "active" : "") + '" data-act="agent-view" data-value="table">' + icon("file", "ic-xs") + "表格</button></div>" +
        '<button class="icon-btn" data-act="refresh" title="刷新">' + icon("refresh", "ic-sm") + "</button>" +
        '<button class="btn" data-act="refresh">添加云端专家</button>' +
        '<button class="btn" data-act="refresh">新建托管专家 <span class="tag brand sm">BETA</span></button>' +
        '<button class="btn primary" data-act="agent-new">' + icon("plus", "ic-sm") + "新建专家</button>" +
        '<button class="btn" data-act="agent-page-tab" data-value="market">从专家市场新建</button></div>' +
        (list.length
          ? (view === "table"
            ? '<div class="table-card" style="margin-top:14px"><table class="table"><thead><tr><th>专家</th><th>模型</th><th>状态</th><th class="num">会话</th><th>版本</th><th>操作</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
            : '<div class="agent-grid" style="margin-top:14px">' + list.map(card).join("") + "</div>")
          : '<div class="card"><div class="empty"><div class="glyph">' + icon("bot") + "</div><b>没有匹配的专家</b>" +
            '<p>换个关键词，或从空模板新建一个。</p><div class="row"><button class="btn" data-act="agent-scope" data-value="all">查看全部</button>' +
            '<button class="btn primary" data-act="agent-new">新建专家</button></div></div></div>');
    }
    return '<div class="main"><div class="page">' + head + tabs + body + "</div></div>";
  }

  function agentDraftOf() {
    const a = AGENTS.find((x) => x.id === state.agent) || AGENTS[0];
    if (!a) return null;
    if (!state.agentDraft || state.agentDraft.id !== a.id) {
      state.agentDraft = {
        id: a.id, name: a.name, desc: a.desc, model: a.model, mode: a.mode || "Act",
        welcome: a.welcome || "今天想先处理哪件事？", visibility: a.visibility || "仅自己", color: a.color,
        temperature: 0.7, iterations: 30, maxInput: 128000, topP: 1,
        heartbeat: true, proactive: true, trace: true, interval: "1h", checkEvery: "1h", cooldown: 8,
        quietStart: "09:00", quietEnd: "21:00", dndStart: "22:00", dndEnd: "08:00",
        skills: { weather: true, "github-trending": true, qrcode: false },
        subagents: { "调研员": true, "写手": false },
        rootDir: "/data/workspaces/" + a.id,
      };
    }
    if (!a.versions) a.versions = [{ v: "v3", note: "当前", at: "2026-11-05 10:02" }, { v: "v2", note: "已发布", at: "2026-11-03 18:20" }, { v: "v1", note: "初始", at: "2026-10-28 09:10" }];
    if (!a.version) a.version = "v3";
    if (!a.files) a.files = {
      "SOUL.md": "# " + a.name + "\n\n你是" + a.desc + "。\n先确认事实，再给出可执行结论；不确定时明确说明。",
      "IDENTITY.md": "名称：" + a.name + "\n语气：直接、专业、先结论后依据",
      "USER.md": "用户：admin\n偏好：中文、先结论、代码用 camelCase",
      "AGENTS.md": "1. 先只读定位，再申请写权限\n2. 写操作前必须建任务\n3. 完成后给出可回滚点",
      "TOOLS.md": "fs.read · fs.write · shell.exec（需审批）· kb.search",
      "HEARTBEAT.md": "- 每天 09:00 汇总待决事项\n- 发布窗口前 1 小时提醒",
    };
    return state.agentDraft;
  }

  function applyAgentDraft(a, d) {
    if (!a || !d) return;
    a.name = d.name || a.name; a.desc = d.desc || a.desc; a.model = d.model || a.model;
    a.color = d.color || a.color; a.mode = d.mode; a.welcome = d.welcome; a.visibility = d.visibility;
  }

  function renderAgentDrawer(a) {
    if (!a) return "";
    const d = agentDraftOf();
    if (!d) return "";
    const tabs = [["basic", "基本信息"], ["runtime", "模型与运行"], ["prompt", "配置文件"], ["skills", "技能"],
      ["subagents", "子智能体"], ["workspace", "工作区"], ["heartbeat", "心跳与主动"], ["persona", "人格与记忆"], ["versions", "版本"]];
    return '<div class="drawer-mask" data-act="close-drawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="编辑专家">' +
      '<div class="drawer-h"><span class="avatar ' + d.color + '" style="width:34px;height:34px">' + esc((d.name || "?")[0]) + "</span>" +
      "<div><b>" + esc(d.name) + '</b><div class="hint">' + esc(d.model) + " · " + esc(a.status) + " · " + esc(a.version || "v3") + "</div></div>" +
      (state.drawerDirty ? '<span class="tag amber sm" style="margin-left:6px">有未保存修改</span>' : '<span class="tag green sm" style="margin-left:6px">已同步</span>') +
      '<div class="spacer"></div><button class="btn sm" data-act="agent-test" data-id="' + a.id + '">试运行</button>' +
      '<button class="btn sm primary" data-act="agent-publish" data-id="' + a.id + '">发布</button>' +
      '<button class="icon-btn" data-act="close-drawer" title="关闭" aria-label="关闭">' + icon("x") + "</button></div>" +
      '<div class="tabs" style="padding:0 18px">' + tabs.map(([id, label]) =>
        '<button class="tab ' + (state.agentTab === id ? "active" : "") + '" data-act="agent-tab" data-id="' + id + '">' + label + "</button>").join("") + "</div>" +
      '<div class="drawer-b">' + renderAgentTab(a) + "</div>" +
      '<div class="drawer-f"><button class="btn" data-act="agent-export" data-id="' + a.id + '">导出 .poly</button>' +
      '<button class="btn" data-act="agent-import" data-id="' + a.id + '">导入 .poly</button><span class="spacer"></span>' +
      '<button class="btn" data-act="close-drawer">取消</button><button class="btn primary" data-act="agent-save" data-id="' + a.id + '">保存</button></div></aside>';
  }

  function agentField(label, control, hint) {
    return '<div class="field"><label class="hint">' + label + "</label>" + control +
      (hint ? '<div class="hint" style="margin-top:4px">' + hint + "</div>" : "") + "</div>";
  }

  function renderAgentTab(a) {
    const d = agentDraftOf();
    if (!d) return "";
    if (state.agentTab === "runtime") {
      return '<div class="setting-grid">' +
        agentField("默认模型", '<select class="input" data-draft="model">' + ["deepseek-v4", "claude-sonnet", "gpt-5"].map((m) => '<option' + (d.model === m ? " selected" : "") + ">" + m + "</option>").join("") + "</select>") +
        agentField("会话模式", '<select class="input" data-draft="mode">' + ["Act", "Ask", "Plan"].map((m) => '<option' + (d.mode === m ? " selected" : "") + ">" + m + "</option>").join("") + "</select>") +
        agentField("最大迭代", '<input class="input" type="number" data-draft="iterations" value="' + d.iterations + '" />') +
        agentField("最大输入长度", '<input class="input" type="number" data-draft="maxInput" value="' + d.maxInput + '" />') +
        agentField("Temperature", '<input class="input" type="number" step="0.1" data-draft="temperature" value="' + d.temperature + '" />') +
        agentField("Top P", '<input class="input" type="number" step="0.1" data-draft="topP" value="' + d.topP + '" />') +
        "</div>" +
        '<div class="setting-row"><div class="label"><b>记录运行轨迹</b><span>写入轨迹，可在聊天页查看</span></div>' + toggle(d.trace, "trace", "agent") + "</div>" +
        '<div class="setting-row"><div class="label"><b>运行后端</b><span>本机 · 创建后不可修改（编辑时禁用）</span></div><span class="tag sm">本机</span></div>' +
        '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "运行中的专家修改模型/后端，只影响新会话；进行中的会话锁定旧配置。</div>";
    }
    if (state.agentTab === "prompt") {
      const files = Object.keys(a.files || {});
      const cur = state.agentFile && files.includes(state.agentFile) ? state.agentFile : files[0];
      return '<div class="row" style="margin-bottom:10px"><span class="hint">配置文件（' + files.length + '）</span><span class="spacer"></span>' +
        '<button class="btn sm text" data-act="nav" data-route="workbench">打开工作区</button><button class="btn sm" data-act="agent-newfile" data-id="' + a.id + '">新建文件</button></div>' +
        files.map((f) => '<div class="setting-row' + (f === cur ? " current" : "") + '" style="padding:9px 0"><div class="label"><b class="mono">' + esc(f) + "</b><span>" +
          esc((a.files[f] || "").split("\n")[0] || "空文件") + "</span></div>" +
          '<button class="btn sm ' + (f === cur ? "primary" : "text") + '" data-act="agent-file-open" data-name="' + esc(f) + '">编辑</button></div>').join("") +
        '<div class="divider"></div>' +
        agentField(cur, '<textarea class="input mono" id="agent-file-content" rows="9" data-agent-file="' + esc(cur) + '">' + esc(a.files[cur] || "") + "</textarea>") +
        '<div class="row"><span class="hint">保存文件后，运行中的专家会在下次会话重载</span><span class="spacer"></span>' +
        '<button class="btn primary sm" data-act="agent-file-save" data-name="' + esc(cur) + '">保存文件</button></div>';
    }
    if (state.agentTab === "skills") {
      return [["weather", "天气查询", "内置 · 当前会话可用"], ["github-trending", "GitHub 趋势", "工作区 · 只读网络"], ["qrcode", "二维码生成", "内置 · 无外部权限"]].map(([key, name, meta]) =>
        '<div class="setting-row"><div class="label"><b class="mono">' + key + "</b><span>" + name + " · " + meta + "</span></div>" + toggle(d.skills[key], key, "agentSkill") + "</div>").join("") +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="nav" data-route="skills">管理技能</button><span class="hint">安装/卸载后需重载专家</span></div>';
    }
    if (state.agentTab === "subagents") {
      return [["调研员", "负责检索与事实核对"], ["写手", "负责初稿与改写"]].map(([n, desc]) =>
        '<div class="setting-row"><div class="label"><b>' + n + "</b><span>" + desc + "</span></div>" + toggle(d.subagents[n], n, "agentSub") + "</div>").join("") +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="nav" data-route="personalization">浏览子智能体市场</button></div>';
    }
    if (state.agentTab === "workspace") {
      return agentField("存储后端", '<select class="input" disabled><option>本地文件系统</option></select>', "编辑时只读；创建后不可修改。") +
        agentField("根目录", '<input class="input" data-draft="rootDir" value="' + esc(d.rootDir) + '" />', "保存前会探测目录可写性。") +
        '<div class="row" style="margin-top:12px"><button class="btn" data-act="nav" data-route="workbench">打开工作区</button>' +
        '<button class="btn text" data-act="agent-import" data-id="' + a.id + '">导入压缩包</button><button class="btn text" data-act="agent-export-zip" data-id="' + a.id + '">导出压缩包</button></div>' +
        '<div class="alert warn" style="margin-top:12px">' + icon("alert", "ic-sm") + "替换导入会清空本地工作区；合并导入会覆盖同名文件。</div>";
    }
    if (state.agentTab === "heartbeat") {
      return '<div class="setting-row"><div class="label"><b>启用心跳</b><span>按间隔执行 HEARTBEAT.md 中的任务</span></div>' + toggle(d.heartbeat, "heartbeat", "agent") + "</div>" +
        agentField("执行间隔", '<input class="input" data-draft="interval" value="' + esc(d.interval) + '" placeholder="30m / 1h / 2h30m" />', "支持 30m、1h、2h30m。") +
        '<div class="divider"></div>' +
        '<div class="setting-row"><div class="label"><b>开启主动关心</b><span>仅在关心时段、对话空闲时发一句</span></div>' + toggle(d.proactive, "proactive", "agent") + "</div>" +
        '<div class="setting-grid">' +
        agentField("检查频率", '<input class="input" data-draft="checkEvery" value="' + esc(d.checkEvery) + '" />') +
        agentField("同话题冷却（小时）", '<input class="input" type="number" data-draft="cooldown" value="' + d.cooldown + '" />') +
        agentField("关心时段", '<input class="input" data-draft="quietStart" value="' + esc(d.quietStart) + '" />') +
        agentField("免打扰", '<input class="input" data-draft="dndStart" value="' + esc(d.dndStart) + '" />') +
        "</div>";
    }
    if (state.agentTab === "persona") {
      return '<div class="setting-row"><div class="label"><b>MBTI 人格</b><span>当前 ' + esc(state.mbti) + ' · 理性、长期主义</span></div><button class="btn sm" data-act="mbti-retest">重新测试</button></div>' +
        '<div class="setting-row"><div class="label"><b>记忆</b><span>1,204 条原子 · 36 条待确认草稿</span></div><button class="btn sm" data-act="memory-view">查看记忆</button></div>' +
        '<div class="setting-row"><div class="label"><b>清理低置信度记忆</b><span>删除过期或低置信度条目，不可恢复</span></div><button class="btn sm danger" data-act="memory-clear">清理</button></div>' +
        '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "记忆写入受白名单限制；工具结果与外部网页不会直接写入长期记忆。</div>";
    }
    if (state.agentTab === "versions") {
      return (a.versions || []).map((v, i) =>
        '<div class="setting-row"><div class="label"><b>' + esc(v.v) + " · " + esc(v.note) + '</b><span>' + esc(v.at) + "</span></div>" +
        (i === 0 ? '<span class="tag green sm">当前</span>' : '<button class="btn sm" data-act="agent-rollback" data-value="' + esc(v.v) + '">回滚到此版本</button>') + "</div>").join("") +
        '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "回滚只影响新会话；进行中的会话继续使用当前版本。</div>";
    }
    // basic
    return '<div class="row" style="align-items:flex-start;gap:14px;margin-bottom:10px">' +
      '<span class="avatar ' + d.color + '" style="width:54px;height:54px;font-size:20px;border-radius:14px">' + esc((d.name || "?")[0]) + "</span>" +
      '<div><button class="btn sm" data-act="agent-avatar">更换配色</button>' +
      '<div class="hint" style="margin-top:6px">PNG/JPEG/WebP/GIF ≤ 5 MB；未设置时使用配色图标。</div></div></div>' +
      agentField("名称", '<input class="input" data-draft="name" value="' + esc(d.name) + '" />') +
      agentField("描述", '<textarea class="input" rows="2" data-draft="desc">' + esc(d.desc) + "</textarea>") +
      agentField("欢迎语", '<textarea class="input" rows="2" data-draft="welcome">' + esc(d.welcome) + "</textarea>") +
      '<div class="setting-grid">' +
      agentField("默认模式", '<select class="input" data-draft="mode">' + ["Act", "Ask", "Plan"].map((m) => '<option' + (d.mode === m ? " selected" : "") + ">" + m + "</option>").join("") + "</select>") +
      agentField("默认模型", '<select class="input" data-draft="model">' + ["deepseek-v4", "claude-sonnet", "gpt-5"].map((m) => '<option' + (d.model === m ? " selected" : "") + ">" + m + "</option>").join("") + "</select>") +
      agentField("可见范围", '<select class="input" data-draft="visibility">' + ["仅自己", "所有人", "指定分组"].map((m) => '<option' + (d.visibility === m ? " selected" : "") + ">" + m + "</option>").join("") + "</select>") +
      agentField("配色", '<div class="swatches">' + ["tech", "rose", "indigo", "teal", "violet", "emerald", "amber", "slate"].map((c, i) =>
        '<button class="swatch ' + (d.color === c ? "active" : "") + '" data-act="agent-color" data-value="' + c + '" title="' + c + '"><span style="background:' + ["#1677ff", "#e11d48", "#4f46e5", "#0d9488", "#7c3aed", "#059669", "#d97706", "#475569"][i] + '"></span></button>').join("") + "</div>") +
      "</div>" +
      '<div class="setting-row"><div class="label"><b>记录运行轨迹</b><span>写入轨迹，可在聊天页查看</span></div>' + toggle(d.trace, "trace", "agent") + "</div>";
  }

  /* ---------------- render: connections / extensions / usage / settings ---------------- */
  const CONN_CATALOG = [
    ["腾讯文档", "办公协作", "读写腾讯文档、智能表格与空间文件", "tencent"],
    ["腾讯 IMA", "笔记与知识", "笔记与知识库读写、检索与管理", "tencent"],
    ["腾讯会议", "办公协作", "会议管理、查询、录制与智能纪要", "tencent"],
    ["腾讯新闻", "资讯与娱乐", "新闻搜索与热点订阅", "tencent"],
    ["微信读书", "资讯与娱乐", "书架同步与读书笔记", "tencent"],
    ["腾讯乐享", "办公协作", "知识库检索、阅读、创建与文档管理", "tencent"],
    ["腾讯微云", "办公协作", "官方 MCP：网盘列表、上传、下载、分享", "tencent"],
    ["个人邮箱", "通讯与效率", "通过 IMAP/SMTP 连接 QQ、网易、Gmail 邮箱", "mail"],
    ["QQ 音乐", "资讯与娱乐", "搜歌、排行榜、歌单与听歌报告", "qq"],
    ["飞猪", "出行与地图", "机票、酒店、景点与行程智能搜索", "travel"],
    ["百度地图", "出行与地图", "地点检索、路线规划与天气查询", "map"],
    ["携程问道", "出行与地图", "酒店、机票与行程问答推荐", "travel"],
    ["美团旅游助手", "出行与地图", "酒店、机票、火车票、景点与行程问答", "travel"],
    ["滴滴", "出行与地图", "网约车预估、叫车与出行路线规划", "travel"],
    ["元典", "专业工具", "法律法规、案例文书与法律幻觉检测", "law"],
    ["企查查", "专业工具", "一键 OAuth 或 API Key，接入企业风险与知识产权信息", "law"],
    ["腾讯设计 Ardot", "办公协作", "设计稿读写、设计系统与导出", "tencent"],
    ["有道云笔记", "笔记与知识", "笔记创建、搜索、整理与管理", "note"],
    ["Notion", "笔记与知识", "搜索、读写页面与数据库", "note"],
    ["OpenAlex", "笔记与知识", "检索学术文献、引文与研究实体", "note"],
    ["滴答清单", "通讯与效率", "任务、清单、习惯与专注记录", "todo"],
    ["飞书 CLI", "办公协作", "通过 lark-cli 操作文档、多维表格、日历与消息", "feishu"],
    ["企业微信 CLI", "办公协作", "通过 wecom-cli 操作文档、日程与消息", "wecom"],
    ["钉钉 CLI", "办公协作", "通过 Workspace CLI（dws）操作通讯录、日程与文档", "dingtalk"],
    ["Agent Mail", "办公协作", "独立的 Agent 邮箱，支持邮件、附件与设备码授权", "mail"],
    ["Obsidian", "笔记与知识", "搜索、阅读和写入指定库中的笔记（需本机运行）", "note"],
    ["语雀（官方 MCP）", "笔记与知识", "通过本地 stdio 检索、读写知识库与文档", "note"],
    ["ragflow", "笔记与知识", "连接已有 RAGFlow 知识库，提供只读检索", "rag"],
    ["WeKnora", "笔记与知识", "连接 WeKnora 私有知识库，提供只读检索", "rag"],
    ["Dify", "自托管 / 扩展", "连接 Dify 已发布应用或工作流的 MCP 服务", "dify"]
  ];

  function renderConnections() {
    const tab = state.connTab || "enabled";
    const CATS = ["全部", "办公协作", "笔记与知识", "出行与地图", "通讯与效率", "资讯与娱乐", "专业工具", "自托管 / 扩展"];
    const cat = state.connCat || "全部";
    const toneOf = (k) => ({ tencent: "blue", mail: "amber", qq: "green", travel: "teal", map: "violet", law: "indigo", note: "blue", todo: "amber", feishu: "blue", wecom: "green", dingtalk: "amber", rag: "violet", dify: "teal" }[k] || "blue");
    let body = "";
    if (tab === "enabled") {
      const list = state.connectorsEmpty ? [] : state.connectors;
      body = list.length
        ? '<div class="conn-grid">' + list.map((c) =>
          '<div class="conn-card"><div class="conn-top"><span class="conn-ic tone-' + (c.status === "已过期" ? "amber" : "blue") + '">' + esc(c.name[0]) + "</span>" +
          '<div class="conn-main"><div class="row" style="gap:6px"><b>' + esc(c.name) + "</b>" +
          '<span class="tag ' + (c.status === "已连接" ? "green" : "amber") + ' sm">' + esc(c.status) + "</span></div>" +
          '<div class="hint">' + esc(c.desc) + "</div></div>" +
          '<span class="conn-tools">' + c.tools + " 工具</span></div>" +
          '<div class="conn-tags">' + (c.def ? '<span class="tag brand sm">默认打开</span>' : '<span class="tag sm">手动选择</span>') +
          '<span class="tag outline sm">仅自己</span></div>' +
          '<div class="conn-foot">' + (c.status === "已过期"
            ? '<button class="btn sm primary" data-act="conn-oauth" data-id="' + c.id + '">' + icon("refresh", "ic-sm") + "重新授权</button>"
            : '<button class="btn sm" data-act="conn-open" data-id="' + c.id + '">配置</button>' +
              '<button class="btn sm text" data-act="conn-probe" data-id="' + c.id + '">测试连接</button>') +
          '<span class="spacer"></span>' +
          '<button class="btn sm text" data-act="conn-default" data-id="' + c.id + '">' + (c.def ? "取消默认" : "设为默认") + "</button>" +
          '<button class="btn sm text danger" data-act="conn-delete" data-id="' + c.id + '">删除</button></div></div>').join("") +
          '<div class="conn-add-card" data-act="conn-add"><span class="conn-add-ic">' + icon("plus") + "</span><b>添加连接</b><p>从内置连接器或 MCP 开始。</p></div></div>"
        : '<div class="conn-empty"><div class="conn-mascot">' + icon("plug") + "</div><b>还没有已启用的连接器</b>" +
          '<p>连接器实例保存一份外部服务的凭证，专家通过它调用对方的工具。请基于内置连接器创建实例。</p>' +
          '<div class="conn-steps">' +
          ["连接器实例是什么", "怎么创建", "谁可以使用与默认开启"].map((t, i) => '<div class="conn-step"><span class="conn-step-n">' + (i + 1) + "</span><div><b>" + t + "</b><p>" +
            ["一个实例 = 一份凭证 + 一个显示名称。同一个内置连接器可以创建多个实例。",
              "打开「内置连接器」，选择要接入的服务，在弹出的「创建连接器」中填写凭证并探测。",
              "创建时可选仅自己、所有人或指定用户分组。默认开启只对你自己生效。"][i] + "</p></div></div>").join("") +
          "</div>" +
          '<div class="row"><button class="btn primary" data-act="conn-tab" data-id="builtin">' + icon("plug", "ic-sm") + "浏览内置连接器</button>" +
          '<button class="btn" data-act="conn-add">' + icon("plus", "ic-sm") + "添加自定义 MCP</button></div></div>";
    } else if (tab === "builtin") {
      const list = CONN_CATALOG.filter(([, c]) => cat === "全部" || c === cat);
      const configured = CONN_CATALOG.filter(([name]) => state.connectors.some((x) => x.name === name)).length;
      body = '<div class="kb-count">当前支持 ' + CONN_CATALOG.length + " 个连接器，已配置 " + configured + " 个</div>" +
        '<div class="conn-bar"><div class="market-cats">' + CATS.map((c) =>
          '<button class="chip ' + (cat === c ? "on" : "") + '" data-act="conn-cat" data-value="' + c + '">' + c + "</button>").join("") + "</div>" +
        '<span class="spacer"></span><button class="btn sm" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button></div>" +
        '<div class="conn-grid dense">' + list.map(([name, c, desc, kind]) =>
          '<div class="conn-card"><div class="conn-top"><span class="conn-ic tone-' + toneOf(kind) + '">' + icon("plug", "ic-sm") + "</span>" +
          '<div class="conn-main"><b>' + esc(name) + '</b><div class="conn-cat">' + esc(c) + "</div></div></div>" +
          '<div class="conn-desc">' + esc(desc) + "</div>" +
          '<div class="conn-foot"><button class="btn sm text" data-act="conn-add" data-name="' + esc(name) + '">点击连接</button></div></div>').join("") + "</div>";
    } else {
      const servers = state.mcpServers;
      const json = JSON.stringify(servers.reduce((acc, s) => {
        acc[s.id] = { display_name: s.name, url: s.url, transport: s.transport === "HTTP" ? "streamable_http" : "stdio" };
        return acc;
      }, {}), null, 2);
      const example = '{\n  "deepwiki": {\n    "display_name": "DeepWiki",\n    "url": "https://mcp.deepwiki.com/mcp",\n    "transport": "streamable_http"\n  }\n}';
      body = '<div class="json-hint">MCP 服务器配置（JSON 格式），参考以下格式：</div>' +
        '<pre class="json-example">' + esc(example) + "</pre>" +
        '<div class="seg-text view" style="width:fit-content;margin:12px 0"><button class="seg ' + (state.mcpMode !== "json" ? "active" : "") + '" data-act="mcp-mode" data-value="visual">可视化</button>' +
        '<button class="seg ' + (state.mcpMode === "json" ? "active" : "") + '" data-act="mcp-mode" data-value="json">&lt;/&gt; JSON</button></div>' +
        (state.mcpMode === "json"
          ? '<div class="card"><div class="card-b"><textarea class="input mono" id="mcp-json" rows="14">' + esc(json) + "</textarea>" +
            '<div class="row" style="margin-top:10px"><button class="btn" data-act="mcp-probe" data-id="' + (servers[0] ? servers[0].id : "") + '">探测</button><span class="spacer"></span>' +
            '<button class="btn primary" data-act="mcp-save">保存</button></div></div></div>'
          : '<div class="mcp-add-row"><button class="mcp-add-slot" data-act="mcp-add" data-value="http">' + icon("globe", "ic-sm") + "添加 HTTP Server " + icon("plus", "ic-xs") + "</button>" +
            '<button class="mcp-add-slot" data-act="mcp-add" data-value="stdio">' + icon("terminal", "ic-sm") + "添加 Stdio Server " + icon("plus", "ic-xs") + "</button></div>" +
            '<div class="conn-section-h">已添加的服务器</div>' +
            (servers.length
              ? '<div class="conn-grid dense">' + servers.map((s) =>
                '<div class="conn-card"><div class="conn-top"><span class="conn-ic tone-violet">' + icon("terminal", "ic-sm") + "</span>" +
                '<div class="conn-main"><b>' + esc(s.name) + '</b><div class="conn-cat">' + esc(s.transport) + "</div></div></div>" +
                '<div class="conn-desc">' + esc(s.url) + "</div>" +
                '<div class="conn-foot"><button class="btn sm text" data-act="mcp-edit" data-id="' + s.id + '">编辑</button>' +
                '<button class="btn sm text" data-act="mcp-probe" data-id="' + s.id + '">探测</button><span class="spacer"></span>' +
                '<button class="btn sm text danger" data-act="mcp-delete" data-id="' + s.id + '">删除</button></div></div>').join("") + "</div>"
              : '<div class="mcp-empty">尚未添加自定义 MCP，点击上方按钮开始配置</div>') +
            '<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn primary" data-act="mcp-save">保存</button></div>');
    }
    return '<div class="main"><div class="page">' +
      '<div class="page-head"><div><div class="page-title">连接器</div>' +
      '<div class="page-sub">连接文档、网盘与邮箱，并在对话中按需使用</div></div></div>' +
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
      '<div class="setting-row"><div class="label"><b>对话默认选中</b><span>关闭后需在对话中手动勾选</span></div>' +
      '<button class="btn sm" data-act="conn-default" data-id="' + c.id + '">' + (c.def ? "取消默认" : "设为默认") + "</button></div>" +
      '<div class="setting-row"><div class="label"><b>共享范围</b><span>共享后其他人可选用，但不能改配置</span></div><select class="input" style="width:160px"><option>仅自己</option><option>所有人</option><option>指定分组</option></select></div>' +
      '<div class="alert info" style="margin-top:12px">' + icon("info", "ic-sm") + "保存后可「测试连接」探测可用工具数；OAuth 过期需重新授权。</div>" +
      "</div><div class=\"drawer-f\"><button class=\"btn text danger\" data-act=\"conn-delete\" data-id=\"" + c.id + "\">删除</button><span class=\"spacer\"></span>" +
      '<button class="btn" data-act="close-connector">取消</button><button class="btn primary" data-act="conn-save" data-id="' + c.id + '">保存</button></div></aside>';
  }

  function renderExtensions() {
    const view = state.extView || "installed";
    const switchRow = "";
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
    const onCount = PLUGINS.filter((p) => p.on).length;
    const updatable = PLUGINS.filter((p) => { const l = PLUGIN_MARKET.find((x) => x.name === p.name); return l && l.version !== p.version; }).length;
    return '<div class="main"><div class="page"><div class="page-head"><div><div class="page-title">扩展</div>' +
      '<div class="page-sub">管理服务器插件；技能包在「技能包」页安装与启用，安装后按专家分配。</div></div>' +
      '<div class="page-actions"><button class="btn" data-act="nav" data-route="skills">' + icon("package", "ic-sm") + "技能包</button>" +
      '<button class="btn primary" data-act="plugin-install">' + icon("plus", "ic-sm") + "安装插件</button></div></div>" +
      '<div class="stat-strip">' +
      [["已安装", PLUGINS.length, "服务器插件"], ["已启用", onCount, onCount ? "运行中" : "全部禁用"],
        ["可更新", updatable, updatable ? "市场有新版本" : "均为最新"], ["权限", "网络 / 工作区 / 文件", "安装时授予"]].map(([l, v, note]) =>
        '<div class="stat-card"><span>' + l + '</span><b style="font-size:' + (String(v).length > 8 ? "15px" : "22px") + '">' + esc(v) + '</b><span class="delta up">' + esc(note) + "</span></div>").join("") +
      "</div>" +
      switchRow + body + "</div></div>";
  }

  function usageDays(range) {
    const n = range === "7d" ? 7 : range === "90d" ? 30 : 14;
    const out = [];
    const end = new Date(2026, 10, 6);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(end); d.setDate(end.getDate() - i);
      const wave = 40 + Math.round(16 * Math.sin(i * 0.8) + (n - i) * 0.7);
      out.push({
        label: d.getMonth() + 1 + "-" + String(d.getDate()).padStart(2, "0"),
        tokens: wave * 1600,
        cost: Number((wave / 5).toFixed(1)),
        calls: wave + 20,
        sessions: Math.round(wave / 6),
      });
    }
    return out;
  }
  const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.round(n / 1e3) + "K");

  function renderUsage() {
    const view = state.usageView || "summary";
    const range = state.usageRange || "30d";
    const rows = usageDays(range);
    const totalTokens = rows.reduce((n, r) => n + r.tokens, 0);
    const totalCost = rows.reduce((n, r) => n + r.cost, 0);
    const totalSessions = rows.reduce((n, r) => n + r.sessions, 0);
    const totalCalls = rows.reduce((n, r) => n + r.calls, 0);
    const maxCost = Math.max.apply(null, rows.map((r) => r.cost));
    const rangeLabel = range === "7d" ? "近 7 天" : range === "90d" ? "近 90 天" : "近 14 天";
    const exps = [["业务专家", 62], ["代码助手", 24], ["知识库问答", 9], ["发布管家", 5]];
    const models = [["deepseek-v4", 58], ["glm-4.6", 26], ["qwen3-max", 11], ["bge-m3", 5]];
    const inputShare = 97;
    const outShare = 100 - inputShare;
    const perTurn = totalSessions ? Math.round(totalTokens / totalSessions) : 0;
    const tabs = [["summary", "汇总"], ["day", "按天"], ["expert", "按专家"], ["model", "按模型"]];
    const kpis = [
      ["TOTAL TOKENS", fmtTokens(totalTokens)],
      ["输入", fmtTokens(totalTokens * inputShare / 100)],
      ["输出", fmtTokens(totalTokens * outShare / 100)],
      ["缓存输入", "0"],
      ["缓存命中率", "0.0%"],
      ["对话轮数", String(totalSessions)],
      ["均值/轮", fmtTokens(perTurn)],
    ];
    const donut = (title, items) => '<div class="card donut-card"><div class="donut-title">' + title + "</div>" +
      '<div class="donut-wrap"><div class="donut" style="--a:' + items[0][1] + '%;--c1:var(--primary);--c2:color-mix(in srgb, var(--primary) 34%, #fff)"></div></div>' +
      '<div class="donut-legend">' + items.map(([n, v], i) =>
        '<span><i style="background:' + (i === 0 ? "var(--primary)" : i === 1 ? "color-mix(in srgb, var(--primary) 34%, #fff)" : "var(--surface-3)") + '"></i>' + esc(n) + "</span>").join("") + "</div></div>";
    const kpiStrip = '<div class="kpi-strip">' + kpis.map(([l, v]) =>
      '<div class="kpi-cell"><span>' + l + "</span><b>" + v + "</b></div>").join("") + "</div>";
    const donuts = '<div class="donut-row">' +
      donut("输入 / 输出", [["输入", inputShare], ["输出", outShare]]) +
      donut("用户分布", [["admin", 100]]) +
      donut("专家分布", exps.map(([n, s]) => [n, s])) +
      donut("模型分布", models.map(([n, s]) => [n, s])) +
      "</div>";
    const trend = '<div class="card"><div class="card-h"><b class="card-title">每日消耗趋势</b>' +
      '<span class="card-sub">' + rangeLabel + " · 单位 ¥</span><span class=\"spacer\"></span>" +
      '<span class="chart-legend"><i></i>成本</span></div><div class="card-b">' +
      '<div class="usage-chart"><div class="chart-y"><span>¥' + Math.ceil(maxCost) + '</span><span>¥' + (maxCost / 2).toFixed(0) + '</span><span>0</span></div>' +
      '<div class="chart-main"><div class="bars">' + rows.map((r) =>
        '<i style="--h:' + Math.round((r.cost / maxCost) * 100) + '%" title="' + r.label + " · ¥" + r.cost.toFixed(1) + '"></i>').join("") + "</div>" +
      '<div class="bar-x">' + rows.map((r) => "<span>" + r.label + "</span>").join("") + "</div></div></div></div></div>";
    let body = "";
    if (view === "summary") {
      body = kpiStrip + donuts + trend;
    } else if (view === "day") {
      body = '<div class="card"><div class="card-h"><b class="card-title">按天明细</b><span class="card-sub">' + rangeLabel + "</span></div>" +
        '<table class="table"><thead><tr><th>日期</th><th class="num">Token</th><th class="num">成本</th><th class="num">模型调用</th><th class="num">会话</th></tr></thead><tbody>' +
        rows.slice().reverse().map((r) => '<tr><td class="mono">' + r.label + '</td><td class="num">' + fmtTokens(r.tokens) + '</td><td class="num">¥' + r.cost.toFixed(1) + '</td><td class="num">' + r.calls + '</td><td class="num">' + r.sessions + "</td></tr>").join("") +
        "</tbody></table></div>";
    } else if (view === "expert") {
      body = '<div class="card"><div class="card-h"><b class="card-title">按专家</b><span class="card-sub">成本 / token / 会话</span></div>' +
        '<table class="table"><thead><tr><th>专家</th><th class="num">成本占比</th><th class="num">成本</th><th class="num">Token</th><th class="num">会话</th></tr></thead><tbody>' +
        exps.map(([n, share]) => "<tr><td><b>" + n + '</b></td><td class="num">' + share + '%</td><td class="num">¥' + (totalCost * share / 100).toFixed(1) + '</td><td class="num">' + fmtTokens(totalTokens * share / 100) + '</td><td class="num">' + Math.round(totalSessions * share / 100) + "</td></tr>").join("") +
        "</tbody></table></div>";
    } else {
      body = '<div class="card"><div class="card-h"><b class="card-title">按模型</b><span class="card-sub">调用量与成本</span></div>' +
        '<table class="table"><thead><tr><th>模型</th><th class="num">成本占比</th><th class="num">成本</th><th class="num">Token</th><th class="num">调用</th></tr></thead><tbody>' +
        models.map(([n, share]) => '<tr><td class="mono">' + n + '</td><td class="num">' + share + '%</td><td class="num">¥' + (totalCost * share / 100).toFixed(1) + '</td><td class="num">' + fmtTokens(totalTokens * share / 100) + '</td><td class="num">' + Math.round(totalCalls * share / 100) + "</td></tr>").join("") +
        "</tbody></table></div>";
    }
    return '<div class="main"><div class="page">' +
      '<div class="page-head"><div><div class="page-title">Token 统计</div>' +
      '<div class="page-sub">查看账户 Token 消耗总览，并按渠道与会话做多维分析</div></div>' +
      '<div class="page-actions"><button class="btn" data-act="usage-export">' + icon("download", "ic-sm") + "导出 Excel</button></div></div>" +
      '<div class="info-banner">' + icon("info", "ic-sm") + "<span>页面展示的 Token 用量仅供参考；部分消耗（如记忆总结、召回等）尚未纳入统计。</span></div>" +
      '<div class="tabs page-tabs">' + tabs.map(([id, label]) =>
        '<button class="tab ' + (view === id ? "active" : "") + '" data-act="usage-view" data-value="' + id + '">' + label + "</button>").join("") + "</div>" +
      '<div class="filter-row"><div class="select-pill">全部用户' + icon("chev", "ic-xs") + "</div>" +
      '<div class="select-pill">' + rangeLabel + icon("chev", "ic-xs") + "</div>" +
      '<div class="select-pill">全部专家' + icon("chev", "ic-xs") + "</div>" +
      '<span class="spacer"></span><span class="hint">数据更新于 5 分钟前 · 含工具调用与重试</span></div>' +
      body + "</div></div>";
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
      '<div style="margin-top:16px">' + body + "</div></div></div>";
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
    const tab = state.wbTab || "browser";
    const LABEL = { browser: "浏览器", terminal: "终端", cloud: "云服务器" };
    let body = "";
    if (tab === "browser") {
      body = '<div class="wb-shell"><div class="wb-bar">' +
        '<button class="icon-btn" data-act="refresh" title="后退">' + icon("chev", "ic-sm") + "</button>" +
        '<button class="icon-btn" data-act="refresh" title="前进">' + icon("chev", "ic-sm") + "</button>" +
        '<button class="icon-btn" data-act="refresh" title="刷新">' + icon("refresh", "ic-sm") + "</button>" +
        '<input class="wb-url" value="https://cloud.tencent.com" />' +
        '<button class="btn sm text" data-act="refresh">访问</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm text" data-act="refresh">AI 助手</button>' +
        '<button class="btn sm text" data-act="refresh">技能录制</button>' +
        '<button class="btn sm" data-act="wb-close">关闭浏览器</button></div>' +
        '<div class="wb-viewport"><div class="wb-hero">' + icon("globe") + "<b>浏览器会话</b>" +
        "<p>专家打开网页后会出现在这里，可实时查看画面、接管点击与输入。</p>" +
        '<button class="btn primary" data-act="refresh">连接浏览器</button></div></div></div>' +
        '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "浏览器会话按专家隔离；关闭浏览器只结束当前会话，不影响历史截图与轨迹。</div>";
    } else if (tab === "terminal") {
      body = '<div class="wb-shell"><div class="wb-bar">' +
        '<span class="wb-title">' + icon("terminal", "ic-sm") + "终端 · 业务专家</span>" +
        '<span class="spacer"></span><button class="btn sm text" data-act="refresh">新建会话</button>' +
        '<button class="btn sm" data-act="wb-close">关闭终端</button></div>' +
        '<div class="wb-term">' +
        [["$", "npm test -- --auth", "ok"], ["", "PASS src/auth.spec.ts (2 tests)", ""], ["", "Test Suites: 1 passed", ""], ["$", "git diff --stat", "ok"], ["", " src/auth.ts | 12 ++++++------", ""]].map(([p, t, tone]) =>
          '<div class="term-line ' + (tone || "") + '"><span class="term-p">' + p + "</span>" + esc(t) + "</div>").join("") +
        '<div class="term-line"><span class="term-p">$</span><span class="term-caret"></span></div></div></div>' +
        '<div class="alert info" style="margin-top:14px">' + icon("info", "ic-sm") + "终端命令命中命令防护或需审批时，会在对话内弹出审批卡；写操作会创建任务并计入预算。</div>";
    } else {
      body = '<div class="wb-bar"><select class="input" style="width:140px"><option>全部地域</option><option>广州</option><option>上海</option></select>' +
        '<button class="btn sm" data-act="refresh">' + icon("refresh", "ic-sm") + "刷新</button>" +
        '<span class="spacer"></span><button class="btn sm" data-act="refresh">运维专家</button>' +
        '<button class="btn primary" data-act="wb-auth">' + icon("key", "ic-sm") + "一键授权</button></div>" +
        '<div class="conn-empty" style="margin-top:12px"><div class="conn-mascot">' + icon("cloud") + "</div>" +
        "<b>尚未授权腾讯云</b><p>授权后可查看 CVM 实例与监控，并交给运维专家排障。</p>" +
        '<div class="conn-steps">' +
        [["打开腾讯云登录", "点「一键授权」，在浏览器完成登录，不用填写密钥。"],
          ["复制验证码", "登录成功后页面会显示一串验证码，复制后回到这里点「我已复制」。"],
          ["或从本机导入", "这台机器已经用 tcli 登录过时，可在授权窗口里直接导入。"]].map(([t, d], i) =>
          '<div class="conn-step"><span class="conn-step-n">' + (i + 1) + "</span><div><b>" + t + "</b><p>" + d + "</p></div></div>").join("") +
        '</div><button class="btn primary" data-act="wb-auth">' + icon("key", "ic-sm") + "一键授权</button></div>";
    }
    return '<div class="main"><div class="page">' +
      cfgHead("工作台 / " + LABEL[tab], "查看并接管专家的终端与浏览器，实时跟进执行过程。") +
      body + "</div></div>";
  }

  function pageSubnavHTML() {
    const r = state.route;
    const t = (on, act, group, value, label) => '<button class="tab ' + (on ? "active" : "") + '" data-act="' + act + '"' +
      (group ? ' data-group="' + group + '"' : "") + ' data-value="' + value + '"' +
      (act === "conn-tab" ? ' data-id="' + value + '"' : "") + ">" + label + "</button>";
    const bar = (items) => (items.length ? '<div class="tabs page-subtabs">' + items.join("") + "</div>" : "");
    const sub = (group, cur, items) => bar(items.map(([v, label]) => t(cur === v, "subtab", group, v, label)));
    if (r.startsWith("connections")) {
      const cur = state.connTab || "enabled";
      const n = state.connectorsEmpty ? 0 : state.connectors.length;
      const mcp = (state.mcpServers || []).length;
      return bar([["enabled", "已启用连接器 " + n], ["builtin", "内置连接器"], ["custom", "自定义连接器"]].map(([v, l]) => t(cur === v, "conn-tab", null, v, l)));
    }
    if (r.startsWith("extensions")) return sub("extView", state.extView || "installed", [["installed", "已安装"], ["market", "插件市场"]]);

    if (r.startsWith("acp")) return sub("acpTab", state.acpTab || "runners", [["runners", "Runner"], ["permissions", "权限"]]);
    if (r.startsWith("remote")) return sub("remoteTab", state.remoteTab || "desktop", [["desktop", "桌面"], ["phone", "手机"]]);
    if (r.startsWith("workbench")) return sub("wbTab", state.wbTab || "browser", [["browser", "浏览器"], ["terminal", "终端"], ["cloud", "云服务器"]]);
    if (r.startsWith("admin-users")) return sub("userTab", state.userTab || "users", [["users", "用户管理"], ["roles", "角色管理"], ["groups", "用户分组"], ["feishu", "飞书登录"], ["wecom", "企微登录"], ["dingtalk", "钉钉登录"], ["oidc", "通用 OIDC"], ["ldap", "LDAP"]]);
    if (r.startsWith("admin-models")) return sub("modelTab", state.modelTab || "chat", [["chat", "对话模型"], ["embedding", "向量模型"], ["generation", "生成模型"], ["voice", "语音模型"], ["decision", "决策模型"], ["search", "搜索引擎"]]);
    if (r.startsWith("admin-storage")) return sub("storageTab", state.storageTab || "mine", [["mine", "我的存储"], ["types", "支持类型"]]);
    if (r.startsWith("admin-plugins")) return sub("pluginTab", state.pluginTab || "plugins", [["plugins", "已安装插件"], ["market", "插件市场"], ["permissions", "权限审计"]]);
    if (r.startsWith("admin-security")) return sub("securityTab", state.securityTab || "hitl", [["hitl", "工具审批"], ["filesystem", "文件访问"], ["pii", "敏感信息"], ["toolGuard", "命令防护"], ["skillScan", "技能扫描"], ["audit", "审计日志"]]);
    if (r.startsWith("admin-advanced")) return sub("advTab", state.advTab || "env", [["env", "环境变量"], ["backup", "备份与恢复"], ["https", "HTTPS"], ["updates", "应用更新"], ["webauthn", "通行密钥"]]);
    return "";
  }

  function injectAfterHead(html, sub) {
    const start = html.indexOf('<div class="page-head">');
    if (start < 0) return html.replace('<div class="page">', '<div class="page">' + sub);
    let i = start;
    let depth = 0;
    while (i < html.length) {
      const open = html.indexOf("<div", i);
      const close = html.indexOf("</div>", i);
      if (close < 0) break;
      if (open >= 0 && open < close) { depth += 1; i = open + 4; }
      else {
        depth -= 1;
        i = close + 6;
        if (depth === 0) return html.slice(0, i) + sub + html.slice(i);
      }
    }
    return html;
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
    return injectAfterHead(html, sub);
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
    if (state.cronDraft) out += renderCronDrawer();
    if (state.kbDrawer) out += renderKbDrawer();
    if (state.channelDrawer) out += renderChannelDrawer();
    if (state.skillPkgDrawer) out += renderSkillPkgDrawer();
    if (state.skillCreate) out += renderSkillCreateDrawer();
    if (state.bridgeDrawer) out += renderBridgeDrawer();
    if (state.storageDrawer) out += renderStorageDrawer();
    if (state.provDrawer) out += renderProviderDrawer();
    if (state.pluginDrawer) out += renderPluginDrawer();
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
      body = '<div class="modal-b"><div class="field"><label>文件</label><input class="input" id="upload-file" type="file" multiple /></div>' +
        '<div class="hint" style="margin-top:8px">支持 PDF / Word / Markdown / 表格 / 图片；上传后进入解析队列，完成后自动可检索。</div></div>' +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="upload-save">上传</button></div>';
    } else if (m.type === "new-task") {
      body = '<div class="modal-b"><div class="field"><label>任务标题 <span style="color:var(--red)">*</span></label><input class="input" id="new-task-title" placeholder="例如：修复登录超时" /></div>' +
        '<div class="field"><label>来源</label><select class="input" id="new-task-source"><option>GitHub</option><option>飞书</option><option>邮件</option></select></div>' +
        '<div class="field"><label>执行器</label><select class="input" id="new-task-exec"><option>内置</option><option>Claude Code</option><option>Codex</option></select></div>' +
        '<div class="hint" style="margin-top:8px">手动建单会跳过 Gate 与 Eval，直接使用默认授权范围；创建后可立即执行。</div></div>' +
        '<div class="modal-f"><button class="btn" data-act="modal-close">取消</button><button class="btn primary" data-act="new-task-save">创建</button></div>';
    } else if (m.type === "note") {
      body = '<div class="modal-b">' + (m.body || "") + "</div>" +
        '<div class="modal-f"><button class="btn primary" data-act="modal-close">知道了</button></div>';
    } else if (m.type === "agent-new") {
      body = '<div class="modal-b"><div class="field"><label>名称 <span style="color:var(--red)">*</span></label><input class="input" id="agent-name" placeholder="例如：发布管家" /></div>' +
        '<div class="field"><label>模板</label><select class="input" id="agent-template"><option>空白</option><option>业务专家</option><option>代码助手</option><option>知识库问答</option></select></div></div>' +
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
    return '<div class="mask" data-act="modal-mask"><div class="modal" data-act="modal-noop" role="dialog" aria-modal="true" aria-label="' + esc(m.title || "对话框") + '">' +
      '<div class="modal-h">' + esc(m.title || "") + '<span class="spacer"></span>' +
      (m.type === "slash" || m.type === "mention" ? "" : '<button class="icon-btn" data-act="modal-close" title="关闭" aria-label="关闭">' + icon("x", "ic-sm") + "</button>") +
      "</div>" + body + "</div></div>";
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
    const items = [["chat", "chat", "对话"], ["tasks", "inbox", "任务"], ["agents", "bot", "专家"], ["knowledge", "book", "知识"], ["more", "grid", "更多"]];
    const moreItems = [["inbox", "收件箱", "inbox"], ["automation", "自动化", "clock"], ["connections", "连接", "plug"], ["extensions", "扩展", "grid"],
      ["workbench", "工作台", "monitor"], ["usage", "用量", "chart"], ["admin", "管理", "shield"], ["settings", "设置", "sliders"]];
    return '<nav class="mobile-nav">' + items.map(([r, ic, label]) =>
      '<button class="' + ((r === "more" ? state.mobileMore : state.route.startsWith(r) || (r === "tasks" && /^(inbox|ticket)/.test(state.route))) ? "active" : "") + '" data-act="' + (r === "more" ? "mobile-more" : "nav") + '"' + (r === "more" ? "" : ' data-route="' + r + '"') + '>' +
      icon(ic) + "<span>" + label + "</span></button>").join("") + "</nav>" +
      (state.mobileMore ? '<div class="mobile-sheet-mask" data-act="mobile-more"></div><div class="mobile-sheet">' +
        '<div class="side-title" style="padding:6px 10px 10px">更多</div>' +
        moreItems.map(([r, label, ic]) => '<button class="side-nav" data-act="nav" data-route="' + r + '">' + icon(ic, "ic-sm") + "<span>" + label + "</span></button>").join("") +
        "</div>" : "");
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

  function closeDrawerSafe() {
    if (state.drawerDirty) {
      state.modal = { type: "confirm", title: "放弃未保存的修改？", body: "关闭后本次编辑会丢失；可以先点「保存」。", confirmLabel: "放弃修改", danger: true, onConfirm: () => {
        state.drawer = null; state.agentDraft = null; state.drawerDirty = false; state.modal = null; render();
      } };
      render(); return;
    }
    state.drawer = null; state.agentDraft = null; render();
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
    if (state.modal) {
      const f = document.querySelector(".modal input:not([type=hidden]), .modal textarea, .modal select");
      if (f) setTimeout(() => f.focus(), 0);
    }
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
    if (!state.activeSession) {
      const sid = "s_" + uid();
      SESSIONS.unshift({ id: sid, title: (text || "附件消息").slice(0, 18), preview: (text || "附件消息").slice(0, 32), time: now() });
      state.activeSession = sid;
      state.threads[sid] = state.messages;
    } else {
      const sess = SESSIONS.find((s) => s.id === state.activeSession);
      if (sess) { sess.preview = (text || "附件消息").slice(0, 32); sess.time = now(); }
    }
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
        const lastUser = state.messages.slice().reverse().find((x) => x.role === "user");
        if (state.mode === "Act" && lastUser && /改|写|修|跑|执行|部署|重试/.test(lastUser.text || "") && !state.messages.some((x) => x.ticket)) {
          spawnChatTicket(reply, { silent: true });
          toast("已生成任务卡，确认后才会执行");
        }
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
    found.att.decision = scope === "session" ? "allow_session" : "allow_once";
    found.att.decidedAt = now();
    found.att.decidedBy = state.displayName;
    pushEvent(found.task, "Attention", "answered · " + (scope === "session" ? "本会话允许" : "仅本次允许") + " · " + state.displayName, "ok");
    if (scope === "session") state.hitl = "all";
    taskRunTick(found.task);
    render();
    toast(scope === "session" ? "已允许，本会话内同类操作不再询问" : "已允许，本轮继续");
  }

  function deny(attId) {
    const found = attentionById(attId);
    if (!found) return;
    found.att.resolved = true;
    found.att.decidedAt = now();
    found.att.decidedBy = state.displayName;
    pushEvent(found.task, "Attention", "denied · " + state.displayName, "warn");
    cancelTask(found.task, "已拒绝，任务结束");
    render();
    toast("已拒绝，任务已结束");
  }

  function resolveAttention(attId) {
    const found = attentionById(attId);
    if (!found) return;
    found.att.resolved = true;
    found.att.decidedAt = now();
    found.att.decidedBy = state.displayName;
    if (found.task.bucket === "attention") { found.task.bucket = "running"; }
    pushEvent(found.task, "Attention", "answered · " + (found.att.kind === "question" ? "已回答" : "已解除阻塞"), "ok");
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
    if (el.tagName === "BUTTON" && el.disabled) return;
    if (el.getAttribute("aria-disabled") === "true") return;
    const act = el.dataset.act;
    const needPerm = ACTION_PERM[act];
    if (needPerm && !can(needPerm)) { toast("当前角色无权执行此操作", "error"); return; }
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
        } else if (id === "cron") {
          state.cronJobs.forEach((j) => { if (selected.includes(j.id)) { j.on = value === "enable"; j.next = j.on ? "明天 09:00" : "—"; } });
          ts.selected = []; render(); toast("已更新定时任务状态");
        } else if (id === "acp") {
          let blocked = 0;
          state.acpRunners.forEach((r) => {
            if (!selected.includes(r.id)) return;
            if (value === "enable" && r.status !== "已安装") { blocked++; return; }
            r.on = value === "enable";
          });
          ts.selected = []; render();
          toast(blocked ? "已更新；" + blocked + " 个未安装的 Runner 未启用" : "已更新 Runner 状态", blocked ? "error" : "");
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
      case "group-edit": {
        const g = state.groups.find((x) => x.id === el.dataset.name);
        openForm("group", "编辑分组", [
          { label: "分组 ID", id: "g-id", value: g ? g.id : "", required: true },
          { label: "说明", id: "g-desc", value: g ? g.name : "", placeholder: "分组说明" },
        ], { groupId: g ? g.id : "", confirmLabel: "保存" });
        return;
      }
      case "group-new":
        openForm("group", "新建分组", [
          { label: "分组 ID", id: "g-id", placeholder: "例如 design-team", required: true },
          { label: "说明", id: "g-desc", placeholder: "分组说明" },
        ], { confirmLabel: "创建" });
        return;
      case "group-delete": {
        const gid = el.dataset.name;
        state.modal = { type: "confirm", title: "删除分组", body: "删除分组不会删除成员，只会解除分组关系。", confirmLabel: "删除", danger: true, onConfirm: () => {
          state.groups = state.groups.filter((x) => x.id !== gid);
          state.modal = null; render(); toast("分组已删除");
        } };
        render(); return;
      }
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
      case "provider-config":
      case "prov-custom": {
        const nm = el.dataset.name || "";
        state.provDraft = {
          mode: state.modelTab || "chat",
          name: act === "prov-custom" ? "" : nm,
          type: "OpenAI 兼容",
          baseUrl: nm === "DeepSeek" ? "https://api.deepseek.com/v1" : "",
          apiKey: "",
          site: "",
          models: nm === "DeepSeek" ? ["deepseek-chat", "deepseek-reasoner"] : [""],
          image: "",
          video: "",
          routeId: "",
          on: true,
          custom: act === "prov-custom"
        };
        state.provDrawer = true;
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
      case "storage-add": {
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
      case "channel-open": state.channelDrawer = el.dataset.id || "wechat"; render(); return;
      case "channel-close": state.channelDrawer = null; render(); return;
      case "channel-qr": toast("已重新生成二维码"); return;
      case "channel-reply": channelCfgOf(state.channelDrawer).reply = val; render(); return;
      case "channel-save": {
        const ch = state.channels.find((c) => c.id === state.channelDrawer);
        if (ch) {
          const cfg = channelCfgOf(ch.id);
          if (!ch.required) ch.on = cfg.enabled !== false;
          if (ch.on) ch.status = "已连接";
          toast(ch.name + (ch.on ? " 已启用" : " 已停用"));
        }
        state.channelDrawer = null; render(); return;
      }
      case "skillpkg-select": state.skillPkg = el.dataset.id; render(); return;
      case "skillpkg-create": state.skillPkgDrawer = "create"; state.skillPkgDraft = null; render(); return;
      case "bridge-add": state.bridgeDrawer = true; state.bridgeDraft = null; render(); return;
      case "bridge-close": state.bridgeDrawer = null; render(); return;
      case "bridge-share": (state.bridgeDraft = state.bridgeDraft || {}).share = val; render(); return;
      case "bridge-ai": {
        const d = state.bridgeDraft || (state.bridgeDraft = { name: "", desc: "", url: "", account: "admin", password: "", share: "self" });
        d.desc = "公司云端：用于查看对端专家与团队，跨实例发起对话（由名称生成，可修改）。";
        render(); toast("已生成描述（原型）"); return;
      }
      case "bridge-detect": loadingThen(el, 700, () => { render(); toast("探测成功：账号可达（原型）"); }); return;
      case "bridge-save": {
        const d = state.bridgeDraft || {};
        if (!String(d.name || "").trim() || !String(d.url || "").trim()) { toast("显示名与对端地址必填"); return; }
        state.bridgeConnected = true; state.bridgeDrawer = null; state.bridgeDraft = null;
        render(); toast("已保存并连接「" + d.name + "」"); return;
      }
      case "wb-close": toast("已关闭当前工作台会话"); return;
      case "wb-auth": loadingThen(el, 800, () => { render(); toast("跳转腾讯云授权页（原型）"); }); return;
      case "sso-save": loadingThen(el, 400, () => { render(); toast(SSO_KINDS[val].name + " 配置已保存"); }); return;
      case "sso-test": loadingThen(el, 600, () => { render(); toast(SSO_KINDS[val].name + (ssoCfgOf(val).enabled ? " 连接正常" : " 已配置，启用后可测试登录")); }); return;
      case "sso-copy": toast("回调地址已复制"); return;
      case "prov-scope": state.provScope = val; render(); return;
      case "prov-close": state.provDrawer = false; render(); return;
      case "prov-model-add": { const d = provDraft(); d.models.push(""); render(); return; }
      case "pv-model-del": { const d = provDraft(); d.models.splice(Number(el.dataset.idx), 1); render(); return; }
      case "pv-fetch": { const d = provDraft(); d.models = (d.models.filter((m) => m) || []).concat(["gpt-4o-mini", "text-embedding-3-small"]); render(); toast("已拉取 2 个模型（原型）"); return; }
      case "prov-test": loadingThen(el, 600, () => { render(); toast("连接成功：返回 2 个模型（原型）"); }); return;
      case "prov-save": {
        const d = provDraft();
        if (!String(d.name || "").trim()) { toast("名称必填"); return; }
        if (!state.providers.some((p) => p.name === d.name)) {
          state.providers.push({ name: d.name, id: d.name.toLowerCase().replace(/\s+/g, "-"), models: (d.models || []).filter(Boolean).length + " 个模型", status: "已授权" });
        }
        state.provDrawer = false; state.provDraft = null;
        render(); toast("已保存并启用「" + d.name + "」"); return;
      }
      case "plugin-close": state.pluginDrawer = false; render(); return;
      case "plugin-pick": toast("已选择 plugins/demo.zip（原型）"); return;
      case "plugin-perm": {
        const d = state.pluginDraft || (state.pluginDraft = { perms: [] });
        d.perms = d.perms || [];
        d.perms = d.perms.includes(val) ? d.perms.filter((x) => x !== val) : d.perms.concat(val);
        render(); return;
      }
      case "plugin-save": {
        const d = state.pluginDraft || {};
        const name = d.mode === "zip" ? (d.slug || "imported-plugin") : d.name;
        if (!name) { toast("请填写插件名称"); return; }
        if (!PLUGINS.some((p) => p.name === name)) PLUGINS.push({ name: name, desc: "新安装的插件", version: "0.1.0", on: true, perms: d.perms || [] });
        state.pluginDrawer = false; state.pluginDraft = null;
        render(); toast("已安装「" + name + "」"); return;
      }
      case "prov-more": state.provMore = !state.provMore; render(); return;
      case "prov-fav": state.provFav = !state.provFav; render(); return;
      case "media-save": loadingThen(el, 400, () => { render(); toast("生成路由已保存"); }); return;

      case "prov-custom": toast("自定义供应商（原型）：填名称 / Base URL / API Key"); return;
      case "storage-config": {
        const name = el.dataset.name || "腾讯云 COS";
        const existing = state.storages.find((x) => x.name === name);
        state.storageDraft = { name: existing ? existing.name : "admin", kind: name };
        state.storageDrawer = true;
        render(); return;
      }
      case "storage-tab-types": state.storageTab = "types"; render(); return;
      case "storage-close": state.storageDrawer = null; render(); return;
      case "storage-save": {
        const d = state.storageDraft || {};
        if (!String(d.name || "").trim()) { toast("名称必填"); return; }
        state.storages.push({ id: "st" + Date.now().toString(36), name: d.name, detail: (d.kind || "") + " · " + (d.bucket || "未填 Bucket"), status: "已配置" });
        state.storageDrawer = null; state.storageDraft = null;
        state.storageTab = "mine";
        render(); toast("已创建「" + d.name + "」存储后端"); return;
      }
      case "plugin-cat": state.pluginCat = val; render(); return;
      case "plugin-tab-market": state.pluginTab = "market"; render(); return;
      case "plugin-zip": { state.pluginDraft = { mode: "zip", name: "", version: "", slug: "", perms: ["网络"] }; state.pluginDrawer = true; render(); return; }
      case "role-view": state.roleView = val; render(); return;
      case "role-new": toast("新建角色（原型）"); return;
      case "role-delete": toast("内置角色不可删除"); return;
      case "user-edit": toast("编辑用户（原型）"); return;
      case "skillpkg-close": state.skillPkgDrawer = null; render(); return;
      case "skillpkg-save": {
        const d = skillPkgDraft();
        if (!String(d.name || "").trim()) { toast("技能包名称必填"); return; }
        const id = "p" + (SKILL_PACKAGES.length + 1);
        SKILL_PACKAGES.push({ id: id, name: d.name, desc: d.desc || "暂无描述", owner: "admin", shared: d.share === "all", skills: [], icon: d.icon });
        state.skillPkg = id;
        state.skillPkgDrawer = null; state.skillPkgDraft = null;
        render(); toast("已创建「" + d.name + "」，去添加技能吧"); return;
      }
      case "spd-icon": skillPkgDraft().icon = val; render(); return;
      case "spd-policy": skillPkgDraft().policy = val; render(); return;
      case "spd-share": skillPkgDraft().share = val; render(); return;
      case "spd-ai": {
        const d = skillPkgDraft();
        d.desc = (d.name || "技能包") + "：把一组可复用的技能收在一起，用于" + "（按名称生成，可再修改）" + "。";
        render(); toast("已根据名称生成描述（原型）"); return;
      }
      case "skill-add": state.skillCreate = true; state.skillDraft = null; render(); return;
      case "skill-create-close": state.skillCreate = false; render(); return;
      case "skill-create-save": {
        const d = skillDraft();
        if (!String(d.name || "").trim()) { toast("技能名称必填"); return; }
        if (!String(d.content || "").trim()) { toast("技能实现内容必填"); return; }
        const cur = SKILL_PACKAGES.find((p) => p.id === state.skillPkg) || SKILL_PACKAGES[0];
        const key = "custom-" + (Date.now().toString(36));
        if (cur) cur.skills.push(key);
        state.skillMeta = state.skillMeta || {};
        state.skillMeta[key] = { name: d.display || d.name, desc: d.short || d.desc || "自定义技能", ic: "spark", emoji: d.emoji };
        state.skillCreate = false; state.skillDraft = null;
        render(); toast("已创建技能「" + d.name + "」并加入技能包"); return;
      }
      case "skd-mode": skillDraft().mode = val; render(); return;
      case "skd-emoji": skillDraft().emoji = val; render(); return;
      case "skd-meta": toast("已添加一个 Metadata 字段（原型）"); return;
      case "skd-ai": {
        const d = skillDraft();
        const n = d.name || "这个技能";
        d.desc = n + "：在用户提出相关请求时使用，按步骤给出结论与依据。";
        d.display = d.display || d.name;
        d.short = d.short || d.desc;
        render(); toast("已生成描述与展示文案（原型）"); return;
      }
      case "skillpkg-menu": {
        const p = SKILL_PACKAGES.find((x) => x.id === el.dataset.id);
        openMenu(el, p ? p.name : "技能包", [
          { label: "添加技能", act: "skill-add", icon: "plus" },
          { label: "导出 ZIP", act: "skill-export-zip", icon: "download" },
          { sep: true },
          { label: "删除技能包", act: "skillpkg-delete", value: p ? p.id : "", icon: "trash" },
        ]); return;
      }
      case "skillpkg-delete": {
        const idx = SKILL_PACKAGES.findIndex((x) => x.id === val);
        if (idx >= 0) { const n = SKILL_PACKAGES[idx].name; SKILL_PACKAGES.splice(idx, 1); state.skillPkg = SKILL_PACKAGES[0] ? SKILL_PACKAGES[0].id : ""; render(); toast("已删除「" + n + "」"); }
        return;
      }
      case "skillpkg-market": navigate("personalization"); state.persTab = "skills"; state.persSkillTab = "market"; render(); return;
      case "skill-export-zip": loadingThen(el, 500, () => { render(); toast("已导出技能包 ZIP（原型）"); }); return;
      case "channel-config": {
        const ch = state.channels.find((c) => c.id === el.dataset.id);
        openForm("channel", "配置 " + (ch ? ch.name : "通道"), [
          { label: "App ID / Bot Token", id: "c-id", value: ch && ch.status === "已连接" ? "cli_xxxxxxxx" : "", placeholder: "从开放平台复制", required: true },
          { label: "App Secret", id: "c-secret", placeholder: "从开放平台复制" },
          { label: "机器人前缀", id: "c-prefix", value: ch ? ch.prefix : "@poly", placeholder: "@poly" },
        ], { confirmLabel: "保存并连接", channelId: ch ? ch.id : "", hint: "保存后会立即验证凭据并把通道置为已连接；控制台通道不可关闭。" });
        return;
      }
      case "channel-check": {
        const ch = state.channels.find((c) => c.id === el.dataset.id);
        if (!ch) return;
        if (ch.status !== "已连接") { toast("该通道还没有有效凭据，请先点「配置」", "error"); return; }
        loadingThen(el, 500, () => { render(); toast(ch.name + " 连接正常，最近 5 分钟收到 0 条新消息"); });
        return;
      }
      case "acp-config": {
        const r = state.acpRunners.find((x) => x.id === el.dataset.id) || {};
        openForm("acp-config", "配置 " + (r.name || "ACP Runner"), [
          { label: "启动命令", id: "acp-cmd", value: r.cmd || "opencode --acp", required: true },
          { label: "参数（每行一个）", id: "acp-args", placeholder: "--model\n--read-only" },
          { label: "环境变量（KEY=VALUE）", id: "acp-env", placeholder: "API_KEY=..." },
        ], { acpId: r.id || "", hint: "保存后点「检测」确认 CLI 可用，再启用。" });
        return;
      }
      case "acp-detect": {
        const r = state.acpRunners.find((x) => x.id === el.dataset.id);
        if (!r) return;
        loadingThen(el, 600, () => {
          r.status = r.cmd ? "已安装" : "未安装";
          render();
          toast(r.status === "已安装" ? r.name + " 检测通过，可启用" : r.name + " 未找到可执行文件", r.status === "已安装" ? "" : "error");
        });
        return;
      }
      case "acp-delete": {
        const r = state.acpRunners.find((x) => x.id === el.dataset.id);
        if (!r) return;
        state.modal = { type: "confirm", title: "删除 Runner", body: "删除「" + r.name + "」后，使用它的专家将回退到内置执行器。", confirmLabel: "删除", danger: true, onConfirm: () => {
          state.acpRunners = state.acpRunners.filter((x) => x.id !== r.id);
          state.modal = null; render(); toast("已删除 Runner");
        } };
        render(); return;
      }
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
      case "plugin-install": {
        state.pluginDraft = { mode: "install", name: el.dataset.name || "", version: el.dataset.ver || "v0.1.0", slug: "", perms: ["网络"] };
        state.pluginDrawer = true; render(); return;
      }
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
        const c = state.connectors.find((x) => x.id === id);
        if (!c) return;
        state.connector = c;
        render(); return;
      }
      case "close-connector": state.connector = null; render(); return;
      case "conn-save": {
        const nameEl = $("#conn-name");
        const descEl = $("#conn-desc");
        const name = nameEl ? nameEl.value.trim() : "";
        if (!name) { if (nameEl) nameEl.style.borderColor = "var(--red)"; toast("显示名称不能为空", "error"); return; }
        if (/fail/i.test(name)) { toast("保存失败：服务端拒绝，已回滚到上次配置", "error"); return; }
        const target = state.connectors.find((x) => x.id === id) || state.connector;
        loadingThen(el, 400, () => {
          if (target) {
            target.name = name;
            if (descEl) target.desc = descEl.value.trim();
          }
          state.connector = null; render(); toast("连接器配置已保存");
        });
        return;
      }
      case "conn-probe": {
        const c = state.connectors.find((x) => x.id === id) || state.connector;
        if (c && c.status === "已过期") { toast("授权已过期，请先点「重新授权」", "error"); return; }
        loadingThen(el, 500, () => {
          if (c) c.tools = c.tools || 12;
          render(); toast((c ? c.name : "连接器") + " 测试通过，发现 " + (c ? c.tools : 12) + " 个工具");
        });
        return;
      }
      case "conn-oauth": {
        const c = state.connectors.find((x) => x.id === id) || state.connector;
        state.oauthTarget = c ? c.id : "";
        state.modal = { type: "oauth", provider: (c && c.name) || "连接器", step: 0 }; render(); return;
      }
      case "oauth-start":
        if (!state.modal || state.modal.type !== "oauth") return;
        state.modal.step = 1; render();
        setTimeout(() => {
          if (state.modal && state.modal.type === "oauth" && state.modal.step === 1) { state.modal.step = 2; render(); }
        }, 1600);
        return;
      case "oauth-complete": {
        const c = state.connectors.find((x) => x.id === state.oauthTarget) || state.connector;
        if (c) c.status = "已连接";
        if (state.connector) state.connector.status = "已连接";
        state.modal = null; render(); toast("授权成功，连接已恢复"); return;
      }
      case "conn-default": {
        const c = state.connectors.find((x) => x.id === id);
        if (c) { c.def = !c.def; render(); toast(c.def ? "已设为对话默认" : "已取消默认"); }
        return;
      }
      case "conn-add": {
        state.formErrors = {};
        state.modal = { type: "form", kind: "connector", title: "添加连接", confirmLabel: "创建", fields: [
          { label: "服务", id: "n-kind", type: "select", options: ["飞书", "企业微信", "钉钉", "Notion", "邮箱", "自定义 MCP"] },
          { label: "显示名称", id: "n-name", value: el.dataset.name || "", placeholder: "例如 研发群飞书", required: true },
          { label: "App ID / Client ID", id: "n-id", placeholder: "从开放平台复制", required: true },
          { label: "App Secret / Token", id: "n-secret", placeholder: "从开放平台复制" },
          { label: "共享范围", id: "n-share", type: "select", options: ["仅自己", "所有人", "指定用户分组"] },
        ], hint: "保存后连接器会出现在「已启用连接器」；OAuth 类服务可再点「重新授权」。" };
        render(); return;
      }
      case "conn-delete": {
        const cid = id || (state.connector && state.connector.id);
        const c = state.connectors.find((x) => x.id === cid);
        state.modal = { type: "confirm", title: "删除连接器", body: "删除「" + (c ? c.name : "") + "」后，使用它的专家将无法调用其工具；此操作不可撤销。", confirmLabel: "删除", danger: true, onConfirm: () => {
          state.connectors = state.connectors.filter((x) => x.id !== cid);
          state.connector = null; state.modal = null; render(); toast("已删除连接器");
        } };
        render(); return;
      }
      case "mcp-mode": state.mcpMode = val; render(); return;
      case "mcp-add": case "mcp-edit": {
        const s = act === "mcp-edit" ? state.mcpServers.find((x) => x.id === el.dataset.id) : null;
        state.formErrors = {};
        state.modal = { type: "form", kind: "mcp", title: act === "mcp-add" ? "添加 MCP Server" : "编辑 MCP Server", confirmLabel: "保存", mcpId: s ? s.id : "", fields: [
          { label: "显示名称", id: "m-name", value: s ? s.name : "", placeholder: "例如 我的知识库", required: true },
          { label: "Server ID", id: "m-id", value: s ? s.id : "", placeholder: "仅字母/数字/下划线/连字符" },
          { label: "Transport", id: "m-transport", type: "select", options: ["HTTP", "Stdio"], value: s ? s.transport : "HTTP" },
          { label: "URL / Command", id: "m-url", value: s ? s.url : "", placeholder: "https://mcp.example.com/mcp", required: true },
          { label: "Headers / Args / Env", id: "m-extra", placeholder: "每行 Key: Value 或 KEY=VALUE" },
        ], hint: "保存前可探测；需要 OAuth 的 MCP 会先引导授权。" };
        render(); return;
      }
      case "mcp-probe": {
        const srv = state.mcpServers.find((s) => s.id === el.dataset.id);
        loadingThen(el, 500, () => {
          if (srv) { srv.tools = srv.tools || 8; srv.status = "可用"; }
          render(); toast("MCP 探测成功" + (srv ? "：发现 " + srv.tools + " 个工具" : ""));
        });
        return;
      }
      case "mcp-save": {
        const ta = $("#mcp-json");
        if (!ta || !ta.value.trim()) { toast("没有可保存的配置", "error"); return; }
        loadingThen(el, 400, () => { render(); toast("MCP JSON 已保存，面板已重载"); });
        return;
      }
      case "mcp-delete": {
        const mid = el.dataset.id;
        state.modal = { type: "confirm", title: "删除 MCP Server", body: "删除后使用它的专家将不再加载这些工具。", confirmLabel: "删除", danger: true, onConfirm: () => {
          state.mcpServers = state.mcpServers.filter((s) => s.id !== mid);
          state.modal = null; render(); toast("已删除 MCP Server");
        } };
        render(); return;
      }
      case "cron-new":
        state.cronDraft = { name: "", cron: "0 9 * * *", type: "智能体", kind: "agent", prompt: "", channel: "控制台", on: true, fresh: true };
        state.cronDrawer = "new"; render(); return;
      case "cron-example":
        state.cronDraft = { name: val.slice(0, 18), cron: el.dataset.cron || "0 9 * * *", type: "智能体", kind: "agent", prompt: val, channel: "控制台", on: true, fresh: true };
        state.cronDrawer = "new"; render(); return;
      case "cron-close": state.cronDraft = null; render(); return;
      case "cron-filter": state.cronFilter = val; render(); return;
      case "cron-save": {
        const d = state.cronDraft;
        if (!d) return;
        if (!String(d.name).trim() || !String(d.cron).trim()) { toast("任务名称与执行频率必填"); return; }
        if (d.id) {
          const j = state.cronJobs.find((x) => x.id === d.id);
          if (j) Object.assign(j, { name: d.name, cron: d.cron, type: d.type, prompt: d.prompt, channel: d.channel, on: d.on });
          toast("已保存「" + d.name + "」");
        } else {
          state.cronJobs.unshift({ id: "cr_" + (state.cronJobs.length + 1) + "_" + Date.now().toString(36), name: d.name, cron: d.cron,
            desc: "按 Cron 调度", type: d.type, last: "—", next: "明天 09:00", on: d.on, prompt: d.prompt, channel: d.channel });
          toast("已创建「" + d.name + "」");
        }
        state.cronDraft = null; render(); return;
      }
      case "cron-edit": {
        const j = state.cronJobs.find((x) => x.id === el.dataset.id);
        if (!j) return;
        state.cronDraft = { id: j.id, name: j.name, cron: j.cron, type: j.type, kind: "agent", prompt: j.prompt || "", channel: j.channel || "控制台", on: j.on, fresh: true };
        state.cronDrawer = j.id; render(); return;
      }
      case "cron-menu":
        openMenu(el, "更多操作", [
          { label: "暂停 / 启用", act: "cron-toggle", value: el.dataset.id, icon: "stop" },
          { label: "查看执行记录", act: "cron-history", value: el.dataset.id, icon: "chart" },
          { sep: true },
          { label: "删除任务", act: "cron-delete", value: el.dataset.id, icon: "trash" },
        ]);
        return;
      case "cron-toggle": {
        const j = state.cronJobs.find((x) => x.id === val);
        if (j) { j.on = !j.on; j.next = j.on ? "明天 09:00" : "—"; render(); toast(j.on ? "已启用 " + j.name : "已暂停 " + j.name); }
        return;
      }
      case "cron-history":
        state.modal = { type: "cron-history", jobId: val, title: "执行记录" }; render(); return;
      case "cron-run": {
        const j = state.cronJobs.find((x) => x.id === el.dataset.id);
        if (!j) return;
        loadingThen(el, 700, () => {
          j.last = now() + " · 成功";
          j.next = "明天 09:00";
          (state.cronHistory[j.id] || (state.cronHistory[j.id] = [])).unshift({ at: Date.now(), ok: true, note: "手动触发 · 输出已投递到" + (j.channel || "控制台") });
          render(); toast("已触发「" + j.name + "」，结果已投递");
        });
        return;
      }
      case "cron-delete": {
        const jid = el.dataset.id;
        const j = state.cronJobs.find((x) => x.id === jid);
        state.modal = { type: "confirm", title: "删除定时任务", body: "删除「" + (j ? j.name : "") + "」后不再调度；历史执行记录会保留。", confirmLabel: "删除", danger: true, onConfirm: () => {
          state.cronJobs = state.cronJobs.filter((x) => x.id !== jid);
          state.modal = null; render(); toast("已删除定时任务");
        } };
        render(); return;
      }
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
        } else if (kind === "channel") {
          if (!values["c-id"]) errors["c-id"] = "填写 Bot Token / App ID 后才能连接";
        } else if (kind === "acp") {
          if (!values["a-id"]) errors["a-id"] = "Runner ID 不能为空";
          if (!values["a-cmd"]) errors["a-cmd"] = "启动命令不能为空";
        } else if (kind === "connector") {
          if (!values["n-name"]) errors["n-name"] = "显示名称不能为空";
          if (!values["n-id"]) errors["n-id"] = "App ID / Client ID 不能为空";
        } else if (kind === "mcp") {
          if (!values["m-name"]) errors["m-name"] = "显示名称不能为空";
          if (!values["m-url"]) errors["m-url"] = "URL / Command 不能为空";
        } else if (kind === "cron") {
          if (!values["c-name"]) errors["c-name"] = "任务名称不能为空";
          if (!/^[\d*\/,\- ]+$/.test(values["c-cron"] || "")) errors["c-cron"] = "请输入合法的 Cron 表达式，例如 0 9 * * *";
        } else if (kind === "kb-file") {
          if (!values["kf-name"]) errors["kf-name"] = "文件名不能为空";
        } else if (kind === "kb-folder") {
          if (!values["kf-folder"]) errors["kf-folder"] = "文件夹名称不能为空";
        } else if (kind === "group") {
          if (!/^[a-z0-9-]{2,32}$/.test(values["g-id"] || "")) errors["g-id"] = "分组 ID 需为 2–32 位小写字母、数字或短横线";
        } else if (kind === "kb" || kind === "kb-rename") {
          if (!values["kb-name"]) errors["kb-name"] = "知识库名称不能为空";
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
          } else if (kind === "channel") {
            const ch = state.channels.find((c) => c.id === modal.channelId);
            if (ch) { ch.status = "已连接"; ch.on = true; if (values["c-prefix"]) ch.prefix = values["c-prefix"]; }
            else state.channels.push({ id: "ch_" + uid(), name: "自定义通道", status: "已连接", prefix: values["c-prefix"] || "@poly", msgs: "0", on: true });
          } else if (kind === "acp-config") {
            const r = state.acpRunners.find((x) => x.id === modal.acpId);
            if (r && values["acp-cmd"]) r.cmd = values["acp-cmd"];
          } else if (kind === "acp") {
            const rid = (values["a-id"] || "runner").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
            if (!state.acpRunners.find((x) => x.id === rid)) {
              state.acpRunners.push({ id: rid, name: values["a-id"] || rid, cmd: values["a-cmd"] || "", status: values["a-cmd"] ? "已安装" : "未安装", on: false });
            } else toast("Runner ID 已存在", "error");
          } else if (kind === "connector") {
            state.connectors.push({ id: "cn_" + uid(), name: values["n-name"] || "新连接器", kind: values["n-kind"] || "custom", status: "已连接", desc: values["n-name"] + " · " + (values["n-id"] || ""), tools: 8, def: false });
          } else if (kind === "mcp") {
            const editing = modal.mcpId ? state.mcpServers.find((s) => s.id === modal.mcpId) : null;
            if (editing) {
              editing.name = values["m-name"] || editing.name;
              editing.transport = values["m-transport"] || editing.transport;
              editing.url = values["m-url"] || editing.url;
            } else {
              const mid = (values["m-id"] || values["m-name"] || "mcp").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
              state.mcpServers.push({ id: mid, name: values["m-name"] || mid, transport: values["m-transport"] || "HTTP", url: values["m-url"] || "", tools: 0, on: true, def: false });
            }
          } else if (kind === "cron") {
            const job = state.cronJobs.find((j) => j.id === modal.cronId);
            if (job) {
              job.name = values["c-name"] || job.name; job.cron = values["c-cron"] || job.cron;
              job.type = values["c-type"] || job.type; job.prompt = values["c-prompt"] || ""; job.channel = values["c-channel"] || "控制台";
            } else {
              state.cronJobs.unshift({ id: "cr_" + uid(), name: values["c-name"] || "未命名任务", cron: values["c-cron"] || "0 9 * * *", desc: "自定义调度", type: values["c-type"] || "智能体", last: "—", next: "等待首次执行", on: true, prompt: values["c-prompt"] || "", channel: values["c-channel"] || "控制台" });
            }
          } else if (kind === "kb-file") {
            const fname = (values["kf-name"] || "untitled.md").replace(/[<>:"|?*\x00-\x1f]/g, "").trim() || "untitled.md";
            (DOCS[state.kb] || (DOCS[state.kb] = [])).unshift([fname, /\.txt$/i.test(fname) ? "TXT" : "Markdown", "ready", Math.max(1, Math.round((values["kf-content"] || "").length / 60)), "刚刚"]);
            DOC_FOLDER[fname] = state.kbFolder !== "root" ? state.kbFolder : "";
            syncKbCounts(); state.kbTab = "docs";
          } else if (kind === "kb-folder") {
            const f = (values["kf-folder"] || "").trim();
            if (f) {
              state.kbFolders[state.kb] = state.kbFolders[state.kb] || [];
              if (!state.kbFolders[state.kb].includes(f)) state.kbFolders[state.kb].push(f);
              KB_FOLDERS[state.kb] = state.kbFolders[state.kb];
            }
          } else if (kind === "agent-file") {
            const a = AGENTS.find((x) => x.id === modal.agentId);
            if (a) {
              a.files = a.files || {};
              a.files[values["af-name"]] = values["af-body"] || "";
              state.agentFile = values["af-name"];
              state.drawerDirty = true;
            }
          } else if (kind === "group") {
            const g = state.groups.find((x) => x.id === modal.groupId);
            if (g) { g.id = values["g-id"] || g.id; g.name = values["g-desc"] || g.name; }
            else state.groups.push({ id: values["g-id"], name: values["g-desc"] || values["g-id"], members: 0, on: true });
          } else if (kind === "kb") {
            const nid = "kb_" + uid();
            KBS.push({ id: nid, name: values["kb-name"], docs: 0, chunks: 0, status: "ready" });
            DOCS[nid] = []; state.kbFolders[nid] = []; KB_FOLDERS[nid] = [];
            state.kb = nid; state.kbTab = "docs";
          } else if (kind === "kb-rename") {
            const kb = kbById(modal.kbId);
            if (kb) kb.name = values["kb-name"];
          }
          state.modal = null;
          state.formErrors = {};
          render();
          toast(kind === "session-rename" ? "会话已重命名" : kind === "cron" && modal.cronId ? "定时任务已更新" : kind === "kb-folder" ? "文件夹已创建" : "已保存");
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
      case "session-pin": {
        const s = SESSIONS.find((x) => x.id === id);
        if (s) {
          s.pinned = !s.pinned;
          if (s.pinned) { s.group = "置顶"; SESSIONS.splice(SESSIONS.indexOf(s), 1); SESSIONS.unshift(s); }
          else { s.group = ""; }
        }
        state.menu = null; render(); toast(s && s.pinned ? "已置顶会话" : "已取消置顶"); return;
      }
      case "session-rename":
        state.modal = { type: "form", kind: "session-rename", title: "重命名会话", confirmLabel: "保存", sessionId: id, fields: [
          { label: "会话名称", id: "session-name", value: (SESSIONS.find((s) => s.id === id) || {}).title || "" },
        ] };
        render(); return;
      case "session-fork": {
        const src = SESSIONS.find((x) => x.id === id);
        if (!src) return;
        const sid = "s_" + uid();
        SESSIONS.unshift({ id: sid, title: src.title + " · 分支", preview: "分支自 " + src.title, time: now(), badge: "分支" });
        state.threads[sid] = (state.threads[id] || SESSION_THREADS[id] || state.messages).map((m) => ({ ...m, id: m.id ? m.id + "_f" : undefined }));
        state.menu = null; state.activeSession = sid; state.messages = state.threads[sid]; state.chatWelcome = false;
        navigate("chat"); toast("已创建分支会话"); return;
      }
      case "session-delete": {
        const idx = SESSIONS.findIndex((s) => s.id === id);
        state.modal = { type: "confirm", title: "删除会话", body: "删除后该会话的消息与运行轨迹将不可恢复。", confirmLabel: "删除", danger: true, onConfirm: () => {
          if (idx >= 0) SESSIONS.splice(idx, 1);
          delete state.threads[id];
          const wasActive = state.activeSession === id;
          state.modal = null;
          if (wasActive) {
            const next = SESSIONS[0];
            state.activeSession = next ? next.id : null;
            state.messages = next ? (state.threads[next.id] || SESSION_THREADS[next.id] || []) : [];
            state.chatWelcome = !next;
          }
          render(); toast("已删除会话");
        } };
        render(); return;
      }
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
      case "task-sort": state.taskSort = el.value; render(); return;
      case "filter-source": state.sourceFilter = state.sourceFilter === val && val !== "all" ? "all" : val; render(); return;
      case "filter-executor": state.executorFilter = val; render(); return;
      case "clear-filter": state.bucket = "all"; state.sourceFilter = "all"; state.executorFilter = "all"; state.q = ""; render(); return;
      case "task-select": state.selectedTask = id; state.detailOpen = true; render(); return;
      case "ticket-view": state.selectedTask = id; navigate("ticket/" + id); return;
      case "ticket-start": {
        const t = taskById(id);
        if (t) { startTask(t); }
        return;
      }
      case "ticket-cancel": {
        const t = taskById(id);
        if (t) { cancelTask(t, "已取消，未执行工具"); render(); toast("已取消，未执行工具"); }
        return;
      }
      case "ticket-why": {
        state.modal = { type: "note", title: "为什么需要任务？", body: '<p>这一步调用 <code class="inline">write_file</code> 并运行测试，会修改工作区文件，属于有副作用的操作。</p><p>任务用来记录四件事：谁授权（Mandate）、能做什么（scope）、花多少（预算）、出了事怎么查（审计与产物）。只读问答不会出现任务卡。</p>' };
        render(); return;
      }
      case "ticket-approve": case "ticket-approve-session": {
        const t = taskById(id);
        if (t && t.attention) approve(t.attention.id, act === "ticket-approve-session" ? "session" : "once");
        return;
      }
      case "ticket-deny": {
        const t = taskById(id);
        if (t && t.attention) deny(t.attention.id);
        return;
      }
      case "ticket-answer": {
        const t = taskById(id);
        if (!t || !t.attention) return;
        state.selectedAttention = t.attention.id;
        state.modal = { type: "answer", title: "回答问题", attId: t.attention.id };
        render(); return;
      }
      case "ticket-budget": {
        const t = taskById(id);
        state.modal = { type: "budget", title: "追加预算", task: t || taskById(state.selectedTask) };
        render(); return;
      }
      case "ticket-stop": {
        const t = taskById(id);
        if (!t) return;
        state.modal = { type: "confirm", title: t.suggested ? "取消任务" : "停止任务", body: "停止后不再执行任何工具，已产生的产物会保留；该决定会写入审计。", confirmLabel: "停止", danger: true, onConfirm: () => {
          cancelTask(t, "已由人停止");
          state.modal = null; render(); toast("已停止，未继续执行工具");
        } };
        render(); return;
      }
      case "ticket-retry": {
        const t = taskById(id);
        if (!t) return;
        if (t.attention) { t.attention.resolved = true; t.attention = null; }
        t.outcome = null; t.summary = "重试中"; t.cost = 0; t.progress = 0;
        pushEvent(t, "Retry", "manual retry · " + state.displayName, "info");
        taskRunTick(t); toast("已重新执行"); return;
      }
      case "ticket-rerun": {
        const t = taskById(id);
        if (!t) return;
        t.suggested = true; t.bucket = "queued"; t.state = "suggested"; t.outcome = null;
        t.progress = 0; t.cost = 0; t.artifacts = []; t.summary = "重新发起，等待授权";
        pushEvent(t, "Ticket", "reopened · 重新发起", "");
        render(); toast("已重新发起，确认后执行"); return;
      }
      case "task-stop": {
        const t0 = taskById(id);
        state.modal = { type: "confirm", title: "停止任务", body: "停止后不再执行任何工具，已产生的产物会保留；该决定会写入审计。", confirmLabel: "停止任务", danger: true, onConfirm: () => {
          cancelTask(taskById(id), "已由人停止");
          state.modal = null; render(); toast("已停止，该线程不再自动接单");
        } };
        if (!t0) { state.modal = null; return; }
        render(); return;
      }
      case "task-retry": {
        const t = taskById(id);
        if (!t) return;
        if (t.attention) { t.attention.resolved = true; t.attention = null; }
        t.outcome = null; t.summary = "重试中"; t.cost = 0; t.progress = 0;
        pushEvent(t, "Retry", "manual retry · " + state.displayName, "info");
        taskRunTick(t); toast("已重新执行"); return;
      }
      case "task-assign": {
        state.assignTaskId = id;
        const cur = (taskById(id) || {}).executor;
        openMenu(el, "选择执行器", [
          { label: "内置", hint: "通用", act: "assign-exec", value: "内置", active: cur === "内置" },
          { label: "Claude Code", hint: "编码", act: "assign-exec", value: "Claude Code", active: cur === "Claude Code" },
          { label: "Codex", hint: "编码", act: "assign-exec", value: "Codex", active: cur === "Codex" },
        ]);
        return;
      }
      case "assign-exec": {
        const t = taskById(state.assignTaskId || state.selectedTask);
        if (t) { t.executor = val; pushEvent(t, "Assign", "reassigned → " + val, ""); }
        state.menu = null; state.assignTaskId = null; render(); toast("已派给 " + val); return;
      }
      case "task-budget": {
        const t = taskById(id) || taskById(state.selectedTask);
        state.modal = { type: "budget", title: "追加预算", task: t };
        render(); return;
      }
      case "budget-save": {
        const input = $("#budget-input");
        const add = Number(input && input.value) || 0;
        if (add <= 0) { toast("追加金额需大于 0", "error"); return; }
        const t = (state.modal && state.modal.task) || taskById(state.selectedTask);
        if (!t) { state.modal = null; render(); return; }
        t.budget = Number((t.budget + add).toFixed(2));
        t.stalled = false;
        if (t.attention) { t.attention.resolved = true; t.attention = null; }
        pushEvent(t, "Budget", "追加 " + money(add) + " · 恢复执行", "ok");
        state.modal = null;
        taskRunTick(t);
        toast("预算已追加 " + money(add) + "，任务继续"); return;
      }
      case "budget-add": {
        const found = attentionById(id);
        if (!found) return;
        found.task.budget = Number((found.task.budget + 1).toFixed(2));
        found.task.stalled = false;
        found.att.resolved = true; found.att.decision = "budget"; found.att.decidedAt = now();
        pushEvent(found.task, "Budget", "追加 ¥1.00 · 恢复执行", "ok");
        taskRunTick(found.task);
        toast("已追加 ¥1.00，任务继续"); return;
      }
      case "task-export": {
        const t = taskById(id) || taskById(state.selectedTask);
        if (!t) return;
        const payload = { ticket: t, audit: state.auditEvents.filter((e) => e.taskId === t.id) };
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
        a.download = t.id + "-report.json"; a.click(); URL.revokeObjectURL(a.href);
        toast("报告已导出（JSON）"); return;
      }
      case "task-new": state.modal = { type: "new-task", title: "新建任务" }; render(); return;
      case "new-task-save": {
        const titleEl = $("#new-task-title");
        const title = titleEl ? titleEl.value.trim() : "";
        if (!title) { if (titleEl) titleEl.style.borderColor = "var(--red)"; toast("任务标题不能为空", "error"); return; }
        const source = ($("#new-task-source") || {}).value || "GitHub";
        const executor = ($("#new-task-exec") || {}).value || "内置";
        const id = "tk_" + uid();
        state.tasks.unshift({ id: id, title: title, bucket: "queued", state: "open", source: source === "飞书" ? "feishu" : source === "邮件" ? "email" : "github", sourceLabel: source, ref: "手动创建", actor: "you", actorColor: "blue", executor: executor, strength: "explicit", policy: 7, progress: 0, cost: 0, budget: 1, createdAt: "刚刚", summary: "等待执行器", updatedAt: Date.now(), timeline: [["刚刚", "Ticket", "manual · opened（跳过 Gate/Eval）", ""]], reports: [], artifacts: [] });
        state.modal = null; state.selectedTask = id; state.bucket = "queued";
        render(); toast("任务已创建，可立即执行"); return;
      }
      case "filter-open": return;

      case "mobile-more": state.mobileMore = !state.mobileMore; render(); return;
      case "detail-back": state.detailOpen = false; render(); return;
      case "attention-select": state.selectedAttention = id; state.detailOpen = true; render(); return;
      case "att-filter": state.attFilter = val; state.selectedAttention = null; state.inboxSelected = []; render(); return;
      case "att-check": {
        state.inboxSelected = state.inboxSelected.includes(id) ? state.inboxSelected.filter((x) => x !== id) : state.inboxSelected.concat(id);
        render(); return;
      }
      case "att-read": {
        const found = attentionById(id);
        if (found) { found.att.read = !found.att.read; render(); }
        return;
      }
      case "answer-open": case "answer-submit": {
        state.selectedAttention = id;
        state.modal = { type: "answer", title: "回答问题", attId: id };
        render(); return;
      }
      case "answer-save": {
        const v = (($("#answer-input") || {}).value || "").trim();
        if (!v) { toast("回答不能为空", "error"); return; }
        const attId = (state.modal && state.modal.attId) || state.selectedAttention;
        const found = attentionById(attId);
        if (found) {
          found.att.answer = v;
          pushEvent(found.task, "Attention", "answered · " + v, "ok");
        }
        state.modal = null;
        resolveAttention(attId);
        toast("已提交回答，Agent 继续"); return;
      }
      case "answer-inline-submit": {
        const ta = $("#answer-inline");
        const v = ta ? ta.value.trim() : "";
        if (!v) { toast("先填写回答", "error"); return; }
        const found = attentionById(id);
        if (!found) { toast("该事项已被处理", "error"); return; }
        found.att.answer = v;
        pushEvent(found.task, "Attention", "answered · " + v, "ok");
        resolveAttention(id);
        toast("已提交回答，Agent 继续"); return;
      }
      case "to-chat": navigate("chat"); return;
      case "snooze": state.snoozeAtt = id; openMenu(el, "稍后提醒", [
        { label: "10 分钟", act: "snooze-set", value: "10m" },
        { label: "1 小时", act: "snooze-set", value: "1h" },
        { label: "明天", act: "snooze-set", value: "1d" },
      ]); return;
      case "snooze-set": {
        const found = attentionById(state.snoozeAtt);
        if (found) pushEvent(found.task, "Attention", "snoozed · " + val + " · " + state.displayName, "");
        state.menu = null; state.snoozeAtt = null; render(); toast("已设为稍后提醒：" + val); return;
      }
      case "inbox-read-all": {
        let n = 0;
        state.tasks.forEach((t) => { if (t.attention && !t.attention.resolved && !t.attention.read) { t.attention.read = true; n++; } });
        render(); toast(n ? "已标记 " + n + " 项为已读，仍需决策" : "没有未读事项"); return;
      }
      case "inbox-bulk": {
        const ids = state.inboxSelected.slice();
        const approveMode = val === "approve";
        const targets = attentions().filter((x) => ids.includes(x.att.id) && x.att.kind === "approval");
        if (!targets.length) { toast("选中的事项里没有可批量处理的审批", "error"); return; }
        state.modal = { type: "confirm", title: (approveMode ? "批量批准 " : "批量拒绝 ") + targets.length + " 项",
          body: "将对这 " + targets.length + " 个工具调用执行「" + (approveMode ? "仅本次允许" : "拒绝") + "」。每一项都会写入审计，可在对应工单回看。",
          confirmLabel: approveMode ? "全部允许" : "全部拒绝", danger: !approveMode,
          onConfirm: () => {
            targets.forEach(({ att }) => { if (approveMode) approve(att.id, "once"); else deny(att.id); });
            state.inboxSelected = []; state.modal = null; render(); toast("已处理 " + targets.length + " 项");
          } };
        render(); return;
      }

      case "kb-select": state.kb = id; state.kbTab = "docs"; state.kbTest = null; state.kbSelected = []; state.kbSearch = ""; state.kbFolder = "root"; render(); return;
      case "kb-tab": state.kbTab = id; state.kbDirty = false; render(); return;
      case "kb-view": state.kbView = val; render(); return;
      case "kb-folder": state.kbFolder = val; state.kbSelected = []; render(); return;
      case "kb-new":
        openForm("kb", "新建知识库", [
          { label: "知识库名称", id: "kb-name", placeholder: "例如 产品手册", required: true },
        ], { confirmLabel: "创建", hint: "创建后可上传文档、配置向量模型与共享范围。" });
        return;
      case "kb-create-menu":
        openMenu(el, "新建", [
          { label: "新建文件", act: "kb-newfile", icon: "file" },
          { label: "新建文件夹", act: "kb-newfolder", icon: "folder" },
          { label: "新建知识库", act: "kb-new", icon: "book" },
        ]); return;
      case "kb-menu": {
        const kbid = el.dataset.id || state.kb;
        state.kb = kbid;
        openMenu(el, "知识库操作", [
          { label: "添加到会话", act: "kb-add-to-chat", value: kbid, icon: "chat" },
          { label: "编辑知识库", act: "kb-edit", value: kbid, icon: "edit" },
          { label: "导出文档清单", act: "kb-export", value: kbid, icon: "download" },
          { sep: true },
          { label: "删除", act: "kb-delete", value: kbid, icon: "trash" },
        ]); return;
      }
      case "kb-add-to-chat": {
        state.menu = null;
        toast("已把「" + kbById(state.kb).name + "」加入当前会话（原型）");
        render(); return;
      }
      case "kb-edit": {
        state.menu = null;
        state.kbDrawer = "edit";
        state.kbEdit = null;
        render(); return;
      }
      case "kb-open-settings": state.kbDrawer = "settings"; render(); return;
      case "kb-open-edit": state.kbDrawer = "edit"; state.kbEdit = null; render(); return;
      case "kb-drawer-close": state.kbDrawer = null; state.kbEdit = null; state.kbDirty = false; render(); return;
      case "kb-drawer-save": {
        const kb = kbById(state.kb);
        if (state.kbDrawer === "settings") {
          const cfg = kbCfgOf(kb);
          const read = (sel, key, num) => { const n = $(sel); if (n) cfg[key] = num ? Number(n.value) || cfg[key] : n.value; };
          read("#kb-ocr", "ocr");
          read("#kb-chunk", "chunk", true); read("#kb-overlap", "overlap", true);
          read("#kb-maxdocs", "maxDocs", true); read("#kb-maxmb", "maxMb", true);
          state.kbDrawer = null; state.kbDirty = false; render(); toast("知识库设置已保存");
        } else {
          const d = state.kbEdit || {};
          if (d.name) kb.name = d.name;
          kb.desc = d.desc != null ? d.desc : kb.desc;
          kb.icon = d.icon || kb.icon;
          const cfg = kbCfgOf(kb);
          if (d.maxDocs) cfg.maxDocs = Number(d.maxDocs) || cfg.maxDocs;
          state.kbDrawer = null; state.kbEdit = null; render(); toast("已保存「" + kb.name + "」");
        }
        return;
      }
      case "kb-model-source": kbCfgOf(kbById(state.kb)).modelSource = val; state.kbDirty = true; render(); return;
      case "kb-model-set": kbCfgOf(kbById(state.kb)).model = val; state.kbDirty = true; render(); return;
      case "kbedit-icon": state.kbEdit = Object.assign({}, state.kbEdit || { name: kbById(state.kb).name, desc: kbById(state.kb).desc || "" }, { icon: val }); render(); return;
      case "kb-ai-desc": {
        const kb = kbById(state.kb);
        state.kbEdit = Object.assign({}, state.kbEdit || { name: kb.name, icon: kb.icon || "book" }, { desc: kb.name + "：面向团队内部的标准答案与流程说明，支持按段落检索与引用。" });
        render(); toast("已根据名称生成描述（原型）"); return;
      }
      case "kb-rename": {
        const kb = kbById(state.kb);
        openForm("kb-rename", "重命名知识库", [{ label: "知识库名称", id: "kb-name", value: kb.name, required: true }], { kbId: kb.id, confirmLabel: "保存" });
        return;
      }
      case "kb-delete": {
        const kb = kbById(state.kb);
        const n = (DOCS[kb.id] || []).length;
        state.modal = { type: "confirm", title: "删除知识库", body: "删除「" + kb.name + "」会同时移除 " + n + " 篇文档与全部切片，不可恢复。", confirmLabel: "删除", danger: true, onConfirm: () => {
          const idx = KBS.findIndex((k) => k.id === kb.id);
          if (idx >= 0) KBS.splice(idx, 1);
          delete DOCS[kb.id];
          delete state.kbFolders[kb.id];
          delete KB_FOLDERS[kb.id];
          state.kb = KBS[0].id; state.kbFolder = "root"; state.kbSelected = []; state.modal = null; render(); toast("已删除知识库");
        } };
        render(); return;
      }
      case "kb-export": {
        const kb = kbById(state.kb);
        const csv = "name,status,chunks,updated\n" + (DOCS[kb.id] || []).map((d) => d[0] + "," + d[2] + "," + d[3] + "," + d[4]).join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = kb.id + "-docs.csv"; a.click(); URL.revokeObjectURL(a.href);
        toast("文档清单已导出"); return;
      }
      case "kb-toggle-doc": {
        const name = el.dataset.name;
        state.kbSelected = state.kbSelected.includes(name) ? state.kbSelected.filter((x) => x !== name) : state.kbSelected.concat(name);
        render(); return;
      }
      case "kb-select-all": {
        const kb = kbById(state.kb);
        const q = (state.kbSearch || "").toLowerCase();
        const folder = state.kbFolder !== "root" ? state.kbFolder : "";
        const names = (DOCS[kb.id] || []).filter((d) => (!folder || folderOf(d[0]) === folder) && (!q || d[0].toLowerCase().includes(q))).map((d) => d[0]);
        const allOn = names.length > 0 && names.every((x) => state.kbSelected.includes(x));
        state.kbSelected = allOn ? state.kbSelected.filter((x) => !names.includes(x)) : Array.from(new Set(state.kbSelected.concat(names)));
        render(); return;
      }
      case "kb-search-clear": state.kbSearch = ""; render(); return;
      case "kb-refresh": loadingThen(el, 350, () => { render(); toast("文档列表已刷新"); }); return;
      case "kb-bulk-delete": {
        const kb = kbById(state.kb);
        const n = state.kbSelected.length;
        state.modal = { type: "confirm", title: "删除 " + n + " 个文档", body: "切片与向量会一并移除，且不可恢复。", confirmLabel: "删除", danger: true, onConfirm: () => {
          DOCS[kb.id] = (DOCS[kb.id] || []).filter((d) => !state.kbSelected.includes(d[0]));
          state.kbSelected = []; syncKbCounts(); state.modal = null; render(); toast("已删除 " + n + " 个文档");
        } };
        render(); return;
      }
      case "kb-bulk-reindex": {
        const kb = kbById(state.kb);
        const names = state.kbSelected.slice();
        (DOCS[kb.id] || []).forEach((d) => { if (names.includes(d[0])) d[2] = "processing"; });
        state.kbSelected = []; render(); toast("已加入重建队列，完成后自动就绪");
        setTimeout(() => { (DOCS[kb.id] || []).forEach((d) => { if (names.includes(d[0])) { d[2] = "ready"; d[4] = "刚刚"; } }); syncKbCounts(); render(); }, 1600);
        return;
      }
      case "kb-newfile":
        openForm("kb-file", "新建文件", [
          { label: "文件名", id: "kf-name", placeholder: "例如 notes.md", required: true },
          { label: "内容", id: "kf-content", placeholder: "在此编写文档内容…" },
        ], { confirmLabel: "创建", hint: "创建后直接进入索引；" + (state.kbFolder !== "root" ? "将归入「" + state.kbFolder + "」。" : "将归入根目录。") });
        return;
      case "kb-newfolder":
        openForm("kb-folder", "新建文件夹", [
          { label: "文件夹名称", id: "kf-folder", placeholder: "例如 发布流程", required: true },
        ], { confirmLabel: "创建", hint: "文件夹用于组织文档，不参与检索。" });
        return;
      case "kb-vector-check": loadingThen(el, 450, () => { render(); toast("向量模型可用，维度 1024"); }); return;
      case "kb-retrieval-config":
        openMenu(el, "检索模式", [
          { label: "混合检索（向量 + 关键词）", act: "kb-retrieval", value: "hybrid", active: (kbCfgOf(kbById(state.kb)).retrieval || "hybrid") === "hybrid" },
          { label: "仅向量", act: "kb-retrieval", value: "vector", active: kbCfgOf(kbById(state.kb)).retrieval === "vector" },
          { label: "仅关键词", act: "kb-retrieval", value: "keyword", active: kbCfgOf(kbById(state.kb)).retrieval === "keyword" },
        ]); return;
      case "kb-share-config":
        openMenu(el, "共享范围", [
          { label: "仅自己", act: "kb-share", value: "self", active: kbCfgOf(kbById(state.kb)).share === "self" },
          { label: "所有人可读", act: "kb-share", value: "all", active: kbCfgOf(kbById(state.kb)).share === "all" },
          { label: "指定分组", act: "kb-share", value: "groups", active: kbCfgOf(kbById(state.kb)).share === "groups" },
        ]); return;
      case "kb-retrieval": kbCfgOf(kbById(state.kb)).retrieval = val; state.menu = null; state.kbDirty = true; render(); return;
      case "kb-share": kbCfgOf(kbById(state.kb)).share = val; state.menu = null; state.kbDirty = true; render(); return;
      case "kb-settings-save": {
        const cfg = kbCfgOf(kbById(state.kb));
        const read = (sel, key, num) => { const n = $(sel); if (n) cfg[key] = num ? Number(n.value) || cfg[key] : n.value; };
        read("#kb-model", "model"); read("#kb-ocr", "ocr");
        read("#kb-chunk", "chunk", true); read("#kb-overlap", "overlap", true);
        read("#kb-maxdocs", "maxDocs", true); read("#kb-maxmb", "maxMb", true);
        loadingThen(el, 400, () => { state.kbDirty = false; render(); toast("知识库设置已保存"); });
        return;
      }
      case "kb-settings-cancel": state.kbDirty = false; render(); toast("已放弃未保存的修改"); return;
      case "kb-upload": if (!requirePerm("knowledge:write")) return; state.modal = { type: "upload", title: "上传文档" }; render(); return;
      case "upload-save": {
        const input = $("#upload-file");
        const files = input && input.files ? Array.from(input.files) : [];
        if (!files.length) { toast("先选择一个文件", "error"); return; }
        loadingThen(el, 500, () => {
          const k = state.kb;
          files.forEach((f) => (DOCS[k] || (DOCS[k] = [])).unshift([f.name, (f.name.split(".").pop() || "FILE").toUpperCase(), "processing", 0, "刚刚"]));
          state.modal = null; render(); toast("已上传 " + files.length + " 个文件，正在解析");
          setTimeout(() => {
            (DOCS[k] || []).forEach((d) => {
              if (d[2] === "processing" && files.some((f) => f.name === d[0])) {
                d[2] = "ready"; d[3] = 40 + Math.floor(Math.random() * 60); d[4] = "刚刚";
              }
            });
            syncKbCounts(); render(); toast("解析完成，文档已可检索");
          }, 1800);
        });
        return;
      }
      case "kb-test-run": {
        const q = ($("#retrieval-q") || {}).value || "";
        if (!q) { toast("先输入问题", "error"); return; }
        const mode = ($("#retrieval-mode") || {}).value || "混合检索";
        const topk = Number(($("#retrieval-topk") || {}).value) || 5;
        loadingThen(el, 450, () => {
          state.kbTest = [
            { src: "deploy.md · 第 3 节 · chunk_12", score: "0.92", ms: 18, acl: "ACL · 研发组", text: "发布审批由 SRE 负责人 @alice 与业务 owner 共同确认；紧急发布需值班经理批准。" },
            { src: "incident-runbook.pdf · 第 2 页 · chunk_41", score: "0.81", ms: 21, acl: "ACL · 仅自己", text: "发布窗口：周三 14:00–17:00；回滚需在 30 分钟内完成。" },
            { src: "oncall.md · 第 1 节 · chunk_3", score: "0.66", ms: 12, acl: "ACL · 研发组", text: "值班经理在发布期间负责熔断决策，可直接回滚。" },
          ].slice(0, Math.max(1, Math.min(topk, 3)));
          state.kbTestMode = mode;
          render(); toast("检索完成 · " + mode + " · TopK " + topk);
        });
        return;
      }
      case "kb-test-clear": state.kbTest = null; render(); return;
      case "kb-test-sample": {
        state.kbTab = "retrieval"; render();
        const inp = $("#retrieval-q"); if (inp) inp.value = val;
        return;
      }
      case "kb-test-open": state.kbTab = "retrieval"; render(); return;
      case "doc-preview": state.modal = { type: "doc-preview", title: "预览 · " + (el.dataset.name || "文档"), name: el.dataset.name || "文档" }; render(); return;
      case "doc-reindex": {
        const d = docOf(el.dataset.name);
        if (!d) return;
        d[2] = "processing"; render(); toast("正在重建索引…");
        setTimeout(() => { d[2] = "ready"; d[3] = d[3] || 32; d[4] = "刚刚"; syncKbCounts(); render(); toast("索引已重建完成"); }, 1400);
        return;
      }
      case "doc-retry": {
        const d = docOf(el.dataset.name);
        if (!d) return;
        d[2] = "processing"; render(); toast("正在重试解析…");
        setTimeout(() => { d[2] = "ready"; d[3] = d[3] || 48; d[4] = "刚刚"; syncKbCounts(); render(); toast("重试成功，文档已可检索"); }, 1500);
        return;
      }
      case "doc-retry-all": {
        const kb = kbById(state.kb);
        const failed = (DOCS[kb.id] || []).filter((d) => d[2] === "failed");
        if (!failed.length) { toast("没有失败的文档"); return; }
        failed.forEach((d) => { d[2] = "processing"; });
        render(); toast("已重试 " + failed.length + " 个文档");
        setTimeout(() => { failed.forEach((d) => { d[2] = "ready"; d[3] = d[3] || 36; d[4] = "刚刚"; }); syncKbCounts(); render(); toast("全部重试完成"); }, 1600);
        return;
      }
      case "doc-delete": {
        const name = el.dataset.name;
        const kb = kbById(state.kb);
        state.modal = { type: "confirm", title: "删除文档", body: "确定删除「" + name + "」？切片与向量会一并移除，检索立即失效。", confirmLabel: "删除", danger: true, onConfirm: () => {
          DOCS[kb.id] = (DOCS[kb.id] || []).filter((d) => d[0] !== name);
          state.kbSelected = state.kbSelected.filter((x) => x !== name);
          delete DOC_FOLDER[name];
          syncKbCounts(); state.modal = null; render(); toast("已删除「" + name + "」");
        } };
        render(); return;
      }

      case "agent-filter": state.agentFilter = val; render(); return;
      case "agent-page-tab": state.agentPageTab = val; render(); return;
      case "chat-scope": state.chatScope = val; render(); return;
      case "agent-scope": state.agentScope = val; render(); return;
      case "agent-view": state.agentView = val; render(); return;
      case "agent-chat": state.agent = id; navigate("chat"); return;
      case "agent-market-create": state.agentPageTab = "mine"; render(); toast("已从专家市场创建「" + val + "」（原型）"); return;
      case "refresh": render(); toast("已刷新"); return;
      case "agent-open": {
        state.agent = id; state.agentTab = "basic"; state.drawer = "agent";
        state.agentDraft = null; state.drawerDirty = false; state.agentFile = null;
        agentDraftOf();
        render(); return;
      }
      case "agent-menu": {
        const a = AGENTS.find((x) => x.id === id);
        openMenu(el, a ? a.name : "专家", [
          { label: "编辑", act: "agent-open", value: id, icon: "edit" },
          { label: "复制", act: "agent-duplicate", value: id, icon: "copy" },
          { sep: true },
          { label: "删除", act: "agent-delete", value: id, icon: "trash" },
        ]);
        return;
      }
      case "agent-color": {
        const d = agentDraftOf();
        if (d) { d.color = val; state.drawerDirty = true; render(); }
        return;
      }
      case "agent-avatar": {
        const d = agentDraftOf();
        if (d) {
          const colors = ["blue", "violet", "teal", "amber", "rose"];
          d.color = colors[(colors.indexOf(d.color) + 1) % colors.length];
          state.drawerDirty = true; render();
        }
        return;
      }
      case "agent-avatar-remove": {
        const d = agentDraftOf();
        if (d) { d.color = "blue"; state.drawerDirty = true; render(); }
        return;
      }
      case "agent-tab": state.agentTab = id; render(); return;
      case "close-drawer": closeDrawerSafe(); return;
      case "agent-save": {
        const a = AGENTS.find((x) => x.id === id) || AGENTS.find((x) => x.id === state.agent);
        const d = agentDraftOf();
        loadingThen(el, 380, () => {
          applyAgentDraft(a, d);
          state.drawer = null; state.agentDraft = null; state.drawerDirty = false;
          render(); toast("已保存草稿，发布后新会话生效");
        });
        return;
      }
      case "agent-publish": {
        const a = AGENTS.find((x) => x.id === id) || AGENTS.find((x) => x.id === state.agent);
        const d = agentDraftOf();
        loadingThen(el, 450, () => {
          applyAgentDraft(a, d);
          const n = (a.versions || []).length + 1;
          const v = "v" + n;
          a.versions = [{ v: v, note: "已发布", at: new Date().toLocaleString("zh-CN") }].concat(a.versions || []);
          a.version = v; a.published = true;
          state.drawer = null; state.agentDraft = null; state.drawerDirty = false;
          render(); toast("已发布 " + v + "，新会话生效");
        });
        return;
      }
      case "agent-test": {
        const a = AGENTS.find((x) => x.id === id) || AGENTS.find((x) => x.id === state.agent) || AGENTS[0];
        if (!a) return;
        const sid = "try_" + uid();
        SESSIONS.unshift({ id: sid, title: "试运行 · " + a.name, preview: "沙箱会话，不写入真实工作区", time: now(), badge: "试运行" });
        state.threads[sid] = [{ role: "system", text: "试运行会话 · " + a.name + " · 沙箱工作区，不影响真实任务" },
          { role: "assistant", time: now(), text: "已进入 " + a.name + " 的试运行。这里可以验证配置，产生的调用不会计入任务与预算。" }];
        state.activeSession = sid; state.messages = state.threads[sid]; state.chatWelcome = false;
        state.drawer = null; state.agentDraft = null; state.drawerDirty = false;
        navigate("chat"); toast("已进入试运行会话");
        return;
      }
      case "agent-duplicate": {
        const a = AGENTS.find((x) => x.id === id);
        if (!a) return;
        const copy = JSON.parse(JSON.stringify(a));
        copy.id = "ag_" + uid(); copy.name = a.name + " 副本"; copy.published = false; copy.version = "v1";
        AGENTS.unshift(copy); render(); toast("已复制为「" + copy.name + "」"); return;
      }
      case "agent-delete": {
        const a = AGENTS.find((x) => x.id === id);
        if (!a) return;
        state.modal = { type: "confirm", title: "删除专家", body: "删除「" + a.name + "」后，其配置、技能与工作区引用将不可用；会话记录保留。", confirmLabel: "删除", danger: true, onConfirm: () => {
          const i = AGENTS.findIndex((x) => x.id === id);
          if (i >= 0) AGENTS.splice(i, 1);
          state.drawer = null; state.agentDraft = null; state.modal = null; render(); toast("已删除专家");
        } };
        render(); return;
      }
      case "agent-rollback": {
        const a = AGENTS.find((x) => x.id === state.agent);
        if (!a) return;
        state.modal = { type: "confirm", title: "回滚到 " + val, body: "回滚会以该版本覆盖当前配置，只影响新会话；进行中的会话继续使用当前版本。", confirmLabel: "回滚", danger: true, onConfirm: () => {
          a.version = val;
          a.versions = (a.versions || []).map((x) => (x.v === val ? { ...x, note: "当前" } : { ...x, note: x.note === "当前" ? "已发布" : x.note }));
          state.agentDraft = null;
          state.modal = null; render(); toast("已回滚到 " + val);
        } };
        render(); return;
      }
      case "agent-file-open": state.agentFile = el.dataset.name; render(); return;
      case "agent-file-save": {
        const a = AGENTS.find((x) => x.id === state.agent);
        const ta = $("#agent-file-content");
        if (a && ta) { a.files = a.files || {}; a.files[el.dataset.name] = ta.value; render(); toast(el.dataset.name + " 已保存"); }
        return;
      }
      case "agent-newfile": {
        openForm("agent-file", "新建配置文件", [
          { label: "文件名", id: "af-name", placeholder: "例如 STYLE.md", required: true },
          { label: "内容", id: "af-body", placeholder: "文件内容…" },
        ], { agentId: state.agent, confirmLabel: "创建" });
        return;
      }
      case "agent-export": {
        const a = AGENTS.find((x) => x.id === id) || AGENTS.find((x) => x.id === state.agent) || AGENTS[0];
        if (!a) return;
        const blob = new Blob([JSON.stringify({ name: a.name, version: a.version || "v3", model: a.model, desc: a.desc, files: a.files || {}, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = (a.name || "agent") + ".poly.json";
        link.click(); URL.revokeObjectURL(link.href);
        toast("已导出 .poly.json"); return;
      }
      case "agent-import": {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".json,.poly,.zip,.md";
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const a = AGENTS.find((x) => x.id === state.agent);
          if (a) {
            a.files = a.files || {};
            a.files[/\.md$/i.test(f.name) ? f.name : "IMPORTED.md"] = "（导入自 " + f.name + "；原型仅记录文件名与内容占位）";
          }
          render(); toast("已导入 " + f.name);
        };
        inp.click(); return;
      }
      case "agent-export-zip": {
        const a = AGENTS.find((x) => x.id === id) || AGENTS.find((x) => x.id === state.agent) || AGENTS[0];
        if (!a) return;
        const blob = new Blob([JSON.stringify({ agent: a.name, files: a.files || {} }, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = (a.name || "agent") + "-workspace.json";
        link.click(); URL.revokeObjectURL(link.href);
        toast("工作区清单已导出"); return;
      }
      case "agent-new": state.modal = { type: "agent-new", title: "新建专家" }; render(); return;
      case "agent-create": {
        const nameEl = $("#agent-name");
        const name = nameEl ? nameEl.value.trim() : "";
        if (!name) { if (nameEl) nameEl.style.borderColor = "var(--red)"; toast("专家名称不能为空", "error"); return; }
        const tpl = ($("#agent-template") || {}).value || "空白";
        AGENTS.unshift({ id: "ag_" + uid(), name: name, desc: tpl === "空白" ? "自定义专家" : tpl + "模板", model: "deepseek-v4", color: "blue", status: "空闲", sessions: 0, published: false, version: "v1" });
        state.modal = null;
        render(); toast("已创建 " + name);
        return;
      }
      case "agent-template": {
        state.modal = { type: "note", title: "模板库", body: ["业务专家", "代码助手", "知识库问答"].map((n) =>
          '<div class="setting-row"><div class="label"><b>' + n + '</b><span>预置提示词与工具集</span></div><button class="btn sm" data-act="agent-from-template" data-value="' + n + '">使用</button></div>').join("") };
        render(); return;
      }
      case "agent-from-template": {
        AGENTS.unshift({ id: "ag_" + uid(), name: val + " 副本", desc: val + "模板", model: "deepseek-v4", color: "violet", status: "空闲", sessions: 0, published: false, version: "v1" });
        state.modal = null; render(); toast("已从模板创建"); return;
      }
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
        const rows = usageDays(state.usageRange || "30d");
        const csv = "date,tokens,cost,calls,sessions\n" + rows.map((r) => r.label + "," + r.tokens + "," + r.cost + "," + r.calls + "," + r.sessions).join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = "usage-" + (state.usageRange || "30d") + ".csv"; a.click(); URL.revokeObjectURL(a.href);
        toast("已导出 " + rows.length + " 天用量 CSV"); return;
      }
      case "settings-tab": state.settingsTab = id; render(); return;
      case "toggle-switch": {
        const key = el.dataset.key;
        const scope = el.dataset.scope || "";
        if (key && scope === "security") {
          state.security[key] = !state.security[key];
          render(); toast(state.security[key] ? "已开启" : "已关闭"); return;
        }
        if (key && scope === "kbcfg") {
          const cfg = kbCfgOf(kbById(state.kb));
          cfg[key] = !cfg[key]; state.kbDirty = true; render(); return;
        }
        if (key && scope === "agent") {
          const d = agentDraftOf();
          if (d) { d[key] = !d[key]; state.drawerDirty = true; render(); }
          return;
        }
        if (key && scope === "channelCfg") {
          const cfg = channelCfgOf(state.channelDrawer);
          cfg[key] = !cfg[key];
          render(); return;
        }
        if (key && scope === "pv") {
          const d = provDraft();
          d[key] = !(d[key] !== false);
          render(); return;
        }
        if (key && scope === "plugin") {
          const p = PLUGINS.find((x) => x.name === key);
          if (p) p.on = !p.on;
          render(); return;
        }
        if (key && scope === "prov") {
          if (key === "media") state.mediaOn = !(state.mediaOn !== false);
          else if (key === "decision") state.decisionOn = !state.decisionOn;
          else toast(key + " 已切换（原型）");
          render(); return;
        }
        if (key && scope === "sso") {
          const kind = state.userTab;
          const cfg = ssoCfgOf(kind);
          if (key === kind) cfg.enabled = !cfg.enabled;
          else cfg[key] = !cfg[key];
          render(); return;
        }
        if (key && scope === "group") {
          const g = (state.groups || []).find((x) => x.id === key);
          if (g) { g.on = !g.on; render(); toast(g.id + (g.on ? " 已启用" : " 已停用")); }
          return;
        }
        if (key && scope === "user") {
          const u = state.adminUsers.find((x) => x.u === key);
          if (u) { u.status = u.status === "已禁用" ? "已启用" : "已禁用"; render(); toast(u.u + (u.status === "已禁用" ? " 已禁用" : " 已启用")); }
          return;
        }
        if (key && scope === "spd") {
          const d = skillPkgDraft();
          d[key] = !d[key];
          render(); return;
        }
        if (key && scope === "skill") {
          state.skillToggle[key] = !(state.skillToggle[key] !== false);
          render(); toast(state.skillToggle[key] ? "已启用 " + key : "已禁用 " + key); return;
        }
        if (key && scope === "cronDraft") {
          if (state.cronDraft) { state.cronDraft[key] = !state.cronDraft[key]; render(); }
          return;
        }
        if (key && scope === "agent-enable") {
          const a = AGENTS.find((x) => x.id === key);
          if (a) {
            a.status = a.status === "已停止" ? "运行中" : "已停止";
            render();
            toast(a.name + (a.status === "已停止" ? " 已停止" : " 已启动"));
          }
          return;
        }
        if (key && scope === "agentSkill") {
          const d = agentDraftOf();
          if (d) { d.skills[key] = !d.skills[key]; state.drawerDirty = true; render(); }
          return;
        }
        if (key && scope === "agentSub") {
          const d = agentDraftOf();
          if (d) { d.subagents[key] = !d.subagents[key]; state.drawerDirty = true; render(); }
          return;
        }
        if (key && scope === "pers") {
          state.persToggles[key] = !(state.persToggles[key] !== false);
          render(); toast(state.persToggles[key] ? "已开启" : "已关闭"); return;
        }
        if (key && scope === "cron") {
          const job = state.cronJobs.find((j) => j.id === key);
          if (job) { job.on = !job.on; job.next = job.on ? job.next || "明天 09:00" : "—"; job.last = job.on ? job.last : job.last; render(); toast(job.on ? "已启用定时任务" : "已暂停定时任务"); }
          return;
        }
        if (key && scope === "channel") {
          const ch = state.channels.find((c) => c.id === key);
          if (ch) { ch.on = !ch.on; render(); toast(ch.on ? "已启用通道" : "已关闭通道（仅停止收发）"); }
          return;
        }
        if (key && scope === "acp") {
          const r = state.acpRunners.find((x) => x.id === key);
          if (r) {
            if (!r.on && r.status !== "已安装") { toast("先检测并安装 CLI 才能启用", "error"); return; }
            r.on = !r.on; render(); toast(r.on ? "已启用 Runner" : "已停用 Runner");
          }
          return;
        }
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
      else if (state.drawer) { closeDrawerSafe(); }
      else if (state.connector) { state.connector = null; render(); }
      else if (state.userMenu) { state.userMenu = false; render(); }
      else if (state.mobileMore) { state.mobileMore = false; render(); }
      return;
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (state.modal && (state.modal.type === "form" || state.modal.type === "invite") && t.closest(".modal")) state.modal.dirty = true;
    if (state.agentDraft && (t.dataset.draft != null || t.dataset.agentFile) && t.closest(".drawer")) {
      if (t.dataset.draft != null) state.agentDraft[t.dataset.draft] = t.type === "number" ? Number(t.value) : t.value;
      state.drawerDirty = true;
      const badge = document.querySelector(".drawer-h .tag");
      if (badge) { badge.className = "tag amber sm"; badge.textContent = "有未保存修改"; }
    }
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
    if (t.dataset.input && t.dataset.input.indexOf("cron-") === 0 && state.cronDraft) {
      const field = t.dataset.input.slice(5);
      if (field === "mode") state.cronDraft.kind = t.value.indexOf("文本") === 0 ? "text" : "agent";
      else state.cronDraft[field === "name" ? "name" : field === "cron" ? "cron" : field === "type" ? "type" : field === "prompt" ? "prompt" : "channel"] = t.value;
      return;
    }
    if (t.dataset.input === "agent-search") {
      const pos = t.selectionStart;
      state.agentQ = t.value;
      render();
      const again = document.querySelector("[data-input='agent-search']");
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
    if (/^pv-/.test(t.dataset.input || "")) {
      const d = provDraft();
      const key = t.dataset.input.slice(3);
      if (/^model-\d+$/.test(key)) d.models[Number(key.slice(6))] = t.value;
      else d[key] = t.value;
      return;
    }
    if (t.dataset.input === "pg-slug") { (state.pluginDraft = state.pluginDraft || {}).slug = t.value; return; }
    if (t.dataset.input === "pg-name") { (state.pluginDraft = state.pluginDraft || {}).name = t.value; return; }
    if (/^st-/.test(t.dataset.input || "")) {
      const d = state.storageDraft || (state.storageDraft = { name: "", kind: "腾讯云 COS" });
      d[t.dataset.input.slice(3)] = t.value;
      return;
    }
    if (t.dataset.input === "plugin-q") {
      const pos = t.selectionStart;
      state.pluginQ = t.value;
      render();
      const again = document.querySelector("[data-input='plugin-q']");
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      return;
    }
    if (t.dataset.ssoField) {
      const cfg = ssoCfgOf(state.userTab);
      cfg.values[t.dataset.ssoField] = t.value;
      return;
    }
    if (/^bridge-/.test(t.dataset.input || "")) {
      const d = state.bridgeDraft || (state.bridgeDraft = { name: "", desc: "", url: "", account: "admin", password: "", share: "self" });
      const key = t.dataset.input.slice(7);
      d[key === "desc" ? "desc" : key === "name" ? "name" : key === "url" ? "url" : key === "account" ? "account" : "password"] = t.value;
      return;
    }
    if (/^(spd|skd)-/.test(t.dataset.input || "")) {
      const isPkg = t.dataset.input.indexOf("spd-") === 0;
      const d = isPkg ? skillPkgDraft() : skillDraft();
      const key = t.dataset.input.slice(4);
      d[key === "name" ? "name" : key === "desc" ? "desc" : key] = t.value;
      return;
    }
    if (t.dataset.input === "kbedit-name" || t.dataset.input === "kbedit-desc" || t.dataset.input === "kbedit-maxdocs") {
      const kb = kbById(state.kb);
      state.kbEdit = Object.assign({ name: kb.name, desc: kb.desc || "", icon: kb.icon || "book" }, state.kbEdit || {});
      state.kbEdit[t.dataset.input === "kbedit-name" ? "name" : t.dataset.input === "kbedit-desc" ? "desc" : "maxDocs"] = t.value;
      return;
    }
    if (t.dataset.input === "kb-model-q") {
      const pos = t.selectionStart;
      state.kbModelQ = t.value;
      render();
      const again = document.querySelector("[data-input='kb-model-q']");
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
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
    if (bootParams.get("persskills")) { state.persTab = "skills"; state.persSkillTab = bootParams.get("persskills"); }
    if (bootParams.get("channel")) state.channelDrawer = bootParams.get("channel");
    if (bootParams.get("skillpkg") === "1") { state.skillPkgDrawer = "create"; state.skillPkgDraft = null; }
    if (bootParams.get("usertab")) state.userTab = bootParams.get("usertab");
    if (bootParams.get("wbtab")) state.wbTab = bootParams.get("wbtab");
    if (bootParams.get("plugintab")) state.pluginTab = bootParams.get("plugintab");
    if (bootParams.get("mtab")) state.modelTab = bootParams.get("mtab");
    if (bootParams.get("pvopen") === "1") { state.provDrawer = true; state.provDraft = null; }
    if (bootParams.get("plugininstall") === "1") { state.pluginDrawer = true; state.pluginDraft = null; }
    if (bootParams.get("storagetab")) state.storageTab = bootParams.get("storagetab");
    if (bootParams.get("storagedrawer") === "1") state.storageDrawer = true;
    if (bootParams.get("bridgeempty") === "1") state.bridgeConnected = false;
    if (bootParams.get("bridgedrawer") === "1") { state.bridgeDrawer = true; state.bridgeDraft = null; }
    if (bootParams.get("skillcreate") === "1") { state.skillCreate = true; state.skillDraft = null; }
    if (bootParams.get("kbsettings") === "1") state.kbDrawer = "settings";
    if (bootParams.get("kbedit") === "1") { state.kbDrawer = "edit"; state.kbEdit = null; }
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
  if (bootParams.get("rail") === "1") state.railCollapsed = true;
  [["wbtab", "wbTab"], ["bridgetab", "bridgeTab"], ["acptab", "acpTab"], ["remotetab", "remoteTab"],
    ["storagetab", "storageTab"], ["plugintab", "pluginTab"], ["usertab", "userTab"], ["modeltab", "modelTab"],
    ["advtab", "advTab"], ["securitytab", "securityTab"], ["persTab", "persTab"], ["filetab", "fileTab"]].forEach(([p, k]) => {
    if (bootParams.get(p)) state[k] = bootParams.get(p);
  });
  if (bootParams.get("demo") === "ticket" || bootParams.get("demo") === "approval" || bootParams.get("demo") === "flow") {
    state.chatWelcome = false;
    const sid = "s_demo";
    SESSIONS.unshift({ id: sid, title: "修改重试次数", preview: "任务卡 · 等待授权", time: now() });
    state.activeSession = sid;
    state.messages = [
      { role: "system", text: "新会话 · 业务专家" },
      { role: "user", text: "把 auth.ts 里登录超时的重试次数改成 3，然后跑一下测试。", time: "10:02" },
      { role: "assistant", time: "10:03", text: "这一步会修改工作区文件并运行测试，需要创建一个任务来承载授权、预算和审计。" },
    ];
    state.threads[sid] = state.messages;
    const t = spawnChatTicket(state.messages[state.messages.length - 1], { silent: true });
    if (bootParams.get("demo") !== "ticket") startTask(t);
    if (bootParams.get("demo") === "flow" && t.attention) approve(t.attention.id, "once");
  }
  applyTheme();
  syncKbCounts();
  state.route = parseRoute();
  {
    const parts = state.route.split("/");
    if ((parts[0] === "tasks" || parts[0] === "ticket") && taskById(parts[1])) state.selectedTask = parts[1];
  }
  render();
})();
