# 07 · 设计评审与 Super-agent 对齐修订

> 本文做两件事：**（A）对前 6 份文档做一次诚实的完备性/合理性评审**；**（B）对照 DeepSeek Harness 团队的《Super-agent 设计探索》，给出必须的架构修订。**
> 结论：文档在"对话型 Agent 平台"这个假设内是自洽的、可执行的；但 Super-agent 揭示的是**"工作系统"而非"聊天系统"**。缺口不在模块细节，而在**工作入口（Intake）与工作授权（Mandate）**这两层。必须补，且要调整路线优先级。

---

## 0. 结论先行

| 判断 | 结论 |
|---|---|
| 文档完备性 | **7/10**：7 项原始要求全部有对应交付，但"主动性/多来源工作/授权"是系统性空白 |
| 架构合理性 | **8/10**：持久化执行 + 事件溯源 + 模块边界是扎实的；但**对话为中心**，缺"工作"这一层抽象 |
| 与 Super-agent 的差距 | **大**：我们做的是"更好的 Octop"，它描述的是"下一个形态"——常驻、并行、主动、可恢复 |
| 是否要改 | **要**，但不是推翻：在现有骨架上加 **Work Intake 层**，把 Executor 变成端口，把"注意力"变成一等指标 |
| 改动量 | 新增 1 个域（约 10 张表 / 12 类事件 / 6 个页面），调整 3 个里程碑；约 **+6–8 人周** |

**一句话修订**：把 PolyOpus 从"多用户多 Agent 聊天平台"升级为 **"带工作入口的常驻 Agent 系统"**：

```
Source → Trigger → (Gate → Assessment) → Ticket(Mandate) → Assignment → Executor → Report → Channel
```

---

## 1. 自评审：前 6 份文档到底怎么样

### 1.1 对照你最初提的 7 项要求

| # | 你的要求 | 交付 | 覆盖度 | 评价 |
|---|---|---|---|---|
| 1 | 架构设计 | `02` 全篇 | 90% | 分层、执行模型、数据模型、事件契约、安全、部署都有；缺"工作入口"层 |
| 2 | 优点 | `05` §1（16 条） | 95% | 每条有代码证据，可直接复用 |
| 3 | 缺点 | `05` §2（15 类） | 95% | 有量化画像与 file:line，可信 |
| 4 | 各模块设计与详细实现思路 | `03` 13 个模块 | 80% | 核心模块（conversations/kernel/capabilities）很细；billing/audit/api 偏薄；缺验收标准 |
| 5 | 各功能项能力 | `01` 110 项 | 90% | 逐项取舍与做法；缺"主动性"类能力（因为 Octop 本身弱） |
| 6 | 完整界面交互 | `04` 40+ 路由 + 对话页深度规格 | 85% | 对话/管理等齐全；缺"多任务并行""注意力收件箱""工单"视图 |
| 7 | 调整优化 | `05` §5（40 条） | 90% | 分 P0/P1/P2、有验收；但都是"修 Octop 的病"，不是"下一代形态" |

### 1.2 评分卡

| 维度 | 分 | 理由 |
|---|---:|---|
| 需求覆盖 | 8.5 | 七项要求均有实质交付，不是提纲 |
| 技术深度 | 8.0 | 有 DDL、状态机、接口签名、失败模式；少数模块停在原则层 |
| 内部一致性 | 7.5 | 前后术语基本统一；数字曾有小出入（已修）；`03` 缺统一术语表 |
| 可执行性 | 8.0 | 里程碑到人周、PR 清单、CI 门禁都可落地 |
| 前瞻性 | **5.0** | **最大短板**：假设"用户来聊天"，没假设"事件来找 Agent" |
| 可验证性 | 7.0 | NFR 有数字，但缺"任务成功率/人工干预率"这类结果指标 |
| 风险意识 | 7.5 | 有风险册；但低估"主动性带来的误动作与成本" |
| 文档工程 | 8.0 | 结构清晰、可导航；缺 ADR 模板与术语表 |

### 1.3 发现的 12 个缺口（按严重度）

| # | 缺口 | 级别 | 影响 | 修订 |
|---|---|---|---|---|
| G1 | **没有工作入口层**：所有入口（Web/IM/cron/webhook）各自为政，没有统一的 Source/Trigger 抽象 | P0 | 无法做"多来源、可去重、可审计、可回放"的常驻 Agent | 新增 Work Intake 域（§4.2） |
| G2 | **没有"工作授权"模型**：只有工具审批，没有"这件事为什么允许 Agent 做、能做多大" | P0 | 主动性 = 风险；出了事无法回答"谁授权的" | Policy + Mandate（§4.5） |
| G3 | **主动性被降级**：`01` 把 proactive 放 v2，`05` 把"主动关怀"当产品决策 | P0 | 丢掉 Super-agent 的核心价值（不用 @ 也能干活） | 提前到 v0.5，重定义为"事件驱动的工作"而非"打扰" |
| G4 | **工具是同步的**：`ToolSpec` 只有 timeout，没有 start/stop | P1 | 长任务（CI、浏览器、批处理）阻塞 worker，无法"边跑边接新指令" | 增加 async 工具与 tool_jobs（§4.7） |
| G5 | **上下文只有预算没有"引用图"** | P1 | 长任务里模型记不住"这件事从哪来、谁在处理" | Chain of Recall（§4.8） |
| G6 | **没有 Watchdog** | P1 | Agent 卡住/跑偏无人发现，只能等用户投诉 | 独立巡检 Session（§4.9） |
| G7 | **事件不合并**：每条消息一个 turn | P2 | 高峰期 Router/模型被打爆；成本高 | 批处理窗口（§4.10） |
| G8 | **指标只测系统，不测"注意力"** | P1 | 无法证明"更省人力"这个核心卖点 | 新增 4 个结果指标（§4.10） |
| G9 | **Executon 与内核耦合**：假定自研 kernel 永远在 | P1 | 无法接 Claude Code/Codex/DSH 等外部执行器；harness 迭代会被动 | Executor 端口（§4.6） |
| G10 | **没有主动性的成本治理** | P1 | 常驻 Agent 会 7×24 烧 token | 预算/配额/静默策略（§4.5） |
| G11 | **评测只测 RAG/工具，不测结果** | P1 | 不知道"接单是否正确、是否该拒绝" | 结果评测集（§4.10） |
| G12 | **模块缺验收标准与术语表** | P2 | 多人协作时口径漂移 | `03` 每模块加 DoD；新增术语表 |

