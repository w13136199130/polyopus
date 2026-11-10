# 35 · Octop 功能覆盖差距与补齐清单

> 目的：以 Octop（`E:\space\work_space\agnet\lsh-agent`，1.0.3b2）为功能基线，逐域核对 PolyOpus 的
> **能力盘点（01）→ 需求（28）→ API（29）→ 数据（31）→ 界面（30）→ 事件（11）** 六层是否闭合。
> **b4 增量**（云主机、多实例、通知、TOS 等）见 `37`；本文保留 b2 基线，补丁以 `37` 为准。
> 输出：缺口清单 + 影响位置 + 补齐动作，保证 Octop 的能力项**要么被规格覆盖，要么被显式登记为延后**。
>
> 口径：只把 `01` 标为 ✅ 保留 / ⬆ 增强 / 🔁 重做 / 🆕 新增 的项计入"必须覆盖"；
> `⏸ 暂缓` / `✂ 砍掉` 只要求登记去向，不计缺口。

---

## 0. 结论先行

1. **01 的盘点基本完整（130 项），但 28–34 的"封版基线"没有承接它。** 本轮已补 59 条需求 ID（记忆/渠道/团队/控制面/工具等），
   但仍有约 20 项 P1 能力没有需求条目。
2. **Octop 有 341 个路由处理器；`29` 目录已扩写，OpenAPI 已生成 188 个操作（全量目录 + v1.1 云主机）。**
   剩余主要是 `users/roles/groups/invites` 等管理端端点。
3. **事件契约已从 48 扩到 61**，补了 `cron.fired`、`channel.inbound`、`delegation.*`、`memory.*`、`plugin.*`、`notification.created`、`workspace.changed`、`control.*`、`subscription.created`。
4. **31 已从"声明 68 / 实际 35 条 DDL"改为"首版 94 / 94 条 DDL（含 v1.1 云主机 3 张）"**，并补齐 `channels`、ACL、M1 6 张表、通知与剩余 29 张；
   8 张候选表（workflows/workflow_runs/bridge/acp/thread_participants/source_cursors/agent_storage_bindings/feature_flags）明确延后。
5. **30 已补 teams/workbench/channels/memory/observability/notifications 六块状态表**，覆盖域从 11 提到 17。

一句话：**盘点层与执行层已接上第一批，但契约（29/OpenAPI/事件）和前端状态仍需第二批收口。**

### 0.1 执行状态（2026-11 第一批）

- [x] 记忆模型统一为 `memory_atoms + memory_events`（`13`/`31` 对齐）
- [x] 子智能体：从"暂缓"改为 v1.0（与 28/29/31 现有内容一致）
- [x] 会话 fork：明确 v1 只做 Turn 级分支
- [x] OCR：28 标注 v1 置灰、v2 再做
- [x] `cron.fired` 幽灵引用改为 `trigger.received`
- [x] 表数统一：02/31 均为"首版 87"，31 候选 95
- [x] 31 新增 10 张表 DDL（tools/tool_settings/policy_rules/skills/expert_templates/channel_bindings/channel_messages/delegations/subscriptions/control_sessions）
- [x] 28 新增 59 条需求（AUTH/EXP/CAP/KB/ADM/MEM/CHAN/ORG/CTL/CLOUD/NOTIF）
- [x] 30 新增 6 个页面域状态表（团队/工作台/渠道/记忆/可观测/通知）
- [x] 33 Container 补 memory/channels/control/agents/capabilities/usage 端口
- [x] README 文档数与目录更新为 38 份
- [x] ADR-009 记忆 provider 策略：默认 PgMemoryProvider，外部引擎只做适配器
- [x] ADR-010 技能渐进披露：只注索引、正文按需读、每轮 allowlist、禁用双向生效
- [x] ADR-011 治理硬约束：执行期校验、last-admin、step-up、来源身份、插件子进程
- [x] ADR-012 统一执行基底 + 懒 Ticket
- [x] ADR-013 资源 ACL 两层模型
- [x] 31 补齐首版剩余 29 张表 + source_actors/policy_bundles（现 94 张 / 94 条 DDL）
- [x] 通知领域模型：表/端点/事件/UI/需求
- [x] 新域错误码/状态机/事件补齐（事件 61 类）
- [x] `contracts/coverage_check.py` 覆盖门禁（HARD 0，WARN 157 测试待写）
- [x] 188 个操作进 `contracts/spec/api.py`（54 个 backlog），OpenAPI 188 操作 / 229 schema（未生成前后端框架）
- [x] 29 补 P0 端点（memory/channels/tools/teams/control/auth-MFA/cron 已进）
- [x] OpenAPI 从 11 扩到 158（docs/29 全量目录 + 云主机 v1.1 + ACL + 通知）
- [x] 事件补 `cron.fired`、`channel.inbound`、`memory.*`、`delegation.*`、`plugin.*`（48→56）
- [ ] 31 剩余 31 张表补列与索引
- [ ] 30 的 5 个新域补到 `04` 的按钮级细节

