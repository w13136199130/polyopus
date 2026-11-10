# 18 · 从 Octop 迁移

> 目标：把 Octop 实例里的**用户资产**（人、专家、知识、记忆、渠道、历史）搬到 PolyOpus，且**可干跑、可校验、可回滚**。
> 原则：**迁资产，不迁运行时状态**；ID 可换但必须可追溯；不伪造历史事件。

---

## 1. 迁移原则

| # | 原则 | 说明 |
|---|---|---|
| 1 | **只迁资产** | 用户、专家、知识、记忆、渠道、定时、历史、插件/技能；**不迁** checkpoint、租约、在途 turn、浏览器会话、桥连接 |
| 2 | **可干跑** | 先 `inspect` + `plan`，产出人类可读报告，再执行 |
| 3 | **幂等可重入** | 每条记录带 `legacy_id`，重复执行 upsert 不重复 |
| 4 | **不伪造事件** | 历史消息进 `messages` 投影，标 `imported=true`；不生成假的 token/tool 事件 |
| 5 | **密钥重加密** | 能解密的迁移并重加密；不能解密的标记"需重新授权" |
| 6 | **双跑可回滚** | Octop 保持只读 7 天；切换只改入口，不改旧库 |

---

## 2. 迁移范围

| 类别 | 迁 | 不迁 | 说明 |
|---|---|---|---|
| 身份 | users、roles、invites、SSO 配置 | JWT 密钥、登录会话、MFA 挑战 | 密码 hash 可复用则复用，否则强制重置 |
| 专家 | agents、config、SOUL/AGENTS、skills | checkpoint、last_state | 生成 `agent_versions` v1 |
| 模型 | providers、models、active model | 调用中的连接 | API Key 重加密 |
| 渠道 | channels、IM 绑定 | 在途消息、二维码会话 | 一台机器一个 bot 身份 |
| 定时 | cron_jobs | 运行中的 APScheduler job | 转 `schedules` |
| 历史 | threads、thread_messages | trajectory（可选归档） | 投影导入，不可回放 |
| 知识 | KB、documents、chunks 文本 | 原向量（除非同模型同维度） | 重新 embedding |
| 记忆 | octop-memory atoms、MEMORY/USER.md | 记忆运行态、slim 备份 | 重新 embedding |
| 扩展 | plugins、skill_packages、专家模板 | 插件运行态缓存 | 补 `api_version` |
| 运维 | storage_backends、settings（白名单） | secrets 中的 JWT | 重加密 |
| 用量/审计 | usage_log、audit_log | — | 标 `source=octop` |
| 联邦 | — | bridge_connections | 重新配对 |

---

## 3. ID 策略

```sql
CREATE TABLE legacy_map (
  source      TEXT NOT NULL,     -- 'octop'
  kind        TEXT NOT NULL,     -- 'user' | 'agent' | 'thread' | 'message' ...
  old_id      TEXT NOT NULL,
  new_id      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (source, kind, old_id)
);
```

| 对象 | 策略 |
|---|---|
| user | 新整数 id；按 `username` 去重；旧 id 记 `legacy_map` |
| agent | 若旧 id 形如 `[a-z]+_[0-9A-Z]{26}` 且不冲突 → 保留；否则 `ag_<新ULID>` |
| thread | `th_<新ULID>`；旧 id 进 map |
| message | `msg_<新ULID>`；旧 id 进 map；`messages.legacy_id` 便于排查 |
| KB/doc | `kb_`/`doc_` 新 id；旧 id 进 map |
| 其他 | 统一新 id + map |

> UI 提供"旧 ID 搜索"：输入 Octop id → 查 `legacy_map` → 跳新对象。

---

## 4. 表映射

