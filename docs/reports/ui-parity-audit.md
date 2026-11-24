# UI 对齐审计（原型 vs 当前前端）

> 日期：2026-11-23
> 范围：`prototype/`（README、app.js、styles、shots）与 `web/src/` 当前实现。
> 方法：按路由逐页对比结构、控件、状态与交互；以 `docs/30-按钮与页面状态总表.md` 为状态口径。尚未做像素级截图 diff，截图基线放到每个修复批次验收时建立。
> 说明：现有 47 条 Playwright 证明核心行为可用，不等于原型 1:1；本审计只回答“哪里不一致、先修什么”。

---

## 0. 执行摘要

1. **不建议继续先堆后台功能，也不建议全面重做 UI。** 当前差异中有一批不依赖新后端，属于“页面已存在但交互/状态没对齐”；先修这些收益最高。
2. **原型自身有两套导航截图。** `prototype/shots/tasks.png` 等展示的是旧版全量导航，而 `prototype/app.js`、`prototype/README.md`、`docs/04` 已定稿 **8 + 3**。本项目继续以 8+3 为准，不按旧截图扩导航。
3. **P0 共 18 项，最高优缺口集中在 6 处**：
   - 对话审批卡不在消息流内，且只有“批准/拒绝”，缺“本会话允许”（后端已支持）。
   - 任务卡缺少可读编号/来源、预算条，以及 question/blocked 的内联动作。
   - 专家页没有原型左侧专家列表；抽屉关闭会静默丢草稿。
   - 知识库文档搜索未接后端 `q`，状态仍显示英文，缺卡片视图。
   - 连接器 probe 只校验本地配置，UI 却提示“连接正常”；OAuth URL 是占位地址。
   - 全局外壳缺任务角标、账户弹层、命令面板与移动端行为。
4. **缺后端的功能必须诚实降级**：Ask/Plan 模式、技能包、渠道、云端协同、ACP、远程桌面、工作台、真实 OAuth、Web Push。
5. 建议按“外壳+对话 → 任务+专家 → 知识+连接+扩展 → 设置/管理/用量 → v1.1 页面”的顺序做纵切，不按前后端分层。

---

## 1. 判定口径

| 级别 | 含义 | 处理 |
|---|---|---|
| **P0** | 当前页面已存在、后端能力基本具备，但核心流程/信任/信息密度明显不符原型 | 本迭代必须修，不等待新后端 |
| **P1** | 需要新后端、新页面域，或页面信息架构大改 | 先定契约；未实现前诚实降级/隐藏，禁止假交互 |
| **P2** | 视觉、文案、排序、空态、低风险细节 | 随所属页面批次顺手修 |

分类标记：

- **a**：纯 UI 不一致，后端已有。
- **b**：后端缺失，但当前 UI 假装成功或可用（必须立即停掉）。
- **c**：后端缺失，当前 UI 已诚实降级（保留，补说明）。

---

## 2. 路由覆盖

| 原型路由 | 当前实现 | 结论 |
|---|---|---|
| `#/chat` | `/chat` | 有页面，P0/P1 缺口见 §3 |
| `#/tasks` | `/tasks` | 有页面，P0/P1 缺口见 §3 |
| `#/automation` | `/automation` | 有页面，仅入口在任务页；P1/P2 |
| `#/usage` | `/usage` | 只有按模型表；P1 缺后端聚合 |
| `#/agents` | `/agents` | 有页面，缺二级列表；P0/P1 |
| `#/knowledge` | `/knowledge` | 有页面，缺文档搜索/卡片；P0/P1 |
| `#/connections` | `/connections` | 有页面，信息架构不同；P0/P1 |
| `#/extensions` | `/extensions` | 仅插件/工具，缺技能包/市场；P1 |
| `#/settings` | `/settings` | 外观对齐较好；通知/导出/快捷键有缺口 |
| `#/notifications` | `/notifications` | 通知中心已有；原型 `#/inbox` 的待决处理未合并 |
| `#/admin-*` | `/admin?tab=*` | 合并为 Tab；缺插件/高级/角色分组等 |
| `#/workbench` | `/workbench` ComingSoon | 诚实降级，保持 |
| `#/personalization` | 无 | v1.1；不要做假页面 |
| `#/skills` | 无 | v1.1；扩展页可加“技能包”占位说明 |
| `#/channels`、`#/bridge`、`#/acp`、`#/remote` | 无 | v1.1；不加入 8+3 导航 |
| `#/inbox` | `/tasks` 待决桶 + `/notifications` | 原型是“待我决定”工作台；当前拆成两处，需在任务页补回入口与角标 |
| `#/ticket/:id` | `/tasks?ticketId=` | 可选深链，P2 |
| `#/teams/:id`、`#/workbench/cloud` | 无 | v1.1；隐藏 |

---

## 3. P0：核心流程与信任缺口

> 只列“当前页面已存在、后端基本具备、必须现在修”的项；P1 结构项见 §4，会随对应批次一起做。

### 3.1 全局外壳