---

## 1. 完整性度量

| 层 | Octop 基线 | PolyOpus 现状 | 覆盖率 | 说明 |
|---|---:|---:|---:|---|
| 能力盘点 | 130 项 | 130 项（01） | 100% | 盘点本身完整 |
| 需求 ID | — | 152 条（28：原 88 + 补 64） | ≥100%（含 v1.1） | P1 仍有少量无 ID |
| HTTP 端点 | 341 个 handler | 242 目录 / 188 个（OpenAPI） | 75% | 56 个 backlog 在 coverage_allowlist |
| 数据表 | 68 张（原声明） | 首版 94 / 94 条 DDL（含 v1.1 3 张） | 65% | 首版表全部有 DDL（8 张延后） |
| 事件类型 | — | 61 类（11） | 各域核心 ~90% | 缺 workspace/control/subscription |
| 页面/状态 | 60+ 路由 | 30 覆盖 17 域 / 04 有 40+ | ~85% | 已补 6 个域（含云主机） |
| 可交互原型 | 真实前端 19.7 万行 | 4k 行 vanilla 原型 | 演示级 | 仅验证交互 |
| 实现代码 | 14.6 万行 / 551 测试 | 0 | 0% | 设计阶段 |

> 覆盖率不是越高越好：`⏸/✂` 项本就不该有实现。但 **✅/⬆/🔁 项必须有六层规格**，当前不满足。

---

## 2. 覆盖矩阵（按 01 的能力域）

图例：✅ 六层闭合｜⚠️ 有设计、缺契约/数据/状态之一｜❌ 整域未进入 28–34

| 域 | 能力 | 28 需求 | 29 API | 31 表 | 30 UI | 11 事件 | 判定 |
|---|---:|---:|---:|---:|---:|---:|---|
| A 身份与访问 | 12 | 10 | 10 | 14 | 部分 | 无 | ⚠️ 缺 MFA/OIDC/API Key |
| B Agent 与模板 | 11 | 8 | 12 | 7 | 9 分区 | 无 | ⚠️ 缺模板库/导入导出 |
| C 对话与运行时 | 18 | 14 | 17 | 14 | 完整 | 完整 | ✅（slash/润色/用量环除外） |
| D 工具与能力接入 | 12 | 1 | 8 | 1 | 部分 | 部分 | ❌ 无 tools/policy 表与端点 |
| E 知识与 RAG | 9 | 8 | 10 | 4 | 完整 | 无 | ⚠️ 缺评测/重建 |
| F 记忆 | 8 | 0 | 0 | 2（名称冲突） | 0 | 0 | ❌ 整域孤儿 |
| G 自动化与多智能体 | 10 | 8 | 2 | 4 | 部分 | 缺 cron/team | ❌ 缺团队/派工 |
| H 渠道（IM） | 8 | 0 | 0 | 1 | 0 | 缺 inbound | ❌ 整域孤儿 |
| I 设备与控制面 | 7 | 0 | 0 | 0 | 0 | 0 | ❌ 整域孤儿 |
| J 平台与运维 | 11 | 3 | 4 | 3 | 部分 | 部分 | ⚠️ 缺指标/更新 |
| K 管理与治理 | 10 | 7 | 14 | 5 | 完整 | 部分 | ⚠️ 缺配额/成本/导出 |
| L 交付形态 | 8 | 1 | — | — | — | — | ⚠️ CLI/PWA 无规格 |
| M 生态与扩展 | 6 | 4 | 7 | 4 | 完整 | 无 | ⚠️ 缺插件事件/SDK |
| N Super-agent | 16 | ~6 | 5 | 4 | 部分 | 部分 | ⚠️ 缺订阅/引用图/塑形 |

