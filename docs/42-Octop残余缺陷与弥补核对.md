# 42 · Octop 残余缺陷与 PolyOpus 弥补核对

> 口径：本地 Octop **1.0.3b4**（`E:\space\my_space\project\Octop`）的代码事实。
> 问题：Octop 还有哪些缺陷；PolyOpus 设计是否已经弥补；哪些仍需补。
> 结论：**12 类结构性问题里，7 类设计已覆盖、3 类只覆盖一半、2 类尚未覆盖。**

---

## 0. 结论先行

| 状态 | 数量 | 说明 |
|---|---:|---|
| ✅ 设计已覆盖 | 13 | 无租户、IM 身份、SSO allowlist、Token 传输、admin 守卫、工具治理、插件权限、知识切片/静默、团队在途 |
| ⚠️ 部分覆盖 | 2 | 记忆幂等、知识评测（均待 spike 验证） |
| ❌ 未覆盖 | 0 | — |

**全部 6 项已补齐（M-01..M-06）**；剩余风险集中在 spike 验证（记忆幂等 S5、知识质量 S5/黄金集）。

---

## 1. 核对矩阵

图例：✅ 设计已覆盖｜⚠️ 部分｜❌ 未覆盖｜🧪 需 spike 验证

| # | Octop 缺陷 | 严重度 | 证据 | PolyOpus 设计 | 状态 |
|---|---|---|---|---|---|
| 1 | 无租户模型，一套实例一个库 | P0 | 全仓无 `tenant_id` 隔离；官方 backlog 也承认 | 全表 `tenant_id` + repo 强制过滤（`TEN-001`） | ✅ |
| 2 | IM 消息归属 Agent owner，群成员共享线程/记忆/用量 | P0 | `message_keys.py:92-107` | `ADM-013`：`source_actor`，不继承 owner | ✅ |
| 3 | SSO 首次登录自动建号，无邮箱域/组 allowlist | P0 | OIDC/OAuth 自动 provisioning；LDAP 有 `allowed_groups`，OIDC 无 | `AUTH-013` + `sso_providers` allowlist + `/admin/sso-providers` | ✅ |
| 4 | 登出不撤 token；token 可放 query | P1 | `auth.py:215-218` 只写审计；`deps.py:99-108` 接受 `access_token` | `AUTH-014`：query token 400 + 登出撤销 refresh family | ✅ |
| 5 | `users` 权限可重置/删除 admin，缺目标角色守卫 | P0 | `users.py:641-653` 无 target admin 检查 | `ADM-012` last-admin + admin 目标二次确认 | ✅ |
| 6 | 工具治理五套并行，过滤只在 prompt 表面 | P0 | catalog/plugin/skill/security/MCP；`ToolsFilterMiddleware` 不改 ToolNode | 单一策略引擎 + 执行期二次校验（`CAP-004`、`ADR-011`） | ✅🧪 |
| 7 | 插件任意 Python，无 permissions/沙箱/签名 | P0 | `plugins/loader.py` 直接 import + `setup(ctx)` | `plugin.yaml` + permissions + 签名 + 子进程（`ADR-011`） | ✅🧪 |
| 8 | 工具调用不写审计 | P1 | 审计以管理动作为主；无 `tool_calls` 审计表 | `tool_calls` 表 + `CAP-002..007` | ✅ |
| 9 | 知识库固定 800/120 字符、每 KB 暴力 cosine、检索异常吞空 | P0 | `chunk.py:6`；`index.py:108`；`retrieve.py:53-56` | 结构切片 + pgvector/BM25 + 失败重试 + 评测（`KB-009/010`） | ✅🧪 |
| 10 | 记忆抽取/召回缓存进程内，重启可能重跑 | P1 | `octop_memory` recall cache 60s；extracted ids LRU | `lease/attempts` + `event_id` 幂等（`13 §4.9`） | ⚠️🧪 |
| 11 | 团队在途任务用进程内 `TeamJobTracker`，重启即丢 | P1 | `teams/jobs.py:1-20` | `delegations` 表 + 租约（`ORG-002`） | ✅ |
| 12 | 多实例只共享部分 PG 数据，无实例注册/缓存失效 | P1 | b3 共享 cron/channel/avatar/plugin；b4 云授权控制面 | `17 T2` 架构图；无 `instances`/失效机制 | ⚠️ |
| 13 | 无数据导出/删除（GDPR 类） | P1 | 无对应端点 | `D-13` 已登记，但 `28/29` 无正式需求/端点 | ❌ |
| 14 | 密钥无轮换/泄露检测 | P2 | `secrets` 加密存储，无 rotation | `secrets.version/rotated_at` 有字段，无流程 | ⚠️ |
| 15 | 提示注入只防了记忆，工具输出/入口未系统设防 | P1 | 记忆 anti-poison；工具输出可进上下文 | 记忆防投毒；未写入口/工具输出防线 | ⚠️ |

---

## 2. 弥补项（M-01..M-06 全部落档）

### M-01 · ✅ 已补：SSO 自动建号 allowlist（P0）

> 已落 `AUTH-013`、`sso_providers` allowlist 字段、`/admin/sso-providers` 端点、`32 §13B` 不变量。

**问题**：OIDC/OAuth 首次登录会按 IdP subject 自动建号；没有邮箱域、租户、组限制，也没有“首登角色固定后不随目录组变化”的策略。

**设计**：

- `sso_providers` 增加 `allowed_email_domains[]`、`allowed_groups[]`、`auto_provision: bool`、`default_role`、`role_sync: none|login`。
- 首登：域/组不匹配 → `SSO_NOT_ALLOWED`，不建号。
- 角色：默认只读/成员；`admin` 必须显式白名单；目录组变化是否同步要写死。
- 审计：`auth.sso_provisioned` / `auth.sso_rejected`。

