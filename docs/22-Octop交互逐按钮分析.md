# 22 · Octop 交互逐按钮分析与原型对齐

> 分析对象：`E:\space\work_space\agnet\lsh-agent`（Octop 1.0.3b2）。
> 目的：回答三个问题——Octop 的界面为什么"看起来合理"、它的按钮/配置到底有哪些、PolyOpus 的原型应该怎么改。
> 证据：`dashboard/src/layouts/*`、`dashboard/src/components/AvatarDropdown.tsx`、`dashboard/src/routes/index.tsx`、`dashboard/src/pages/**`、`dashboard/src/locales/zh.json`。

---

## 0. 先给结论

Octop 的"合理"不是视觉多精致，而是四件事做对了：

1. **导航有文字、有分组、可收起**：展开 220px（图标 + 文案 + 分组标题），收起 56px（纯图标 + tooltip）。不是一列裸图标。
2. **用户区是一个完整的账户菜单**：头像 + 名字 + 角色，点开有外观、帮助、项目地址、自定义导航、个人设置、账户安全、检查更新、退出。设置是抽屉，不是单独一个"设置"图标。
3. **每个页面都有稳定的骨架**：标题 20/600 + 副标题 13 + 右侧动作区 + 内容卡片（24 padding、8 radius）；桌面端没有额外全局顶栏，空间留给内容。
4. **配置项按"页 → 页签 → 分组"三层组织**，危险操作统一二次确认，保存类操作统一右下角/右上角主按钮。

我们上一版原型的问题正好相反：

| 上一版 | 问题 | 本次改法 |
|---|---|---|
| 64px 纯图标侧栏 | 认不出、没有分组、没有账户入口 | 232px 展开侧栏：图标 + 文案 + 设置/控制/管理分组；可收起为 64px |
| 没有用户菜单 | 只有头像，点不开 | 侧栏底部 `admin / 管理员` → 账户弹层（文字菜单） |
| 设置只有一个页面 | 配置项不成体系 | 个人设置（资料/布局/语言/配色/SSO）+ 管理侧 6 个配置页 |
| 菜单只有图标 | 悬停才知道是什么 | 所有导航、菜单、按钮都有文字；图标只做辅助 |
| 页面缺配置表单 | 只有任务/对话 | 新增 通道、个性化、模型、用户、存储、插件、安全、应用设置 |

---

## 1. 外壳（Shell）

### 1.1 侧栏尺寸与状态

| 状态 | 宽度 | 内容 | 来源 |
|---|---|---|---|
| 展开 | **220px** | Logo + 版本；一级项（图标 + 文案）；分组标题；底部用户区（头像 + 名字 + 展开箭头） | `sidebarNav.tsx:26`、`Sidebar.tsx:534` |
| 收起 | **56px** | 只留图标；hover 出 tooltip；底部只留头像 | `sidebarNav.tsx:27`、`SidebarCollapsedIconNav.tsx` |
| 移动端 | 抽屉 | 顶部只有一个汉堡按钮；品牌 + 版本；不占常驻宽度 | `Header.tsx:23`（桌面返回 `null`） |

交互细节：

- 分组标题 **设置 / 控制 / 管理** 可折叠；当前路由所在分组会自动展开（`useNavGroupCollapse`）。
- 进入页面会 **prefetch** 路由（`Sidebar.tsx:161`），减少点击后的空白。
- 折叠状态持久化；折叠后图标仍有 `title`/tooltip。
- 支持"自定义导航"：拖动排序、分组、隐藏、恢复默认（`SidebarNavCustomizer`）。
- 管理项可带"有新版本"徽标（`nav.newVersionBadge`）。

### 1.2 导航矩阵（按 Octop 真实顺序）

