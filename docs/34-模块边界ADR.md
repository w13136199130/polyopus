# 34 · 模块边界 ADR（v1.0 定稿）

> 状态：Accepted（2026-11）
> 适用：`31` 数据模型、`32` 模块接口、`33` 包划分
> 目的：把 6 个会导致"重复表/重复状态/上帝模块"的边界一次定死。

---

## ADR-001 · Attention 拥有 Approval 生命周期

**Context**

- `conversations` 的 Run 需要暂停等待审批；
- `tickets` 也有 blocked 状态；
- 原设计同时有 `approvals`、`attentions`、ticket.blocked 三处状态。

**Decision**

- `attention` 域拥有 `attentions` 与 `approvals` 两张表。
- `conversations` 只做三件事：发 `approval.requested` 事件、释放 Run lease、订阅 `attention.resolved` 恢复。
- `tickets` 只引用 `attention_id`，不自己维护审批状态。
- `approvals` 是"Run 暂停记录"；`attentions` 是"用户收件箱投影"，由 attention service 在同一事务写。
- `attentions` 增加 `source_type(approval|question|blocked)` + `source_id`。

**Consequences**

- 删除 `conversations` 对 `approvals` 表的写权限。
- 恢复 Run 只能由 attention 事件触发。
- 收件箱和对话审批永远一致。

---

## ADR-002 · Admin 不是 domain

**Context**

- `domains/admin/` 没有表，却会跨 identity/settings/providers/storage/audit 调用，容易变成上帝对象。

**Decision**

- 删除 `domains/admin/`。
- `admin` 只存在于：
  - `api/routers/admin.py`（HTTP 组合）
  - `application/admin_service.py`（跨域用例编排）
- admin service 只调用各域 ports，不拥有 repo/表/事务。

**Consequences**

- `33` 的 domain 数从 17 收敛到 16。
- 管理端权限仍由 identity 的 `admin` scope 判定。

---

## ADR-003 · Settings 与 Preferences 分家

**Context**

- 原 `settings` 既存实例配置，又存用户主题/语言，边界模糊。

**Decision**

- `identity` 拥有 `user_preferences`：主题、语言、密度、快捷键、通知偏好、Dock 宽度。
- `settings` 只拥有实例级配置：环境变量、HTTPS、更新、备份策略、功能开关。
- `agents` 拥有专家配置。
- 三者不共用一张 `settings` 表。

**Consequences**

- 用户偏好可随用户导出/迁移。
- 实例配置只能管理员写。

---

## ADR-004 · Cron 归 Intake，Assignment 归 Tickets

**Context**

- `orchestration` 同时管团队、委派、cron；`tickets` 又管 assignment，职责重叠。

**Decision**

- `cron` 是 `intake` 的 Source（`kind=schedule`），`cron_jobs` 表归 intake。
- `tickets` 拥有 ticket/mandate/assignment/report 的完整生命周期。
- `orchestration` 只拥有团队、团队房间、委派策略；不写 assignment、不跑 cron。
- `scheduler_worker` 只读 intake 的 schedule source，产生 Trigger。

**Consequences**

- 定时任务与 Web/IM 触发走同一 Intake 管线。
- 任务中心只认 tickets 的 assignment 状态。

---

## ADR-005 · Agent 不再有 team kind

**Context**

- `02` 写 Agent `kind=expert|team`，`orchestration` 又有 team 聚合，重复。

**Decision**

- `agents` 只做 expert/agent 配置与版本，不再有 `kind=team`。
- `orchestration` 拥有 `teams`、`team_members`，team 引用多个 `agent_id`。
- Agent 的 `kind` 只保留 `expert`（未来可扩展 `worker`）。

**Consequences**

- 团队不是"一个大 Agent"，而是编排层聚合。
- 团队对话使用 team 的 routing policy，不伪造 Agent 版本。

---

## ADR-006 · Capabilities / Connectors / Extensions 三分

**Context**

- 三者都像"能力"，容易互相 import，导致安装、发现、执行混在一起。

**Decision**

| 模块 | 只负责 | 不负责 |
|---|---|---|
| `connectors` | 外部系统连接、OAuth、实例、工具发现 | 工具执行策略 |
| `extensions` | 插件/技能包的安装、版本、签名、启停 | 运行时工具调用 |
| `capabilities` | 工具/技能解析、绑定、策略、runtime 调用 | 安装/下载/签名 |

依赖方向：

```
capabilities -> connectors.ports
capabilities -> extensions.ports
```

禁止反向 import。

**Consequences**