### 1.4 过度设计与风险（自我批评）

| 项 | 问题 | 建议 |
|---|---|---|
| 自研 Agent 内核（~5k 行） | 与 Super-agent 的启示相反：harness 正在商品化，差异化在"入口/授权/注意力" | 改为 **Executor 端口 + 默认内核**，内核可替换（§4.6） |
| 首版 65 张表（含 intake 11 张） | 对 4 人团队偏重；`artifacts`/`kb_acl`/`workflows` 可后置 | v1 收敛到 ~50 张；工作流挪到 v1.5 |
| 34 周到 v2 | 加入 Intake 后至少 +6 周；且团队/联邦/桌面同时做会摊薄 | 砍联邦与桌面到 v2.5；团队降级为 Executor 的一种 |
| 工作流 DAG | 与 Ticket/Assignment 有重叠；先做"事件驱动 + 单工单"更划算 | v1 只做线性 Assignment；DAG 放 v2 |
| 多租户 + 单机默认 | 复杂度前置，收益后置 | 保留列与过滤器，但 UI 不做租户切换（v1） |

### 1.5 文档一致性问题（已修/待修）

- 数字：`01` 的能力计数、`02` 的表/事件数已对齐；`05` 的量化画像已补 CLI/桌面/测试行。
- 术语：`03` 的 "thread" 与 Super-agent 的 "Thread" 冲突；本文统一为 `conversation`（对话）与 `event_thread`（事件线程）。
- 交叉引用：`README` 已指向 6 份；本文加入后需更新索引。
- 待补：`03` 每模块的"验收标准"、`docs/glossary.md`（本文 §9 先给最小版）。

---

## 2. DeepSeek Super-agent 是什么（基于公开材料）