| # | 差异 | 当前 | 原型 | 处理 |
|---|---|---|---|---|
| S-1 | 任务角标缺失 | 侧栏“任务”无待决数量 | 待决 Attention 数，0 隐藏 | 用 `/attentions` 聚合数加 badge；`/automation` 也归到任务高亮 |
| S-2 | 账户菜单缺失 | 底部只有主题切换和“退出”两个按钮 | 点击用户区打开菜单：外观、帮助、项目、自定义导航、设置、安全、更新、退出 | 新增 `UserMenu` 弹层；主题/退出移入菜单 |

文件：`web/src/layouts/Sidebar.tsx`、`web/src/layouts/Sidebar.module.css`、`web/src/layouts/AppShell.module.css`、`web/src/app/route-error.tsx`。

### 3.2 对话

| # | 差异 | 当前 | 原型 | 处理 |
|---|---|---|---|---|
| C-1 | 审批卡位置 | 渲染在 `MessageList` 之后，滚动区之外 | 审批卡在消息流内，随对话滚动 | 把 approval 作为消息流尾部节点传给 `MessageList` |
| C-2 | 审批动作 | 只有“批准/拒绝” | 拒绝 / 仅本次（approve）/ 本会话允许（approve_session）/ 查看完整参数 | 三按钮 + 参数展开；后端已支持 `approve_session` |
| C-3 | 无模型状态 | 菜单有提示，发送仍可用 | 琥珀提示 + “配置模型”，发送禁用 | 用 `modelConfigured` 禁用发送并给 CTA |
| C-4 | 对话错误态 | 普通 `ErrorState`，输入框仍可发 | 全页错误、保留草稿、重试/新对话、禁用 composer | 提升为页面级错误块 |
| C-5 | 富消息卡 | 工具卡只显示最后一个工具；文件卡只有路径/大小 | 多工具步骤、代码块高亮、文件 diff（+/−）、引用 chips | 先补代码块渲染、文件 +/− 与多工具聚合；diff 数据不足时诚实省略 |

文件：`web/src/routes/chat/ChatPage.tsx`、`web/src/components/attention/ApprovalCard.tsx`、`web/src/features/chat/components/MessageList.tsx`、`web/src/features/chat/components/Composer.tsx`、`web/src/features/chat/components/ChatHeader.tsx`。

### 3.3 任务

| # | 差异 | 当前 | 原型 | 处理 |
|---|---|---|---|---|
| T-1 | 任务身份 | 显示 `ticketId.slice(0,11)` | `#412 · acme/api` + 来源可读名 | 后端已给 `sourceName`；显示短号 + 来源 |
| T-2 | 预算条 | 只有“¥x / ¥y”文字 | 使用/上限进度条 + 追加预算 | 用已有 budget 字段画条 |

文件：`web/src/features/tasks/components/TicketList.tsx`、`TicketDetailPanel.tsx`、`TaskSidebar.module.css`。

### 3.4 专家

| # | 差异 | 当前 | 原型 | 处理 |
|---|---|---|---|---|
| A-2 | 卡片动作 | 编辑/发布/删除 | 打开 / 试运行 / ⋯ | 卡片“试运行”复用 `/agents/{id}/test` |
| A-3 | 抽屉脏关闭 | 直接关闭，草稿丢失 | dirty 标记 + 关闭确认 | 加 dirty guard |
| A-4 | 抽屉动作 | 只有保存草稿 | 试运行 / 发布 / 导出 `.poly` / 保存/取消 | 发布复用已有 API；导出标注 v1.1 |

文件：`web/src/routes/agents/AgentsPage.tsx`、`AgentEditDrawer.tsx`。

### 3.5 知识

| # | 差异 | 当前 | 原型 | 处理 |
|---|---|---|---|---|
| K-1 | 文档搜索 | 无搜索框 | 搜索文件名/内容 | 后端 `GET /docs?q=` 已存在，补 wrapper 与输入框 |
| K-3 | 状态文案 | 显示 `ready/failed/processing` | 中文状态 | 统一映射 |
| K-5 | 批量重建 | 只有批量删除 | 批量重建 + 删除 | 循环已有 per-doc reindex，或补 batch 端点 |

文件：`web/src/routes/knowledge/KnowledgePage.tsx`、`web/src/lib/api/endpoints/index.ts`。

### 3.6 连接器

| # | 差异 | 当前 | 原型 | 处理 |
|---|---|---|---|---|
| N-1 | probe 语义 | 只校验本地配置，却提示“连接正常” | 真实连通性/授权检测 | UI 改为“配置有效”；MCP 可直接调用 `discover` 做真实探测 |
| N-2 | OAuth 真实性 | 返回 `connect.invalid` 占位 URL，仍可打开 | 真实 provider 授权页 | 未接真实 OAuth 前隐藏“重新授权” |

文件：`web/src/routes/connections/ConnectionsPage.tsx`、`ConnectorsTab.tsx`、`ConnectorDrawer.tsx`、`src/polyopus/domains/connectors/service.py`。

### 3.7 扩展