| 分组 | 文案 | 路由 | 图标 | 权限/备注 |
|---|---|---|---|---|
| 顶部 | 对话 | `/chat`、`/chat/:agentId/:threadId` | MessageSquare | 所有人 |
| 顶部 | 专家 | `/experts` | GraduationCap | `experts` |
| 顶部 | 自动化 | `/tasks` | Timer | `tasks`；实际是定时任务 |
| 顶部 | Token 统计 | `/token-usage` | Activity | `token-usage` |
| 设置 | 个性化 | `/personalization/skills` 等 | Sparkles | `personalization`；默认落到第一个有权限的 Tab |
| 设置 | 通道 | `/personalization/channels` | Waypoints | `channels` |
| 设置 | 连接器 | `/connectors` | Link2 | `connectors` |
| 设置 | 技能包 | `/skill-packages` | Package | `skill-packages` |
| 设置 | 知识库 | `/knowledge-bases` | Database | `knowledge-bases` |
| 设置 | 云端协同 | `/bridge` | Cloudy | `bridge` |
| 控制 | 工作台 | `/workbench` | PanelsTopLeft | `workbench`；终端/浏览器共用 |
| 控制 | 远程桌面 | `/remote-desktop` | Monitor | `desktop` 或移动端 `mobile` |
| 控制 | ACP 协作 | `/acp` | Share2 | 管理员 |
| 管理 | 用户管理 | `/admin/users` | Users | `admin-users` |
| 管理 | 模型配置 | `/admin/models` | Cpu | `models` |
| 管理 | 存储管理 | `/admin/backend` | HardDrive | `admin-storage` |
| 管理 | 插件管理 | `/admin/plugins` | Puzzle | `admin-plugins` |
| 管理 | 安全防护 | `/admin/security` | Shield | `admin-security` |
| 管理 | 应用设置 | `/admin/advanced` | SlidersHorizontal | `admin-advanced`；有新版本时带徽标 |

> 注意：Octop 的"任务"不是工单中心，而是 **定时任务**（CronJobs）。PolyOpus 的"任务/收件箱"是额外能力，不能直接替换它的入口；建议保留"自动化"作为独立导航，任务中心另开入口。

### 1.3 用户区（最容易被忽略、但最影响"合理感"）

触发区（`Sidebar.tsx:534-560`）：

- 展开：`头像 30px + 显示名 + 角色 + ChevronDown`，整行 hover。
- 收起：只留头像，hover tooltip 显示名字。
- 点击向上弹出 Popover（`AvatarDropdown.tsx:293-387`）。

弹层内容与按钮：

| 区块 | 控件 | 文案 | 行为 |
|---|---|---|---|
| 头部 | 显示名 + 角色 Tag + `@username` | 管理员 / 普通用户 | 只读 |
| 外观 | 浅色 / 深色 / 跟随系统 | `account.themeLight` 等 | 立即切换，持久化 |
| 菜单 | 帮助与反馈 | `account.helpFeedback` | 新窗口打开帮助页 |
| 菜单 | 项目地址 | `account.projectUrl` | 新窗口 GitHub |
| 菜单 | 自定义导航 | `nav.customize` | 打开导航编辑器（拖拽/分组/隐藏/恢复默认） |
| 菜单 | 个人设置 | `account.settings` | 打开右侧 480px Drawer |
| 菜单 | 账户安全 | `account.security` | 打开账户安全 Drawer（TOTP/Passkey/恢复码/改密） |
| 菜单 | 检查更新 | `account.checkUpdates` | 跳 `/admin/advanced?tab=updates` |
| 菜单 | 退出登录（红） | `auth.logout` | 调 logout + 清 token + 回登录页 |

个人设置 Drawer（`AvatarDropdown.tsx:430-663`）：

| 分区 | 字段/按钮 | 说明 |
|---|---|---|
| 身份 | 显示名、`@username`、角色 Tag | 只读摘要 |
| 头像 | 默认图标选择 / 上传图片 / 删除 | 上传后立即生效 |
| 显示名称 | Input（≤64）+ 底部"保存" | 保存后全局展示更新 |
| 页面布局 | 经典模式 / 极简模式（Segmented） | 立即切换 |
| 语言 | 中文 / English（Segmented） | 立即切换并持久化 |
| 配色 | 8 套预设 + 自定义颜色 | 与明暗主题独立 |
| 单点登录 | 飞书 / 企业微信 / 钉钉：绑定 / 解除绑定 | 至少保留一种登录方式 |

