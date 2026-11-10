# 29 · API 与错误码总表

> 目的：把 `contracts/spec/api.py` 从"工单/Attention 两个域"扩展到全产品，形成可生成的 API 契约与稳定错误码。
> 参考 Octop：
> - `ErrorCode(StrEnum)` + `OctopError` 统一异常，5xx 记日志、4xx 本地化；
> - 每个域一个 router，Pydantic body，权限 dependency；
> - 稳定错误码 + `traceId`，前端按 code 分支，不解析 message；
> - 批量操作返回逐项结果，不用一个 500 掩盖部分失败。
>
> 我们额外强化：幂等键、版本冲突（409）、游标分页、SSE 断线恢复、租户隔离。

---

## 1. 基本约定

### 1.1 Base URL

- 当前：`/api`
- 破坏性升级：`/api/v2`
- 非破坏性字段只增不删；删除字段先标 `deprecated` 至少一个 minor。
- 前端通过 `generated/ts/src/api.gen.ts` 使用，不手写 URL。

### 1.2 认证

| 项 | 约定 |
|---|---|
| 登录态 | HttpOnly Cookie `poly_session` 或 `Authorization: Bearer <token>` |
| query token | **禁止**；`?access_token=` 返回 `TOKEN_IN_QUERY` |
| 刷新 | `POST /auth/refresh`，旋转 refresh token |
| CSRF | Cookie 模式必须带 `X-CSRF-Token` |
| 租户 | `X-Tenant-Id`；缺省用当前用户 default tenant |
| 请求追踪 | 服务端生成 `traceId`，响应头 `X-Trace-Id` |
| 客户端版本 | `X-Client-Version`（可选，用于兼容提示） |

### 1.3 响应包络

成功：直接返回资源或列表，不额外包 `data`。

```json
{ "items": [], "nextCursor": "..." }
```

失败：统一错误信封。

```json
{
  "error": {
    "code": "TURN_ACTIVE",
    "message": "当前会话正在生成，请先停止",
    "details": { "turnId": "tn_01..." },
    "traceId": "tr_01..."
  }
}
```

规则：

- `code` 稳定、英文、UPPER_SNAKE；前端只按 code 分支。
- `message` 可本地化，仅用于展示/日志，不用于判断。
- `details` 是结构化补充，不包含密钥。
- `traceId` 必须回传响应头，便于日志关联。

### 1.4 HTTP 状态映射

| HTTP | 语义 | 典型 code |
|---:|---|---|
| 200 | 成功 | — |
| 201 | 创建成功 | — |
| 202 | 已接受（异步） | `TURN_QUEUED` |
| 204 | 无内容 | — |
| 400 | 参数/格式错误 | `VALIDATION_FAILED` |
| 401 | 未认证/过期 | `AUTH_FAILED` / `TOKEN_EXPIRED` |
| 403 | 无权限 | `FORBIDDEN` / `MANDATE_SCOPE_VIOLATION` |
| 404 | 不存在或不可见 | `NOT_FOUND` / `*_NOT_FOUND` |
| 409 | 冲突/重复/版本 | `CONFLICT` / `VERSION_CONFLICT` / `*_TAKEN` |
| 413 | 负载过大 | `PAYLOAD_TOO_LARGE` |
| 415 | 类型不支持 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | 语义校验失败 | `VALIDATION_FAILED` |
| 429 | 限流 | `RATE_LIMITED` |
| 500 | 内部错误 | `INTERNAL_ERROR` |
| 503 | 依赖不可用 | `SERVICE_UNAVAILABLE` |

> 安全：资源存在但无权访问时统一 404 还是 403？
> - 管理端：403（明确权限）
> - 用户资源：404（不泄露存在性）
> - 由 `details.reason=hidden` 标记，不返回资源字段。

---

## 2. 错误码目录

### 2.1 通用

| code | HTTP | 说明 | 前端动作 |
|---|---:|---|---|
| `VALIDATION_FAILED` | 400/422 | 字段校验失败，details.fields | 字段级错误 |
| `NOT_FOUND` | 404 | 资源不存在 | 空态/返回列表 |
| `FORBIDDEN` | 403 | 无权限 | 403 页/请求访问 |
| `UNAUTHORIZED` | 401 | 未登录 | 跳登录 |
| `TOKEN_EXPIRED` | 401 | 登录过期 | 刷新或登录 |
| `CONFLICT` | 409 | 通用冲突 | 提示刷新 |
| `VERSION_CONFLICT` | 409 | 乐观锁冲突，details.currentVersion | 刷新/覆盖 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一幂等键不同请求体 | 提示重试 |
| `RATE_LIMITED` | 429 | 限流，Retry-After | 倒计时 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体/上传超限 | 提示大小 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | 类型不支持 | 提示格式 |
| `SERVICE_UNAVAILABLE` | 503 | 依赖不可用 | 重试 |
| `INTERNAL_ERROR` | 500 | 未预期错误 | 重试/反馈 |

### 2.2 认证 / 租户