| # | 差异 | 当前 | 原型 | 处理 |
|---|---|---|---|---|
| E-2 | 权限列 | 显示工具数 | 显示权限 | 后端已有 `permissions[]`，改表格 |

文件：`web/src/routes/extensions/ExtensionsPage.tsx`。

---

## 4. P1：需要后端或页面域

| 区域 | 缺口 | 依赖 | 动作 |
|---|---|---|---|
| 对话 | Ask/Plan 模式与卡片 | `POST /turns` 无 `mode`；无 plan/ask 事件 | 先保持 “v1.1” 说明；做模式前先定 turn 契约 |
| 对话 | steer 插话、引用/技能 chips、真实上下文环 | `/steer`、skills、compaction | 后端补齐后再开 |
| 对话 | 会话未读、消息分隔、语音按钮、移动端 | 已有 unreadCount / 本地 | 随 Batch A 做未读与分隔；语音禁用；移动端 Batch B |
| 会话 | 加载更早消息 | 无 cursor 分页 | 长会话分页 API |
| 任务 | question 文本回答、blocked 卡动作 | answer 只接受 approve/deny | 扩展 Attention answer schema |
| 任务 | 时间线中文阶段、来源选择、移动端 | 本地字段 | 随 Batch B 做 label 与移动端；来源选择标“手动” |
| 专家 | 左侧专家列表、9 分区抽屉、导出 `.poly` | 列表已有；导出无 API | Batch B 做列表；导出标 v1.1 |
| 知识 | 卡片视图、列顺序、批量重建、KB 设置 | 列表 q/folder 已有；设置 API 缺 | Batch C 做卡片/列/批量；设置只接 rename |
| 知识 | 多格式上传/进度、向量/OCR/共享设置、评测/摄取队列 | 无 multipart/索引配置 API | 先诚实标注，后补 |
| 连接器 | 三 Tab（已启用/内置/自定义）、入口权限、卡内设默认/删除 | 无新后端 | Batch C 做前端重构 |
| 连接器 | 通道/云端协同/ACP Tab、真实 OAuth、非 MCP 真实探活 | 无路由/真实 provider | 不做假入口；MCP 已可用 discover 真探测 |
| 扩展 | 顶层“插件/技能包”、详情抽屉、权限列 | skills 无 API；插件 permissions 已有 | Batch C 做插件侧；技能包 v1.1 |
| 扩展 | 市场、版本更新 | 无 market/update API | v1.1 |
| 设置 | 通知偏好服务端化、导出我的数据、可编辑快捷键 | `/me/export` 已有；无 prefs 字段 | 先接导出；prefs 加字段/迁移 |
| 用量 | 概览/按天/按专家/按模型 + 7/30/90 天 + 图表 | 只有按模型聚合 | 新增 `groupBy`/`range` 聚合 |
| 管理 | 概览 hub、插件 Tab、角色/分组、重置密码、模型类型、日期筛选 | 部分 API 缺失 | 插件 Tab 可先做；其余按后端批次 |
| 外壳 | 命令面板、移动端底部导航 | 本地/路由 | 可先做本地版 |
| 错误 | 403/409/500 独立页面 | 无 | 前端即可 |
| 工作台/个性化/技能/渠道/团队/云主机 | 无页面 | 无域/API | 保持隐藏或 ComingSoon，禁止假交互 |

---

## 5. 前三批执行计划

### Batch A：外壳 + 对话核心（先做）

范围：

1. 侧栏任务角标 + 账户弹层 + `/automation` 高亮。
2. 审批卡移入消息流 + 三按钮（拒绝/仅本次/本会话允许）+ 参数展开。
3. 无模型提示与发送禁用、对话错误态。
4. 代码块渲染、文件 +/−（trace 暂无 +/− 数据时诚实省略）。
5. 会话未读点/“以下是新消息”：需要线程已读状态的写入与清空 API，本批不做，放到 Batch D。

验收：

- 审批卡在消息流中随滚动；`approve_session` 后同一会话下一次写操作不再弹审批。
- 无模型时发送按钮禁用并有“配置模型”入口。
- 侧栏角标与 `/attentions` 待决数一致，处理后实时下降。
- Playwright 覆盖三按钮、无模型、任务角标；1280/1024 截图无溢出。

### Batch B：任务 + 专家

范围：

1. 任务短号/来源/预算条/时间线中文阶段；blocked/question 先引导到详情处理（文本回答需后端）。
2. 专家页新增左侧列表 + 卡片“打开/试运行/⋯”；抽屉 dirty guard、发布/试运行动作。
3. 移动端任务只显示列表、详情全屏：留到外壳响应式批次一起做。

验收：

- 任务卡显示 `#ID · source`，预算条与数字一致。
- 专家草稿修改后关闭会确认；卡片可试运行。
- 960/720 宽度下任务/专家不横向溢出。

### Batch C：知识 + 连接 + 扩展

范围：