### 1.4 页面骨架（PageShell）

`PageShell.tsx:132-224` 的硬约束：

| 项 | 值 |
|---|---|
| 外边距 | 桌面 32px，顶部 24px |
| 标题 | 20px / 600，行高 28 |
| 副标题 | 13px，secondary，距标题 4px |
| 标题 → 内容 | 24px（有 Agent 选择器时 12px + 选择器） |
| 内容卡片 | `colorBgContainer`、24px padding、8px radius |
| 滚动 | 只滚内容卡片，标题固定 |
| 右侧动作 | 与标题同一行，`flex-shrink: 0` |

桌面端没有全局 Header（`Header.tsx:23` 直接 `return null`），所以第一屏的视觉重心是"侧栏 + 页面标题 + 内容卡片"。

---

## 2. 逐页按钮与配置

> 标注：**L1** 直接执行；**L2** 行内确认/Toast；**L3** 弹窗确认；**L4** 重新认证/输入名称确认。

### 2.1 对话 `/chat`

| 位置 | 控件 | 行为 | 级别 |
|---|---|---|---|
| 顶部 | 专家选择器 | 切换当前专家，URL 变为 `/chat/:agentId` | L1 |
| 顶部 | 会话标题 / 重命名 | 行内编辑 | L1 |
| 顶部 | 导出 / 清空 / 删除会话 | 导出 JSON；删除需确认 | L3 |
| 输入区 | 发送 | Enter 发送；Shift+Enter 换行 | L1 |
| 输入区 | 停止 | 中断本轮，保留已生成内容 | L1 |
| 输入区 | 附件 / @ / / / 语音 | 文件、提及、斜杠命令、语音 | L1 |
| 输入区 | 模型 / 模式 / 知识库 / 连接器 | 打开选择菜单；选择后写入本轮 | L1 |
| 消息 | 复制 / 重新生成 / 分支 | 重新生成会新建分支 | L1 |
| 工具卡 | 展开/收起参数 | 展示入参、结果、耗时 | L1 |
| 审批卡 | 拒绝 / 允许 / 本会话允许 / 查看参数 | 允许后恢复执行；拒绝结束本轮 | L1/L3 |
| 右侧 | 运行轨迹 / 工作区 / 浏览器 | 打开对应面板 | L1 |

配置重点：**本轮选择只影响本轮**；模型/知识库选择器要有"跟随默认"选项，不能把全局默认偷偷改掉。

### 2.2 专家 `/experts`

页头：

| 控件 | 文案 | 行为 |
|---|---|---|
| 视图切换 | 卡片 / 表格 | 持久化 |
| 新建 | 新建专家 | 打开创建 Drawer |
| 模板 | 从内置专家模板新建 | 打开模板库 |
| 搜索 | 搜索专家 | 前端过滤 |
| 筛选 | 状态 / 模型 / 人格 | 组合筛选 |

卡片/行操作：

| 控件 | 行为 | 级别 |
|---|---|---|
| 打开 | 进入专家详情/对话 | L1 |
| 启动 / 停止 | 启动后端运行时；停止需确认 | L2/L3 |
| 编辑 | 打开 `EditAgentDrawer` | L1 |
| 复制 ID | 复制 `agent_id` | L1 |
| 共享 | 仅自己 / 所有人 / 指定分组 | L1 |
| 发布模板 | 生成快照；可更新/取消发布 | L3 |
| 删除 | 输入/确认；有运行中会话时阻止 | L4 |

编辑 Drawer 的配置分区（`EditAgentDrawer.tsx`）：