| code | HTTP | 说明 |
|---|---:|---|
| `AUTH_FAILED` | 401 | 账号或密码错误（不区分账号是否存在） |
| `LOGIN_LOCKED` | 423 | 登录锁定（5 次失败/15 分钟；带 `Retry-After` 秒数） |
| `USER_DISABLED` | 403 | 用户已禁用 |
| `SETUP_REQUIRED` | 409 | 尚未初始化 |
| `SETUP_ALREADY_DONE` | 409 | 已初始化 |
| `MFA_REQUIRED` | 401 | 需要二次验证 |
| `MFA_INVALID` | 401 | 验证码错误 |
| `EMAIL_INVALID` | 400 | 邮箱格式错误 |
| `USERNAME_TAKEN` | 409 | 用户名占用 |
| `EMAIL_TAKEN` | 409 | 邮箱占用 |
| `TENANT_NOT_FOUND` | 404 | 租户不存在 |
| `TENANT_MISMATCH` | 403 | 资源不属于当前租户 |
| `MEMBERSHIP_REQUIRED` | 403 | 不是租户成员 |
| `INVITE_INVALID` | 400 | 邀请无效 |
| `INVITE_EXPIRED` | 410 | 邀请过期 |
| `INVITE_USED` | 409 | 邀请已使用 |
| `SSO_NOT_ALLOWED` | 403 | 邮箱域/组不在 allowlist，不建号 |
| `SSO_PROVIDER_DISABLED` | 403 | provider 已停用 |
| `TOKEN_IN_QUERY` | 400 | 禁止用 query 传 access token |
| `REAUTH_REQUIRED` | 401 | 敏感操作需要 step-up |

### 2.3 对话 / Turn

| code | HTTP | 说明 |
|---|---:|---|
| `THREAD_NOT_FOUND` | 404 | 会话不存在/不可见 |
| `THREAD_TURN_ACTIVE` | 409 | 已有进行中 Turn |
| `TURN_NOT_FOUND` | 404 | Turn 不存在 |
| `TURN_NOT_CANCELLABLE` | 409 | 已结束/不可停止 |
| `TURN_BUDGET_EXCEEDED` | 402/409 | Token/成本/时长超限 |
| `MESSAGE_NOT_FOUND` | 404 | 消息不存在 |
| `MESSAGE_NOT_EDITABLE` | 409 | 非用户消息/已锁定 |
| `STEER_NOT_FOUND` | 404 | 插话已消费/撤回 |
| `STEER_REJECTED` | 409 | 当前阶段不可插入 |
| `ATTACHMENT_TOO_LARGE` | 413 | 附件超限 |
| `ATTACHMENT_UNSUPPORTED_TYPE` | 415 | 附件类型不支持 |
| `CONTEXT_OVERFLOW` | 409 | 上下文超限，需压缩 |
| `MODEL_NOT_AVAILABLE` | 503 | 模型不可用 |
| `MODEL_RATE_LIMITED` | 429 | 上游限流 |

### 2.4 审批 / Attention

| code | HTTP | 说明 |
|---|---:|---|
| `ATTENTION_NOT_FOUND` | 404 | 待决项不存在 |
| `ATTENTION_ALREADY_RESOLVED` | 409 | 已被处理 |
| `ATTENTION_EXPIRED` | 410 | 已过期 |
| `ATTENTION_FORBIDDEN` | 403 | 无权处理 |
| `DECISION_INVALID` | 400 | decision 不合法 |

### 2.5 任务 / Intake

| code | HTTP | 说明 |
|---|---:|---|
| `TICKET_NOT_FOUND` | 404 | 任务不存在 |
| `TICKET_ENDED` | 409 | 已结束 |
| `ASSIGNMENT_NOT_RUNNING` | 409 | 没有运行中的 Assignment |
| `ASSIGNMENT_LEASE_LOST` | 409 | 租约失效 |
| `BUDGET_EXCEEDED` | 402/409 | 预算超限 |
| `MERGE_SELF` | 400 | 不能合并到自己 |
| `MERGE_CONFLICT` | 409 | 合并目标状态不允许 |
| `MANDATE_SCOPE_VIOLATION` | 403 | 超出 Mandate |
| `SOURCE_NOT_FOUND` | 404 | Source 不存在 |
| `SOURCE_PAUSED` | 409 | Source 已暂停 |
| `TRIGGER_DUPLICATE` | 409 | 重复 Trigger（幂等返回已有 Ticket） |
| `GATE_FILTERED` | 200 | 被 Gate 过滤（记录 disposition，不报错） |
| `ASSESSMENT_UNAVAILABLE` | 503 | Assessment 暂不可用，已重排 |

### 2.6 专家 / 能力

| code | HTTP | 说明 |
|---|---:|---|
| `AGENT_NOT_FOUND` | 404 | 专家不存在 |
| `AGENT_NAME_TAKEN` | 409 | 名称占用 |
| `AGENT_ID_INVALID` | 400 | ID 格式非法 |
| `AGENT_ID_TAKEN` | 409 | ID 占用 |
| `AGENT_BUSY` | 409 | 运行中不可改 |
| `AGENT_NOT_RUNNING` | 409 | 未运行，无法停止 |
| `AGENT_VERSION_LOCKED` | 409 | 版本已发布不可改 |
| `EXPERT_TEMPLATE_NOT_FOUND` | 404 | 模板不存在 |
| `TOOL_NOT_ALLOWED` | 403 | 工具不在 Mandate |
| `TOOL_APPROVAL_REQUIRED` | 409 | 需要审批 |

### 2.7 连接器 / 扩展