1. 知识文档搜索接 `q`、卡片视图、中文状态、列顺序、批量重建。
2. 连接器三 Tab（已启用/内置/自定义）、行内设默认/删除、probe 改“配置有效”；MCP 真探测走“发现工具”，隐藏假 OAuth。
3. 扩展顶层改“插件/技能包”，权限列、详情抽屉；市场/更新标 v1.1。
4. 连接器入口权限改为 `connector:read` 或 `source:read`。

验收：

- 搜索输入过滤文档；卡片/表格切换保留筛选。
- probe 不再宣称“连接正常”，MCP 探测能返回工具数。
- 扩展不再把“工具注册表”当主 Tab；权限列来自后端。

### Batch D：设置 + 管理 + 用量（契约先行）

先补 API，再改页面：

- `GET /usage?groupBy=day|agent|model&range=7|30|90`。
- `/me` 通知偏好字段；接通 `/me/export`。
- Admin 插件 Tab（复用 `/plugins`）；角色/分组/重置密码按后端能力逐个开。
- 403/409/500 独立错误页。

### Batch E：v1.1 页面域

Ask/Plan、技能包、渠道、云端协同、ACP、远程桌面、团队、云主机。每个域先做后端契约，再谈 UI；在此之前导航/入口不得假装可用。

---

## 6. 审计结论

- **先修 P0 的 UI-only 缺口**，不要等后台“做到一定程度”；这些改动不会返工，且能立刻提升原型相似度。
- **后端缺口按页面纵切补**：一个页面需要什么 API 就补什么，不做“大而全”的预先建设。
- **所有未实现能力统一诚实降级**：禁用按钮 + v1.1 标签 + 说明，禁止 toast 假成功、假 OAuth、假“连接正常”。
- **验收从行为升级为视觉回归**：每个批次加 1280/1024 Playwright 截图基线，避免“功能通过但页面不像”。

下一步从 **Batch A** 开始。

---

## 7. 执行记录

### Batch A（2026-11-23）

| 项 | 状态 | 说明 |
|---|---|---|
| 侧栏任务角标 | DONE | 用 `/attentions` pending 数；5s 刷新；0 隐藏；`/automation` 保持任务高亮 |
| 账户菜单 | DONE | 用户区弹层：个人设置、管理控制台、主题、退出；折叠态可弹出 |
| 审批卡进入消息流 | DONE | `MessageList` 内渲染，随消息滚动；e2e 断言位于 `message-scroll` |
| 审批三动作 | DONE | 拒绝 / 仅本次允许 / 本会话允许；后端把 `approved_session` 的工具 key 写入线程设置，本会话后续 turn 自动 allow（deny 仍优先） |
| 无模型状态 | DONE | env provider 缺 Key 时显示琥珀提示、禁用发送、给“配置模型”入口；FakeModel 不回退受影响 |
| 对话错误态 | DONE | 消息加载失败保留草稿、重试/新建对话，composer 禁用 |
| 代码块 | DONE | 解析 fenced code，显示语言标签；未闭合 fence 在流式中也可读 |
| 工具-only turn | FIXED | 空 assistant 投影但有 steps/files 时保留该行，避免文件卡丢失 |
| 未读点/新消息分隔 | DEFERRED | 当前 unread_count 没有写入/清空 API；不伪造，移到 Batch D |
| 文件 +/− | DEFERRED | `fs.write` trace 只有 path/bytes，无 diff 统计；有数据后再显示 |

验证：后端 444 测试、web 115 单测、Playwright 48/48、ruff/mypy/eslint 通过。

### Batch B（2026-11-23）

| 项 | 状态 | 说明 |
|---|---|---|
| 任务卡身份 | DONE | `#短号 · 来源名`（title 保留完整 ticket_id），搜索仍覆盖完整 ID |
| 预算条 | DONE | 详情“授权范围”增加使用/上限进度条，≥80% 琥珀提示 |
| 时间线阶段 | DONE | 补 Gate / Eval / Execution 中文/英文阶段映射 |
| 任务内联 question/blocked | PARTIAL | approval 卡内联；question/blocked 仍进详情，文本回答需扩展 Attention answer schema（P1） |
| 专家二级列表 | DONE | 232px 页内列表：名称/模型/发布状态；点击打开抽屉 |
| 卡片动作 | DONE | 打开 / 试运行 / 发布 / ⋯（删除）；试运行直接打开测试分区 |
| 抽屉脏关闭 | DONE | 未保存标记 + 关闭确认（继续编辑/放弃修改） |
| 抽屉动作 | DONE | 保存草稿、发布、测试对话保留；导出 `.poly` 仍标 v1.1 |
| 移动端任务 | DEFERRED | 216px 侧栏已在 1180 隐藏；列表/详情切换留到统一响应式批次 |

验证：后端 444、web 115、Playwright **50/50**、ruff/mypy/eslint/build 通过。

### Batch C（2026-11-23）