---

## 3. 缺口清单

### 3.1 P0 · 不补就无法宣称"v1.0 基线完整"

| ID | 缺口 | Octop 证据 | 影响位置 | 补齐动作 |
|---|---|---|---|---|
| G-MEM-01 | ~~记忆整域无需求/API/UI/事件；表名冲突~~ → 已补：需求 8、表 2、事件 2、端点 11、页面状态；表名统一 `memory_atoms` | `routers/memory.py`(22)、`memory_storage.py`(6)、`memory_portable.py`(4) | `13`、`28`、`29`、`30`、`31`、`32`；`domains/memory`；`api/routers/memory.py`；`web/features/memory` | 实现侧：抽取/去重/冲突管线与 pgvector 索引；删除用 `memory.updated(status=retired)` + 审计表达 |
| G-CAP-01 | ~~工具注册表、逐 Agent 开关、策略规则无表无端点~~ → 已补 3 表 + 10 端点 + CAP-002..007 | `agent_tools.py`、`security/`、`tool_guard` | `03 §6`、`28 §2.4`、`29`、`31 §2.4`；`domains/capabilities`；`admin/security`；专家抽屉"工具"分区 | 实现侧：策略引擎、沙箱、工具缓存/限速；插件权限执行 |
| G-CHAN-01 | ~~渠道配置/绑定/入站映射/测试/出站无契约~~ → 已补 3 表 + 9 端点 + 6 需求 + 页面状态 + `channel.inbound` | `routers/channels.py`(22)、`gateway/` | `03 §10`、`28`、`29`、`30`、`31`；`domains/channels`；连接页"渠道"Tab；Intake 的 Source | 实现侧：飞书/钉钉/企微 adapter、入站幂等、出站重试 |
| G-ORG-01 | ~~团队/派工无需求无端点~~ → 已补 `delegations` 表 + 11 端点 + 5 需求 + 2 事件 + 团队页状态 | `routers/teams.py`(6)、`team_manager.py`(2179) | `03 §9`、`28`、`29`、`31`、`04 /teams/:id`；`domains/orchestration`；任务中心"团队"视图 | 实现侧：协调者/成员线程、持久化邮箱、成员忙入队 |
| G-CTL-01 | ~~终端/浏览器/工作台整域无契约~~ → 已补 `control_sessions` 表 + 7 端点 + 4 需求 + 工作台状态 | `routers/terminal.py`、`browser/`、`pages/Control/Workbench` | `03 §11`、`28`、`29`、`30`、`31`；`domains/control`；工作台页；安全审计 | 实现侧：PTY/CDP 进程、profile 隔离、流 ticket、默认禁用与审计 |
| G-AUTH-01 | ~~MFA/TOTP/WebAuthn/OIDC/OAuth/LDAP/API Key 无端点~~ → 已补 14 端点（MFA 5、SSO 4、API Key 3、设备会话 2） | `auth_mfa.py`(14)、`auth_oidc.py`(7)、`auth_oauth.py`(9)、`auth_ldap.py`(4) | `28 §2.1`、`29 §3.1`；`domains/identity`；登录页/账户安全；`settings` 页 API Key | 实现侧：TOTP/WebAuthn、SSO 回调、API Key 作用域、会话轮换 |
| G-DDL-01 | ~~68 张表只有 35 条 DDL~~ → 已补 `channels`、ACL、M1 6 张、通知与剩余 29 张，现 94 张 / 94 条 DDL（含 v1.1 3 张）；8 张候选表延后 | — | `31`、迁移器、所有 domain repo | 只剩索引/回滚复核 |
| G-API-01 | ~~OpenAPI 11/99~~ → 已覆盖 188/242 个操作（56 个 backlog） | — | `contracts/spec/api.py`、`generated/ts` | 下一步：进入 M0 实现 |
| G-REQ-01 | 01 中 ✅/⬆ 但 28 无 ID 的能力约 40+ 项 | — | `28`、`01`、CI 需求门禁 | 逐项落 ID 或降级为 `LATER` 并写理由；建议补一个"01→28"映射表 |
| G-UI-01 | 30 缺 teams/workbench/channels/memory/observability 五块 | `dashboard/src/pages/*` | `30`、`04`、前端 feature 划分 | 每块补：页面结构、控件、状态矩阵、权限、API 映射、空/错态 |
| G-CRON-01 | ~~定时任务只有 `POST /cron-jobs`~~ → 已补 7 端点（列表/创建/详情/修改/删除/立即执行/运行历史） | `cron.py`(8) | `29`、`28 INTAKE-007`、`30`、自动化页 | 实现侧：scheduler、错过补跑、`cron.fired` 已入事件契约 |
| G-KB-01 | 缺检索评测（E9）、全量重建、embedding 模型管理 | `knowledge_bases.py`(29)、`onnx_models.py`(8) | `28 §2.6`、`29 §3.6`、知识库设置页 | 补 `/knowledge-bases/{id}/eval`、`/reindex-all`、`/embedding-models`；补 KB-009..012 |