| code | HTTP | 说明 |
|---|---:|---|
| `CONNECTOR_NOT_FOUND` | 404 | 实例不存在 |
| `CONNECTOR_NAME_TAKEN` | 409 | 名称占用 |
| `CONNECTOR_INVALID_CREDENTIALS` | 400 | 凭证无效 |
| `CONNECTOR_OAUTH_HTTPS_REQUIRED` | 400 | OAuth 必须 HTTPS |
| `CONNECTOR_OAUTH_STATE_INVALID` | 400 | state 无效/过期 |
| `CONNECTOR_OAUTH_DENIED` | 403 | 用户拒绝授权 |
| `CONNECTOR_NOT_BOUND` | 409 | 未绑定 |
| `CONNECTOR_ALREADY_BOUND` | 409 | 已绑定 |
| `CONNECTOR_MCP_URL_INVALID` | 400 | MCP URL 非法 |
| `CONNECTOR_MCP_LOAD_FAILED` | 502 | MCP 加载失败 |
| `CONNECTOR_REFERENCED` | 409 | 被专家引用，不能删 |
| `PLUGIN_INVALID_ARCHIVE` | 400 | 插件包损坏 |
| `PLUGIN_ALREADY_EXISTS` | 409 | 已安装 |
| `PLUGIN_INSTALL_FAILED` | 500 | 安装失败 |
| `PLUGIN_SIGNATURE_INVALID` | 403 | 签名校验失败 |
| `SKILL_ALREADY_EXISTS` | 409 | 技能已存在 |
| `SKILL_IMPORT_FAILED` | 400 | 技能导入失败 |
| `SKILL_PACKAGE_NOT_FOUND` | 404 | 技能包不存在 |
| `SKILL_PACKAGE_LOCKED` | 409 | 被引用不可删 |

### 2.8 知识库

| code | HTTP | 说明 |
|---|---:|---|
| `KB_NOT_FOUND` | 404 | 知识库不存在 |
| `KB_FORBIDDEN` | 403 | 无权限 |
| `KB_NAME_TAKEN` | 409 | 名称占用 |
| `KB_NAME_INVALID` | 400 | 名称非法 |
| `KB_PREREQUISITES_FAILED` | 503 | 向量/OCR 依赖不可用 |
| `KB_NOT_READY` | 409 | embedding 后端/凭证/维度未就绪（返回缺什么），开启与建库前校验 |
| `KB_DOC_LIMIT` | 409 | 文档数超限 |
| `KB_DOC_TOO_LARGE` | 413 | 单文件超限 |
| `KB_UNSUPPORTED_TYPE` | 415 | 类型不支持 |
| `KB_DOC_PARSE_FAILED` | 500 | 解析失败 |
| `KB_REINDEX_IN_PROGRESS` | 409 | 正在重建 |
| `KB_SEARCH_FAILED` | 503 | 检索失败 |

### 2.9 用量 / 管理 / 运维

| code | HTTP | 说明 |
|---|---:|---|
| `QUOTA_EXCEEDED` | 402 | 配额超限 |
| `TOKEN_QUOTA_EXCEEDED` | 402 | Token 配额超限 |
| `PROVIDER_NAME_TAKEN` | 409 | 提供商名占用 |
| `PROVIDER_INVALID` | 400 | 配置无效 |
| `PROVIDER_REFERENCED` | 409 | 被模型引用 |
| `STORAGE_BACKEND_NAME_TAKEN` | 409 | 存储名占用 |
| `STORAGE_BACKEND_REFERENCED` | 409 | 被专家引用 |
| `STORAGE_PROBE_FAILED` | 502 | 探测失败 |
| `USER_ROLE_IN_USE` | 409 | 角色被使用 |
| `USER_ROLE_ID_TAKEN` | 409 | 角色 ID 占用 |
| `ENV_INVALID` | 400 | 环境变量格式错误 |
| `ENV_KEY_TAKEN` | 409 | 变量重复 |
| `BACKUP_IN_PROGRESS` | 409 | 备份进行中 |
| `BACKUP_SCHEMA_INCOMPATIBLE` | 409 | 备份版本不兼容 |
| `TLS_DOMAIN_MISMATCH` | 400 | 证书域名不匹配 |
| `UPDATE_TARGET_NOT_NEWER` | 409 | 目标版本不更新 |
| `AUDIT_READONLY` | 403 | 审计日志不可改 |

### 2.10 记忆 / 通知

| 错误码 | HTTP | 说明 |
|---|---|---|
| `MEMORY_NOT_FOUND` | 404 | 记忆不存在 |
| `MEMORY_CONFLICT` | 409 | 与现有记忆冲突，需复核 |
| `MEMORY_WRITE_PAUSED` | 409 | 用户暂停了记忆写入 |
| `MEMORY_EXPORT_FAILED` | 500 | 导出失败 |
| `NOTIFICATION_NOT_FOUND` | 404 | 通知不存在 |
| `NOTIFICATION_ALREADY_READ` | 200/幂等 | 已读重复操作，返回当前状态 |

### 2.11 渠道 / 控制面

| 错误码 | HTTP | 说明 |
|---|---|---|
| `CHANNEL_AUTH_FAILED` | 401 | 渠道凭证无效 |
| `CHANNEL_PROBE_FAILED` | 502 | 探测失败（上游不可达） |
| `CHANNEL_DUPLICATE` | 409 | 渠道名/外部键重复 |
| `CONTROL_SESSION_NOT_FOUND` | 404 | 会话不存在 |
| `CONTROL_TERMINAL_DISABLED` | 403 | 终端未启用 |
| `CONTROL_SESSION_UNAVAILABLE` | 409 | 会话已关闭/不可接管 |