| 项 | 状态 | 说明 |
|---|---|---|
| 知识文档搜索 | DONE | `GET /docs?q=` 接入；输入用 deferred value，空结果给“清除搜索” |
| 知识与卡片视图 | DONE | 表格/卡片切换；卡片复用预览/重建/删除；KB 名称+文档/切片/id 摘要 |
| 知识状态/列 | DONE | ready/processing/queued/failed 中文化；列顺序改为 文件名/状态/分块/上传时间/操作 |
| 知识批量重建 | DONE | 批量条新增“批量重建”，逐文档调用现有 reindex，成功后清选择 |
| 连接器信息架构 | DONE | 已启用 / 内置 / 自定义 三子 Tab；自定义 MCP 实例与目录分区 |
| 连接器行内动作 | DONE | 设默认/取消默认、删除二次确认；创建/配置/测试保留 |
| 连接器真实性 | DONE | probe 文案改“配置有效（仅本地校验）”；OAuth 不再打开占位地址，标 v1.1；MCP 用“发现工具”做真实探测 |
| 连接器入口权限 | DONE | `RequirePermission anyOf`：source:read 或 connector:read |
| 扩展信息架构 | DONE | 顶层 插件/技能包/工具/Agent 工具；插件内 已安装/市场 |
| 扩展权限列/详情 | DONE | 表格显示 permissions；新增只读详情抽屉（权限/工具/签名/版本） |
| 扩展市场/技能 | DONE | 市场与技能包明确 v1.1 空态，保留签名安装与示例插件，不伪造在线目录 |
| 插件启停控件 | PARTIAL | 仍是 checkbox（原型 switch）；属 P2 视觉件，后续统一控件 |

验证：后端 444、web 115、Playwright **50/50**、ruff/mypy/eslint/build 通过。

### Batch D（2026-11-23）

| 项 | 状态 | 说明 |
|---|---|---|
| 用量范围/分组 | DONE | `range=7/30/90` + `groupBy=model/agent/day`；响应一次返回 totals/byDay/byAgent/byModel |
| 用量概览 | DONE | 4 KPI、每日 tokens 柱状图、专家/模型 Top 5；CSV 导出跟随当前 range/group |
| 通知偏好 | DONE | `0034_user_preferences.sql`；`PATCH /auth/me` 接受 `notificationPrefs`，按账号持久化 |
| 导出我的数据 | DONE | 设置账号页创建导出 → 轮询进度 → ready 后下载；新增 `GET /me/export/{id}/download`，路径 jail 在 data/exports |
| 管理端插件 | DONE | 新增插件 Tab：安装示例、启停、卸载，复用 `/plugins`；概览快捷入口补插件 |
| 403/409/500 独立错误页 | DONE | 统一 `ErrorPage`（403/404/409/500），权限拒绝、404 与路由崩溃均接入；提供返回/重试/回到对话 |
| 角色/分组/重置密码 | PARTIAL | 用户/邀请/批量已有；角色列表只读、分组与重置密码无后端，未伪做 |

验证：后端 **446**、web 115、Playwright **51/51**、ruff/mypy/eslint/build 通过。

### 响应式收尾（2026-11-23）

| 项 | 状态 | 说明 |
|---|---|---|
| 外壳断点 | DONE | ≤960 强制 56px  rail；≤720 隐藏 rail，显示 5 项底部导航（按权限过滤） |
| 移动端内容 | DONE | AppShell 预留 56px 底部安全区；PageShell 头部/标题收紧；对话页「会话」按钮打开全宽会话抽屉 |
| 抽屉/弹窗 | DONE | ≤720 抽屉全宽、弹窗留 10px 边距 |
| 任务移动端 | DONE | ≤720 列表与详情单屏切换；详情有「返回列表」；新建任务→详情→返回已 e2e |
| 错误页 | DONE | 403 权限、404、409、500 统一错误卡；路由崩溃页复用 |
| 移动端溢出 | DONE | 390px 下 tasks/automation/notifications/agents/knowledge/extensions/admin/settings 无横向溢出 |
| 命令面板 `⌘K` | DEFERRED | 仍无全局命令面板；留到交互增强批次 |

验证：后端 446、web 115、Playwright **54/54**、ruff/mypy/eslint/build 通过。

### 命令面板 + Ask/Plan（2026-11-23）

| 项 | 状态 | 说明 |
|---|---|---|
| 全局 ⌘K / Ctrl+K | DONE | AppShell 挂载命令面板：搜索/键盘上下/Enter，覆盖对话、任务、专家、知识、连接、扩展、自动化、用量、通知、设置、管理、新建对话；按权限过滤 |
| Ask/Plan 模式 | DONE | Composer 模式菜单（Act/Ask/Plan），会话级持久化；turn 携带 mode；Ask/Plan 不广告/不执行工具 |
| 模式提示词 | DONE | 后端按 mode 追加系统指令：Ask 先澄清、Plan 只给计划；引擎事件 `turn.started.mode` 进入 trace |
| 模式卡 | DONE | 消息流渲染 Ask/Plan 卡；Plan「执行计划」/「转为任务」、Ask「跳过并执行」都会切回 Act；Plan 转任务直接 `POST /tickets` 并跳转任务详情 |
| 结构化 Ask | DONE | 解析模型输出的 `{"questions":[...]}` JSON 块，渲染选项/补充输入/提交回答；普通代码块不会被误解析 |
| `/plan` 命令 | DONE | 不再只插文案，直接切换 Plan 模式 |