> **来源边界**：DeepSeek Harness 团队发布的是**设计探索文章**，并开源了研究原型 [`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)（README 明确写 "research prototype, not an official DeepSeek product"）。原型的定位是"**针对单个 GitHub 仓库的主动式编码 Agent**"，监听 GitHub（可选飞书），被允许的人提出工作时开一个 work item，在自己的 Session/目录里做，回到原对话（如 PR）回复，Web 面板只显示"需要人处理的事"。
> 下文架构细节参考了[官方仓库](https://github.com/deepseek-ai/dsh-superagent-prototype)、[架构解读](https://apidog.com/blog/how-to-build-a-super-agent/)与[国内报道](https://cloud.tencent.cn/developer/article/2774420)。实验数字来自解读文章转述，原文标注"indicative only"。

### 2.1 五个模块

| 模块 | 做什么 | 关键设计 |
|---|---|---|
| **Router / Worker 双层** | Router 是常驻 Session，只与人交互和派工，不执行任务；Worker 每任务一个隔离 Session，拿全工具与最强模型，只向 Router 汇报 | Router 可用轻模型、可不给 Bash；Worker 可再套子 Agent/团队；Router 只派**独立**任务，团队负责**耦合**任务 |
| **事件驱动 Triggers** | 聊天、GitHub webhook、CI 回调都归一为 Trigger | **两段过滤**：代码快路径（来源/群/白名单/模式）→ LLM 慢路径（策略提示词）；入口先 202 再排队 |
| **Thread 路由** | Thread = 同一 PR/IM 话题/邮件串上的连续事件；首个事件创建的 Worker 订阅该 Thread，后续事件直达 Worker，不再经过 Router | 多对多；两个 Worker 可同时订阅同一 PR；去掉直通后 Router 决策 +30%、token +37% |
| **上下文即缓存 + 全双工** | 常驻内容内联（ID、短摘要、邻接消息），其余截断留指针；Trigger/Thread/Worker 稳定 ID 构成 "Chain of Recall"；工具改 `start()/stop()` 异步；回复按渠道塑形（IM ≤100 词） | 支持"静默复现并修复"的投机执行 |
| **算力/状态/环境分离 + Watchdog** | 无状态容器跑循环，状态进 DB，环境留在机器上（BYOM 守护进程）；Watchdog 是独立定时 Session，检查每个 Worker 是否在推进/跑偏 | Watchdog 在主系统之外，Router 挂了它还在 |

### 2.2 实验数据（原文标注"仅示意"）

| 方案 | p50 (min) | p95 (min) | cache-read tokens/run |
|---|---:|---:|---:|
| Super-agent | 12.4 | 15.7 | 23.2M |
| 去掉 Thread 直通 | 12.6 | 15.5 | 31.8M |
| 单 Session + 子 Agent（中性提示） | 20.4 | 29.5 | 6.1M |
| 单 Session（委派优先提示） | 13.8 | 29.0 | 10.8M |

**三个可迁移结论**：
1. 单 Session 在"中性提示"下 5 次都没主动委派 → **委派必须由架构保证，不能靠提示词**。
2. 委派优先能把中位数拉平，但**尾部（p95）依然差** → 并行与隔离才是尾部优化。
3. Super-agent 用 **3.8 倍 token** 换 **近一半的 p95** → 这是一个明确的"花 token 买时延/注意力"的取舍，必须做成可配置预算。

### 2.3 它的领域模型（最值得抄的部分）

官方 `docs/001-domain.md` 定义了一套非常克制的概念，并且专门列了 **"Rejected concepts"**：

| 概念 | 定义 | 关键规则 |
|---|---|---|
| **Source** | 事件流；kind 是可复用实现，instance 是一份配置 | 自己记读取位点（重启不重放）；丢弃自己的 bot 消息；把事件翻译成 Thread 与 Channel |
| **Trigger** | 一条不可变事件（带来源自己的元数据） | 属于一个或多个 Thread；**同一 Trigger 接受两次只建一个 Ticket**（幂等） |
| **Thread** | 按时间排序的 Trigger；由 Source 定义边界 | 同一 Thread 同时只跑一个 Eval；可挂多个 Ticket；持有 Subscription 与 Decision 历史 |
| **Eval** | 对一批 Trigger 的判断，分 **Gate（确定性）+ Assessment（模型）** | 无状态；输入含 Thread 快照、该 Thread 上所有 Ticket（含已结束）、当前 Policy；输出 Decision（accept/stop/ignore/unavailable） |
| **Policy** | 版本化的接单规则 + 各 Source 的准入表/同步/机器人名单 | 版本号写进 Mandate；影响在途 Ticket 的变更要投递；**不撤销 Mandate** |
| **Mandate** | 接单授予的东西：Policy 版本、scope、strength、命中的规则、发送者身份 | 不可变；扩大范围 = 新 Ticket；只有"人"能停止；Policy 失效才撤销 |
| **Ticket** | 授权工作的单元 | 只有 Eval 能建；`open ↔ ended`；人发消息可恢复（同 Mandate、不再 Eval）；被停止的不再接收 |
| **Assignment** | Ticket 与某个 Executor 实例的绑定 | `pending → running → ended`，与 Ticket 状态独立；可多次 |
| **Subscription** | Ticket 与 Thread 的多对多关系 | 事件扇出给所有活跃 Ticket；**扇出不授予权限**（权限在 Mandate） |
| **Attention** | 等待人回答的问题 | 结构化字段，不从报告自由文本推断 |
| **Disposition** | 每条 Trigger 的去向记录（被过滤/被评估/被扇出） | 审计与调参的基础 |

**它刻意拒绝的概念**（同样有启发）：不做 Principal/Membership、不做跨 Source 身份映射（当提示词文本）、不让 Eval 自己排延迟任务、不做"等待中"的 Eval 状态、不限制"一个 Thread 只能一个 Ticket"、不做 Subscription 级准入检查、不做 Correlation 路由、不让 Ticket 状态跟随执行器 Session。

---

## 3. 差距分析：PolyOpus vs Super-agent

| 维度 | PolyOpus 现状（前 6 份文档） | Super-agent | 差距 | 决策 |
|---|---|---|---|---|
| 入口 | Web/IM/cron/webhook 各自处理，`submit()` 直接建 Turn | Source → Trigger，统一不可变事件 + 读取位点 + 去重 | **大** | 新增 Intake 域 |
| 触发判断 | 无；消息即执行 | Gate（确定性）+ Assessment（模型）+ Decision | **大** | 新增 Eval |
| 授权 | 工具级审批 | 工作级 Mandate（Policy 版本/scope/strength/身份） | **大** | 新增 Policy/Mandate |
| 工作单元 | Turn（一次问答） | Ticket（可跨多轮、可恢复、可停止） | **大** | 新增 Ticket |
| 执行绑定 | `runs` 直接挂 turn | Assignment（Ticket↔Executor，可多次/可换执行器） | 中 | 新增 Assignment，runs 挂其下 |
| 事件路由 | session_key 选 thread | Subscription 扇出，后续事件直达 Worker | 中 | 新增 event_threads + subscriptions |
| 主动性 | 推迟到 v2 | 核心（不用 @） | **大** | 提前 + 重定义 |
| 工具 | 同步 | 全双工 start/stop | 中 | 加 async 工具 |
| 上下文 | 预算 + 压缩 | 缓存 + 指针 + Chain of Recall | 中 | 加引用图 |
| 监督 | 健康检查/指标 | Watchdog（独立 Session 判断推进/跑偏） | 中 | 新增 |
| 并行 | 一个 thread 一个 turn | 多 Worker 并行 + Router 批处理 | **大** | 新增任务中心 UI + 批处理 |
| 回复 | 按事件流统一渲染 | 按渠道塑形（IM 短、GitHub 结构化） | 小 | 加回复策略 |
| 成本 | 有成本账本 | 主动型成本更高，需要预算 | 中 | 加"每 Ticket 预算" |

**结论**：不是"重写"，而是**在现有 conversations/kernel 之上加一层**。我们的 Turn/Run/Step 正好可以成为 **Executor 的内部实现**；Super-agent 的 Ticket/Assignment 成为它的上游。

---

## 4. 修订方案

### 4.1 修订后的分层

```
┌──────────────────────────────────────────────────────────────────────┐
│ Surfaces: Web · IM · Email · GitHub · Webhook · CLI · API            │
└───────────────┬──────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────┐
│ INTAKE（新增）                                                        │
│  Source(adapter, read_position, identity)                            │
│    → Trigger(immutable, dedupe) → Disposition                        │
│    → event_thread → Gate(确定性) → Assessment(模型) → Decision        │
│    → Ticket(Mandate) → Assignment → [Executor 端口]                   │
│    → Report → Channel(回复)                                           │
│  Policy(versioned) · Attention(结构化待决) · Watchdog(独立巡检)         │
└───────────────┬──────────────────────────────────────────────────────┘
                │ Assignment
┌───────────────▼──────────────────────────────────────────────────────┐
│ EXECUTOR（端口，可替换）                                               │
│  A. 内置 kernel：Turn/Run/Step + ModelGateway + Tools（前 6 份文档）    │
│  B. 外部 harness：DSH / Claude Code / Codex / OpenCode（ACP/CLI）      │
│  每个 Ticket 一个 session + 一个 workdir；只用 Report 回报              │
└───────────────┬──────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────┐
│ CORE（不变）conversations · capabilities · knowledge · memory · ...    │
│ PLATFORM（不变）db · queue · events · storage · secrets · telemetry    │
└──────────────────────────────────────────────────────────────────────┘
```

**关键不变量**：
- Executor **在域外**；域内只知道 `Assignment` 与 `Report`。
- Ticket 状态**不跟随** Executor 状态（Super-agent 明确列为 rejected）。
- Subscription 只提供上下文，**不提供授权**；授权只在 Mandate。

### 4.2 新增领域模型（10 张表）

```sql
CREATE TABLE sources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id      TEXT NOT NULL UNIQUE,
  tenant_id      TEXT NOT NULL DEFAULT 'default',
  kind           TEXT NOT NULL,              -- im:feishu / github / email / webhook / schedule
  name           TEXT NOT NULL,
  config_json    TEXT NOT NULL,              -- 连接配置（不含密钥，密钥走 secrets）
  identity_json  TEXT NOT NULL,              -- 该来源上的 bot 身份（用于丢弃自己的消息）
  read_position_json TEXT NOT NULL DEFAULT '{}',
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE triggers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id     TEXT NOT NULL UNIQUE,
  tenant_id      TEXT NOT NULL DEFAULT 'default',
  source_id      TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
  external_id    TEXT NOT NULL,              -- 平台消息 id / webhook delivery id
  actor_json     TEXT NOT NULL,              -- {kind:user|bot, id, name, is_allowed}
  payload_json   TEXT NOT NULL,
  dedupe_key     TEXT NOT NULL,
  received_at    INTEGER NOT NULL,
  UNIQUE (source_id, dedupe_key)
);
CREATE INDEX idx_triggers_actor ON triggers(source_id, received_at);