- 插件安装失败不会污染运行时注册表。
- 连接器断连不影响已安装插件元数据。

---

## ADR-007 · Kernel 无状态

**Context**

- `kernel/loop.py` 与 conversations 的 Turn 状态机可能重复。

**Decision**

- `kernel` 只负责一次执行的纯循环：模型调用、工具调用、上下文、steer 消费。
- Turn/Run/Step 的持久化状态机归 `conversations`。
- kernel 不写 DB、不发事件、不 import platform/domains；通过回调/端口返回 step 结果。

**Consequences**

- kernel 可独立单测。
- 恢复/暂停/审批逻辑只在 conversations。

---

## ADR-008 · Artifacts 归 conversations，二进制归 platform/storage

**Context**

- 附件/产物散在 workspace/inbound，删除会话后存储对不上账。

**Decision**

- `artifacts`、`attachments` 元数据归 `conversations`。
- 二进制内容归 `platform/storage` 的 CAS（hash 寻址）。
- 删除会话软删元数据，异步 GC 无引用对象。

**Consequences**

- DB 不存大对象。
- 工作区与附件解耦。

---

## ADR-009 · 记忆默认 `PgMemoryProvider`，外部引擎只做适配器

**Context**

对照 Octop 的 `octop-memory` 后，发现其 `raw → candidate → atom → episode → entity/page` 五层与规则优先晋升更成熟；
但它的 schema、租户边界与 PolyOpus 的事件/工单模型不一致，直接设为默认会把版本与数据模型风险带进核心。

**Decision**

1. v1 默认 `PgMemoryProvider`：逻辑三层 `raw → candidate → atom`，物理复用 `memory_events(kind=raw)` 与 `memory_atoms(status='candidate')`。
2. `OctopMemoryProvider` / `Mem0Provider` 只作为可选适配器；`ZepProvider` v1.5。
3. 所有 provider 通过同一套 conformance tests（写入白名单、去重、冲突、TTL、租户隔离、导出、删除审计）。
4. provider 切换用 JSONL 导出/导入；双写灰度 v1.5。

**Consequences**

- 领域层只依赖 `MemoryProvider` 端口，不感知 `AtomCard/Episode/EntityPage`。
- 想快速对齐 Octop 质量时可换适配器，但默认路径不新增外部服务。
- `13 §4.9` 为唯一 provider 策略说明。

---

## ADR-010 · 技能渐进披露，禁止整包注入

**Context**

Octop 的 `SKILL.md` 只把索引放进 system prompt，正文按需 `read_file`；PolyOpus 原设计只写"技能索引"，
没有规定正文读取、每轮过滤与禁用后的执行期行为，容易被实现成"把技能全文拼进 prompt"。

**Decision**

1. system prompt 只放 `name + description + when_to_use`，正文不进前缀。
2. 正文由 `skill.read(slug)` 按需读取，≤32KB，带 `content_hash`。
3. 每轮支持 `skills=[...]` allowlist；索引与执行都过滤。
4. 禁用双向生效：索引移除 + `skill.read` 返回 `SKILL_DISABLED`。
5. 技能包带 `version + dependencies`；安装校验路径/大小/文件数。

**Consequences**

- 上下文预算不被技能正文挤占。
- 技能启用/禁用不再依赖"模型自觉"。
- `02 §7.1.1` 与 `28 CAP-008/009` 为实现依据。

---

## ADR-011 · 治理硬约束：执行期校验、last-admin、step-up、来源身份

**Context**

Octop 的治理缺口是明确的：五套并行开关、过滤只改 prompt、`ToolNode` 仍持有 callable；
`users` 权限可重置 admin 密码；IM 消息归属 Agent owner；组可见性无 grant 即公开。
PolyOpus 若只写"策略引擎"而不把这些约束写死，实现时仍会复刻同类问题。

**Decision**

1. **工具执行期二次校验**：`ToolRuntime.invoke()` 重新求值 policy；模型可见列表不是安全边界。
2. **last-admin**：不能禁用/删除/降级最后一个 admin；对 admin 的敏感操作需二次确认 + 审计。
3. **step-up**：重置密码、关闭 MFA、创建/撤销 API Key、修改安全策略，要求 5 分钟内重认证。
4. **来源身份**：IM/webhook 消息必须带 `source_actor`，不得继承 Agent owner；线程/用量/记忆按 actor 归属。
5. **租户过滤**：repo 基类强制 `tenant_id`，CI 检查无 tenant 条件的查询。
6. **插件隔离**：子进程 + 只读挂载 + 网络代理；不承诺 in-process 沙箱。