| 分区 | 字段 |
|---|---|
| 基本信息 | 名称、描述、自定义 ID（3-64，创建后不可改）、配色、头像（≤5MB） |
| 模型 | Provider、模型、思考模式、最大迭代、最大输入长度、轨迹开关 |
| 提示词 | SOUL / IDENTITY / USER / AGENTS / TOOLS / BOOTSTRAP / HEARTBEAT / SKILL / MEMORY / PROACTIVE 文件编辑 |
| 技能 | 已安装技能勾选、技能市场安装 |
| 工具 | 内置工具、插件工具开关；shell 等标"需审批" |
| 工作区 | 存储后端、目录、导入/导出压缩包 |
| 心跳 | 启用、间隔（30m/1h/2h30m）、HEARTBEAT.md |
| 主动关心 | 启用、检查频率、关心时段、免打扰、同话题冷却、发送位置 |
| 人格 | MBTI 选择/测试 |
| 记忆 | 查看、清理、待确认草稿 |
| 高级 | 运行配置（迭代/输入长度/轨迹） |

保存行为：底部固定"取消 / 保存"；保存只影响新会话，运行中的会话锁定旧版本（页面上要明说）。

### 2.3 自动化 `/tasks`（定时任务）

页头：`创建定时任务`、视图切换（表格/卡片）、专家选择器、刷新/同步状态。

表单分区（`cronJobs.form.*`）：

| 分区 | 字段 |
|---|---|
| 基础信息 | 任务 ID（自动生成，只读）、名称（≤max）、启用开关 |
| 执行计划 | 调度方式（一次性 / 固定频率 / Cron）、执行时间、常用频率、Cron 表达式、时区 |
| 任务内容 | 任务类型（智能体 / 固定文本）、消息内容、智能体指令、执行模型、连接器（多选）、每次新会话 |
| 执行路由 | 目标会话（默认 Dashboard） |
| 发送目标 | 通道、接收用户 ID、会话 ID、发送模式（stream/final） |
| 高级 | 请求会话 ID、请求用户 ID、最大并发、超时秒数、错过容忍秒数 |
| 特殊 | Agent Mail 新邮件：监听邮箱 |

行操作：`立即执行`（L3 确认）、`编辑`、`删除`（L3）、启用/停用（L1）。空态给 3 条示例任务，点击直接填入表单。

### 2.4 Token 统计 `/token-usage`

| 控件 | 行为 |
|---|---|
| 时间范围 | 今天 / 昨天 / 近 7 天 / 近 30 天 / 本月 / 上月 / 全部 / 自定义起止 |
| 维度 | 汇总 / 按天 / 按专家 / 按模型 / 频道 |
| 筛选 | 全部专家、全部用户 |
| 导出 | 导出 Excel（文件名 `Token用量...`） |
| 图表 | 每日趋势、输入/输出对比、频道占比、每周对比 |
| 明细 | 模型调用明细、按轮次聚合、频道明细 |

空态要区分"区间内无记录"和"暂无数据"。

### 2.5 个性化 `/personalization/*`

侧栏/页签：**技能、子智能体、工具、插件、MBTI 人格、记忆**（顺序按权限动态）。

| Tab | 主要按钮 | 配置 |
|---|---|---|
| 技能 | 从市场安装、创建、导入 ZIP/URL、导出 | 已安装/内置/市场；启用开关；展示名称中英文、简短描述 |
| 子智能体 | 新建、安装技能、编辑 | 名称、描述、技能、模型、启用 |
| 工具 | 全选/清空、保存 | 内置工具 + 插件工具；shell 标"需审批" |
| 插件 | 启用/禁用、安装 | 插件列表、权限清单 |
| MBTI | 测试、选择人格 | 16 型人格、说明、当前人格 |
| 记忆 | 搜索、清理、确认草稿 | 原子记忆、主题、来源、待确认 |

### 2.6 通道 `/personalization/channels`

页头：`新建通道`；卡片/表格；每行：状态、机器人前缀、消息数、启用开关、`配置`、`检测连接`、`重连`。

配置抽屉（按类型不同）：