### 2.12 团队 / 云主机

| 错误码 | HTTP | 说明 |
|---|---|---|
| `TEAM_MEMBER_BUSY` | 409 | 成员有在途派工，不能移除 |
| `DELEGATION_CONFLICT` | 409 | dedupe_key 冲突 |
| `CLOUD_NOT_AUTHORIZED` | 401 | 未授权云账号 |
| `CLOUD_CREDENTIAL_EXPIRED` | 401 | 云凭证过期 |
| `CLOUD_PROVIDER_UNSUPPORTED` | 400 | 不支持的云厂商 |
| `CLOUD_ACTION_FAILED` | 502 | 云侧操作失败 |

---

## 3. 端点目录

> 仅列 v1 必需端点。`{id}` 为 ULID；列表默认 `limit=30`，最大 100。

### 3.1 Auth / Tenant / User

| Method | Path | 说明 | 权限 |
|---|---|---|---|
| POST | `/auth/login` | 密码登录 | public |
| POST | `/auth/refresh` | 刷新 token | session |
| POST | `/auth/logout` | 退出 | session |
| GET | `/auth/me` | 当前用户/租户/权限 | session |
| POST | `/setup` | 初始化首个管理员 | public（仅空库） |
| POST | `/auth/mfa/totp/enroll` | 开始 TOTP 绑定 | session |
| POST | `/auth/mfa/totp/verify` | 校验并启用 | session |
| DELETE | `/auth/mfa/{method}` | 关闭 TOTP/WebAuthn | session |
| GET | `/auth/mfa/webauthn/challenge` | WebAuthn 注册挑战 | session |
| POST | `/auth/mfa/webauthn/register` | 完成 WebAuthn 注册 | session |
| GET | `/auth/providers` | 可用 SSO provider | public |
| POST | `/auth/sso/start` | 发起 SSO 跳转 | public |
| POST | `/auth/sso/callback` | 换 token | public |
| POST | `/auth/ldap/login` | LDAP/AD 登录 | public |
| POST | `/auth/reauth` | 敏感操作 step-up（5 分钟） | session |
| GET | `/me/api-keys` | 我的 API Key | session |
| POST | `/me/api-keys` | 创建（密钥仅显示一次） | session |
| DELETE | `/me/api-keys/{keyId}` | 撤销 | session |
| GET | `/me/sessions` | 登录设备列表 | session |
| DELETE | `/me/sessions/{sessionId}` | 下线设备 | session |
| POST | `/me/export` | 导出我的数据（异步任务） | session |
| GET | `/me/export/{jobId}` | 导出进度/下载链接 | session |
| GET | `/me/tenants` | 我的租户 | session |
| GET | `/users` | 用户列表 | `user:read` |
| POST | `/users` | 创建用户 | `user:write` |
| PATCH | `/users/{userId}` | 修改角色/状态/昵称 | `user:write` |
| DELETE | `/users/{userId}` | 删除（不可删自己） | `user:write` |
| POST | `/users/{userId}/reset-password` | 重置并返回临时密码 | `user:write` |
| POST | `/users/batch` | 批量启停/删除 | `user:write` |
| POST | `/users/import` | CSV 导入（dry-run + 逐项失败） | `user:write` |
| GET | `/invites` | 邀请列表，`status` | `user:invite` |
| POST | `/invites` | 创建邀请（邮箱/角色/有效期） | `user:invite` |
| POST | `/invites/accept` | 接受邀请（public） | public |
| GET | `/invites/{token}` | 邀请预览（public） | public |
| DELETE | `/invites/{inviteId}` | 撤销邀请 | `user:invite` |
| GET | `/roles` | 角色列表 | `role:read` |
| POST | `/roles` | 创建角色 | `role:write` |
| GET | `/roles/{roleId}` | 角色详情/权限矩阵 | `role:read` |
| PATCH | `/roles/{roleId}` | 修改权限 | `role:write` |
| DELETE | `/roles/{roleId}` | 删除自定义角色 | `role:write` |
| GET | `/groups` | 分组列表 | `group:read` |
| POST | `/groups` | 创建分组 | `group:write` |
| GET | `/groups/{groupId}` | 分组详情/成员 | `group:read` |
| PATCH | `/groups/{groupId}` | 修改分组 | `group:write` |
| DELETE | `/groups/{groupId}` | 删除分组 | `group:write` |
| POST | `/groups/{groupId}/members` | 替换成员集合 | `group:write` |
| DELETE | `/groups/{groupId}/members/{userId}` | 移除成员 | `group:write` |

### 3.2 对话 / 事件