### 3.2 P1 · 与 Octop 功能对齐 / 体验闭环

| ID | 缺口 | 影响位置 | 补齐动作 |
|---|---|---|---|
| G-EXP-01 | 专家模板库、从模板创建（01 B3/B4） | agents 域、`/agents` 模板 Tab、DB | 补 `expert_templates` 表与 `/experts*`、`/agents/from-template`；补 EXP-009..011 |
| G-EXP-02 | Agent 导入/导出 `.poly`（01 B11 🆕） | agents 域、CLI | 补 `/agents/{id}/export\|import`、包格式与签名 |
| G-EXP-03 | Agent 级预算/配额 | billing/quota、专家抽屉 | 复用 `quota_limits`，补 `/agents/{id}/budget` 与 UI |
| G-CHAT-01 | Slash 命令（01 C11 ✅） | 对话输入、命令注册表 | 补 `/slash/commands` 或内置端点 + 帮助自动生成 |
| G-CHAT-02 | 文本润色（01 C14 ✅） | 对话输入 | 补 `/text-assist` 与输入增强动作 |
| G-CHAT-03 | 上下文用量环（01 C13 ✅） | 对话头、ContextAssembler | 补 `GET /threads/{id}/context`（分段 token/预算） |
| G-CHAT-04 | 对话导出、单步重试、引用跳转 | 对话页、Run 详情 | 补 `/threads/{id}/export`、`/runs/{id}/steps/{step}/retry`、引用定位字段 |
| G-CAP-02 | 工具缓存/限速/成本上限（01 新增） | 内核 runtime、usage | 补 ToolSpec 字段与策略 obligations |
| G-CAP-03 | OpenAPI→工具一键导入 | 连接器/扩展 | 补 `/connectors/openapi/import` 与 spec→ToolSpec 映射 |
| G-EXT-01 | 技能 CRUD 无独立端点，31 无 `skills` 表 | 扩展页、能力域 | 补 `skills` 表与 `/skills*`；技能包补版本/依赖列 |
| G-KB-02 | 增量索引/死信/失败重试 | knowledge worker | 补 `content_hash`、`index_status`、DLQ 与重试 |
| G-ADM-01 | 管理概览/指标端点缺失 | `/admin`、观测页 | 补 `/admin/overview`、`/metrics` 暴露 |
| G-ADM-02 | 配额管理 API/UI | 管理端、用量页 | 补 `/admin/quotas*` 与三层配额 UI |
| G-ADM-03 | 成本价格表（01 K7 ⬆） | usage/billing | 补 `model_prices` 表与 `/admin/prices*` |
| G-ADM-04 | 数据导出/删除（01 K10 🆕） | 设置/管理端 | 补 `/me/export`、`/admin/tenants/{id}/purge` |
| G-DEL-01 | PWA/离线壳无需求 | web | 补 UX-011 与 SW 策略 |
| G-DEL-02 | CLI 无命令级规格（01 L2 ✅） | `src/polyopus/cli` | 补 `poly <域> <动作>` 命令表、`--json`、退出码 |
| G-CHAN-02 | 回复塑形（S15） | channels | 按渠道定义长度/结构策略并进 Mandate |
| G-INTAKE-01 | Webhook / Email Source 无端点 | intake | 补 `/sources/webhook/*`（签名）、Email adapter |
| G-TICKET-01 | Subscription 事件扇出（S10） | tickets/events | 补 `subscriptions` 表与 fan-out worker；补 `ticket.subscribed` |
| G-MEM-02 | Chain of Recall（S14） | memory/context | 补统一 `ref://` 解析端点 `/refs/{id}` 与引用表 |
| G-POL-01 | Policy 版本可见/回滚（S6） | intake/policy | 补 `policy_versions` 表与 `/admin/policies/{id}/versions` |
| G-OPS-01 | Watchdog API/告警 UI | 任务中心/管理端 | 补 `/watchdog/alerts*` 与告警状态 |
| G-AUD-01 | 审计导出/详情 | 管理端 | 补 `GET /admin/audit/{id}`、`/export` |