验证：后端 **449**、web 119、Playwright **58/58**、ruff/mypy/eslint/build 通过。

### 任务产物与时间线修正（2026-11-23）

| 项 | 状态 | 说明 |
|---|---|---|
| 任务产物 | DONE | 引擎在 `fs.write` 成功后登记 `artifacts`（ref/mime/size/sha256），租户+thread+turn 去重 |
| 产物预览 | DONE | 任务详情“产物”行新增预览；走 `/workspace/file`，Dialog 显示文件内容 |
| 时间线阶段 | DONE | 所有 ticket 都补 Trigger/Gate/Eval：手动任务显示“手动创建”，webhook 显示触发文本；原有 Ticket/Assign/Report 保留 |
| 任务卡来源 | DONE | 手动任务不再重复显示“手动 · #ID · 手动”，只显示短号；有来源时显示 `#ID · source` |
| 再次运行/删除 | DONE | 结束任务可 `POST /tickets/{id}/rerun` 重新排队（写 timeline）；`DELETE /tickets/{id}` 删除任务记录/报告/时间线，保留审计/用量/事件；详情页有按钮与二次确认 |
| 空产说明 | DONE | 无产物时说明“仅文本任务不产生文件；需要文件请在指令中要求写入工作区” |
| 手动任务写权限 | DONE | 手动 ticket 默认 scope 补 `fs:write`，写操作进入审批而非 scope 拒绝；`0035_manual_ticket_write_scope.sql` 修复历史手动任务 |
| 审批入口 | DONE | 任务详情直接渲染 ApprovalCard（拒绝/仅本次/本会话），列表无 attention 但 bucket=attention 时给「处理」兜底；attention 查询 2s 刷新 |
| 任务内容 | DONE | 详情新增「任务内容」面板：最新人工说明 > 触发文本 > 标题；不再只能看授权/报告 |
| 编辑任务 | DONE | `PATCH /tickets/{id}` 仅允许 ended（停止/失败/完成）；编辑标题与说明，说明写入 human_message，再次运行使用新说明 |
| 取消任务 | DONE | 运行/排队中显示「取消任务」，确认后走 stop 收尾；结束态显示再次运行/编辑/删除 |
| 产物预览排版 | DONE | 预览不再用 `<pre>` 展示源码；轻量安全 Markdown 渲染器支持标题/列表/引用/表格/粗体/行内代码/代码块/链接，禁用 `javascript:` 链接；Dialog overlay/content 显式 z-index，时间线圆点不再穿透遮罩 |
| 审批即时反馈 | DONE | 审批回答后 ticket bucket 立即从 attention 改为 running；前端同时 invalidate attentions/tickets/counts/detail/timeline，任务卡不再延迟显示“待决” |

验证：后端 451、web **122**、Playwright **62/62** 通过。

### 视觉验收收口：任务窗 + 对话（2026-11-24）

做法：不在 `e2e/` 写临时用例，而是复制 e2e 库到 `data/visual-chat.db`，用独立端口（API 8911 / 预览 4187）起隔离实例，直接用 Playwright 库在 1440 / 1280 / 1024 / 390 取基线，对照 `prototype/shots/{tasks,ticket,chat,chat-dock,welcome,mobile-tasks}.png` 逐项修，再重拍确认。前后截图在被忽略的 `web/.screenshots/visual/{before,after}/`。