| Method | Path | 说明 |
|---|---|---|
| GET | `/threads` | 会话列表，`q/sort/cursor` |
| POST | `/threads` | 新建会话 |
| GET | `/threads/{id}` | 会话详情 |
| PATCH | `/threads/{id}` | 重命名/置顶 |
| DELETE | `/threads/{id}` | 删除（软删） |
| POST | `/threads/{id}/read` | 清除未读（幂等） |
| GET | `/threads/{id}/messages` | 历史消息，`before/after/limit` |
| POST | `/threads/{id}/turns` | 发送消息，幂等键 |
| GET | `/threads/{id}/events` | SSE，`after_seq`/Last-Event-ID |
| GET | `/turns/{turnId}/runs` | 执行尝试列表 |
| GET | `/runs/{runId}/steps` | Run 的步骤 |
| GET | `/turns/{turnId}/trace` | Turn + Runs 回放 |
| POST | `/turns/{id}/stop` | 停止 |
| POST | `/turns/{id}/steer` | 插话 |
| DELETE | `/turns/{id}/steer/{steerId}` | 撤回插话 |
| POST | `/messages/{id}/edit-resend` | 编辑重发 |
| POST | `/turns/{id}/regenerate` | 重新生成 |
| POST | `/attachments` | 上传（multipart） |
| GET | `/attachments/{id}` | 下载（权限校验） |

### 3.3 Ticket / Attention / Intake

| Method | Path | 说明 |
|---|---|---|
| GET | `/tickets` | 列表，bucket/source/executor/q/sort/cursor |
| GET | `/tickets/counts` | 各 bucket 计数 |
| GET | `/tickets/{id}` | 详情 |
| POST | `/tickets/{id}/stop` | 停止 |
| POST | `/tickets/{id}/assign` | 改派 |
| POST | `/tickets/{id}/budget` | 调预算 |
| POST | `/tickets/{id}/merge` | 合并 |
| GET | `/tickets/{id}/reports` | 报告 |
| GET | `/tickets/{id}/timeline` | 时间线 |
| GET | `/attentions` | 待决列表 |
| POST | `/attentions/{id}/answer` | 回答/批准/拒绝 |
| GET | `/sources` | 来源列表 |
| POST | `/sources` | 新建来源 |
| POST | `/sources/{id}/pause` | 暂停 |
| GET | `/triggers` | 触发记录 |
| POST | `/cron-jobs` | 定时任务 |

### 3.4 专家 / 版本 / 工作区

| Method | Path | 说明 |
|---|---|---|
| GET | `/agents` | 列表 |
| POST | `/agents` | 创建 |
| GET | `/agents/{id}` | 详情 |
| PATCH | `/agents/{id}` | 更新草稿 |
| DELETE | `/agents/{id}` | 删除 |
| GET/PUT | `/agents/{id}/files/{name}` | 配置文件 |
| GET/PUT | `/agents/{id}/skills` | 技能绑定 |
| GET/PUT | `/agents/{id}/subagents` | 子智能体 |
| GET | `/agents/{id}/workspace` | 文件列表 |
| POST | `/agents/{id}/workspace/upload` | 上传 |
| POST | `/agents/{id}/publish` | 发布版本 |
| GET | `/experts` | 专家模板库 |
| POST | `/agents/from-template` | 从模板创建 |
| POST | `/agents/{id}/rollback` | 回滚 |
| POST | `/agents/{id}/test` | 试运行 |

### 3.5 连接器 / 扩展

| Method | Path | 说明 |
|---|---|---|
| GET | `/connectors/catalog` | 目录，`q/category` |
| GET | `/connectors/instances` | 实例列表 |
| POST | `/connectors/instances` | 创建实例 |
| PATCH | `/connectors/instances/{id}` | 修改 |
| DELETE | `/connectors/instances/{id}` | 删除 |
| POST | `/connectors/instances/{id}/probe` | 测试 |
| POST | `/connectors/oauth/start` | 发起 OAuth |
| GET | `/connectors/oauth/pending/{state}` | 轮询 |
| GET | `/connectors/oauth/callback` | 回调 |
| GET | `/plugins` | 插件列表 |
| POST | `/plugins/{id}/install` | 安装 |
| PATCH | `/plugins/{id}` | 启停/更新 |
| DELETE | `/plugins/{id}` | 卸载 |
| GET | `/skill-packages` | 技能包 |
| POST | `/skill-packages/{id}/install` | 安装 |
| PATCH | `/skill-packages/{id}` | 更新/启停 |

### 3.6 知识库

| Method | Path | 说明 |
|---|---|---|
| GET | `/knowledge-bases` | 列表 |
| POST | `/knowledge-bases` | 创建 |
| PATCH | `/knowledge-bases/{id}` | 设置 |
| DELETE | `/knowledge-bases/{id}` | 删除 |
| GET | `/knowledge-bases/{id}/docs` | 文档列表，`q/folder/cursor` |
| POST | `/knowledge-bases/{id}/docs` | 上传（multipart） |
| GET | `/knowledge-docs/{id}` | 文档详情 |
| GET | `/knowledge-docs/{id}/preview` | 预览 URL |
| POST | `/knowledge-docs/{id}/reindex` | 重建 |
| POST | `/knowledge-bases/{id}/reindex-all` | 全量重建 |
| DELETE | `/knowledge-docs/{id}` | 删除 |
| POST | `/knowledge-docs/batch` | 批量重建/删除 |
| POST | `/knowledge-bases/{id}/search` | 检索测试 |

### 3.7 用量 / 管理 / 运维