| Octop | PolyOpus | 转换 | 备注 |
|---|---|---|---|
| `users` | `users` | username/display_name/locale/disabled/created_at；`role` 映射到 `role_id` | 密码：argon2id 且参数一致则复用；否则 `must_reset_password=1` |
| `user_role` | `roles` | permissions JSON → 权限点 | 未知权限点丢弃并记报告 |
| `user_group` / `user_group_member` | `groups` / `group_members`（新增） | 直接映射 | 目标 schema 需补两张表 |
| `resource_group_grant` | `resource_acl` | resource_type+key → ACL 行 | 8 种资源类型逐一映射 |
| `user_invites` | `invites` | code/expires/used | 过期邀请不迁 |
| `sso_providers` | `sso_providers` | kind/config；secret 重加密 | — |
| `agents` | `agents` + `agent_versions` | config_json + system_prompt + persona → spec v1 | `kind=team` 单独处理（§9） |
| `providers` | `providers` | name/kind/base_url/api_key/models | key 重加密 |
| `voice_providers` | `voice_providers` | — | 可后置 |
| `channels` | `sources` + `channel_bindings` | kind/config → source；agent 绑定 | IM 凭证重加密 |
| `cron_jobs` | `schedules` | trigger/prompt/session_key/task_type | 时区按 Octop `default_timezone` |
| `sessions` | `conversations.threads` | session_key 拆 origin/subject | 不迁未读计数 |
| `threads` | `threads` | title/pinned/last_active/created_at | `imported=true` |
| `thread_messages` | `messages` | role/content blocks/created_at | 见 §6 |
| `trajectory_events` | `imported_trajectory`（可选） | 原样 JSONL 归档 | 不参与回放 |
| `knowledge_bases` | `knowledge_bases` | name/embedding_model/chunk_config | 维度不同则重建 |
| `knowledge_documents` | `kb_documents` | filename/mime/size/status/pages | 源文件不在则只能迁文本 |
| （Octop 每 KB SQLite） | `kb_chunks` | 文本 + 页码/标题 → 重新 embed | 见 §7 |
| `skill_packages` | `skill_packages` | name/version/shared/copy_policy | 目录一并复制 |
| `published_experts` | `agent_templates` | manifest + files | 保留发布者/可见性 |
| `storage_backends` | `storage_backends` | kind/endpoint/bucket | secret 重加密 |
| `connectors` | `connector_instances` | kind/config/credentials | OAuth token 尝试重加密，失败标"需重新授权" |
| `settings` | `settings` | 白名单键 | 见 §10 |
| `usage_log` | `usage_records` | token 列；`cost_micros=0`，`price_version='imported'` | 成本不可回溯 |
| `audit_log` | `audit_log` | actor/action/target/payload | `source='octop'` |
| `proactive_care_config` | `schedules`（可选） | 转成每日定时 | 或直接丢弃 |
| `bridge_connections` | — | 不迁 | 重新配对 |

### 需要在目标 schema 增补的对象

- `groups` / `group_members`（若不在 `02` 的表清单里，迁移前补）
- `legacy_map`
- `messages.imported` / `messages.legacy_id`
- `threads.imported_at`

---

## 5. 工作区文件映射

```
~/.octop/agents/<id>/                 →  ~/.polyopus/workspaces/<agent_id>/
  SOUL.md, AGENTS.md, IDENTITY.md       →  同名复制
  skills/<slug>/SKILL.md                →  同名复制（补 front-matter 若缺）
  references/                           →  同名复制
  .octop/                               →  ✗ 跳过（系统态：sessions、auth、manifest）
  checkpoints.sqlite / memory.sqlite    →  ✗ 跳过（记忆走 §8）
  inbound/*                             →  artifacts/<sha256>，并在消息里补引用
```

- 复制后生成 `sha256 manifest`，校验用。
- 文件权限：目录 0750，文件 0640；跨平台统一 LF。
- Windows 路径：`\` → `/`；大小写敏感冲突时加后缀并记报告。

---

## 6. 历史导入

**做法**：消息进 `messages` 投影，**不生成逐 token 事件**。

```
for thread in octop.threads:
    new_thread = insert(thread, imported_at=now)
    for msg in thread_messages:
        insert(messages, thread_id=new_thread, role, blocks, created_at,
               imported=true, legacy_id=msg.id)