| # | 差异 | 处理 |
|---|---|---|
| T-1 | 详情头 6 个按钮在 1280 宽把标题挤成一字一行、标签竖排 | **P0**。改为「标题 + 一行元信息 + 按状态显示操作」：运行/排队中 = 重新派工 / 追加预算 / 取消任务；结束后 = 再次运行 / 编辑 / 删除。`.headMain` 给 flex-basis，让操作先换行再挤压标题 |
| T-2 | 「任务线」标题被长副标题挤成两行 | 卡片标题 `flex: none`，副标题单行省略 |
| T-3 | 无预算上限时仍画一条空进度条 +「未设置上限」，像多余分割线 | 仅在有上限时渲染进度条 |
| T-4 | 追加预算后上限/进度条不显示 | **真问题**：详情接口预算键为 `max_cost_micros`，前端按 `maxCostMicros` 读。两种键都读 |
| T-5 | 时间线两行节点、带连接线、间距不一致 | 改为原型「时间 \| 圆点 \| 阶段 \| 说明」单行栅格，28px 等距，超出省略并带完整 title |
| T-6 | 报告显示 `执行 completed（… / … micros）` 与原始 key/value | `formatSummary` / `formatFact`：状态中文化、tokens 千分位、金额按元；facts 变 chip |
| T-7 | 审批条只写「策略要求审批：fs.write」 | `approvalQuestion`：按工具生成问题，如「是否允许写入 release-notes.md？」；允许两行不截断 |
| T-8 | 卡片选中态整块蓝底 | 白底 + 蓝色描边 + 左侧蓝条；标题 14.5px；卡片圆角 10px |
| T-9 | 「待我决定」里有任务没有任何按钮 | **真问题**：审批过期清理只以拒绝续跑对话、不关单。过期后调用 `finish_after_attention(expired=True)`；`0036` 修复历史孤儿；已完成但报告仍是 waiting 的显示「审批超时未处理，任务已结束」 |
| T-10 | 「任务内容」卡与头部各有一个「编辑」 | 去掉卡内重复入口 |
| C-1 | 审批暂停后留下只有头像和名字的空助手行 | 只保留每轮最后一条助手行；空行仅在该轮有工具/文件/引用时保留 |
| C-2 | 助手回答是纯文本，Markdown 标记原样显示 | 改用 `MarkdownView`（`compact` 模式），替换原仅支持围栏代码的 `RichText`；流式光标跟随最后一个块 |
| C-3 | 工具卡只显示最后一次调用 | 每次调用一行，带耗时与状态 |
| C-4 | 审批卡是「待批准/影响/参数」三行表单感 | 原型样式：琥珀左边线、⚠ 需要你确认 + 倒计时、工具 + 参数、影响、拒绝 / 仅本次允许 / 本会话允许 + 查看参数 |
| C-5 | 会话栏每行只有标题，选中无明显标记 | 两行（标题 + 最新消息预览）+ 左侧选中条；预览由后端返回并去掉 Markdown 标记 |
| C-6 | 输入框右侧「—」上下文环占位 | 无数据支撑，移除 |
| C-7 | 欢迎快捷卡用的是零散字符图标 | 图标块（复用侧栏 icon 路径） |
| C-8 | 390 宽下「分享」按钮文字折成两行 | 移动端隐藏该按钮 |
| S-1 | 原型次级按钮为白底描边，共享 `secondary` 为灰底 | 共享 `Button` 新增 `outline` / `outlineDanger` 变体（纯新增） |

未做（如实）：文件卡的 +/− 行数（trace 没有差异数据）；专家条在名称很长时仍会省略；Dock 与轨迹面板本轮未对照。

验证：后端 **454**、web **122**、Playwright **62/62**、check.py / import-linter / eslint 通过。

### 连接页对齐原型（2026-11-24）

对照 `prototype/shots/connections.png`（已启用）、`connectors-mcp.png`（内置）、`connections-empty.png`（空态）。沿用隔离预览（e2e 库 + 独立端口），截图在 `web/.screenshots/connections/after/`。

| # | 差异 | 处理 |
|---|---|---|
| K-1 | 顶部是「来源 / 连接器」，默认停在来源表单，与原型首屏相反 | 页面骨架改为「标题 + 连接器 / 通道 / 云端协同 / ACP」，默认连接器；来源（Webhook + 定时任务）并入通道 |
| K-2 | 连接器卡片窄、没有描述，状态写 `已配置`，操作挤成一行 | 原型 agent-card：36px 渐变图标、名称 + 已连接/已过期/待配置、描述行、右上「N 工具」、默认打开/仅自己标签、底部分隔动作（配置 / 测试连接 / 设默认 / 删除） |
| K-3 | 三个子 Tab 带计数 | 改为「已启用连接器 / 内置连接器 / 自定义连接器」，去掉计数 |
| K-4 | 没有添加入口卡 | 网格末尾加虚线「添加连接」卡；零实例时给「添加连接器 / 浏览内置连接器」空态 |
| K-5 | 内置目录是列表行，没有分类 | 分类 chips（全部 / 办公协作 / 开发协作 / 通讯与效率 / 自托管·扩展）+ 卡片网格；凭证标签修正为 OAuth / Token / IMAP·授权码，不再出现 `Token / Token`、`IMAP / Token` |
| K-6 | 自定义 MCP 只有实例列表，没有双视图 | 可视化 / JSON 切换；HTTP / Stdio 分开入口；JSON 视图可解析、校验并保存为新实例，解析规则抽到 `mcpConfig.ts` 并加 3 条单测 |
| K-7 | 编辑 MCP 实例时抽屉预填模板，直接保存会覆盖原配置 | **真问题**。编辑态改为空编辑器：不填不提交 `config`，可视化/JSON 都不再写入模板；只有用户新增 Server 或粘贴 JSON 后才覆盖，并给出提示 |
| K-8 | 通道表单按钮被网格拉满整格、删除是红色实心块 | 提交按钮 `justify-self: start`；删除改红色文字；面板 12px 圆角、输入 34px 高 |
| K-9 | 页头「添加自定义 MCP」只在连接器页可用 | 请求状态提到页面层：从通道/云端协同/ACP 点击会先切回连接器并打开抽屉 |
| K-10 | Tab 下划线两端是圆弧：全局 `button { border-radius }` 渗进了 `border-bottom` | 所有下划线 Tab 显式 `border-radius: 0`（连接、知识、设置、用量、管理、自动化、扩展、通知、Dock、轨迹、MCP 抽屉，共 13 处）；任务页的胶囊 Tab 不受影响 |