| Method | Path | 说明 |
|---|---|---|
| GET | `/usage/summary` | 总览，`window/granularity/as_user/agent_id` |
| GET | `/usage/export` | CSV/XLSX |
| GET | `/admin/providers` | 提供商 |
| POST | `/admin/providers` | 新增 |
| PATCH | `/admin/providers/{id}` | 修改 |
| POST | `/admin/providers/{id}/test` | 测试 |
| GET/POST | `/admin/storage` | 存储后端 |
| GET/PATCH | `/admin/security` | 安全设置/规则 |
| GET/POST | `/admin/sso-providers` | SSO provider 列表/创建（含 allowlist/首登角色） |
| PATCH | `/admin/sso-providers/{providerId}` | 修改 SSO provider |
| GET/PUT | `/admin/settings` | 应用设置 |
| GET | `/admin/backup` | 备份列表 |
| GET | `/admin/backup/status` | 是否有备份/恢复进行中 |
| GET | `/admin/backup/auto` | 自动备份设置 |
| PUT | `/admin/backup/auto` | 修改自动备份（间隔/保留数/包含项） |
| POST | `/admin/backup/auto/run` | 立即运行一次自动备份 |
| POST | `/admin/backup` | 手动创建（含 manifest 可选包含项） |
| POST | `/admin/backup/import` | 上传备份包 |
| DELETE | `/admin/backup/{backupId}` | 删除备份 |
| POST | `/admin/backup/{backupId}/restore` | 恢复（先校验和 + schema 版本检查） |
| GET | `/admin/overview` | 系统概览/队列/错误率/成本 |
| GET | `/admin/quotas` | 三层配额列表 |
| PATCH | `/admin/quotas/{quotaId}` | 修改配额上限 |
| GET | `/admin/audit` | 审计日志 |
| GET | `/admin/audit/export` | 审计导出 CSV/JSON |
| DELETE | `/admin/tenants/{tenantId}` | 删除租户（二次确认 + 名称校验） |
| GET | `/admin/data-jobs/{jobId}` | 导出/删除任务进度 |
| GET | `/admin/instances` | 实例列表/角色/心跳（v1.1） |
| GET | `/admin/config-versions` | 各 scope 当前版本（v1.1） |
| GET | `/admin/model-prices` | 价格表（按模型/币种，当前版本） |
| PUT | `/admin/model-prices` | 价格 upsert（自动升 version） |
| POST | `/admin/secrets/{secretId}/rotate` | 密钥轮换（双版本） |
| GET | `/tool-labels` | 工具显示名（按 locale） |
| GET | `/skill-labels` | 技能显示名（按 locale） |
| GET | `/health` | 健康检查 |

### 3.8 记忆 / 上下文

| Method | Path | 说明 |
|---|---|---|
| GET | `/memories` | 列表，`kind/status/source/cursor` |
| POST | `/memories` | 显式写入（白名单来源） |
| GET | `/memories/search` | 检索，`q/limit` |
| GET | `/memories/export` | 导出 JSONL/JSON |
| POST | `/memories/pause` | 暂停/恢复写入，`{paused,until}` |
| GET | `/memories/{memoryId}` | 详情（含证据） |
| PATCH | `/memories/{memoryId}` | 纠错/退休，生成新版本 |
| DELETE | `/memories/{memoryId}` | 删除（审计） |
| GET | `/threads/{threadId}/context` | 上下文预算构成 |
| POST | `/threads/{threadId}/compact` | 触发压缩，返回前后 token |
| GET | `/admin/memory-metrics` | 命中率/矛盾率/陈旧率/污染率 |

### 3.9 渠道（v1.1）

| Method | Path | 说明 |
|---|---|---|
| GET | `/channels` | 账号列表，`kind/status` |
| POST | `/channels` | 创建账号（凭证加密） |
| PATCH | `/channels/{channelId}` | 修改配置/启停 |
| DELETE | `/channels/{channelId}` | 删除 |
| POST | `/channels/{channelId}/probe` | 探测并返回缺失凭证 |
| GET | `/channel-bindings` | 绑定列表，`channelId/agentId` |
| POST | `/channel-bindings` | 绑定 Agent |
| PATCH | `/channel-bindings/{bindingId}` | 群聊/@ 规则 |
| GET | `/channel-messages` | 入站/出站调试，`channelId/threadId/status` |

### 3.10 工具 / 策略

| Method | Path | 说明 |
|---|---|---|
| GET | `/tools` | 工具注册表，`source/risk/q` |
| PATCH | `/tools/{toolKey}` | 全局启停 |
| GET | `/agents/{agentId}/tools` | 逐 Agent 绑定 |
| PATCH | `/agents/{agentId}/tools` | 替换绑定集合 |
| GET | `/admin/policies` | 策略规则列表 |
| POST | `/admin/policies` | 新建规则 |
| PATCH | `/admin/policies/{ruleId}` | 修改规则 |
| DELETE | `/admin/policies/{ruleId}` | 删除规则 |
| POST | `/admin/policies/evaluate` | 干跑求值（测试用） |
| POST | `/connectors/openapi/import` | OpenAPI → 工具 |

### 3.11 团队 / 派工（v1.1）