CREATE TABLE event_threads (              -- Super-agent 的 Thread（区别于对话 threads）
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_thread_id TEXT NOT NULL UNIQUE,
  tenant_id      TEXT NOT NULL DEFAULT 'default',
  source_id      TEXT NOT NULL,
  thread_key     TEXT NOT NULL,              -- PR#123 / 飞书话题 / 邮件串
  title          TEXT,
  last_trigger_at INTEGER,
  UNIQUE (source_id, thread_key)
);

CREATE TABLE trigger_threads (            -- Trigger ↔ Thread（多对多）+ 去向
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_id     TEXT NOT NULL,
  event_thread_id TEXT NOT NULL,
  disposition    TEXT NOT NULL,              -- filtered | evaluated | fanned_out
  reason         TEXT,
  ticket_id      TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (trigger_id, event_thread_id)
);

CREATE TABLE policies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id      TEXT NOT NULL UNIQUE,
  tenant_id      TEXT NOT NULL DEFAULT 'default',
  version        INTEGER NOT NULL,
  rules_json     TEXT NOT NULL,              -- 准入与研判规则
  accept_mode    TEXT NOT NULL,              -- explicit_only | allowed_list | all_candidates
  source_parts_json TEXT NOT NULL,           -- 每个 Source 的白名单/同步/机器人名单
  created_by     INTEGER,
  created_at     INTEGER NOT NULL,
  UNIQUE (tenant_id, version)
);

CREATE TABLE evaluations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_id        TEXT NOT NULL UNIQUE,
  event_thread_id TEXT NOT NULL,
  trigger_batch_json TEXT NOT NULL,
  decision       TEXT NOT NULL,              -- accept | stop | ignore | unavailable
  strength       TEXT NOT NULL,              -- explicit | inferred
  scope_json     TEXT,
  reasons_json   TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  model          TEXT,
  tokens         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE tickets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id      TEXT NOT NULL UNIQUE,
  tenant_id      TEXT NOT NULL DEFAULT 'default',
  source_id      TEXT NOT NULL,
  title          TEXT NOT NULL,
  mandate_json   TEXT NOT NULL,              -- 不可变：policy_version/scope/strength/规则/身份
  state          TEXT NOT NULL,              -- open | ended
  end_reason     TEXT,                       -- completed | stopped_by_human | policy_revoked | abandoned
  stopped_by     INTEGER,
  created_at     INTEGER NOT NULL,
  ended_at       INTEGER
);

CREATE TABLE ticket_threads (             -- Subscription（多对多）
  ticket_id      TEXT NOT NULL,
  event_thread_id TEXT NOT NULL,
  role           TEXT NOT NULL,              -- origin | followed | resumed
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, event_thread_id)
);