未做（如实）：内置目录仍只有后端真实支持的 GitHub / 飞书 / Webhook / IMAP / 自定义 MCP，没有补 Notion、钉钉、企业微信等尚不能工作的条目；通道仍是 Webhook + 定时触发，IM 通道待接入；云端协同 / ACP 只有 v1.1 占位。

验证：后端 **454**、web **125**（新增 `mcpConfig` 3 条）、Playwright **62/62**、ruff / mypy / import-linter / eslint / build 通过；`check.py --skip web-dist` 全绿（dist 随本次提交更新）。下划线修正后重跑 连接 / 知识 / 设置 / 用量 / 响应式 13 条 e2e 通过。

### 管理页对齐原型（2026-11-24）

对照 `prototype/shots/admin.png`、`admin-users.png`、`admin-models.png`、`admin-storage.png`、`admin-security.png`、`admin-advanced.png`。沿用隔离预览（e2e 库 + 独立端口），截图在 `web/.screenshots/admin/after/`。

| # | 差异 | 处理 |
|---|---|---|
| M-1 | 页头固定为「管理」，顶部有 配额 / 审计 / 备份 / 数据任务 四块原型没有的 Tab | 顶部收敛为原型七项「概览 / 用户 / 模型 / 存储 / 插件 / 安全 / 应用设置」；页头标题、副标题、右上主操作随 Tab 切换（用户管理 / 模型配置 / 存储管理 / 安全防护 / 应用设置） |
| M-2 | 概览是 8 个小 KPI + 任务桶 + 最近审计 + 两列快捷入口 | 原型结构：4 个主 KPI（活跃会话 / 队列深度 / 错误率 / P95）、一行次级用量（运行中 / 待决 / token / 成本）、6 个整宽快捷卡（带图标与「进入 →」）、数据地图改为 4 行「名称 + 后端 + 容量 + 正常」 |
| M-3 | 用户是带内联表单的列表，没有邮箱列、搜索、分页、角色/分组视图 | 原型用户表：搜索 + 共 N 条 + 列 + 批量导入、全选/逐行选择、用户名/显示名/邮箱/账号类型/登录方式/状态/操作、6-20 条分页；新建用户与邀请用户改为页头按钮 + 弹窗；行内 编辑 / 重置密码（v1.1）/ 禁用启用 / 删除。后端 `GET/POST /users` 补 `email`（表里本来就有） |
| M-4 | 角色/分组没有入口 | 用户下新增「角色 / 分组」子 Tab：角色卡显示成员数、说明、编辑权限（只读权限清单）与查看成员；分组以 v1.1 空态诚实降级 |
| M-5 | 模型是卡片列表，缺少当前生效、搜索、表格列与分页 | 当前生效卡（env 优先，否则第一个 provider）+ 搜索 + 表格（提供商 / ID / 模型 / 状态 / 凭证 / 配置·测试·管理模型）+ 分页；删除收进编辑弹窗，避免行内误删 |
| M-6 | 存储是容量快照 + 自动备份表单 | 原型后端卡片：本地目录（已配置，配置/探测/浏览）+ 腾讯云 COS / PostgreSQL / Docker 沙箱 / S3（未配置，v1.1 禁用）；本地「浏览」弹窗列出数据库/数据/工作区/备份路径与占用；自动备份移到应用设置 |
| M-7 | 安全是一整页姿态卡 + 工具表 + 策略表 | 原案子 Tab：工具审批 / 文件访问 / 敏感信息 / 命令防护 / 技能扫描 / 审计。工具审批开关反映真实策略（打开即进入策略编辑），需审批工具由高风险副作用工具与 ask 规则推导；文件访问显示工作区 jail 与 fs 工具；审计从顶部 Tab 移入 |
| M-8 | 备份/数据任务/配额/审计是独立顶部 Tab | 配额移入用户子 Tab；备份 + 自动备份 + 数据任务移入应用设置「备份与恢复」；审计移入安全子 Tab，原有功能与测试 id 保留 |
| M-9 | 应用设置没有入口 | 新增应用设置：环境变量 / 备份与恢复 / HTTPS / 应用更新 / 通行密钥；仅备份与恢复为真实功能，其余明确 v1.1 |
| M-10 | 用户表操作列没有右对齐；移动端表格把列挤成竖排文字 | **真问题**：共享 CSS 漏了 `rowActions`，按钮按行内元素排；补回并右对齐。表格容器改为横向滚动 + `min-width`，390 宽可滑动查看而不是压扁 |

未做（如实）：分组、角色权限编辑、管理员重置密码、OIDC/飞书/企微/钉钉登录、远端对象存储/数据库后端、环境变量在线编辑、HTTPS/应用更新/通行密钥、敏感信息/命令防护/技能扫描的在线配置，均保持禁用或 v1.1 空态，不做假开关。

验证：后端 **454**、web **125**、Playwright **62/62**、ruff / mypy / import-linter / eslint / build 通过；`check.py --skip web-dist` 全绿（dist 随本次提交更新）。
