# PolyOpus · 设计文档包

> 一个参考腾讯 [Octop](https://github.com/TencentCloud/Octop) 的**自托管多智能体平台**的设计蓝图。
> 本目录只含设计，不含实现代码；目标是让后续开发"照着文档写代码"，而不是"照着 Octop 抄代码"。
>
> **先读 [`00-文档权威源`](docs/00-文档权威源.md)**：`28–34` 是 v1.0 基线，`35–40` 是增量/评审，`01–27` 仅历史参考。

---

## 0. 10 分钟跑通（M0 骨架）

> 当前仓库 = 设计文档 + M0 骨架。可运行的是 CLI、迁移、事件重放与崩溃恢复演示；**还没有 Web 界面**。

前置：Python 3.12、[uv](https://docs.astral.sh/uv/)。Windows 用 Git Bash 或 PowerShell 均可。

```bash
git clone https://github.com/w13136199130/polyopus.git
cd polyopus
uv sync
uv run poly migrate         # 首次会打印一次性 admin 口令
uv run poly doctor          # 6 项自检（迁移后除 model 外全 OK）
uv run poly serve           # 打开 http://127.0.0.1:8000 —— 聊天 + 审批卡界面
uv run pytest               # 70 个用例，含 kill -9 恢复、审批暂停/恢复、模型网关
uv run python scripts/demo_kill9.py
```

没有 `make` 也能跑；装了 make 可用 `make check`（等价于 `uv run python scripts/check.py`）。

| 命令 | 作用 |
|---|---|
| `poly doctor` | 6 项自检（含模型探活） |
| `POLY_MODEL_BASE_URL/_API_KEY/_NAME` | 接 OpenAI 兼容真模型；不配则 FakeModel |
| `poly migrate` / `--check` / `--sql` | 应用 / 只检查 / 只打印迁移 |
| `poly recover` | 恢复租约过期的 run |
| `poly serve` | 启动 HTTP API（`/healthz`、`/api/v1`） |
| `scripts/check.py` | 本地全量门禁（lint/type/imports/schema/test/contracts/coverage） |

---

## 1. 这个文档包是什么

| 项 | 内容 |
|---|---|
| 输入 | 本地 Octop `1.0.3b4`（`E:\space\my_space\project\Octop`）与 `1.0.3b2`（`E:\space\work_space\agnet\lsh-agent`）：722 个 Python 文件 / 14.6 万行、前端 19.7 万行、534 个路由、4790 个测试 |
| 方法 | 通读 `docs/` 30+ 篇设计文档 + `src/octop/`（20 个子包）+ `dashboard/src`（1214 个文件）+ `cli/` + `desktop/` + `tests/`，逐模块核对行号 |
| 产出 | 48 份文档：00 权威源、功能全景、架构、模块、界面、优缺点与优化、实施路线、Intake/事件/组件/按钮/稳定性/容量/迁移/评测/安全/存储、Octop 逐按钮分析、专家/连接器/知识库规格、原型差距审计、侧栏/按钮复核、体验复核、需求追踪/API/UI 状态/数据模型/模块接口、前后端包划分、模块边界 ADR、Octop 功能覆盖差距清单、核心域对照审查、b4 增量对照与问题清单、设计缺陷与不足清单、总体评审、设计补齐方案、技术 Spike 方案、Octop 残余缺陷核对、核心组件对比与优化、深度审计清单、总体路线与同类产品对照、DSH 公开版对照与 7 项补丁、M0 任务卡与执行清单 |
| 结论 | **产品照抄，交互精修，架构重做，代码重写** |

**一句话**：Octop 是一份极好的"需求规格说明书 + 交互参考实现"，但它的对象划分与状态管理不适合长期演进。PolyOpus 保留它的产品决策，替换它的骨架。

> **v1.0 设计封版基线（2026-11）**：以 [`28-需求追踪矩阵`](docs/28-需求追踪矩阵.md)、[`29-API与错误码总表`](docs/29-API与错误码总表.md)、[`30-按钮与页面状态总表`](docs/30-按钮与页面状态总表.md)、[`31-全量数据模型与DDL`](docs/31-全量数据模型与DDL.md)、[`32-模块接口与状态机`](docs/32-模块接口与状态机.md)、[`33-前后端包模块划分`](docs/33-前后端包模块划分.md)、[`34-模块边界ADR`](docs/34-模块边界ADR.md) 为准；`01–27` 作为背景、参考与历史审计。封版后新增/修改需求必须带需求 ID，并同步 28/29/30/31/32/33/34 中至少一份。

---

## 2. 文档导航

| 文档 | 内容 | 适合谁读 |
|---|---|---|
| [`00-文档权威源.md`](docs/00-文档权威源.md) | 文档层级、每份文档的职责、当前权威计数、阅读顺序与变更规则 | 全体 |
| [`01-功能全景.md`](docs/01-功能全景.md) | Octop 110+ 能力项逐条盘点：做了什么、代码在哪、保留/增强/重做/暂缓/砍，以及 12 项"人无我有" | 产品、技术负责人 |
| [`02-架构设计.md`](docs/02-架构设计.md) | 目标架构：模块化单体 + 可拆 Worker、持久化 Turn/Run/Step、事件溯源、数据模型、事件契约、安全、NFR、ADR | 架构师、后端 |
| [`03-模块设计.md`](docs/03-模块设计.md) | 13 个模块的职责/模型/接口/流程/失败模式/测试 + **Octop 源码复用地图** | 后端、Tech Lead |
| [`04-界面交互.md`](docs/04-界面交互.md) | 信息架构、40+ 路由、页面规格、对话页深度规格、交互流程、组件库、快捷键、响应式、可访问性 | 前端、设计 |
| [`05-优缺点与优化.md`](docs/05-优缺点与优化.md) | 16 个值得学的设计、15 类结构性问题（带 file:line）、量化画像、40 条优化清单、风险登记册 | 全体、评审 |
| [`06-实施路线.md`](docs/06-实施路线.md) | v0.1→v2.0 里程碑、任务拆解、团队分工、工程规范、测试策略、SLO、**如何参考 Octop 源码** | 项目经理、全体 |
| [`07-SuperAgent评审与修订.md`](docs/07-SuperAgent评审与修订.md) | 对前 6 份文档的自评审（评分卡 + 12 个缺口）+ 对照 DeepSeek《Super-agent 设计探索》的差距分析与修订方案（Work Intake / Policy / Mandate / Ticket / Attention / Watchdog） | 架构师、Tech Lead、产品 |
| [`08-内核与执行器.md`](docs/08-内核与执行器.md) | 澄清"内核 / 执行器 / Codex"的关系：内核是自研的 Agent 循环，执行器是可插拔端口，Codex 是可选的外部执行器 | 全体、评审 |
| [`09-Intake详细设计.md`](docs/09-Intake详细设计.md) | Source/Trigger/Gate/Assessment/Policy/Mandate/Ticket/Assignment/Attention 的可实现规格：契约、算法、边界、API、指标、测试 | 后端、Tech Lead |
| [`10-术语表与验收标准.md`](docs/10-术语表与验收标准.md) | 40+ 术语中英对照 + 14 个模块的 DoD（评审/验收时逐条打勾） | 全体 |
| [`11-事件Schema.md`](docs/11-事件Schema.md) | 61 类事件的完整信封与字段表：流与 seq、命令 vs 事件、示例、版本化、代码生成与 CI 门禁 | 后端、前端、测试 |
| [`12-任务中心组件规格.md`](docs/12-任务中心组件规格.md) | 任务中心/收件箱的组件级规格：VM、19 个组件的 props、状态矩阵、13 种空态文案、响应式、a11y、接口映射、测试清单 | 前端、设计 |
| [`13-记忆与上下文设计.md`](docs/13-记忆与上下文设计.md) | 上下文工程（组装/压缩/工具清除/引用图）+ 记忆系统（写读路径/冲突/TTL/防投毒）+ Build vs Adopt 评估（mem0/Zep/Redis/pgvector） | 架构师、后端 |
| [`14-竞品对标与组件选型.md`](docs/14-竞品对标与组件选型.md) | 13 个开源 Agent 项目对标：执行/上下文/记忆/插件市场/多 Agent/RAG/UI/许可，差距与 20 条调整清单 | 架构师、产品 |
| [`15-按钮级交互规格.md`](docs/15-按钮级交互规格.md) | 11 个界面、约 95 个按钮：可用条件/接口/确认级别/成功失败/快捷键/埋点 | 前端、设计、测试 |
| [`16-稳定性与长期演进.md`](docs/16-稳定性与长期演进.md) | SLO、降级矩阵、幂等/重试、隔离、背压、Agent 六道闸、升级兼容、fitness functions、发布流程 | 全体、SRE |
| [`17-容量与部署模型.md`](docs/17-容量与部署模型.md) | ACT 模型、四档部署、拆分阈值、PG 分区与索引、压测方案、扩容 playbook、成本量级 | SRE、架构师 |
| [`18-从Octop迁移.md`](docs/18-从Octop迁移.md) | 范围、ID 策略、表/工作区映射、历史/知识/记忆迁移、工具 CLI、校验与回滚 | 后端、交付 |
| [`19-评测Harness.md`](docs/19-评测Harness.md) | 评测分层、数据集生命周期、Runner、录制回放、指标/裁判、CI 门禁、报告 | 测试、算法 |
| [`20-安全测试用例集.md`](docs/20-安全测试用例集.md) | 11 类约 70 条红队用例（认证/授权/注入/SSRF/路径/插件/泄漏/DoS/渠道/Agent/Web）+ Harness | 安全、后端 |
| [`21-数据存储与切换.md`](docs/21-数据存储与切换.md) | 四层存储、权威 vs 派生、展示位置、五种切换（后端/引擎/向量/记忆/实例）、一致性与备份 | 后端、SRE、产品 |
| [`22-Octop交互逐按钮分析.md`](docs/22-Octop交互逐按钮分析.md) | Octop 外壳（220/56 侧栏、用户菜单、PageShell）+ 16 个页面的按钮/配置/确认级别 + 原型对齐清单 | 前端、设计、产品 |
| [`23-专家编辑抽屉规格.md`](docs/23-专家编辑抽屉规格.md) | 9 个分区、逐字段校验/默认值/禁用态、配置文件编辑、技能/子智能体/工作区、保存与发布语义、API/DoD | 前端、后端、设计 |
| [`24-连接器与知识库交互规格.md`](docs/24-连接器与知识库交互规格.md) | 连接器三 Tab、认证方式与 OAuth 状态机、MCP 可视化/JSON、知识库文档树/上传/预览/OCR/检索、错误与 DoD | 前端、后端、设计 |
| [`25-原型交互差距审计.md`](docs/25-原型交互差距审计.md) | 现状评分、聊天/按钮/布局逐项对比 Octop、文档一致性（8+3 vs 19）、P0/P1/P2 修复清单与验收 | 前端、设计、产品 |
| [`26-Octop侧栏与按钮交互复核.md`](docs/26-Octop侧栏与按钮交互复核.md) | Octop 侧栏尺寸/分组/激活态、页面骨架、按钮层级、逐页交互（设置/管理/用量/连接器/扩展/知识库/表单）与差距 | 前端、设计、产品 |
| [`27-Octop体验差距复核.md`](docs/27-Octop体验差距复核.md) | 第二轮体验评分：布局、按钮、表单、表格、抽屉、管理端、连接器/插件/知识库/用量逐项差距与 P0/P1/P2 路线 | 产品、设计、前端 |
| [`28-需求追踪矩阵.md`](docs/28-需求追踪矩阵.md) | 157 条需求的 ID/优先级/验收句/页面/API/表/测试/状态矩阵，MVP 范围与追踪维护规则 | 产品、架构、测试 |
| [`29-API与错误码总表.md`](docs/29-API与错误码总表.md) | API 约定、错误信封/HTTP 映射、60+ 错误码、全量端点目录、分页/幂等/409/SSE/权限 | 后端、前端、测试 |
| [`30-按钮与页面状态总表.md`](docs/30-按钮与页面状态总表.md) | 合并 15/22–27 的页面×控件×状态×权限×API 总表、表单规则、响应式与验收 | 前端、设计、产品 |
| [`31-全量数据模型与DDL.md`](docs/31-全量数据模型与DDL.md) | 94 张表清单（94 张核心 DDL，8 张延后）、索引/租户/状态枚举、保留归档与迁移策略 | 后端、DBA |
| [`32-模块接口与状态机.md`](docs/32-模块接口与状态机.md) | 模块依赖、Python 端口签名、Turn/Run/Assignment/OAuth/Doc 状态机、事务与测试边界 | 架构、后端 |
| [`33-前后端包模块划分.md`](docs/33-前后端包模块划分.md) | 后端 kernel/platform/domains/api/workers 最终树、前端 routes/features/components 最终树、依赖方向、契约与构建 | 架构、前端、后端 |
| [`34-模块边界ADR.md`](docs/34-模块边界ADR.md) | 15 条 Accepted ADR：模块边界 8 条 + 记忆 Provider、技能渐进披露、治理硬约束、懒 Ticket、ACL 两层、自研内核（含逃生舱、翻转触发器与 Router 触发器）、DSH 公开版定位（吸收不变量、不复用代码） | 架构、后端 |
| [`35-Octop功能覆盖差距与补齐清单.md`](docs/35-Octop功能覆盖差距与补齐清单.md) | 以 Octop 341 个路由 / 130 项能力为基线，逐域核对需求/API/表/UI/事件六层；P0/P1/P2 缺口、影响位置与全功能验收清单 | 产品、架构、前端、后端 |
| [`36-Octop对照审查-核心域.md`](docs/36-Octop对照审查-核心域.md) | 上下文/记忆/知识库/用户权限/技能工具五域的 Octop 实现 vs PolyOpus 设计逐项对照：步骤、参数、差异、风险与必须借/必须避的清单 | 架构、后端、算法、安全 |
| [`37-Octop-1.0.3b4对照与问题清单.md`](docs/37-Octop-1.0.3b4对照与问题清单.md) | b2→b4 增量对照：云主机、多实例、通知、TOS、分组可见性、技能包文件树等；P0/P1/P2 问题、交互差异与修复建议 | 产品、架构、前端、后端 |
| [`38-设计缺陷与不足清单.md`](docs/38-设计缺陷与不足清单.md) | 设计层面 P0/P1/P2 缺陷：双执行管线、ACL 数据模型、DDL 覆盖、通知、错误码/状态机、契约门禁等，含修复顺序与验收 | 架构、后端、产品 |
| [`39-设计文档总体评审.md`](docs/39-设计文档总体评审.md) | 全量文档健康度、设计合理性、与 Octop 的差距、对未来功能/体验的影响；文档治理、范围收敛、技术验证与体验验收建议 | 产品、架构、前端、后端 |
| [`40-设计补齐与整体优化方案.md`](docs/40-设计补齐与整体优化方案.md) | 8 个交互/机制缺口的补齐设计、Octop 参考点、文档改动与验收；范围分层、Design DoD、两周设计冲刺与团队分工 | 产品、架构、前端、后端 |
| [`41-技术Spike设计与验证方案.md`](docs/41-技术Spike设计与验证方案.md) | S1 事件重放、S2 租户隔离、S3 策略 fail-closed、S4 插件子进程、S5 记忆探针：假设、用例矩阵、验收、回退与 Go/No-Go | 架构、后端、SRE、安全 |
| [`42-Octop残余缺陷与弥补核对.md`](docs/42-Octop残余缺陷与弥补核对.md) | b4 仍存在的 15 类缺陷与 PolyOpus 覆盖矩阵；M-01..M-06（SSO allowlist、token 传输、多实例、导出/删除、密钥轮换、提示注入）全部落档 | 架构、安全、后端 |
| [`43-核心组件对比与优化调整.md`](docs/43-核心组件对比与优化调整.md) | 执行器/上下文/记忆/知识/模型/流畅交互逐组件对比：Octop 做对了什么、PolyOpus 弊端与调整；内核 12 步管线、ExecutorEvent、模型网关 v2、流式 NFR | 架构、后端、前端、算法 |
| [`44-深度审计清单.md`](docs/44-深度审计清单.md) | 第三轮深度审计：9 条新缺口（备份面/未读/附件缩放/锁定参数/i18n/housekeeping 等）+ 10 条已登记未闭环合并清单与优先级 | 架构、后端、前端、SRE |
| [`45-总体路线与同类产品对照.md`](docs/45-总体路线与同类产品对照.md) | 市场五条路线（Octop 组装/Dify 工作流/LangGraph 框架/OpenHands 纵深/Temporal 持久执行）对照与取舍；PolyOpus 路线定位 + 12 周垂直切片执行路线 + 里程碑门与止损 | 全体、产品、架构 |
| [`46-DSH公开版对照与7项补丁.md`](docs/46-DSH公开版对照与7项补丁.md) | DeepSeek Super-agent 公开版的降级八轴、保住的七条不变量、被验证的三个选型；7 个缺口与 P0/P1/P2 补丁、v1 来源封顶、ADR-015 依据 | 架构、后端、产品 |
| [`47-M0任务卡与执行清单.md`](docs/47-M0任务卡与执行清单.md) | M0 范围裁定（保留/移出/不做）、25 张任务卡（估时/依赖/产出/命令级验收）、依赖图、两周节奏、G-M0 六条出口判据 | 全体、项目经理 |

**推荐阅读顺序**：`05`（先知道别人踩了什么坑）→ `01`（决定做什么）→ `02`（定骨架）→ `03`（分工落地）→ `04`（体验）→ `06`（排期）。

---

## 3. 核心结论（先看这 10 条）

1. **Octop 的功能面是平台级（110+ 项），代码组织是脚本级增长**：核心逻辑压在 `AgentManager`（3963 行）、`GlobalProcessor`（2109 行）、`TeamManager`（2179 行）、`BridgeManager`（2617 行）、`chatStore`（3.9k 行）五个上帝对象里。
2. **它最大的架构缺陷是"状态在进程内"**：团队在途任务、插话队列、审批挂起、浏览器会话全部重启即丢。Octop 自己把这写成"非目标"，但这是生产可用性的硬门槛。
3. **它把会话真相存了四份**（LangGraph checkpoint + jsonl + threads + trajectory），导致一致性问题与 `history_backfill` 补丁。PolyOpus 用**事件溯源**统一。
4. **它的运行期集成靠 monkeypatch 第三方库**（改 `call_peer`、`_invoke_peer`、`_call_agent`、模块函数）。升级依赖即考古。这是新项目**必须彻底避免**的一点。
5. **它的交互细节是行业前列**：50ms 批量渲染、虚拟列表前插锚定、插话安全边界、审批可恢复、工具 UI 插件协议、运行轨迹。这些应当保留（见 `04` §12）。
6. **它的知识库是明显短板**：固定 800/120 字符切片 + 每 KB SQLite 暴力余弦、无混合检索/重排/评测、检索失败静默返回空。必须重做。
7. **它没有多租户、没有成本核算、没有 Agent 版本、没有评测**；这四项恰好是企业化的入场券。Octop 自己的 `OCTOP-ENTERPRISE-GO-LIVE-BACKLOG.md` 承认还需 24–32 人周。
8. **它的工程纪律值得学**：i18n key 树一致性测试、双 dialect 迁移、错误码本地化、发布前真启动门禁、4790 个测试、零 TODO（债进 issue）。
9. **它的文档漂移是反面教材**：`docs/cli.md` 承诺了不存在的传输层与命令。PolyOpus 用"文档即规格 + CI 校验"避免。
10. **正确姿势**：不 fork、不改 Octop，**用它的文档当需求、用它的交互当原型、用它的模板/插件当内容资产**，代码全部按本文档重写（见 `06` §8 的复用地图）。
11. **前 6 份文档仍是"对话平台"的完备设计，不是"常驻工作系统"**：缺工作入口（Source/Trigger）、工作授权（Policy/Mandate）与注意力管理（Attention）。这三层是 Super-agent 的核心，已在 `07` 补齐。
12. **不要把 Agent 循环当成护城河**：harness 正在商品化（DSH、Claude Code、Codex 都可被调用）。差异化在"入口、授权、审计、注意力、知识"，所以 `07` 把 Executor 改成可替换端口。

---

## 4. 一句话架构

```
Surfaces (Web / IM / Email / GitHub / Webhook / CLI / API)
   ↓
Intake（Source → Trigger → Gate/Assessment → Ticket(Mandate) → Assignment）
   ↓
API 层（路由 / WS / SSE / 鉴权 / 错误映射）
   ↓
领域层（identity · agents · conversations · capabilities · knowledge
        · memory · orchestration · channels · billing · audit）
   ↓
Executor 端口（内置 TurnEngine ｜ 外部 DSH / Claude Code / Codex）
   ↓
平台（DB · 队列 · 事件总线 · 存储 · 密钥 · 遥测 · i18n）
```

**与 Octop 的四个关键差异**：

| | Octop | PolyOpus |
|---|---|---|
| 入 口 | 消息直接进对话 | Source → Trigger → Eval → Ticket，统一、可去重、可审计 |
| 授权 | 工具级审批 | 工作级 Mandate（Policy 版本 / scope / strength） |
| 执行 | 内存中的 asyncio 任务 | 持久化 Turn/Run/Step + 租约，崩溃可恢复；且可换 Executor |
| 会话真相 | checkpoint 为真相 | append-only `events` 为真相，`messages` 为投影 |
| 进程 | 单进程、状态在内存 | 默认单进程，但状态全在库；可拆 API/Worker/Scheduler |

---

## 5. 技术选型基线

| 层 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 后端 | Python 3.12 + FastAPI | Go / Node | Agent 生态（MCP、文档解析、LangChain 周边）最全，与 Octop 同栈便于对照源码 |
| Agent 内核 | **自研薄内核**（~5k 行） | octop-harness / LangGraph / OpenAI Agents SDK | 需要可控的恢复语义与可测性；复杂流程交给 workflow 模块 |
| 数据库 | PostgreSQL 首选，SQLite 默认 | MySQL | 一套 schema 两方言；pgvector 可复用 |
| 队列 | DB 表 + `SKIP LOCKED` | Redis Streams / NATS | 零外部依赖启动；可替换 |
| 前端 | React 19 + TS + Vite | Vue / SvelteKit | 与 Octop 交互资产可对照；生态成熟 |
| 样式 | CSS 变量 + CSS Modules + 内部组件库 | Tailwind / AntD | 设计令牌可控，避免"内联样式 + 组件库覆盖"混战 |
| 部署 | 单二进制 / Docker / Compose | K8s | 自托管体验优先 |

> 这些是**建议基线**，不是硬约束。替换时只需保证：事件契约、模块边界、持久化执行三条不变。

---

## 6. 关键假设（若与你不同，请先改这三处）

1. **产品形态**：自托管优先（个人 → 家庭 → 小团队 → 企业内网），不做 SaaS 多租户运营后台。
2. **团队规模**：4 人全职（后端 2 / 前端 1 / 全栈基础设施 1），设计兼职。若只有 1–2 人，请把 `06` 的里程碑合并为"v0.1 + v0.5"，砍掉工作流/联邦/桌面端。
3. **复用边界**：不 fork Octop 代码；可复用其**内容资产**（专家模板、插件示例、提示词）与**协议语义**，代码重写。若你更倾向 fork，请把 `05` §5 的 O1–O10 作为改造清单，工期按 6 个月估。

---

## 7. 建议的下一步（本周可执行）

> **已确认的决策（2026-11-05）**：① Intake 现在做（M0 建表 + 端口，M1 最小摄取，M3a 完整）；② 内核自研（薄），Executor 做端口，Codex/Claude Code 作为 v1.5 可选外部执行器；③ 主动性默认 **`explicit_only`**（只响应明确请求）；④ Source 归属**租户级**、事件线程**按业务对象归一**、外部执行器**以 Mandate 为准**；⑤ Ticket 拆分 v1 不做、`inferred` 默认日预算 **0**。

1. **冻结两份契约**：事件类型表（`02` §3.4 + `07` §4.4）与错误码表。这两份是所有模块的公共依赖。
2. **搭 M0 骨架**：仓库、CI、配置、迁移器、队列、事件总线、**Executor 端口 + intake 表结构**——2 周内必须跑通 `kill -9 后 turn 恢复` 的演示，否则不要进入 M1。
3. **建第一个评测集**：20 条真实任务（读文件/改代码/查知识/多步计划）+ 60 条"该不该接单"样本，作为内核与 Gate/Assessment 的黄金测试。
4. **做一次交互走查**：用 `04` §4 与 §5.14 的规格，在纸上/原型里走一遍"事件 → 工单 → 审批 → 插话 → 断线恢复"，确认没有遗漏的状态。

---

## 8. 目录

```
polyopus/
├─ README.md                 ← 你在这里
├─ docs/                     ← 48 份设计文档
│  ├─ 00-文档权威源.md
│  ├─ 01-功能全景.md
│  ├─ 02-架构设计.md
│  ├─ 03-模块设计.md
│  ├─ 04-界面交互.md
│  ├─ 05-优缺点与优化.md
│  ├─ 06-实施路线.md
│  ├─ 07-SuperAgent评审与修订.md
│  ├─ 08-内核与执行器.md
│  ├─ 09-Intake详细设计.md
│  ├─ 10-术语表与验收标准.md
│  ├─ 11-事件Schema.md
│  ├─ 12-任务中心组件规格.md
│  ├─ 13-记忆与上下文设计.md
│  ├─ 14-竞品对标与组件选型.md
│  ├─ 15-按钮级交互规格.md
│  ├─ 16-稳定性与长期演进.md
│  ├─ 17-容量与部署模型.md
│  ├─ 18-从Octop迁移.md
│  ├─ 19-评测Harness.md
│  ├─ 20-安全测试用例集.md
│  ├─ 21-数据存储与切换.md
│  ├─ 22-Octop交互逐按钮分析.md
│  ├─ 23-专家编辑抽屉规格.md
│  ├─ 24-连接器与知识库交互规格.md
│  ├─ 25-原型交互差距审计.md
│  ├─ 26-Octop侧栏与按钮交互复核.md
│  ├─ 27-Octop体验差距复核.md
│  ├─ 28-需求追踪矩阵.md
│  ├─ 29-API与错误码总表.md
│  ├─ 30-按钮与页面状态总表.md
│  ├─ 31-全量数据模型与DDL.md
│  ├─ 32-模块接口与状态机.md
│  ├─ 33-前后端包模块划分.md
│  ├─ 34-模块边界ADR.md
│  ├─ 35-Octop功能覆盖差距与补齐清单.md
│  ├─ 36-Octop对照审查-核心域.md
│  ├─ 37-Octop-1.0.3b4对照与问题清单.md
│  ├─ 38-设计缺陷与不足清单.md
│  ├─ 39-设计文档总体评审.md
│  ├─ 40-设计补齐与整体优化方案.md
│  ├─ 41-技术Spike设计与验证方案.md
│  ├─ 42-Octop残余缺陷与弥补核对.md
│  ├─ 43-核心组件对比与优化调整.md
│  ├─ 44-深度审计清单.md
│  ├─ 45-总体路线与同类产品对照.md
│  ├─ 46-DSH公开版对照与7项补丁.md
│  └─ 47-M0任务卡与执行清单.md
├─ contracts/                ← 契约作者源与生成器
│  ├─ spec/events.py         （61 事件）
│  ├─ spec/api.py            （188 个已实现操作，54 个 backlog）
│  ├─ generate.py / check.py / runtime_check.py / coverage_check.py
│  └─ examples/
├─ schemas/                  ← 发布契约（生成物）
│  ├─ events/**/*.schema.json
│  └─ api/openapi.json
├─ generated/                ← 类型（生成物）
│  ├─ py/poly_contracts/     （Pydantic v2）
│  └─ ts/src/                （TypeScript）
├─ spikes/                   ← 技术 Spike（S1–S3 已 GO；不进生产构建）
└─ Makefile
```

---

## 9. 可执行契约

设计和代码之间的桥已经搭好：

```bash
python -m contracts.generate     # spec → JSON Schema / Pydantic / TS / OpenAPI
python -m contracts.check        # 校验生成物、示例、OpenAPI 与事件数量
python -m contracts.runtime_check # 需 pydantic，验证真实解析
```

- 事件：61 类，`schemas/events/index.json` 是目录；`generated/py/poly_contracts/events.py` 提供 `parse_event()` 与判别联合。
- API：`schemas/api/openapi.json`（OpenAPI 3.1），覆盖 **188 个操作、229 个 schema**（docs/29 共 242，54 个 backlog 见 coverage_allowlist）（auth/agents/threads/turns/attachments/sources/health/memory/channels/tools/teams/control/cron/users/invites/roles/groups/cloud/notifications/tickets/attentions）。
- 前端：`generated/ts/src/events.gen.ts` 可直接按 `ev.type` 收窄；未知类型应忽略并上报，不要抛错。
- CI：`generate --check` + `check` + `runtime_check` 三道门禁。

详见 [`contracts/README.md`](contracts/README.md)。

---

## 10. 可交互原型

[`prototype/index.html`](prototype/index.html) 是一个**有状态、可点击**的前端原型（零依赖，`file://` 直接打开）：导航定稿为 **8 + 3**（对话/任务/专家/知识/连接/扩展/工作台/用量 + 设置/管理/头像），220px 文字侧栏、56px 折叠，分组 工作 / 能力 / 系统；含账户菜单、个人设置、管理 Hub、hash 路由、流式对话、审批/Ask/Plan/文件改动卡、任务筛选、弹窗/抽屉/菜单、明暗主题与 9 套配色。

```bash
start prototype/index.html
# 或
python -m http.server 8788 --directory prototype
```

| 画面 | 路由 |
|---|---|
| 对话 | `#/chat` |
| 专家 | `#/agents` |
| 任务 / 工单 / 收件箱 | `#/tasks`、`#/ticket`、`#/inbox` |
| 自动化（Cron） | `#/automation` |
| 个性化 / 通道 / 连接器 / 技能包 / 知识库 / 云端协同 | `#/personalization`、`#/channels`、`#/connections`、`#/skills`、`#/knowledge`、`#/bridge` |
| 工作台 / 远程桌面 / ACP | `#/workbench`、`#/remote`、`#/acp` |
| 用户 / 模型 / 存储 / 插件 / 安全 / 应用设置 | `#/admin-users`、`#/admin-models`、`#/admin-storage`、`#/admin-plugins`、`#/admin-security`、`#/admin-advanced` |
| 个人设置 | `#/settings`（从账户菜单进入） |
| Token 统计 | `#/usage` |

可操作的东西包括：发消息与流式停止、队列、模型/模式/知识库菜单、审批三选项、任务停止确认、重新派工、追加预算、回答提问、收件箱分类、知识库文档树/上传/检索测试、专家 9 分区编辑抽屉、连接器三 Tab/配置抽屉/MCP、账户菜单、个人设置、9 套配色与自定义色、管理端配置表单、`⌘K` 命令面板。

截图在 [`prototype/shots/`](prototype/shots/)，按钮清单见 [`prototype/README.md`](prototype/README.md)；Octop 逐按钮分析见 [`22`](docs/22-Octop交互逐按钮分析.md)、专家/连接器/知识库规格见 [`23`](docs/23-专家编辑抽屉规格.md)/[`24`](docs/24-连接器与知识库交互规格.md)，现状差距见 [`25`](docs/25-原型交互差距审计.md)，侧栏/按钮复核见 [`26`](docs/26-Octop侧栏与按钮交互复核.md)，体验差距复核见 [`27`](docs/27-Octop体验差距复核.md)，封版设计见 [`28`](docs/28-需求追踪矩阵.md)–[`34`](docs/34-模块边界ADR.md)。

> 后续实现开始时，建议新增 `docs/adr/`（架构决策记录）、`docs/features/`（每功能一页）、`docs/contracts/`（事件/错误码/OpenAPI 快照）。