CREATE TABLE assignments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id  TEXT NOT NULL UNIQUE,
  ticket_id      TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  executor_kind  TEXT NOT NULL,              -- builtin | dsh | claude_code | codex
  executor_ref   TEXT,                       -- 外部 session id
  state          TEXT NOT NULL,              -- pending | running | ended
  attempt        INTEGER NOT NULL DEFAULT 1,
  lease_owner    TEXT,
  lease_until    INTEGER,
  started_at     INTEGER,
  ended_at       INTEGER
);

CREATE TABLE reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id      TEXT NOT NULL UNIQUE,
  assignment_id  TEXT NOT NULL,
  state          TEXT NOT NULL,              -- progress | waiting | ready | blocked | failed | dropped
  summary        TEXT NOT NULL,
  structured_json TEXT NOT NULL,             -- 结构化字段，供 Attention 判定
  created_at     INTEGER NOT NULL
);

CREATE TABLE attentions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  attention_id   TEXT NOT NULL UNIQUE,
  ticket_id      TEXT NOT NULL,
  question       TEXT NOT NULL,
  options_json   TEXT,
  status         TEXT NOT NULL,              -- pending | answered | expired | dismissed
  answer_json    TEXT,
  answered_by    INTEGER,
  expires_at     INTEGER,
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER
);
```

> 术语消歧：本文的 **Thread** 一律指 `event_thread`（事件线程）；对话仍叫 conversation/thread（`threads` 表）。UI 上分别叫"任务线"与"对话"。

### 4.3 状态机

**Ticket**
```
open ──(Executor 完成/人停止/Policy 撤销/放弃)──► ended
  ▲                                                │
  └──── 人在其 Thread 上发消息（未被 stopped）──────┘
        · 同 Mandate、不重新 Eval、不换 scope
```
- 只有人能"停止"；Executor 只能报告 `dropped`。
- Policy 变更**不撤销** Mandate，只投递；范围变化必须开新 Ticket。

**Assignment**
```
pending ──领取──► running ──报告 ready/failed/dropped──► ended
                    │
                    └─ lease 过期 ──► pending（attempt+1，超限 dead）
```

**Eval**
```
queued(按 thread 串行) ──► gate ──┬─ deny/ignore ──► 记录 disposition
                                  └─ pass ──► assessment ──► accept/stop/ignore/unavailable
```

**Attention**
```
pending ──人回答──► answered
   ├─ 超时 ──► expired（按策略：保持/自动拒绝/升级）
   └─ 被新证据取代 ──► dismissed
```

### 4.4 新增事件（12 类）

| 分组 | 事件 |
|---|---|
| 入口 | `trigger.received` · `trigger.filtered` · `trigger.fanned_out` |
| 研判 | `eval.started` · `eval.decided`（含 decision/strength/policy_version） |
| 工单 | `ticket.opened` · `ticket.resumed` · `ticket.ended` · `ticket.mandate_invalidated` |
| 执行 | `assignment.started` · `assignment.reported` · `assignment.dead` |
| 注意力 | `attention.requested` · `attention.resolved` |
| 监督 | `watchdog.alert`（stalled / drifting / error） |

> UI 的"任务中心"完全由这些事件驱动；`trigger.*` 也进审计与调参。

### 4.5 策略与授权（两层）

**Gate（确定性，毫秒级）**
```python
@dataclass
class GateInput:
    source: Source
    actor: Actor            # user/bot, id, is_allowed
    trigger: Trigger
    rate: RateState

def gate(inp: GateInput, policy: Policy) -> GateResult:
    if inp.actor.is_bot and not policy.allows_bot(inp.source, inp.actor):
        return GateResult.filter("bot_not_allowed")
    if not inp.actor.is_allowed:
        return GateResult.filter("actor_not_allowed")
    if not inp.rate.allow(inp.source, inp.actor):
        return GateResult.filter("rate_limited")
    if policy.accept_mode == "explicit_only" and not has_explicit_request(inp.trigger):
        return GateResult.filter("not_explicit")
    return GateResult.pass_to_assessment()
```
- 每条被过滤的 Trigger 都写 `trigger_threads.disposition`，**可审计、可调参**。

**Assessment（模型）**
- 输入：Trigger 批次、Thread 快照、该 Thread 上所有 Ticket（含已结束）、当前 Policy。
- 输出：`Decision{decision, strength, scope, reasons}`。
- **不判断权限**（Gate 已判）；只判断"该不该接、接多大、是明确要求还是推断"。
- `strength=inferred` 时降低自动化：默认只做只读动作，写操作必须 Attention。

**Mandate（不可变）**
```json
{
  "policy_version": 7,
  "scope": ["repo:acme/api", "branch:main"],
  "strength": "explicit",
  "matched_rules": ["r-12:bug-report", "r-03:main-branch"],
  "actor": {"source": "github", "id": "u_123", "name": "alice"},
  "granted_at": "..."
}
```
- 工具执行前检查 `tool.required_scope ⊆ mandate.scope`；不满足 → 拒绝并开 Attention。
- 人一旦 `stop`，Mandate 作废；Policy 变更只投递、不撤销。
- **跨 Source 身份不映射**：同一个人在不同平台是两个身份；"他是谁"写进提示词，交给人处理。

**成本治理**
- `tickets.budget_json`：`max_tokens` / `max_cost_micros` / `max_wall_clock` / `max_tool_calls`。
- 超预算 → `report(blocked, "budget_exhausted")` → Attention（由人决定追加或放弃）。
- 每个 Source 有"每日主动预算"；`inferred` 强度默认零主动预算（只响应明确请求）。

### 4.6 Executor 端口（关键战略调整）

```python
class Executor(Protocol):
    async def start(self, assignment: Assignment, ticket: Ticket, workdir: Path) -> None: ...
    async def resume(self, assignment: Assignment, input: TicketInput) -> None: ...
    async def stop(self, assignment: Assignment) -> None: ...
    def health(self) -> ExecutorHealth: ...