### 3.3 P2 · 明确延后，但必须登记（否则会被误认为漏项）

| 项 | 01 决策 | 现状问题 | 动作 |
|---|---|---|---|
| 工作流 DAG | 🆕 v1.5 | 03 有设计、04 有路由，28 无"不做"登记 | 在 28 §1.2 登记 v1.5 |
| 子智能体 | ⏸ v2 | 29 已有 `/agents/{id}/subagents`、31 已有 `agent_subagents` | 二选一：提前到 v1 或移除端点/表 |
| 会话 fork | ⏸ v2 | 28 CHAT-007 与 31 `thread_branches` 已按"做"写 | 改为"另存为新会话"或补完整规格 |
| OCR | ⏸ v2 | 28 KB-008 提到 OCR 设置 | 标注 v2，UI 置灰 |
| 语音 STT/TTS | ⏸ v2 | 无 | 登记 |
| 远程桌面/移动控制 | ⏸/✂ | 无 | 登记 |
| MBTI 人格 | ⏸ | 无 | 登记 |
| 媒体生成 | ⏸ | 无 | 登记 |
| SkillHub/插件市场 | ⏸ | 无 | 登记 |
| ACP / MCP Server / Bridge | ⏸/v2 | 31 有 `acp_runners/bridge_connections`，29 无端点 | 保留表但标"未启用" |
| 桌面端 / FnOS / 原生移动 | ⏸/✂ | 无 | 登记 |
| 租户计费/发票 | v1.3 | 28 已登记 BILL-001 | 保持 |
| 多活/容灾 | v2 | 28 已登记 DR-001 | 保持 |

---

## 4. 跨文档一致性修复清单

| # | 冲突 | 位置 | 修复 |
|---|---|---|---|
| 1 | 表数量 65 vs 68 | `02 §4.2` vs `31 §2` | 统一为 68（或同步改 02） |
| 2 | ✅ 已修：README 已改为 35 份并补 35 号文档 | `README §8` | — |
| 3 | 记忆表名两套 | `13 §7` vs `31 §2.6` | 以 atoms 模型为准，31 补 DDL |
| 4 | 子智能体"暂缓"但已有端点/表 | `01 B9` vs `29/31` | 决策并回写 |
| 5 | fork"暂缓"但已有分支表/需求 | `01 C9` vs `28/31` | 决策并回写 |
| 6 | OCR"暂缓"但 KB-008 含 OCR | `01 E3` vs `28` | 标注 v2 |
| 7 | ✅ 已修：`cron.fired` 已补进 `11` 与契约（61 类） | `28 INTAKE-007` vs `11` | 保留 `trigger.received` 路径，同时补 `cron.fired` |
| 8 | 30 只 11 节，04 有 40+ 路由 | `30` vs `04` | 补 5 个域 |
| 9 | 99 端点 vs OpenAPI 11 | `29` vs `contracts/spec/api.py` | 分批补齐 |
| 10 | 02/03 的 domain 表未进 31 | `03 §6/§9/§10/§11` vs `31` | 补 8+ 张表 |
| 11 | 33 的 Container 无 memory/channels/control 端口 | `33 §4.1` vs `32` | 补端口注入 |
| 12 | 事件已补 8 类（56）；仍缺 workspace/control/subscription | `11` vs `03` 各域 | 下一批补 `workspace.file.changed`、`control.*` |