**落点**：`28 AUTH-010` 扩验收、`29 /auth/sso/*`、`31 sso_providers`。

### M-02 · ✅ 已补：Token 传输与登出（P1）

> 已落 `AUTH-014`、`29 §1.2` query token 禁止、`TOKEN_IN_QUERY` 错误码、`32 §13B` 不变量。

**问题**：`?access_token=` 会进日志/Referer；登出不撤 token。

**设计**：

- 只允许 `Authorization: Bearer` 或 httpOnly+Secure+SameSite cookie；query token **禁止**（400 `TOKEN_IN_QUERY`）。
- 登出撤销 refresh family；access 15min 自然过期；可选 jti 黑名单（短期）。
- 审计 `auth.logout`、`auth.token_rejected`。

**落点**：`02 §8.2`、`28 AUTH-002/003`、`29` 错误码。

### M-03 · ✅ 已补：多实例共享（P1）

**问题**：T2 有 api×2–4 + Redis + scheduler leader，但没有实例注册、配置共享、缓存失效。

**设计**：

- `instances(instance_id, role, version, started_at, last_heartbeat)`。
- 配置/权限/插件变更写 `config_versions`，实例轮询或订阅失效。
- cron 单飞：`lease_token` + leader；错过补跑只补最近一次。
- WS 扇出：Redis pub/sub 或 sticky session；缓存按 tenant+key 失效。

**落点**：`17 T2`、`31` 新表、`32` 端口。

### M-04 · ✅ 已补：数据导出/删除（P1）

> 已落 `28 ADM-015/016`、`31 data_jobs`、`29 /me/export` + `/admin/tenants/{id}`、删除顺序。

**问题**：没有 GDPR 类导出/删除；事件、向量、对象存储、记忆、审计的删除顺序未定义。

**设计**：

- `POST /me/export` → 异步任务，产物 zip（JSONL + artifacts 清单）。
- `DELETE /admin/tenants/{id}` → 软删 → 异步清理：业务行 → 向量 → 对象存储 → 事件归档 → 审计匿名化。
- 审计只匿名化不删除；导出有 TTL。

**落点**：`28 ADM-015`、`29`、`31`、`16`。

### M-05 · ✅ 已补：密钥轮换（P2）

**问题**：有加密字段，无轮换流程。

**设计**：

- `secrets.version` + `rotated_at`；双版本读取，写新版本后旧版本只读。
- 轮换任务每月/泄露时触发；失败告警；审计 `secret.rotated`。
- Provider/connector 密钥与用户密码分离。

**落点**：`02 §8.2`、`31 secrets`、`16`。

### M-06 · ✅ 已补：提示注入三层防线（P1）

**问题**：记忆防投毒有，但入口（IM/网页）、工具输出、知识片段没有统一防线。

**设计**：

1. **入口**：外部内容标记 `untrusted`，不直接进 system prompt。
2. **工具输出**：大内容走 artifact，模型只读摘要 + 引用；不把网页当指令。
3. **记忆/知识**：写入白名单 + 置信阈值 + 来源标记；检索片段带 `source=untrusted`。
4. **策略**：工具执行期校验，不因 prompt 里“已批准”而放行。

**落点**：`02 §5.2/§8.1`、`13 §4.6`、`20` 用例。

---

## 3. 已覆盖、但需要 spike 验证的 4 项

| 项 | 设计覆盖 | 验证 |
|---|---|---|
| 工具执行期二次校验 | `CAP-004`、`ADR-011` | S3 策略 fail-closed |
| 插件子进程/权限 | `ADR-011`、`02 §8.3` | S4 插件沙箱 |
| 知识结构切片/混合检索 | `KB-003/007/009` | S5 + 50 问黄金集 |
| 记忆 lease/幂等 | `13 §4.9` | S5 20 探针 |

---

## 4. 不建议照抄 Octop 的部分

- 不要为了“功能全”保留五套工具治理；PolyOpus 单一策略引擎已更正确。
- 不要把团队/派工做成进程内 tracker；`delegations` 表是底线。
- 不要用固定 800/120 切片和暴力 cosine；即使实现慢，也要保留结构切片与混合检索。
- 不要把 IM 消息归 Agent owner；`source_actor` 是硬约束。
- 不要用“无 grant = 公开”的组可见性；默认 private。

---

## 5. 建议的文档动作

| 动作 | 文档 |
|---|---|
| 新增 `AUTH-013` SSO allowlist / 首登角色 | `28 §2.9.1` |
| 新增 `AUTH-014` 禁止 query token + 登出撤销 | `28 §2.9.1`、`29 §2.1` |
| 新增 `ADM-015` 数据导出/删除 | `28 §2.9.6`、`29 §3.7` |
| 新增 `OPS-004` 密钥轮换 | `28 §2.7`、`31 secrets` |
| 扩 `KB-011` 检索 ACL 顺序 + 静默失败 | `28 §2.6`、`03 §7` |
| 扩 `MEM-009` 抽取幂等 + 缓存失效 | `28 §2.9.3`、`13 §4.9` |
| 多实例补 `instances/config_versions` | `17/31/32` |

> 这些是“设计仍未补齐”的项；建议在 M0 前只补 M-01/M-02 的规格（P0），其余随 M1/M2。

---

## 6. 验收

- [ ] OIDC/OAuth 首登在域/组不匹配时拒绝，不建号
- [ ] `?access_token=` 返回 400，登出撤销 refresh family
- [ ] 跨租户、跨实例、导出/删除均有负向用例
- [ ] 密钥双版本轮换可回滚
- [ ] 工具输出/知识片段带 `untrusted` 标记，不直接当指令
- [ ] S3/S4/S5 通过后，上述“设计已覆盖”项才算真覆盖