```

- **内置执行器**：前 6 份文档的 kernel + conversations（Turn/Run/Step/events）。
- **外部执行器**：把 `Assignment` 翻译成 ACP/CLI 调用（DSH / Claude Code / Codex / OpenCode），把它们的输出翻译成 `Report`。
- 好处：
  1. harness 迭代不影响平台层；
  2. 可以让"重活"交给外部编码 Agent，平台负责入口/授权/审计/注意力；
  3. 与 Super-agent 的"Executor 在域外"完全一致。
- 代价：需要定义清晰的 `Report` 契约与 session 映射；外部执行器的细粒度事件（token 流）可能拿不到，UI 要降级为"进度+结果"。

### 4.7 异步工具（全双工）

```python
@dataclass(frozen=True)
class ToolSpec:
    ...
    execution: Literal["sync", "async"] = "sync"

class AsyncToolHandle(BaseModel):
    handle_id: str
    tool: str
    started_at: datetime
    status: Literal["running", "done", "failed", "cancelled"]
```

- `async` 工具调用立即返回 `started`，结果以新事件 `tool.async_completed` 回到同一 turn。
- 适用：CI 运行、长时浏览、批处理、外部工单。
- 约束：同一 turn 最多 N 个并发 async 工具；结果回来时若 turn 已结束，则开新 turn（并标注 `continuation`）。

### 4.8 上下文缓存与 Chain of Recall

在 `03` 的上下文预算之上补三件事：

1. **稳定 ID 引用图**：`trigger_id → event_thread_id → ticket_id → assignment_id → run_id`，任何摘要都可回跳。
2. **内联/溢出**：内联 ID、标题、最近 3 条消息、状态；其余写入"可检索引用"，提示词里只留 `ref://...`。
3. **多跳召回工具**：`recall(ref)` / `expand(ref, fields)`，让模型按需拉取，而不是一次性堆进 prompt。

### 4.9 Watchdog

```python
class Watchdog:
    interval_s = 300
    async def tick(self) -> None:
        for a in await assignments.running():
            hb = await a.last_heartbeat()
            if hb.age > a.stall_threshold:
                await alerts.raise_(a, "stalled")
            elif await judge_drift(a):          # 便宜模型 + 最近 N 条报告
                await alerts.raise_(a, "drifting")
```
- 独立进程/独立定时任务，**不依赖 Router 存活**。
- 输出：`watchdog.alert` 事件 + 任务中心红点 +（可选）自动 `stop` 或降级。
- 人工入口：任务详情页"为什么卡住" → 展示最近报告、心跳、工具调用、trace。

### 4.10 指标与 NFR 修订

| 编号 | 指标 | 目标 | 说明 |
|---|---|---|---|
| NFR-11 | 工单完成时延 p95 | ≤ 30 min（取决于任务类型，按类目分桶） | 对齐 Super-agent 的 p95 口径 |
| NFR-12 | 人工干预率 | ≤ 0.5 次/工单 | 衡量"注意力成本" |
| NFR-13 | 误动作率 | ≤ 1%（写操作）/ ≤ 5%（只读） | 主动性安全红线 |
| NFR-14 | 单位工单成本 | ≤ 预算上限，超限即停 | token + 工具 + 外部 API |
| NFR-15 | 待决事项停留 | p95 ≤ 1 个工作日 | 注意力队列 |
| NFR-16 | Trigger 处理延迟 | p95 ≤ 2 s（不含模型） | 入口不积压 |
| NFR-17 | Eval 批处理率 | 高峰期 ≥ 1.8 条/批 | 防 Router 打爆 |

---

## 5. 界面修订

### 5.1 信息架构：7 → 8 个一级入口

新增 **任务**（`/tasks`），把原"自动化"并入其下：

| 入口 | 路径 | 内容 |
|---|---|---|
| 对话 | `/chat` | 不变（人主动发起的会话） |
| **任务** | `/tasks` | **注意力收件箱 / 进行中 / 已排队 / 已完成**；Tab：定时、工作流、来源 |
| 专家 | `/agents` | 不变；新增"该专家作为 Executor 的运行记录" |
| 知识 | `/knowledge` | 不变 |
| 连接 | `/connections` | 不变；新增 **来源（Sources）** Tab（GitHub/邮件/Webhook/IM） |
| 扩展 | `/extensions` | 不变 |
| 工作台 | `/workbench` | 不变 |
| 用量 | `/usage` | 新增"每工单成本/人工干预" |

### 5.2 任务中心（`/tasks`）

```
┌────────────────────────────────────────────────────────────────────────┐
│ 任务            [待我决定 3] [进行中 5] [已排队 2] [已完成]   🔍 筛选   │
├──────────────┬─────────────────────────────────────────────────────────┤
│ 来源筛选      │  ⚠ 需要你决定（3）                                       │
│ □ GitHub     │  ┌───────────────────────────────────────────────────┐  │
│ □ 飞书        │  │ #412 修复登录超时       @alice · 12 分钟前          │  │
│ □ 邮件        │  │ 问题：是否允许修改 CI 配置？                        │  │
│ □ Webhook    │  │ [允许] [拒绝] [查看上下文]                          │  │
│              │  └───────────────────────────────────────────────────┘  │
│ 状态          │                                                        │
│ ● 进行中 5    │  ⟳ 进行中（5）                                          │
│ ○ 待决 3      │  ┌───────────────────────────────────────────────────┐  │
│ ○ 排队 2      │  │ #411 补充 API 文档      [claude-code] 03:12 已运行  │  │
│              │  │ 进度：已读 12 个文件 · 修改 3 个 · 待跑测试           │  │
│              │  │ [查看会话] [停止]                                    │  │
│              │  └───────────────────────────────────────────────────┘  │
└──────────────┴─────────────────────────────────────────────────────────┘
```