---

## 5. 补齐后的"全功能清单"（验收用）

> 每一项都必须落在六层之一；打勾表示六层闭合。

### 5.1 身份与访问
- [ ] 密码登录/锁定/限流
- [ ] Refresh token 轮换/撤销
- [ ] Setup 向导
- [ ] OIDC
- [ ] OAuth（飞书/钉钉/企微）
- [ ] LDAP/AD（接口预留）
- [ ] TOTP
- [ ] WebAuthn/Passkey
- [ ] 邀请码
- [ ] 角色 + 权限点
- [ ] 分组 + 资源 ACL
- [ ] SSO 绑定/解绑
- [ ] API Key（作用域/过期/限速）
- [ ] 会话/设备管理
- [ ] 租户切换与隔离

### 5.2 Agent 与模板
- [ ] Agent CRUD/启停/热重载
- [ ] 文件即配置（SOUL/AGENTS/skills）
- [ ] 专家模板库 + 从模板创建
- [ ] Agent 版本/发布/回滚
- [ ] 导入/导出 `.poly`
- [ ] 模型/供应商绑定 + fallback
- [ ] 工具/技能/子智能体绑定
- [ ] 工作区浏览/上传/下载
- [ ] Agent 级预算/配额
- [ ] 团队共享/ACL

### 5.3 对话与运行时
- [ ] WS 流式 + SSE
- [ ] 断线重连 `after_seq`
- [ ] 停止生成
- [ ] Queue/Steer + 撤回
- [ ] 编辑重发/重新生成/分支
- [ ] 历史分页/搜索
- [ ] 附件上传/预览
- [ ] 审批/Ask/Plan/文件卡
- [ ] 运行轨迹 + 回放
- [ ] Slash 命令
- [ ] 文本润色
- [ ] 上下文用量环
- [ ] 引用跳转/单步重试
- [ ] 对话导出
- [ ] 多说话人

### 5.4 工具与能力
- [ ] ToolSpec 注册表
- [ ] 内置工具目录（文件/HTTP/时间/任务/检索）
- [ ] 逐 Agent 工具开关
- [ ] 策略引擎（allow/ask/deny + obligations）
- [ ] 审批/临时授权/审计
- [ ] 沙箱（shell/文件/网络/浏览器）
- [ ] 工具缓存/限速/成本上限
- [ ] 异步工具
- [ ] MCP 客户端（stdio/HTTP/OAuth）
- [ ] OpenAPI→工具导入
- [ ] 插件 manifest/权限/签名/UI renderer
- [ ] 技能/SKILL.md
- [ ] 技能包版本/依赖

### 5.5 知识与 RAG
- [ ] KB CRUD/共享/ACL
- [ ] 多格式解析（PDF/DOCX/PPTX/XLSX/MD/HTML）
- [ ] 结构感知切片
- [ ] Embedding 双通道 + 模型版本
- [ ] 向量索引（pgvector/sqlite-vec）
- [ ] 混合检索 + RRF + rerank + MMR
- [ ] 引用到 span
- [ ] 增量索引/失败重试
- [ ] 检索调试面板
- [ ] 检索评测（黄金集）

### 5.6 记忆与上下文
- [ ] Working/Session/Long-term/Knowledge/Artifacts 五层边界
- [ ] 上下文预算表 + 稳定前缀
- [ ] 压缩（阈值/保留/探针校验/回滚）
- [ ] 工具结果清除
- [ ] 引用图 + `recall()`
- [ ] 记忆写路径（抽取/过滤/去重/冲突/审计）
- [ ] 记忆读路径（topK/打分/MMR/预算）
- [ ] 类型/TTL/时间区间
- [ ] 用户控制（查看/纠正/导出/暂停/删除）
- [ ] 防投毒/多租户隔离
- [ ] 记忆评测指标
- [ ] 记忆管理 UI