| Method | Path | 说明 |
|---|---|---|
| GET | `/teams` | 团队列表，`status/q` |
| POST | `/teams` | 创建团队（协调者 + 成员） |
| GET | `/teams/{teamId}` | 团队详情（含成员与忙碌态） |
| PATCH | `/teams/{teamId}` | 修改设置 |
| DELETE | `/teams/{teamId}` | 删除团队 |
| POST | `/teams/{teamId}/members` | 添加成员 |
| DELETE | `/teams/{teamId}/members/{agentId}` | 移除成员 |
| POST | `/teams/{teamId}/stop` | `{scope: coordinator\|room}` |
| GET | `/delegations` | 派工列表，`teamId/state/memberAgentId` |
| POST | `/delegations` | 派工（dedupe_key 幂等） |
| POST | `/delegations/{delegationId}/retry` | 失败/死信重派 |

### 3.12 控制面（终端 / 浏览器，v1.1）

| Method | Path | 说明 |
|---|---|---|
| GET | `/control/sessions` | 会话列表，`kind/status` |
| POST | `/control/sessions` | 新建终端/浏览器会话 |
| GET | `/control/sessions/{sessionId}` | 会话详情 |
| DELETE | `/control/sessions/{sessionId}` | 关闭（终止进程/浏览器） |
| POST | `/control/sessions/{sessionId}/takeover` | 接管浏览器 |
| GET | `/control/sessions/{sessionId}/stream` | 领取实时流 ticket（webrtc/jpeg/ws） |
| POST | `/control/sessions/{sessionId}/input` | 终端输入/尺寸调整 |

### 3.13 定时任务

| Method | Path | 说明 |
|---|---|---|
| GET | `/cron-jobs` | 列表，`enabled/q` |
| POST | `/cron-jobs` | 创建（cron/interval/date） |
| GET | `/cron-jobs/{jobId}` | 详情与下次运行 |
| PATCH | `/cron-jobs/{jobId}` | 修改/启停 |
| DELETE | `/cron-jobs/{jobId}` | 删除 |
| POST | `/cron-jobs/{jobId}/run-now` | 立即执行一次 |
| GET | `/cron-jobs/{jobId}/runs` | 运行历史 |

### 3.14 云主机（v1.1）

| Method | Path | 说明 |
|---|---|---|
| GET | `/cloud/status` | 授权状态与账号摘要 |
| POST | `/cloud/authorize` | 发起云授权（跳转 URL + state） |
| POST | `/cloud/callback` | 换取凭证 |
| POST | `/cloud/accounts/import` | 从本机 CLI profile 导入 |
| POST | `/cloud/accounts/{accountId}/refresh` | 续期 |
| DELETE | `/cloud/accounts/{accountId}` | 退出授权 |
| GET | `/cloud/regions` | 地域/可用区 |
| GET | `/cloud/instances` | 实例列表，`accountId/region/state/q` |
| GET | `/cloud/instances/{instanceId}/metrics` | 单实例指标 |
| POST | `/cloud/metrics/batch` | 批量指标 |
| POST | `/cloud/metrics/cluster-trend` | 集群趋势 |
| POST | `/cloud/instances/{instanceId}/action` | start/stop/reboot |

> 首版只支持腾讯云 CVM；`provider` 字段保留扩展。所有 action 先写 `cloud_ops` 再调云 API。

### 3.15 资源 ACL

| Method | Path | 说明 |
|---|---|---|
| GET | `/groups/{groupId}/grants` | 分组授权列表，`resourceType` |
| POST | `/groups/{groupId}/grants` | 给分组授予资源（view/edit/manage） |
| DELETE | `/groups/{groupId}/grants/{grantId}` | 撤销授权 |
| POST | `/groups/{groupId}/grants/batch` | 批量授权，逐项失败 |
| GET | `/resources/{resourceType}/{resourceKey}/access` | “为什么能/不能访问”诊断 |

> `visibility=private|team|tenant|public` 决定默认受众；grant 是附加放行，**无 grant 不等于公开**。
> `effect` 默认 allow（v1 预留 deny）；`expires_at` 到期自动失效；grant 变更需失效权限缓存并写审计。

### 3.16 通知

| Method | Path | 说明 |
|---|---|---|
| GET | `/notifications` | 我的通知，`unreadOnly/cursor/limit` |
| POST | `/notifications/{notificationId}/read` | 单条已读（幂等） |
| POST | `/notifications/read-all` | 全部已读（幂等） |

> 站内为真相；Web Push 只是投递通道。通知与 Attention 分开：通知只告知，Attention 需要人决策。

---

## 4. 分页 / 排序 / 搜索

- 游标分页：`cursor` 为 opaque base64；返回 `nextCursor`，末尾为 `null`。
- `limit` 默认 30，最大 100；超过返回 400。
- 排序：`sort=field` 或 `-field`；白名单由端点定义，非法字段 400。
- 搜索：`q` 做 trim，最长 200；禁止把 `%`/`_` 直接拼 SQL。
- 时间：ISO-8601 UTC 字符串；数据库存 epoch ms。
- 空结果返回 `200 {items: [], nextCursor: null}`，不返回 404。

---

## 5. 幂等与并发

### 5.1 幂等键

以下写操作要求 `Idempotency-Key`（UUID/ULID）：

- `POST /threads/{id}/turns`
- `POST /attentions/{id}/answer`
- `POST /connectors/oauth/start`
- `POST /admin/backup`
- 批量操作

规则：

1. 同 key + 同 body：返回首次响应（24h）。
2. 同 key + 不同 body：409 `IDEMPOTENCY_CONFLICT`。
3. 处理中：409 `CONFLICT` + `Retry-After: 1`。
4. 服务端表 `idempotency_keys(key, user_id, route, request_hash, response_json, expires_at)`。