| 类型 | 主要字段 |
|---|---|
| 飞书 | App ID、App Secret、Verification Token、Encrypt Key、机器人前缀 |
| 企业微信 | Bot ID、Secret、扫码/手动配置 |
| QQ | App ID、Token、App Secret、沙箱/正式 |
| 钉钉 | Client ID、Client Secret、机器人 Code |
| Discord | Bot Token、代理 |
| Telegram | Bot Token、代理 |
| 通用 | 启用、消息展示（工具详情/思考过程）、回复方式（仅最终/实时）、默认打开 |

危险操作：删除通道 L3；关闭通道只停收发，不删配置。

### 2.7 连接器 `/connectors`

页签：`我的连接`、`服务目录`、`内置连接器`、`已启用`、`自定义连接器`。

| 区域 | 控件 |
|---|---|
| 页头 | 添加自定义 MCP、浏览服务目录 |
| 服务卡 | 一键授权 / 打开登录页 / 手动粘贴 Token / 高级模式 Cookie |
| 已连接卡 | 启用、默认打开、编辑、删除、检测 |
| 自定义 MCP | 可视化 / JSON 两种模式；HTTP/Stdio；显示名、Server ID、Headers、Args、Env；探测、OAuth 授权、启用、默认打开 |
| 邮箱类 | 邮箱服务商、IMAP/SMTP、授权码、登录授权、检查状态、注销 |
| 飞书用户授权 | App ID/Secret、登录授权、我已授权、重新授权 |

### 2.8 知识库 `/knowledge-bases`

页头：`创建知识库`、`知识库设置`（实例级开关 + 向量模型）。

| 区域 | 控件/字段 |
|---|---|
| 创建/编辑 | 名称、描述、图标、默认启用、共享 |
| 文档 | 上传（拖拽）、新建文件夹/文件、删除、重建索引、预览、下载、全屏、查找、大纲 |
| 检索测试 | 输入问题、TopK、分数、命中切片、引用来源 |
| 设置 | 文档上限、切片大小/重叠、Embedding 模型（本地 ONNX / 在线）、OCR（本地/在线）、重建索引确认 |
| 危险 | 删除知识库（L3）、删除文档（L3）、切换向量模型（L3 + 全量重建提示） |

### 2.9 云端协同 `/bridge`

页头：`添加连接`；卡片/表格；连接卡：状态、对端地址、对端账号、专家/团队数、重连、编辑、断开、删除。

添加表单：显示名、对端地址、对端账号、密码、自动重连、备注；`探测` 先验证账号，`保存并连接` 握手成功才落库。对端接入（inbound）只能改显示信息，不能断开/删除。

### 2.10 工作台 / 远程桌面 / ACP

| 页面 | 主要控件 |
|---|---|
| 工作台 | 终端 / 浏览器两个 Tab；全屏；复制、粘贴、清屏、重启；连接状态 |
| 远程桌面 | 桌面 / 手机；连接、断开、全屏、画质、键鼠、剪贴板、重启 |
| ACP | 内置 Runner 卡（OpenCode/CodeBuddy/Claude Code/Codex/Kimi/Cursor/Pi）；`添加 Runner`；字段：Runner ID、启动命令、参数、环境变量、受信任、工具解析模式、Stdio 缓冲；按专家启用 `acp_runner` |

### 2.11 用户管理 `/admin/users`

页签：**用户管理、角色管理、用户分组**。

| 区域 | 控件 |
|---|---|
| 页头 | 邀请用户、新建用户 |
| 用户表 | 用户名、显示名称、邮箱、账号类型、登录方式、状态、登录锁定、专家数、操作 |
| 行操作 | 重置密码、禁用/启用、解除锁定、删除（不能删自己/不能降级自己） |
| 新建用户 | 用户名、密码、确认密码、显示名称、邮箱、账号类型、角色、头像 |
| 邀请 | 备注、有效天数、创建邀请、复制链接、撤销 |
| 角色 | 新建角色、编辑权限/资源策略、成员数 |
| 分组 | 新建/编辑/删除分组、成员、可用资源（连接器/存储/模型/插件/技能包/知识库/专家） |

### 2.12 模型配置 `/admin/models`

页签：**对话、向量、生成、语音、搜索、决策**。