### 5.7 自动化与多智能体
- [ ] Cron/interval/date 触发器
- [ ] 任务 CRUD/立即执行/运行历史
- [ ] 团队/成员/房间/说话人
- [ ] 派工（delegation）+ 持久化邮箱
- [ ] 工作流 DAG（v1.5）
- [ ] Webhook Source
- [ ] 主动关怀（v2）

### 5.8 渠道
- [ ] ChannelAdapter 协议
- [ ] 飞书/钉钉/企微
- [ ] 二维码绑定/配置探测
- [ ] 入站幂等/去重
- [ ] 响应模式（流式/整段）
- [ ] 群聊激活/@ 规则
- [ ] 回复塑形
- [ ] 媒体上传

### 5.9 设备与控制面
- [ ] 浏览器自动化 + 实时预览/接管
- [ ] 终端 PTY + AI 辅助
- [ ] 工作台多面板
- [ ] 设备权限/审计
- [ ] 远程桌面/移动（延后）

### 5.10 平台与运维
- [ ] 单命令启动
- [ ] SQLite/PG 双后端
- [ ] 迁移与版本水位
- [ ] 备份/恢复/校验
- [ ] Docker/Compose
- [ ] systemd/launchd/Windows 服务
- [ ] 配置 doctor
- [ ] OTel/Prometheus/日志
- [ ] 更新检查（不做自替换）
- [ ] TLS（反代方案）

### 5.11 管理与治理
- [ ] 用户/角色/分组管理
- [ ] 供应商/模型池/路由/价格
- [ ] 存储后端管理
- [ ] 插件管理
- [ ] 安全策略/命令护栏
- [ ] 审计查询/导出
- [ ] 用量/成本核算
- [ ] 三层配额
- [ ] 系统概览/队列/错误率
- [ ] 数据导出/删除

### 5.12 交付与生态
- [ ] Web 控制台
- [ ] CLI
- [ ] HTTP/WS API + OpenAPI
- [ ] PWA
- [ ] 插件格式/安装/开发模式
- [ ] 技能包分发
- [ ] SDK（Python/TS）
- [ ] 联邦 Bridge（v2）
- [ ] 桌面/FnOS/移动（延后）

### 5.13 Super-agent
- [ ] Source 统一接入
- [ ] Trigger 幂等
- [ ] Disposition 审计
- [ ] Gate 确定性准入
- [ ] Assessment 模型研判
- [ ] Policy 版本化
- [ ] Mandate 工作授权
- [ ] Ticket 工作单元
- [ ] Assignment 执行绑定
- [ ] Subscription 扇出
- [ ] Attention 结构化待决
- [ ] Watchdog 巡检
- [ ] 异步工具
- [ ] Chain of Recall
- [ ] 回复塑形
- [ ] 投机执行

---

## 6. 验收办法

新增 `contracts/coverage_check.py`（建议进 CI），做四件事：

1. 解析 `docs/28` 的需求 ID、`docs/29` 的端点、`docs/31` 的表名、`docs/30` 的页面域；
2. 与 `docs/01` 的 130 项能力 ID、本文件 §5 的清单做集合比对；
3. 检查每个 `MUST` 需求是否至少有一个端点与一张表；
4. 检查 `schemas/events/index.json` 是否覆盖各域事件（至少 `cron.fired`、`channel.inbound`、`memory.*`、`delegation.*`）。

规则：**任何 ✅/⬆/🔁 能力，若六层缺一层，CI 失败**；`⏸/✂` 必须有 `LATER` 登记。

---

## 7. 建议执行顺序

| 周 | 动作 |
|---|---|
| W1 | 修一致性（§4 的 12 条）；定记忆表模型；补 8 张关键表 DDL |
| W1–W2 | 补 28 的 40+ 需求 ID；补 30 的 5 个页面域 |
| W2–W3 | 补 29 的 P0 端点（memory/channels/teams/control/tools/auth） |
| W3 | 补事件契约（cron/channel/memory/delegation/plugin/workspace） |
| W4 | ✅ 已完成（2026-11）：188 个操作进 `contracts/spec/api.py`（54 backlog），generate/check/coverage 通过 |
| W5+ | 进入 `06` 的 M0 实现，先过 `kill -9 恢复` 门禁 |