**Consequences**

- 鉴权逻辑分散到 API 依赖 + service + runtime 三层，测试必须覆盖负向。
- 多租户与来源身份使早期实现更重，但避免后期数据污染。
- `28 AUTH-012 / ADM-012 / ADM-013 / CAP-008` 与 `02 §8.2/8.3` 为实现依据。

---

## ADR-012 · 统一执行基底 + 懒 Ticket

**Context**

Octop b4 没有 Ticket/Mandate：所有入口最终落到 `session_key → thread → turn`，cron 用 `cron_runs.lease_token`，
团队任务用进程内 tracker。PolyOpus 引入 Ticket 解决了授权/预算/审计，但 `02 §3.6` 说 Turn 是 Executor 内部实现，
`32 §4` 又直接暴露 Turn，`ExecutionContext.ticket_id` 可空——两套执行路径没有收口。

**Decision**

1. 所有入口都走 `thread + turn` 这一条执行基底；Ticket 是授权/预算/审计信封，不是执行器。
2. 普通只读对话不建 Ticket（`turn.ticket_id = null`）。
3. 触发写工具、审批、预算、异步、长任务、IM/cron/webhook/团队入口时，**执行前**创建 Ticket 并回填 `turn.ticket_id`。
4. 无 Ticket 的 Turn 只允许 `risk=low` 且 `side_effects=false` 的工具。
5. Ticket 结束不影响 thread；一个 thread 可顺序承载多个 Ticket。

**Consequences**

- 只有一条执行/恢复/审计路径，避免 Octop 的“两套管线漂移”。
- 简单对话没有 Ticket 开销；有副作用的工作一定有 Mandate。
- `32 §6` 的 `ticket_id` 保留可选，但语义受限；`28 CHAT-015` 是验收依据。

---

## ADR-013 · 资源 ACL 两层模型

**Context**

Octop 用 `user_group / user_group_member / resource_group_grant` 做可见性；
**无 grant 行 = 所有人可见**（fail-open），grant 只做收窄，admin/owner 始终放行。
PolyOpus 声明了 owner/team/tenant/public，但 `31` 没有 grants 表，`28 ADM-011` 也没有优先级规则。

**Decision**

1. ACL 分两层：RBAC 能力（`kb:write`）+ 资源可见性（`visibility` + `resource_group_grants`）。
2. 优先级：`tenant 边界 > admin/owner > 显式 grant > visibility 默认`。
3. 默认 `private`；**无 grant 不等于公开**；跨租户共享 v1 不开放。
4. grant 只影响读/用；写仍要求 owner/admin。
5. 表：`resource_group_grants(tenant_id, resource_type, resource_key, group_id, permission)`；资源类型覆盖技能包/KB/连接器/模型/存储/插件/专家/Agent。
6. 列表用 repo 层统一 SQL 片段，单资源用 `ACL.allows()`；前端 `can()` 只做展示。

**Consequences**

- 不会复刻 Octop 的 fail-open；忘记授权时资源保持私有。
- 多租户与团队共享有明确优先级，测试可枚举。
- `31 §3.10`、`29 §3.15`、`28 ADM-014` 为实现依据。

---

## ADR-014 · 自研薄内核，而非 LangGraph / deepagents（附翻转触发器）

**Context**

内核是栈中"beta 最高"的决策。候选三种：自研薄内核（`08`/`03 §5` 12 步管线）、直接用 LangGraph（自带 checkpoint/interrupt）、用 deepagents（Octop 的上游，中间件最成熟）。

**Decision**

**自研薄内核为默认**；同时保留两条"buy"逃生舱。理由按权重排序：

1. **恢复语义是产品卖点**（NFR-4：kill -9 恢复）。LangGraph 的 checkpoint 是图状态快照，deepagents 的状态在 harness 内——两者都会与"events 单一真相"（S1 已验证）形成**双真相**，恰好复刻 Octop 四套存储的病。
2. **fail-closed 策略闸门必须在循环内**（管线第 6 步）：求值顺序、懒 Ticket 升级点、执行期二次校验（S3 已验证）需要我们拥有每一步的插缝。
3. **内核薄、管线已规格化**：循环本身 ~1–2k 行（12 步 = 12 个可单测中间件）；真正难的压缩/驱逐算法**以参数和规则形式移植**（`13 §3` 已采纳 Octop 的阈值与 CJK 计量常数），不是从零发明。
4. **对照 Octop 的教训**：引擎=外部包导致版本耦合与运行时 monkeypatch（`05 §2.3`：锁下替换 `create_summarization_middleware`）。