```

- `turns/runs/run_steps`：不重建（无真实执行信息）。
- UI 对 `imported=true` 的 thread 显示"历史导入，无法回放"。
- 附件：`inbound/` 文件按 sha256 入库；消息里的 `workspace_path` 改写为 artifact 引用；找不到文件则保留原路径文本并标"附件缺失"。
- 分组：若 Octop 有 turn 边界（`turn_id`/assistant 消息对），按边界重建 `turn_id` 仅用于展示分组；否则按"用户消息→后续 assistant"切分。

---

## 7. 知识库迁移

两条路径：

| 条件 | 做法 |
|---|---|
| embedding 模型与维度**相同** | 导出 `chunk text + vector BLOB` → 反序列化 → 写入 `kb_chunks.embedding` |
| 不同 / 未知 | 只迁文本 + 元数据，**重新 embedding**（推荐） |

- 源文件仍在 → 直接走新管线重新解析，质量更好。
- 源文件不在 → 从 Octop 的 `chunks` 表导出文本（会丢页码/表格结构），标 `degraded=true`。
- 重建引用：按 chunk 的 doc/ordinal 生成页码占位；无法还原的标"未知页"。
- 迁移后跑 10 条检索探针，对比命中。

---

## 8. 记忆迁移

| Octop | PolyOpus |
|---|---|
| `MEMORY.md` / `USER.md` | `memory_profiles.memory_md` / `user_md` |
| octop-memory atoms（`{ns}_*` 表） | `memory_atoms`（text/kind/created_at/confidence/evidence） |
| daily/*.md | `memory_episodes`（按天） |
| 记忆备份/维护记录 | 不迁 |

- atoms 重新 embedding（与知识同模型）。
- 无 `evidence` 的 atom：`evidence_json=[]`，`source='migration'`，置信降为 0.6。
- 冲突：迁移时按 `(namespace, text_hash)` 去重；不自动合并语义冲突。

---

## 9. 专家与团队

- 普通专家：`agents` + `agent_versions(v1)`；config 里的工具/技能/KB/插件 → `agent_bindings`。
- `kind=team`：Octop 的团队是"主持人 + workspace manifest 成员"。迁移为：
  - 主持人 → 普通 agent（保留 SOUL/AGENTS）；
  - 成员列表 → `teams` + `team_members`（新 schema）；
  - 房间/在途任务不迁。
- 共享专家：`is_shared` → `agent_shares`（tenant 内公开）。
- 专家模板：复制 `library/` 到 `templates/`，manifest 保留 i18n 字段。

---

## 10. 密钥、凭证与设置

| 项 | 处理 |
|---|---|
| Octop JWT 密钥 | 不迁；新实例重新生成，所有用户重新登录 |
| provider API Key | 用 Octop 的 Fernet 密钥解密 → 新 master key 加密 |
| 渠道凭证 | 同上 |
| OAuth connector token | 尝试解密+重加密；refresh 失败 → `status=reauth_required` |
| 用户密码 | argon2id 参数一致则复用；否则标记重置 |
| settings | 白名单：`default_timezone`、`max_upload_mb`、`enable_api_docs`、`captcha`；其余不迁 |
| 存储后端 secret | 重加密 |

> 迁移工具需要**只读**访问 Octop 的 `secrets` 表；建议在 Octop 停机快照上执行，避免密钥轮换竞态。

---

## 11. 迁移工具设计

```bash
poly migrate octop inspect --home ~/.octop --json > inventory.json
poly migrate octop plan    --inventory inventory.json --out plan.json
poly migrate octop run     --plan plan.json --dry-run
poly migrate octop run     --plan plan.json --confirm
poly migrate octop verify  --report verify.json
```

| 阶段 | 做什么 | 输出 |
|---|---|---|
| `inspect` | 读 Octop DB/目录，统计对象数、版本、异常 | `inventory.json` |
| `plan` | 计算 ID 映射、冲突、需重授权项 | `plan.json`（人可读摘要） |
| `run --dry-run` | 只写 `legacy_map` 到临时 schema，不落业务表 | 差异报告 |
| `run` | 按依赖顺序导入（用户→角色→专家→模型→渠道→知识→记忆→历史） | 进度 + 错误清单 |
| `verify` | 计数、抽样、登录、检索、记忆探针 | `verify.json` |

**退出码**：0 成功；1 部分失败（可重试）；2 致命（版本不兼容/密钥不可读）。

---

## 12. 校验清单

- [ ] 用户数、专家数、线程数、消息数、KB/文档/切片数与源一致（±0）
- [ ] 10 个抽样用户可登录（或收到重置邮件）
- [ ] 20 条抽样线程可打开，角色/时间/附件正确
- [ ] 5 个专家可启动并完成一次工具调用
- [ ] 10 条知识检索探针命中
- [ ] 5 条记忆探针命中
- [ ] 渠道测试通过（发一条测试消息）
- [ ] 定时任务下次运行时间正确
- [ ] 工作区文件 sha256 manifest 一致
- [ ] 无 `legacy_map` 冲突

---

## 13. 回滚与双跑

```
D0  快照 Octop（停机或只读）
D0  迁移到新实例（dry-run → run → verify）
D1  新实例只读试用（内部）
D2  切 10% 用户（DNS/端口/反代）
D3  切 100%；Octop 保持只读
D10 归档 Octop；保留 30 天
```

- 切换只改入口（反代/端口），两套数据不双写。
- 回滚：入口切回 Octop；新实例数据保留供排查。
- 双跑期间禁止在 Octop 写（否则新数据丢失）。

---

## 14. 边界情况

| 情况 | 处理 |
|---|---|
| 同名专家 | `agents` 唯一约束 `(tenant, name)` → 加 ` (2)` 后缀并记报告 |
| 用户名重复 | 拒绝迁移该用户，人工合并 |
| 时间戳时区 | 统一 UTC 入库；展示按租户时区 |
| Windows 路径 | 归一 `/`；非法字符替换 |
| 共享专家引用已删用户 | owner 置为管理员，记报告 |
| IM 多人共享 owner 身份 | 历史消息 actor 标 `system`，不伪造用户 |
| 超大附件 | 跳过并记清单，提供手动导入 |
| 插件缺 `api_version` | 默认 v1；不兼容则禁用并提示 |
| 团队在途任务 | 丢弃；迁移后重新接单 |

---

## 15. 工期估算

| 任务 | 人日 |
|---|---:|
| 迁移工具（inspect/plan/run/verify） | 8–10 |
| 表映射与转换 | 5–7 |
| 工作区/附件 | 3–4 |
| 知识重建 + 探针 | 3–5 |
| 记忆重建 | 2–3 |
| 密钥/凭证 | 2–3 |
| 干跑与校验 | 5–8 |
| **合计** | **28–40 人日**（约 6–8 周，含验证） |

> 建议：先做"单用户 + 单专家 + 单 KB"的端到端 dry-run，再全量。不要一次性迁所有租户。