- 卡片字段：来源图标、标题、发起人、Executor、已运行时长、进度摘要、成本、状态。
- 操作：查看会话/任务线、停止、接管（转为对话）、重新派工、追加预算。
- 空态：说明"Agent 会在被允许的来源上自动接活；你可以在这里决定它拿不准的事"。

### 5.3 注意力收件箱（全局）

- 顶栏铃铛 + 徽标；`⌘⇧A` 打开。
- 三类：**审批**（工具/写操作）、**提问**（Agent 需要信息）、**受阻**（预算/权限/依赖）。
- 支持批量"全部允许同类"（带范围与时长），但**默认不做静默自动批准**（与 `04` 的 HITL 原则一致）。
- 每条都链到 Ticket → Assignment → Run → Trace。

### 5.4 工单详情（`/tasks/:ticketId`）

```
概览 | 任务线（Trigger 时间轴） | 执行记录（Assignment/Report） | 产物 | 审计
```
- **任务线**：按时间展示 Trigger、Eval 决策（含理由）、扇出、人的消息、Policy 变更。
- **执行记录**：每次 Assignment 的启动/报告/结束、token/成本、失败原因。
- **产物**：PR 链接、文件 diff、报告。
- **审计**：谁在何时授权/停止/改策略。

### 5.5 并行执行视图

- 任务中心"进行中"即并行视图；另在 `/admin/observability` 提供"执行器泳道"（Executor × 时间），用于运维。
- 每个 Executor 显示：心跳、当前工具、最近报告、卡住告警。
- 这是"一个 Agent 同时干多件事"的可视化，也是 Super-agent 相对 Octop 的核心体验差异。

### 5.6 对话页的变化

- 对话页保持"人主动发起"的定位；右上角增加"由此开任务"（把当前对话转成 Ticket）。
- 任务执行中的会话以只读/跟随方式出现在对话列表（带"任务"徽章），避免与人工对话混淆。
- 回复塑形：同一事件在 IM 上走 100 词摘要 + 链接，在 Web 上给完整结构；由 `ChannelPolicy` 配置。

---

## 6. 路线修订

### 6.1 里程碑调整

| 里程碑 | 原内容 | 修订 |
|---|---|---|
| M0 | 地基 | 不变；**新增** `sources/triggers` 的迁移骨架（只建表不实现） |
| M1 | 单机对话闭环 | 不变；**新增** 内置执行器（TurnEngine 包成 Executor）+ intake 最小摄取（Webhook→Trigger→Gate→Ticket） |
| M2 | 能力与知识 | 不变；工具增加 `execution=sync|async` 字段 |
| **M3（改）** | 多渠道 + 定时 + 团队 | **拆成 M3a 工作入口 + M3b 渠道/定时**，团队挪到 M4 |
| **M3a** | — | Source/Trigger/Policy/Gate/Eval/Ticket/Assignment/Attention/Watchdog + 任务中心 UI（**+6 周**） |
| M3b | 飞书/企微/Webhook + 定时 | 作为 Source 实现接入（不是独立通道逻辑） |
| M4 | 生产化 | 不变；新增"结果评测集" |
| M5 | 生态 | 工作流 DAG、插件市场、联邦、ACP、桌面 |

### 6.2 范围重排（重要）

**提前**：Work Intake、Attention、Watchdog、async 工具、成本预算、结果指标。
**延后**：团队协作（降级为 Executor 内的一种模式，v1.5）、工作流 DAG（v2）、联邦/桌面（v2.5）、媒体生成、语音。
**砍掉**：远程安卓（维持原判）。

理由：Super-agent 证明"入口 + 授权 + 注意力"比"多角色团队"更能带来可感知的价值；而且它复用了我们已有的 channels/cron，不需要重写。

### 6.3 新增风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 主动性误动作 | Agent 未经明确请求就写代码/发消息 | `strength=inferred` 只读；写操作必须 Attention；可全局熔断 |
| 成本失控 | 常驻 + 并行 = token 放大 | 每 Ticket/Source 预算；`inferred` 零预算；成本看板 |
| 入口风暴 | Webhook 重放/刷屏 | 去重键 + 限流 + 批处理 + 死信 |
| 策略复杂度 | 规则写错导致该接不接/乱接 | Gate 规则单测 + "干跑"模式（只记录不执行） |
| Executor 异构 | 外部执行器事件粒度不一致 | 统一 Report 契约；UI 降级；超时/心跳兜底 |
| 注意力过载 | 待决事项堆积 | 每用户待决上限 + 超时策略 + 合并同类项 |

---

## 7. 对现有文档的具体修改清单