| 区域 | 控件/字段 |
|---|---|
| 页头 | 添加提供商、搜索、显示更多 |
| 提供商卡 | 已授权/未授权、配置、测试、管理模型、撤销授权、禁用 |
| 配置弹窗 | 接入地址、API Key（留空保持）、Auth Header、Provider Headers、Request Headers、协议（OpenAI/Anthropic）、思考模式 |
| 模型管理 | 添加模型（ID/名称）、移除、搜索、分组使用 |
| 本地模型 | Ollama/ONNX 下载、删除、大小、进度 |
| Embedding | 本地 ONNX / 在线、模型池、维度、探测 |
| 语音/生成/搜索/决策 | 各自的提供商、模型、参数、探测 |

### 2.13 存储管理 `/admin/backend`

页头：`添加存储后端`；分组：本地 / 对象存储 / 沙箱 / 数据库。

| 类型 | 字段 |
|---|---|
| 本地文件系统 | 名称、根目录、超时 |
| 本地 Shell | 名称、超时、环境变量 |
| 腾讯云 COS / S3 / OSS / OBS / 自定义 S3 | 名称、Endpoint、Access Key、Secret Key、Bucket、Region、根目录 |
| PostgreSQL | Host:Port、用户名、密码、数据库、Schema |
| Docker 沙箱 | 镜像、Registry、作用域（agent/user/fixed）、容器名前缀、固定 ID、用户名覆盖 |
| OpenSandbox | 域名、API Key、协议、作用域 |
| 通用 | 备注、高级配置 JSON、探测、浏览、启用 |

### 2.14 插件管理 `/admin/plugins`

`安装插件`、插件表（名称/版本/权限/启用/卸载）、详情抽屉（README、权限、工具、配置）、权限审计。

### 2.15 安全防护 `/admin/security`

页头：`保存全部安全设置`（保存所有页签，运行中专家自动重载）。

页签：

| 页签 | 配置 |
|---|---|
| 工具审批 | 启用开关；需审批工具多选（推荐默认/全选/清空）；IM 需 `/approve`、`/reject` 的警告 |
| 文件访问 | 启用开关；敏感路径 textarea（每行一条，支持 glob） |
| 敏感信息 | 启用 API Key 脱敏；策略：掩码/删除/阻断/哈希 |
| 命令防护 | 启用；动作：阻断（HIGH/CRITICAL）/需审批（含 MEDIUM）/仅记录；规则 YAML 编辑器；保存规则/恢复默认 |
| 技能扫描 | 关闭/警告/拦截 |
| 审计日志 | 时间、事件、主体、结果 |

### 2.16 应用设置 `/admin/advanced`

页签：**环境变量、备份与恢复、HTTPS、应用更新、通行密钥**。

| 页签 | 配置 |
|---|---|
| 环境变量 | KEY/VALUE 表、添加、删除、保存 |
| 备份与恢复 | 立即备份、下载、上传恢复（L4）、自动备份 |
| HTTPS | 域名、证书 PEM、私钥 PEM、检测、保存并重启 |
| 应用更新 | 当前/最新版本、检查更新、立即升级、只更新稳定版、重启服务（L4） |
| 通行密钥 | RP ID、允许的 Origin、登录页显示通行密钥、填入当前站点、保存 |

---

## 3. 按钮分级与禁用规则（Octop 的做法）

| 级别 | 场景 | Octop 表现 |
|---|---|---|
| L1 | 发送、切换 Tab、展开、复制、打开面板 | 立即执行 + 可选 toast |
| L2 | 启用/禁用、保存、测试连接 | 行内 loading + toast；失败保留原值 |
| L3 | 删除任务/通道/文档、停止专家、断开 Bridge | Modal/Popconfirm 二次确认 |
| L4 | 删除用户、关闭 MFA、恢复备份、重启服务 | 重新输入密码或输入名称确认 |

常见禁用条件（原型必须画出来）：