### 5.2 乐观锁

- 资源带 `version`；更新必须 `If-Match: "<version>"` 或 body `version`。
- 不匹配：409 `VERSION_CONFLICT`，`details.currentVersion`。
- 前端弹冲突弹窗：刷新 / 覆盖（覆盖需二次确认）。
- 覆盖 = 重新提交并带 `force=true`，服务端审计记录。

---

## 6. SSE 事件流

`GET /threads/{id}/events?after_seq=123`

```
id: 124
event: message.delta
data: {"seq":124,"type":"message.delta","threadId":"th_...","turnId":"tn_...","delta":"..."}
```

规则：

- `id` 即 `seq`；客户端重连带 `Last-Event-ID`。
- 心跳每 15s `: ping`。
- 事件可重复投递，客户端按 `(threadId, seq)` 去重。
- 断线重连从 `after_seq` 回放；超过保留窗口返回 `409 EVENT_GAP`，客户端拉快照。
- 慢消费者：服务端合并 delta，带 `coalesced:true`；不无限缓冲。
- 关闭：`event: stream.closed`。

---

## 7. 权限作用域

| scope | 覆盖 |
|---|---|
| `chat:read` / `chat:write` | 会话、消息、Turn |
| `ticket:read` / `ticket:write` | 任务、停止、改派、预算、合并 |
| `attention:write` | 审批/提问 |
| `agent:read` / `agent:write` | 专家、版本、发布 |
| `connector:read/write` | 连接器/实例/OAuth |
| `knowledge:read/write` | 知识库/文档/检索 |
| `extension:read/write` | 插件/技能包 |
| `memory:read` / `memory:write` / `memory:export` | 记忆原子、纠错、导出、暂停写入 |
| `channel:read` / `channel:write` | 渠道账号、绑定、探测、消息调试 |
| `tool:read` / `tool:write` | 工具注册表、逐 Agent 绑定 |
| `policy:read` / `policy:write` | 策略规则、干跑求值 |
| `team:read` / `team:write` / `team:stop` | 团队、成员、派工、停止 |
| `control:read` / `control:write` | 终端/浏览器会话、接管、输入 |
| `cron:read` / `cron:write` | 定时任务与运行历史 |
| `cloud:read` / `cloud:write` / `cloud:operate` | 云账号、实例、指标、启停/重启 |
| `group:read` / `group:write` / `group:grant` | 分组、成员、资源授权 |
| `usage:read` | 用量 |
| `admin` | 用户/模型/存储/安全/设置/审计 |
| `audit:read` | 审计 |

只读审计角色：`chat:read,ticket:read,knowledge:read,memory:read,usage:read,audit:read`，无 `write`。

---

## 8. 批量与部分失败

批量端点返回逐项结果，HTTP 200：

```json
{
  "results": [
    {"id":"u1","ok":true},
    {"id":"u2","ok":false,"code":"USER_ROLE_IN_USE","message":"..."}
  ],
  "succeeded":1,"failed":1
}
```

- 不允许一个失败导致整批 500。
- 失败项带稳定 code，前端可重试单条。
- 批量删除必须确认，最多 500 条。

---

## 9. 与 Octop 的差异

| 项 | Octop | PolyOpus |
|---|---|---|
| 错误码 | `ErrorCode` + `OctopError` | 保留，增加 `VERSION_CONFLICT`/`IDEMPOTENCY_CONFLICT`/`EVENT_GAP` |
| 分页 | 部分 cursor | 全列表统一 cursor + limit |
| 并发 | 多为 last-write-wins | 乐观锁 + 409 冲突弹窗 |
| 流式 | WS/SSE | SSE 主，保留 WS 适配 |
| 多租户 | 单实例用户 | 全表 tenant_id，X-Tenant-Id |
| 批量 | 部分 batch | 统一逐项结果 |
| 契约 | Pydantic/OpenAPI | 从 `contracts/spec` 生成 OpenAPI/TS/Python |

---

## 10. 生成与校验

当前契约覆盖（2026-11）：**M0/M1 36 个 + 记忆/渠道/工具 30 个 + 团队/控制 18 个 + 认证扩展/定时 21 个 + 用户/邀请/角色/分组 23 个 + 任务中心 11 个 + step-up 1 个 + 云主机 12 个 + 资源 ACL 5 个 + 通知 3 个 + 管理端 7 个 = 188 个操作**，148 条路径、229 个 schema。
Tags：`auth` `agents` `threads` `turns` `attachments` `sources` `health` `memory` `channels` `tools` `teams` `control` `cron` `users` `invites` `roles` `groups` `cloud` `notifications` `admin` `audit` `tickets` `attentions`。
§3 目录共 242 个端点：**188 已进契约**，其余 56 个在 `contracts/coverage_allowlist.json` 明列（连接器/知识库/管理端等）；新增端点必须先改 spec。

```bash
python contracts/generate.py
python contracts/check.py
python contracts/runtime_check.py
```

CI 必须：

1. spec 模型/Ops 引用完整；
2. OpenAPI 可生成且无 broken `$ref`；
3. TS/Python 生成物与 spec 同步；
4. 错误码在本文与 `ErrorCode` 枚举中一致；
5. 每个 `MUST` 端点至少一个契约测试。