**逃生舱（不弃架构的 buy）**

- **舱 1（中间件级）**：管线第 3/10 步（压缩、工具结果驱逐）若自研质量不达标（探针通过率 <95% 两次迭代），把该中间件**内部实现**换成 vendored 算法/库调用——管线缝是干净的，换内脏不动骨架。
- **舱 2（执行器级）**：`executor_kind` 增加 `harness`（deepagents/LangGraph 作为一种外部执行器，同 Codex/Claude Code 待遇）：特定 Agent 可走它，内置 TurnEngine 仍是默认。翻译层与 `Report` 对接，不进我们的循环。

**翻转触发器（预注册，避免沉没成本辩护）**

| 触发 | 动作 |
|---|---|
| M1 结束时 12 步管线未跑通或推迟 >2 周 | 整体切舱 2：v1 用 harness 执行器，TurnEngine 降为 v1.1 交付 |
| 压缩/驱逐探针两次迭代 <95% | 启用舱 1 |
| 团队从 4 人降到 ≤2 人 | 直接舱 2（自研需要人力余量） |

**Consequences**

- 承担中间件成熟度风险（Octop 的压缩/驱逐打磨了两年），以参数移植 + 探针评测对冲。
- `03 §5` 管线、`13 §3` 参数、S1/S3 spike 结论为实现依据；`32 §6` ExecutorEvent 保证舱 2 可插入。

---

### ADR-014 补充 · Router 层的引入触发器（2026-11 预注册）

v1 不做独立 Router Session：单层 `thread + turn` + Intake 的 Gate/Eval + delegation 足够。
满足**任一**条件时，按 ADR 流程引入 Router 层（只路由不执行，可换轻模型）：

| 触发 | 阈值 | 动作 |
|---|---|---|
| Ticket 并发 | > 10 持续 1 周 | 引入 Router Session，接管 accept 后的派工 |
| Eval 时延 | p95 > 8s 持续 1 周 | 拆出 Router，Assessment 只做判断不做编排 |
| 上下文占用 | 单 Router 上下文 > 60% 预算 | 拆出 Router，隔离"路由上下文"与"执行上下文" |

未触发前**明确不做**，避免提前引入第二套会话真相。

---

## ADR-015 · DSH 公开版：吸收不变量，不复用代码

**Context**

`deepseek-ai/dsh-superagent-prototype`（MIT）是 Super-agent 的**研究原型**，README 自述
"research prototype / not production-ready"，且与内部版本不同。它的公开形态是
**单仓库、单进程 + 目录锁、单 SQLite、无租户、无保留策略**；但保留了七条领域不变量。

**Decision**

1. **只吸收不变量与参数**（`46 §3/§6`）：Attention 结构化、effect 按类配额、Intake 有界上下文、Source 四件事。
2. **代码不进主干**：不引入 TS 运行时、不引入 Harness 依赖；理由与 ADR-014 同源（双真相 + 版本耦合）。
3. **`dsh` 作为 v1.5 可选外部执行器**：走 `08 §3` 端口与 `09 §8.2` 能力矩阵；不能扩大 Mandate（`09 §8.2` 授权优先级）。
4. **不进 v1.0 关键路径**：v1 默认 `builtin`；编码类可先走 `codex`。

**Consequences**

- 12 周计划不受影响；S6 spike（`41 §5A`）在 v1.5 前完成即可。
- 若 v1.5 的编码长任务用 `codex` 不达标（事件粒度/审批可恢复性），再启 `dsh` 适配器，届时只需实现端口。

---

## 决议对文档的影响

| 文档 | 修改 |
|---|---|
| `31` | 增加 `user_preferences`、`teams/team_members`；`approvals/attentions` 标注 attention 所有；`cron_jobs` 标注 intake |
| `32` | attention 拥有 approval；kernel 无状态；orchestration 去掉 cron/assignment；agents 去掉 team kind |
| `33` | 删除 `domains/admin/`；domain 数 17→16；identity 增加 preferences；application/admin_service |
| `28` | 需求归属不变；ADM 归 admin service |
| `30` | 管理端仍走 `api/routers/admin` |

---

## 验收

- [ ] 只有一个模块能写 `approvals`
- [ ] `conversations` 不 import attention repo
- [ ] `admin` 无 repo/表
- [ ] `orchestration` 不写 assignment
- [ ] `agents` 无 team kind
- [ ] `capabilities` 不 import connectors/extensions 实现
- [ ] kernel 无 DB/事件依赖