- 没有权限：入口直接不渲染（不是灰掉），或整页 403 空态。
- 运行中：删除/改 ID/改模型禁用，并给 tooltip 说明原因。
- 未配置：测试/探测/启用禁用，先跳配置。
- 达到上限：添加按钮禁用并显示"已达上限（N）"。
- 自己：不能删除自己、不能把自己降级。
- 沙箱：外部 Runner 配置禁用（`outboundBlockedTooltip`）。

---

## 4. PolyOpus 原型对齐清单

已改（本轮）：

- [x] 侧栏 232px 展开：图标 + 文案 + 设置/控制/管理分组；可收起；折叠状态持久化。
- [x] 底部用户区：头像 + `admin` + 管理员；点击弹出文字菜单。
- [x] 用户菜单：外观三态、帮助、项目地址、自定义导航、个人设置、账户安全、检查更新、退出。
- [x] 个人设置页：资料卡、显示名称、页面布局、语言、主题、9 套配色、密度、预览、SSO。
- [x] 新增配置页：个性化、通道、技能、云端协同、ACP、远程桌面、用户管理、模型配置、存储管理、插件管理、安全防护、应用设置。
- [x] 专家编辑抽屉：扩到 9 个分区（基本信息/模型与运行/配置文件/技能/子智能体/工作区/心跳与主动/人格与记忆/版本），见 `23`。
- [x] 连接器：三 Tab（已启用/内置/自定义 MCP）+ 配置抽屉 + 探测/删除确认 + MCP 可视化/JSON，见 `24`。
- [x] 知识库：文档树 + 上传队列 + 表格/视图切换 + 检索测试 + 向量/OCR 设置，见 `24`。
- [x] 所有按钮带文字；纯图标按钮保留 `title`。

仍建议补（按优先级）：

1. **对话页的模型/知识库/连接器菜单**：当前是简化菜单，应补"跟随默认"、搜索、分组、权限说明。
2. **自动化表单**：Cron 只做了主要字段；Octop 的 6 个分区（执行路由、发送目标、高级）还未全做。
3. **空态/错误态/禁用态**：Octop 的"合理"很大程度来自这些状态，当前原型还偏"正常路径"。
4. **i18n**：Octop 有完整 zh/en；当前只有中文，English 只是占位。

---

## 5. 源码索引（方便继续对照）

| 主题 | 文件 |
|---|---|
| 导航项/分组/权限 | `dashboard/src/layouts/sidebarNav.tsx` |
| 侧栏布局/折叠/用户区 | `dashboard/src/layouts/Sidebar.tsx` |
| 用户菜单/设置抽屉/SSO | `dashboard/src/components/AvatarDropdown.tsx` |
| 页面骨架 | `dashboard/src/layouts/PageShell.tsx` |
| 移动端顶栏 | `dashboard/src/layouts/Header.tsx` |
| 路由与旧地址兼容 | `dashboard/src/routes/index.tsx` |
| 中文文案（按钮/字段/空态） | `dashboard/src/locales/zh.json` |
| 模型配置 | `dashboard/src/pages/Settings/Models/**` |
| 安全防护 | `dashboard/src/pages/Settings/Security/**` |
| 存储管理 | `dashboard/src/pages/Admin/Storage/**` |
| 用户/角色/分组 | `dashboard/src/pages/Admin/Users/**` |
| 定时任务 | `dashboard/src/pages/Control/CronJobs/**` |
| 知识库 | `dashboard/src/pages/KnowledgeBases/index.tsx` |
| 连接器 | `dashboard/src/pages/Agent/Connectors/index.tsx` |
| 专家编辑 | `dashboard/src/pages/Experts/components/EditAgentDrawer.tsx` |
| 通道 | `dashboard/src/pages/Agent/Channels/components/ChannelDrawer.tsx` |
| ACP | `dashboard/src/pages/Agent/ACP/**` |
| 应用设置 | `dashboard/src/pages/Settings/AdvancedSettings/**` |

> 说明：本文件是"交互规格"，不是逐行翻译源码。具体字段的校验文案、错误码、接口路径以对应页面源码为准；原型只实现主路径与代表性分支。