| 文档 | 位置 | 修改 |
|---|---|---|
| `README.md` | 导航表、核心结论、架构图 | 加 `07`；加"工作入口"结论；架构图补 Intake 层 |
| `01-功能全景.md` | 新增 §N | 12 项 Super-agent 能力（Source/Trigger/Policy/Mandate/Ticket/Assignment/Attention/Disposition/Watchdog/async 工具/Chain of Recall/回复塑形），并调整版本范围 |
| `02-架构设计.md` | §0 决策表、§3.6、§4.2、§12、§1.3 | 加 Work Intake 层、11 张表、ADR-008/009/010、NFR-11..17、Executor 端口 |
| `03-模块设计.md` | 新增模块 14、§6 capabilities | 新增 `intake` 模块；工具加 `execution`/`async handle`；知识/记忆不动 |
| `04-界面交互.md` | §2.2 导航、§2.3 路由、§5、§6 | 7→8 入口；新增任务中心/注意力/工单详情/并行视图；新增流程"事件→工单→回复" |
| `06-实施路线.md` | §1、§2 M3、§12 | 里程碑拆分与范围重排；对齐检查表加 8 行 |
| 新增 | `docs/08-术语表.md`（可选） | 统一 conversation / event_thread / ticket / assignment 等术语 |

---

## 8. 不建议现在做的（避免过度设计）

1. **不要做跨 Source 身份映射**：Super-agent 明确把它降级为提示词文本；先按"每个来源一个身份"处理。
2. **不要做 Eval 自己的延迟调度**：需要等待的条件用 Source（定时/轮询）表达，避免 Eval 反向依赖。
3. **不要给 Subscription 加准入检查**：授权在 Mandate；Subscription 只管上下文。
4. **不要做"等待中"的 Eval 状态**：超时就把 Trigger 重新入队或标 `unavailable`。
5. **不要做 Prompt Studio / KG / 多副本 HA**：这些是 Octop backlog 的 P2，Super-agent 也没解决。
6. **不要照抄 23.2M token 的跑法**：先做预算与"仅明确请求"模式，再逐步放开主动性。

---

## 9. 最小术语表

| 术语 | 含义 | 与既有文档的对应 |
|---|---|---|
| Source | 事件来源（kind + instance） | 原"渠道/定时/Webhook"的统一抽象 |
| Trigger | 一条不可变事件 | 原 `InboundMessage` 的上位概念 |
| Event Thread | 同一主题的 Trigger 序列 | 原 `session_key` 的"工作线"版本 |
| Eval | Gate + Assessment | 新增 |
| Policy | 版本化接单规则 | 原工具策略的扩展 |
| Mandate | 授权凭证 | 新增 |
| Ticket | 授权工作单元 | 原 `Turn` 的上位概念 |
| Assignment | 工单到执行器的绑定 | 原 `Run` 的上位概念 |
| Subscription | 工单订阅任务线 | 新增 |
| Attention | 结构化待决事项 | 原 HITL 审批的扩展 |
| Disposition | Trigger 去向记录 | 新增 |
| Executor | 执行器端口 | 原 kernel 的抽象化 |
| Watchdog | 独立巡检 | 新增 |

---

## 10. 参考来源

- [deepseek-ai/dsh-superagent-prototype（官方原型仓库，含 docs/000–008 设计文档）](https://github.com/deepseek-ai/dsh-superagent-prototype)
- [How to Build a Super-Agent Like DeepSeek's: Router, Workers and Triggers Explained（架构解读与实验数据）](https://apidog.com/blog/how-to-build-a-super-agent/)
- [DeepSeek 开源 Super-agent：Agent 不下班、不用你 @（腾讯云开发者社区）](https://cloud.tencent.cn/developer/article/2774420)
- [DeepSeek 发布全新 Agent 架构 "Super-agent"（央广网）](http://news.cnr.cn/native/gd/kx/20261102/t20261102_527860134.shtml)
- [DeepSeek Super-agent 架构解析（阿里云开发者社区）](https://developer.aliyun.com/article/1779111)

> 说明：以上为公开材料转述；实验数据原文标注 "indicative only"，原型自述 "research prototype, not an official DeepSeek product"。本文只借用其**概念与设计原则**，不复制代码。

---

## 11. 决策记录

| 日期 | 决策 | 影响 |
|---|---|---|
| 2026-11-05 | **Intake 现在做**：M0 建表 + Executor 端口；M1 最小摄取（Webhook→Trigger→Gate→Ticket）；M3a 补 Assessment/Attention/任务中心 | `06` M0/M1/M3a 已调整；`02` ADR-011 |
| 2026-11-05 | **内核自研（薄）+ Executor 端口**；Codex/Claude Code 作为 v1.5 可选外部执行器 | `08` 专门解释；`02` ADR-012 |
| 2026-11-05 | **主动性默认档：`explicit_only`**（只响应明确请求）；`inferred` 需管理员按来源开启并按日预算；`all_candidates` 仅内部仓库试用 | Gate 默认拒绝非显式输入；评估集按"宁可漏接不可乱接"调 |
| 2026-11-05 | **Source 归属租户级**：`sources.tenant_id` 必填；多租户共用一个 App 时按 `installation_id` 区分实例 | `09` §17；`02` ADR-015 |
| 2026-11-05 | **事件线程按业务对象归一**：一个 PR / issue / 邮件串 / IM 话题 = 一个线程；行内 review 只做 anchor；引用 issue 用 correlation | `09` §2.5；`02` ADR-014 |
| 2026-11-05 | **外部执行器以 Mandate 为准**：只交已授权子集，超范围拒绝并开 Attention | `09` §8.2；`02` ADR-016 |
| 2026-11-05 | **Ticket 拆分 v1 不做**，只做合并（`ticket.merged`） | 降低状态机复杂度；真实需求出现再补 |
| 2026-11-05 | **`inferred` 默认日预算 = 0**：未显式设置预算的来源不允许 `inferred` 接单 | 主动性成本可控；管理员按来源开启 |
