# 31 · 全量数据模型与 DDL

> 目的：把 `02` 的关键表扩展成可迁移、可索引、可保留的全量模型。
> 参考 Octop：
> - 双迁移（SQLite `.sql` + PG `.pg.sql`），每步小而可回滚；
> - 业务 ID 用 ULID，内部 `INTEGER/BIGINT` 自增；
> - `trajectory_events` 追加写，消息投影可重建；
> - `connector_instances`、`user_permissions`、`shares` 独立表，不把 JSON 塞进用户行；
> - 迁移按功能拆分（001_initial、002_cron…），而不是一次巨型 schema。
>
> 我们强化：所有业务表带 `tenant_id`、乐观锁 `version`、幂等表、outbox、事件 seq。

---

## 1. 约定

| 项 | 约定 |
|---|---|
| 主键 | `id INTEGER PRIMARY KEY AUTOINCREMENT`（PG `BIGSERIAL`） |
| 业务 ID | `xxx_id TEXT UNIQUE`，ULID，前缀 `th_/tn_/tk_/ag_/kb_` |
| 租户 | 所有业务表 `tenant_id TEXT NOT NULL DEFAULT 'default'` |
| 时间 | `ts INTEGER`（epoch ms）；`created_at/updated_at` 同 |
| 软删 | `deleted_at INTEGER NULL`；审计表只追加 |
| JSON | `*_json TEXT`（SQLite）/`JSONB`（PG），repo 层序列化 |
| 乐观锁 | `version INTEGER NOT NULL DEFAULT 1` |
| 布尔 | `INTEGER 0/1`（PG `BOOLEAN`） |
| 外键 | 业务 ID 外键；跨租户校验在应用层 + 复合索引 |
| 索引 | 首列 `tenant_id`，再按状态/时间 |
| 迁移 | `migrations/NNN_name.sql` + `.pg.sql`，只前进；回滚用 down 脚本 |

---

## 2. 表清单（候选 102，首版 94）

> **范围口径**：Schema 一次性建齐 94 张首版表；其中团队/渠道/控制面/云主机（共 9 张）属 **v1.1 功能**，v1.0 只建表不启用。
> 8 张候选表（workflows/workflow_runs/bridge_connections/acp_runners/thread_participants/source_cursors/agent_storage_bindings/feature_flags）延后。

### 2.1 平台 / 身份（16）

`tenants` `users` `user_preferences` `sessions` `invites` `roles` `role_permissions` `user_roles` `groups` `group_members` `resource_group_grants` `source_actors` `sso_providers` `user_mfa` `api_keys` `settings`

### 2.2 对话 / Turn（14）

`threads` `thread_participants` `thread_branches` `messages` `turns` `runs` `steps` `events` `attachments` `artifacts` `approvals` `attentions` `steer_queue` `context_snapshots`

### 2.3 任务 / Intake（12）

> `cron_jobs` / `cron_runs` 归 intake（ADR-004）；`orchestration` 不写这两张表。

`sources` `source_cursors` `triggers` `evals` `tickets` `mandates` `assignments` `reports` `timeline_events` `cron_jobs` `cron_runs` `watchdog_alerts`

### 2.4 专家 / 能力 / 团队（20）

`agents` `agent_versions` `agent_files` `agent_skills` `agent_subagents` `agent_workspace_files` `expert_templates` `providers` `models` `model_prices` `tools` `tool_settings` `policy_rules` `policy_bundles` `tool_calls` `skills` `secrets` `storage_backends` `agent_storage_bindings` `teams` `team_members`

### 2.5 连接器 / 扩展 / 渠道（10）

`connector_catalog` `connector_instances` `connector_oauth_states` `connector_bindings` `channels` `channel_bindings` `channel_messages` `plugins` `plugin_signatures` `skill_packages`

### 2.6 知识 / 记忆（6）

`knowledge_bases` `knowledge_docs` `knowledge_chunks` `knowledge_acl` `memory_atoms` `memory_events`

> 记忆模型以 `13 §7` 为准：`memory_atoms`（事实/偏好/情节/画像统一原子）+ `memory_events`（审计）；
> `memory_edges` / `memory_profiles` 为 v1.5，画像以 `kind=profile` 的 atom 存储，`USER.md` 放 `payload_json`。

### 2.7 用量 / 运维（14）

`usage_ledger` `quota_limits` `audit_log` `idempotency_keys` `outbox` `backups` `backup_settings` `data_jobs` `instances` `config_versions` `schema_migrations` `bridge_connections` `acp_runners` `feature_flags`

### 2.8 编排 / 控制面（5）

`delegations` `subscriptions` `control_sessions` `workflows` `workflow_runs`

> `workflows` / `workflow_runs` 属 v1.5 DAG，首版只建表不启用；`delegations` / `subscriptions` / `control_sessions` 进 v1.0。
> `control_sessions` 覆盖终端与浏览器两类会话，用 `kind` 区分；输入注入与命令执行必须写 `audit_log`。

### 2.9 云主机（v1.1，3）

`cloud_accounts` `cloud_instances` `cloud_ops`

> 首版只接腾讯云 CVM；`provider` 字段保留厂商扩展。实例快照可从云 API 重建，`cloud_instances` 是缓存而非真相。
> 所有启停/重启写 `cloud_ops` + `audit_log`，不允许只留云侧日志。

### 2.10 通知（1）

`notifications`

> 与 Attention 分离：Notification 只告知（任务完成/失败、云操作、导出），Attention 需要人决策。
> 站内为真相；Web Push 只是投递通道，失败不影响站内记录。

> 合计 102 个名字；首版 94（8 张延后/合并：workflows、workflow_runs、bridge_connections、acp_runners、thread_participants、source_cursors、agent_storage_bindings、feature_flags），保留表名稳定。`source_cursors` 可并入 `sources`，`agent_storage_bindings` 可并入 `agents`，`feature_flags` 可并入 `settings`，`thread_participants` 可延后。

---

## 3. 核心 DDL

> SQLite 方言；PG 迁移由生成器转换类型与自增。省略的通用列：`created_at`、`updated_at`、`version`。

### 3.1 租户 / 用户 / 会话

```sql
CREATE TABLE tenants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- active|suspended
  plan          TEXT NOT NULL DEFAULT 'free',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  user_id       TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  display_name  TEXT,
  email         TEXT,
  password_hash TEXT,
  avatar        TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active|disabled|invited
  is_owner      INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, username),
  UNIQUE (tenant_id, email)
);
CREATE INDEX idx_users_tenant_status ON users(tenant_id, status, created_at);

CREATE TABLE user_preferences (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL UNIQUE,
  preferences_json TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  refresh_hash  TEXT NOT NULL,
  user_agent    TEXT,
  ip            TEXT,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(tenant_id, user_id, expires_at);

CREATE TABLE invites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  invite_id     TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  invited_by    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|revoked|expired
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  accepted_at   INTEGER
);
CREATE UNIQUE INDEX uq_invites_pending ON invites(tenant_id, email) WHERE status = 'pending';
```

### 3.2 会话 / 消息 / Turn

```sql
CREATE TABLE threads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  thread_id     TEXT NOT NULL UNIQUE,
  owner_id      TEXT NOT NULL,
  agent_id      TEXT,
  agent_version_id TEXT,              -- 创建时锁定的 agent_versions.id；显式升级才变
  title         TEXT NOT NULL DEFAULT '新对话',
  status        TEXT NOT NULL DEFAULT 'active', -- active|archived|deleted
  pinned        INTEGER NOT NULL DEFAULT 0,
  branch_of     TEXT,
  last_seq      INTEGER NOT NULL DEFAULT 0,
  unread_count  INTEGER NOT NULL DEFAULT 0,   -- message.completed 时 +1；读后清零
  last_message_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_threads_owner ON threads(tenant_id, owner_id, pinned DESC, last_message_at DESC);
```

```sql
CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  message_id    TEXT NOT NULL UNIQUE,
  thread_id     TEXT NOT NULL,
  turn_id       TEXT,
  role          TEXT NOT NULL, -- system|user|assistant|tool
  content       TEXT NOT NULL DEFAULT '',
  content_json  TEXT,          -- 结构化 blocks（工具卡/引用/文件）
  status        TEXT NOT NULL DEFAULT 'completed', -- streaming|completed|failed|cancelled
  seq           INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  UNIQUE (thread_id, seq)
);
CREATE INDEX idx_messages_thread ON messages(tenant_id, thread_id, seq);
```

```sql
CREATE TABLE turns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  turn_id       TEXT NOT NULL UNIQUE,
  thread_id     TEXT NOT NULL,
  agent_version_id TEXT,              -- Turn 开始时快照；同 thread 内可不同（升级后新 Turn 用新版）
  user_message_id TEXT,
  status        TEXT NOT NULL, -- queued|running|waiting_approval|waiting_input|completed|failed|cancelled
  mode          TEXT NOT NULL DEFAULT 'act', -- act|ask|plan
  model         TEXT,
  policy_json   TEXT,
  budget_json   TEXT,
  seq           INTEGER NOT NULL,
  started_at    INTEGER,
  finished_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_turns_thread ON turns(tenant_id, thread_id, seq);
CREATE INDEX idx_turns_status ON turns(tenant_id, status, updated_at);
```

```sql
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  run_id        TEXT NOT NULL UNIQUE,
  turn_id       TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL, -- leased|running|waiting|completed|failed|cancelled
  lease_owner   TEXT,
  lease_until   INTEGER,
  heartbeat_at  INTEGER,
  last_step_idx INTEGER NOT NULL DEFAULT -1,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (turn_id, attempt)
);
CREATE INDEX idx_runs_claim ON runs(status, lease_until);
```

```sql
CREATE TABLE steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  step_id       TEXT NOT NULL UNIQUE,
  run_id        TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  kind          TEXT NOT NULL, -- model|tool|approval|handoff|compact
  status        TEXT NOT NULL, -- started|completed|failed|skipped
  input_json    TEXT,
  output_json   TEXT,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  UNIQUE (run_id, idx)
);
```

### 3.3 事件 / 审批 / 附件

> 归属（ADR-001）：`approvals` 与 `attentions` 都归 `attention` 域。`conversations` 只发 `approval.requested` 并暂停 Run，不写这两张表。`attentions` 是收件箱投影，`approvals` 是 Run 暂停记录，由 attention service 同事务写。

```sql
CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  thread_id     TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  turn_id       TEXT,
  run_id        TEXT,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  trace_id      TEXT,
  UNIQUE (thread_id, seq)
);
CREATE INDEX idx_events_thread_seq ON events(tenant_id, thread_id, seq);
CREATE INDEX idx_events_turn ON events(tenant_id, turn_id, seq);
```

```sql
CREATE TABLE approvals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  approval_id   TEXT NOT NULL UNIQUE,
  turn_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  step_idx      INTEGER NOT NULL,
  request_json  TEXT NOT NULL,
  decisions_json TEXT,
  status        TEXT NOT NULL, -- pending|approved|denied|expired
  expires_at    INTEGER,
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  UNIQUE (run_id, step_idx)
);
CREATE INDEX idx_approvals_pending ON approvals(tenant_id, status, expires_at);

CREATE TABLE attentions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  attention_id  TEXT NOT NULL UNIQUE,
  ticket_id     TEXT,
  turn_id       TEXT,
  kind          TEXT NOT NULL, -- approval|question|blocked
  source_type   TEXT NOT NULL, -- approval|ticket|run
  source_id     TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  expires_at    INTEGER,
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER
);
CREATE INDEX idx_attentions_pending ON attentions(tenant_id, status, created_at);
```

```sql
CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  attachment_id TEXT NOT NULL UNIQUE,
  thread_id     TEXT,
  message_id    TEXT,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ready', -- uploading|ready|failed|deleted
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_attachments_thread ON attachments(tenant_id, thread_id);
```

### 3.4 Intake / Ticket / Assignment

```sql
CREATE TABLE sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  source_id     TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL, -- github|feishu|wecom|dingtalk|email|webhook|schedule
  name          TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- active|paused|degraded
  cursor        TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE triggers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  trigger_id    TEXT NOT NULL UNIQUE,
  source_id     TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL,
  thread_key    TEXT NOT NULL,
  actor_id      TEXT,                      -- source_actors.actor_id
  actor_kind    TEXT,                      -- human|bot|system
  payload_json  TEXT NOT NULL,
  disposition   TEXT, -- accepted|filtered|duplicate|unavailable
  received_at   INTEGER NOT NULL,
  UNIQUE (source_id, dedupe_key)
);
CREATE INDEX idx_triggers_thread ON triggers(tenant_id, thread_key, received_at);
CREATE INDEX idx_triggers_actor ON triggers(tenant_id, actor_id, received_at);

CREATE TABLE evals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  eval_id       TEXT NOT NULL UNIQUE,
  trigger_id    TEXT NOT NULL,
  status        TEXT NOT NULL, -- queued|running|decided|failed|unavailable
  decision_json TEXT,
  model         TEXT,
  started_at    INTEGER,
  finished_at   INTEGER
);

CREATE TABLE tickets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  ticket_id     TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  state         TEXT NOT NULL, -- open|ended
  bucket        TEXT NOT NULL, -- attention|running|queued|done
  source_id     TEXT,
  trigger_id    TEXT,
  actor_json    TEXT,
  strength      TEXT NOT NULL, -- explicit|inferred
  priority      INTEGER NOT NULL DEFAULT 0,
  policy_version INTEGER NOT NULL,
  scope_json    TEXT NOT NULL,
  budget_json   TEXT,
  cost_micros   INTEGER NOT NULL DEFAULT 0,
  summary       TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_tickets_bucket ON tickets(tenant_id, state, bucket, priority DESC, updated_at DESC);

CREATE TABLE mandates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  mandate_id    TEXT NOT NULL UNIQUE,
  ticket_id     TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  scope_json    TEXT NOT NULL,
  strength      TEXT NOT NULL,
  matched_rules_json TEXT,
  created_at    INTEGER NOT NULL,
  invalidated_at INTEGER
);

CREATE TABLE assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  assignment_id TEXT NOT NULL UNIQUE,
  ticket_id     TEXT NOT NULL,
  executor      TEXT NOT NULL, -- builtin|codex|claude_code|dsh
  state         TEXT NOT NULL, -- pending|running|ended|dead
  lease_owner   TEXT,
  lease_until   INTEGER,
  heartbeat_at  INTEGER,
  progress      REAL,
  cost_micros   INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER,
  ended_at      INTEGER,
  UNIQUE (ticket_id, assignment_id)
);
CREATE INDEX idx_assignments_claim ON assignments(state, lease_until);
```

### 3.5 专家 / 提供商

```sql
CREATE TABLE agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  avatar        TEXT,
  model         TEXT,
  backend       TEXT NOT NULL DEFAULT 'builtin',
  status        TEXT NOT NULL DEFAULT 'idle', -- idle|running|disabled
  visibility    TEXT NOT NULL DEFAULT 'private', -- private|team|public
  draft_version INTEGER NOT NULL DEFAULT 0,
  published_version INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);

CREATE TABLE agent_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  version       INTEGER NOT NULL,
  config_json   TEXT NOT NULL,
  files_json    TEXT,
  published_by  TEXT,
  published_at  INTEGER NOT NULL,
  is_current    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (agent_id, version)
);

CREATE TABLE agent_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  content       TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (agent_id, name)
);

CREATE TABLE teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  team_id       TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  routing_json  TEXT,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);

CREATE TABLE team_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  team_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member', -- lead|member
  created_at    INTEGER NOT NULL,
  UNIQUE (team_id, agent_id)
);

CREATE TABLE providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  provider_id   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  base_url      TEXT,
  api_key_enc   TEXT,
  status        TEXT NOT NULL DEFAULT 'unconfigured', -- unconfigured|authorized|error
  models_json   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);
```

### 3.6 连接器 / 知识库

```sql
CREATE TABLE connector_instances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  instance_id   TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  config_enc    TEXT,
  auth_kind     TEXT NOT NULL, -- oauth|token|api_key|cookie|imap
  status        TEXT NOT NULL DEFAULT 'active', -- active|expired|disabled|error
  owner_id      TEXT NOT NULL,
  shared        INTEGER NOT NULL DEFAULT 0,
  default_open  INTEGER NOT NULL DEFAULT 0,
  tools_count   INTEGER NOT NULL DEFAULT 0,
  last_probe_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, owner_id, display_name)
);

CREATE TABLE connector_oauth_states (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  state_id      TEXT NOT NULL UNIQUE,
  connector_kind TEXT NOT NULL,
  instance_id   TEXT,
  status        TEXT NOT NULL, -- pending|authorized|denied|expired|error
  authorize_url TEXT,
  verifier_enc  TEXT,
  user_code     TEXT,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_oauth_pending ON connector_oauth_states(tenant_id, status, expires_at);

CREATE TABLE knowledge_bases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  kb_id         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  embedding_model TEXT,
  embedding_dim INTEGER,
  embedding_version TEXT,
  chunk_config_json TEXT,
  chunker_version TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private', -- private|team|tenant|public
  ocr_mode      TEXT NOT NULL DEFAULT 'off',
  status        TEXT NOT NULL DEFAULT 'ready',
  doc_count     INTEGER NOT NULL DEFAULT 0,
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);

CREATE TABLE knowledge_docs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  doc_id        TEXT NOT NULL UNIQUE,
  kb_id         TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  folder        TEXT,
  status        TEXT NOT NULL, -- uploading|processing|ready|failed
  error_code    TEXT,
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  storage_key   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  UNIQUE (kb_id, sha256)
);
CREATE INDEX idx_docs_kb_status ON knowledge_docs(tenant_id, kb_id, status, updated_at);

CREATE TABLE knowledge_chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  chunk_id      TEXT NOT NULL UNIQUE,
  doc_id        TEXT NOT NULL,
  kb_id         TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  content       TEXT NOT NULL,
  token_count   INTEGER NOT NULL,
  heading_path  TEXT,                      -- H1/H2/H3 路径
  page_from     INTEGER,
  page_to       INTEGER,
  char_start    INTEGER,
  char_end      INTEGER,
  embedding_json TEXT,          -- SQLite; PG 用 vector
  tsv           TEXT,           -- SQLite FTS5; PG tsvector
  metadata_json TEXT,
  UNIQUE (doc_id, idx)
);
CREATE INDEX idx_chunks_kb ON knowledge_chunks(tenant_id, kb_id, doc_id);
CREATE INDEX idx_chunks_heading ON knowledge_chunks(tenant_id, kb_id, heading_path);
```

### 3.7 用量 / 审计 / 幂等 / 运维

```sql
CREATE TABLE usage_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  entry_id      TEXT NOT NULL UNIQUE,
  user_id       TEXT,
  agent_id      TEXT,
  ticket_id     TEXT,
  turn_id       TEXT,
  model         TEXT,
  provider      TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  cache_write   INTEGER NOT NULL DEFAULT 0,
  reasoning     INTEGER NOT NULL DEFAULT 0,
  cost_micros   INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_usage_scope ON usage_ledger(tenant_id, created_at, agent_id, model);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  audit_id      TEXT NOT NULL UNIQUE,
  actor_id      TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  result        TEXT NOT NULL, -- ok|denied|failed
  detail_json   TEXT,
  ip            TEXT,
  trace_id      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_audit_time ON audit_log(tenant_id, created_at DESC);

CREATE TABLE idempotency_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  route         TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json TEXT,
  status        TEXT NOT NULL DEFAULT 'processing', -- processing|done
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, key)
);

CREATE TABLE outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  event_id      TEXT NOT NULL UNIQUE,
  topic         TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|sent|failed
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_outbox_pending ON outbox(status, next_retry_at);
```

### 3.8 补齐表（v1.0 缺口：能力 / 渠道 / 编排 / 控制 / 记忆）

> 这些表在 `03 §6/§9/§10/§11` 与 `13 §7` 已有模型，但此前未进本文件；此处收口为唯一 DDL 源。

```sql
-- 能力：工具注册表、逐 Agent 开关、策略规则
CREATE TABLE tools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_key      TEXT NOT NULL UNIQUE,      -- builtin.http_get / mcp.github.create_issue
  source        TEXT NOT NULL,             -- builtin|mcp|plugin|openapi|skill
  version       TEXT NOT NULL,
  spec_json     TEXT NOT NULL,             -- name/description/input_schema/risk/scopes/renderer
  enabled_global INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE tool_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  tool_key      TEXT NOT NULL REFERENCES tools(tool_key),
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, agent_id, tool_key)
);

CREATE TABLE policy_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id       TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  bundle_id     TEXT,                      -- 来源策略包；回滚时按 bundle 切
  priority      INTEGER NOT NULL,
  when_json     TEXT NOT NULL,             -- 受限 DSL，不 eval Python
  effect        TEXT NOT NULL,             -- allow|ask|deny
  obligations_json TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_policy_eval ON policy_rules(tenant_id, enabled, priority DESC);

-- 技能与专家模板
CREATE TABLE skills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  frontmatter_json TEXT NOT NULL,          -- 触发条件/依赖工具
  content_ref   TEXT NOT NULL,             -- SKILL.md 存储引用
  content_hash  TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (agent_id, slug)
);

CREATE TABLE expert_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  manifest_json TEXT NOT NULL,             -- prompt_files/quick_prompts/task_examples
  source        TEXT,                      -- builtin|import|git
  installed_at  INTEGER NOT NULL
);

-- 渠道：账号配置、绑定与消息（入站幂等）
CREATE TABLE channels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,             -- feishu|dingtalk|wecom|qq|telegram|discord
  display_name  TEXT NOT NULL,
  config_json   TEXT,                      -- 非敏感配置（app_id、回调地址等）
  credential_ref TEXT,                     -- secrets 引用，不存明文
  status        TEXT NOT NULL DEFAULT 'disabled', -- active|disabled|error|expired
  last_error    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, display_name)
);

CREATE TABLE channel_bindings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  channel_id    TEXT NOT NULL REFERENCES channels(channel_id),
  agent_id      TEXT,
  external_key  TEXT NOT NULL,             -- 群/会话标识
  config_json   TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  UNIQUE (channel_id, external_key)
);

CREATE TABLE channel_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  direction     TEXT NOT NULL,             -- inbound|outbound
  external_id   TEXT NOT NULL,             -- 平台 message_id
  thread_id     TEXT,
  actor_id      TEXT,                      -- inbound: source_actors.actor_id
  actor_kind    TEXT,                      -- human|bot|system
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL,             -- received|sent|failed
  error_code    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (channel_id, external_id)
);
CREATE INDEX idx_chmsg_thread ON channel_messages(tenant_id, thread_id, created_at);
CREATE INDEX idx_chmsg_actor ON channel_messages(tenant_id, actor_id, created_at);

-- 编排：派工与事件订阅
CREATE TABLE delegations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  team_id       TEXT NOT NULL REFERENCES teams(team_id),
  parent_ticket_id TEXT,
  parent_run_id TEXT NOT NULL,
  member_agent_id TEXT NOT NULL,
  child_thread_id TEXT,
  dedupe_key    TEXT NOT NULL,             -- hash(parent_run_id+member_id+task_id)
  state         TEXT NOT NULL,             -- pending|running|ended|dead
  payload_json  TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  lease_until   INTEGER,
  last_heartbeat_at INTEGER,
  next_retry_at INTEGER,
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX idx_deleg_state ON delegations(tenant_id, state, created_at);
CREATE INDEX idx_deleg_lease ON delegations(state, lease_until);

CREATE TABLE subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL UNIQUE,
  ticket_id     TEXT NOT NULL REFERENCES tickets(ticket_id),
  event_thread_id TEXT NOT NULL,
  filter_json   TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (ticket_id, event_thread_id)
);

-- 控制面：终端/浏览器会话
CREATE TABLE control_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,             -- terminal|browser
  agent_id      TEXT,
  status        TEXT NOT NULL,             -- starting|running|closed|error
  profile_ref   TEXT,                      -- 浏览器 profile 目录
  endpoint      TEXT,                      -- PTY/CDP 本地端点
  meta_json     TEXT,
  started_at    INTEGER NOT NULL,
  last_seen_at  INTEGER,
  ended_at      INTEGER
);
CREATE INDEX idx_ctrl_active ON control_sessions(tenant_id, status, last_seen_at);

-- 记忆：统一原子 + 审计（画像用 kind=profile）
CREATE TABLE memory_atoms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  atom_id       TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,             -- fact|preference|episode|profile|skill
  text          TEXT NOT NULL,
  embedding     BLOB,                      -- PG 用 vector(1024)
  confidence    REAL NOT NULL,
  status        TEXT NOT NULL,             -- active|retired|pending_review
  valid_from    INTEGER,
  valid_to      INTEGER,
  supersedes    TEXT,
  source        TEXT NOT NULL,             -- explicit_user|assistant_inferred|import|migration
  evidence_json TEXT NOT NULL,
  payload_json  TEXT,                      -- profile 的 USER.md 等
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_memory_ns ON memory_atoms(tenant_id, agent_id, status);
```

> `memory_edges` / `memory_profiles` 不建表：关系走 `memory_atoms` 的 `payload_json`，画像走 `kind=profile`；v1.5 再评估图模型。

### 3.9 云主机（v1.1）

```sql
CREATE TABLE cloud_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  provider      TEXT NOT NULL,             -- tencent|aws|aliyun（首版仅 tencent）
  display_name  TEXT NOT NULL,
  credential_enc TEXT NOT NULL,            -- 加密凭证，不存明文
  scopes_json   TEXT,
  status        TEXT NOT NULL,             -- active|expired|revoked|error
  expires_at    INTEGER,
  last_sync_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, provider, display_name)
);
CREATE INDEX idx_cloud_acct ON cloud_accounts(tenant_id, status);

CREATE TABLE cloud_instances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id   TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES cloud_accounts(account_id),
  provider      TEXT NOT NULL,
  region        TEXT NOT NULL,
  zone          TEXT,
  external_id   TEXT NOT NULL,             -- 云侧实例 ID
  name          TEXT NOT NULL,
  state         TEXT NOT NULL,             -- running|stopped|starting|stopping|rebooting|error|unknown
  spec_json     TEXT,                      -- CPU/内存/磁盘/带宽
  address_json  TEXT,                      -- 公网/内网 IP
  os            TEXT,
  tags_json     TEXT,
  last_seen_at  INTEGER,
  snapshot_at   INTEGER,
  UNIQUE (account_id, region, external_id)
);
CREATE INDEX idx_cloud_inst ON cloud_instances(tenant_id, account_id, region, state);

CREATE TABLE cloud_ops (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id         TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  instance_id   TEXT NOT NULL,
  action        TEXT NOT NULL,             -- start|stop|reboot
  status        TEXT NOT NULL,             -- pending|running|succeeded|failed
  requested_by  TEXT NOT NULL,
  reason        TEXT,
  result_json   TEXT,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_cloud_ops ON cloud_ops(tenant_id, instance_id, created_at DESC);
```

> `cloud_instances` 是缓存：以云 API 为准，快照 TTL 默认 5 分钟；离线时展示最后快照并标注 `snapshot_at`。
> 所有 `action` 必须先写 `cloud_ops(status=pending)` 再调用云 API，失败也要落终态，避免“云侧做了、本地不知道”。

### 3.10 资源 ACL（v1.0）

```sql
CREATE TABLE resource_group_grants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  resource_type TEXT NOT NULL,             -- skill_package|knowledge_base|connector|model|storage_backend|plugin|expert|agent
  resource_key  TEXT NOT NULL,             -- 资源 ID 或 provider/model
  group_id      TEXT NOT NULL,             -- groups.group_id；groups DDL 补齐后加 FK
  permission    TEXT NOT NULL,             -- view|edit|manage
  effect        TEXT NOT NULL DEFAULT 'allow', -- allow|deny（v1 只用 allow，deny 预留）
  expires_at    INTEGER,                   -- 临时授权自动失效
  granted_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, resource_type, resource_key, group_id, permission)
);
CREATE INDEX idx_rgg_resource ON resource_group_grants(tenant_id, resource_type, resource_key);
CREATE INDEX idx_rgg_group ON resource_group_grants(tenant_id, group_id);
CREATE INDEX idx_rgg_expiry ON resource_group_grants(expires_at);
```

> 语义：`visibility=private|team|tenant|public` 决定默认受众；grant 是**附加放行**，不是唯一依据。
> **无 grant 不等于公开**：默认 private；`tenant` 只对同租户可见；跨租户共享 v1 不开放。
> 写操作仍要求 owner/admin，grant 只影响读/用。

### 3.11 M1 补齐表（6 + 通知）

```sql
CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id TEXT NOT NULL UNIQUE,
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL,             -- task|cloud|export|system
  title           TEXT NOT NULL,
  body            TEXT,
  link            TEXT,
  dedupe_key      TEXT NOT NULL,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE (tenant_id, user_id, dedupe_key)
);
CREATE INDEX idx_notif_unread ON notifications(tenant_id, user_id, read_at, created_at DESC);

CREATE TABLE user_mfa (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT NOT NULL,
  method              TEXT NOT NULL,          -- totp|webauthn
  credential_id       TEXT NOT NULL DEFAULT '',
  secret_enc          TEXT,
  credential_json     TEXT,
  recovery_codes_enc  TEXT,
  enabled             INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER,
  UNIQUE (user_id, method, credential_id)
);

CREATE TABLE api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL UNIQUE,
  key_hash      TEXT NOT NULL,
  scopes_json   TEXT NOT NULL,
  last_used_at  INTEGER,
  expires_at    INTEGER,
  revoked_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_apikey_user ON api_keys(tenant_id, user_id, revoked_at);

CREATE TABLE roles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id         TEXT NOT NULL UNIQUE,
  tenant_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  builtin         INTEGER NOT NULL DEFAULT 0,
  permissions_json TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  member_count  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE artifacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id   TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  thread_id     TEXT,
  turn_id       TEXT,
  run_id        TEXT,
  kind          TEXT NOT NULL,               -- file|image|pdf|pr|diff|report|link
  ref           TEXT NOT NULL,               -- storage ref / URL
  mime          TEXT,
  size          INTEGER,
  sha256        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_artifact_scope ON artifacts(tenant_id, thread_id, turn_id);

CREATE TABLE tool_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_call_id  TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  turn_id       TEXT NOT NULL,
  run_id        TEXT,
  tool_key      TEXT NOT NULL,
  args_json     TEXT NOT NULL,
  result_json   TEXT,
  status        TEXT NOT NULL,               -- running|completed|failed|denied
  risk          TEXT NOT NULL,
  approval_id   TEXT,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  error_code    TEXT
);
CREATE INDEX idx_toolcall_turn ON tool_calls(tenant_id, turn_id, started_at);

-- 导出 / 删除任务
CREATE TABLE data_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT,
  kind          TEXT NOT NULL,             -- export|delete
  scope_json    TEXT NOT NULL,             -- tenant/user/thread/kb...
  status        TEXT NOT NULL,             -- queued|running|ready|failed|done
  progress      REAL NOT NULL DEFAULT 0,
  storage_ref   TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_data_jobs ON data_jobs(tenant_id, kind, status, created_at DESC);

-- 多实例：注册与配置版本（v1.1 启用；v1.0 建表空转）
CREATE TABLE instances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id   TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL,             -- api|worker|scheduler
  version       TEXT NOT NULL,
  hostname      TEXT,
  started_at    INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  meta_json     TEXT
);
CREATE INDEX idx_instances_alive ON instances(role, last_heartbeat_at);

CREATE TABLE config_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,             -- settings|permissions|policy|plugins|acl
  key           TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL,
  changed_by    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (scope, key)
);
```

> `groups` 与 `user_mfa/api_keys` 的 FK 在迁移器里补齐；`resource_group_grants.group_id` 直接引用 `groups.group_id`。
> `tool_calls` 是工具审计的权威表；即使工具失败也要落行，不能只写日志。
> `data_jobs` 是导出/删除的权威任务表：先软删 → 业务行 → 向量 → 对象存储 → 事件归档 → 审计匿名化；删除完成前不得物理删除审计。
> `instances` 心跳超 60s 视为离线；`config_versions` 版本变化必须触发本地权限/策略/ACL 缓存失效（`17 T2`）。

### 3.12 首版剩余表（29 张，M1/M2 分批）

> 8 张候选表（`workflows/workflow_runs/bridge_connections/acp_runners/thread_participants/source_cursors/agent_storage_bindings/feature_flags`）不在首版，不在此处建。

```sql
-- 身份 / 权限（M1）
CREATE TABLE group_members (
  group_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE role_permissions (
  role_id       TEXT NOT NULL,
  permission    TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE user_roles (
  user_id       TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sso_providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id   TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- oidc|oauth|ldap
  name          TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  allowed_email_domains_json TEXT,          -- ["example.com"]；空 = 不限制（需显式）
  allowed_groups_json TEXT,                 -- 目录组白名单
  auto_provision INTEGER NOT NULL DEFAULT 0,
  default_role  TEXT NOT NULL DEFAULT 'member', -- admin|member|auditor
  role_sync     TEXT NOT NULL DEFAULT 'none',   -- none|login
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, kind, name)
);

CREATE TABLE settings (
  tenant_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  value_json    TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE secrets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  secret_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  rotated_at    INTEGER,
  UNIQUE (tenant_id, name)
);

-- 对话（M1）
CREATE TABLE context_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id   TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  thread_id     TEXT NOT NULL,
  turn_id       TEXT NOT NULL,
  before_tokens INTEGER NOT NULL,
  after_tokens  INTEGER NOT NULL,
  strategy      TEXT NOT NULL,
  payload_ref   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ctx_snap ON context_snapshots(thread_id, created_at DESC);

CREATE TABLE steer_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  steer_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  turn_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- text|image|file
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL,              -- queued|drained|removed|rejected
  created_at    INTEGER NOT NULL,
  drained_at    INTEGER
);
CREATE INDEX idx_steer_turn ON steer_queue(turn_id, status, created_at);

CREATE TABLE thread_branches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  thread_id     TEXT NOT NULL,
  parent_turn_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_branch_thread ON thread_branches(thread_id, created_at);

-- Intake / 任务（M1）
CREATE TABLE cron_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cron_job_id   TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  schedule      TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  action        TEXT NOT NULL,              -- notify|run_agent|run_workflow
  payload_json  TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  next_run_at   INTEGER,
  last_run_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_cron_due ON cron_jobs(enabled, next_run_at);

CREATE TABLE cron_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  cron_job_id   TEXT NOT NULL,
  status        TEXT NOT NULL,              -- queued|running|succeeded|failed|skipped
  scheduled_at  INTEGER NOT NULL,
  started_at    INTEGER,
  ended_at      INTEGER,
  error         TEXT,
  trigger_id    TEXT
);
CREATE INDEX idx_cron_runs ON cron_runs(cron_job_id, scheduled_at DESC);

CREATE TABLE reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  ticket_id     TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  state         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  progress      REAL,
  facts_json    TEXT,
  artifacts_json TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_reports_ticket ON reports(ticket_id, created_at DESC);

CREATE TABLE timeline_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  ticket_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  actor         TEXT,
  payload_json  TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_timeline_ticket ON timeline_events(ticket_id, created_at);

CREATE TABLE watchdog_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- stalled|drifting|error_loop
  detail        TEXT NOT NULL,
  action        TEXT NOT NULL,              -- notify|stop|requeue
  status        TEXT NOT NULL,              -- open|acked|resolved
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_watchdog_open ON watchdog_alerts(tenant_id, status, created_at DESC);

-- 专家 / 能力（M1–M2）
CREATE TABLE agent_skills (
  agent_id      TEXT NOT NULL,
  skill_id      TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE agent_subagents (
  agent_id      TEXT NOT NULL,
  subagent_id   TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT,
  PRIMARY KEY (agent_id, subagent_id)
);

CREATE TABLE agent_workspace_files (
  agent_id      TEXT NOT NULL,
  path          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  size          INTEGER,
  sha256        TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (agent_id, path)
);

CREATE TABLE models (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id      TEXT NOT NULL UNIQUE,
  provider_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  caps_json     TEXT NOT NULL,
  price_version TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (provider_id, name)
);

CREATE TABLE model_prices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  model         TEXT NOT NULL,
  currency      TEXT NOT NULL,             -- CNY|USD
  input_per_mtok  REAL NOT NULL,
  output_per_mtok REAL NOT NULL,
  cached_per_mtok REAL NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL,
  effective_from INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (model, version, effective_from)
);

CREATE TABLE plugins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  version       TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  status        TEXT NOT NULL,              -- installed|enabled|disabled|failed
  signature     TEXT,
  installed_at  INTEGER NOT NULL
);

CREATE TABLE plugin_signatures (
  plugin_id     TEXT NOT NULL,
  version       TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  signer        TEXT,
  signed_at     INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, version)
);

CREATE TABLE skill_packages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  storage_backend TEXT,
  shared        INTEGER NOT NULL DEFAULT 0,
  allow_download INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, name, version)
);

CREATE TABLE storage_backends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  backend_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- local|s3|cos|tos
  config_json   TEXT NOT NULL,
  status        TEXT NOT NULL,              -- active|error|disabled
  created_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, kind, backend_id)
);

CREATE TABLE backups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,              -- 实例级备份用 'system'
  kind          TEXT NOT NULL,              -- full|incremental
  storage_ref   TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,              -- includes: config/db/workspace/skill_packages/plugins(可选 env)
  checksum      TEXT NOT NULL,              -- sha256；恢复前强校验
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  auto          INTEGER NOT NULL DEFAULT 0, -- 1=自动备份产物
  status        TEXT NOT NULL,              -- creating|ready|failed|restoring|restored
  created_at    INTEGER NOT NULL,
  restored_at   INTEGER
);
CREATE TABLE backup_settings (
  tenant_id     TEXT PRIMARY KEY,
  auto_enabled  INTEGER NOT NULL DEFAULT 0,
  interval_hours INTEGER NOT NULL DEFAULT 24,
  retention_count INTEGER NOT NULL DEFAULT 7,
  includes_json TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_backups_time ON backups(tenant_id, created_at DESC);

CREATE TABLE quota_limits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quota_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  scope         TEXT NOT NULL,              -- tenant|user|agent
  scope_id      TEXT NOT NULL,
  metric        TEXT NOT NULL,              -- tokens|cost|requests|storage|concurrency
  limit_value   INTEGER NOT NULL,
  window        TEXT NOT NULL,              -- day|month|absolute
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, scope, scope_id, metric, window)
);

CREATE TABLE schema_migrations (
  version       INTEGER PRIMARY KEY,
  applied_at    INTEGER NOT NULL,
  checksum      TEXT NOT NULL
);

-- 连接器 / 知识 / 记忆（M2）
CREATE TABLE connector_catalog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id    TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  auth_kind     TEXT NOT NULL,
  config_json   TEXT
);

CREATE TABLE connector_bindings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id    TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  connector_instance_id TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  config_json   TEXT,
  UNIQUE (connector_instance_id, agent_id)
);

CREATE TABLE knowledge_acl (
  kb_id         TEXT NOT NULL,
  subject_type  TEXT NOT NULL,              -- user|group|tenant
  subject_id    TEXT NOT NULL,
  permission    TEXT NOT NULL,              -- read|write|manage
  PRIMARY KEY (kb_id, subject_type, subject_id, permission)
);

CREATE TABLE memory_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  atom_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- raw|promoted|merged|superseded|deleted
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_memory_events ON memory_events(tenant_id, atom_id, created_at);

-- 外部身份映射（IM / webhook）
CREATE TABLE source_actors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id      TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  source_kind   TEXT NOT NULL,             -- feishu|dingtalk|wecom|github|webhook|email|...
  external_id   TEXT NOT NULL,             -- 平台用户 ID / open_id / email
  display_name  TEXT,
  kind          TEXT NOT NULL DEFAULT 'human', -- human|bot|system
  linked_user_id TEXT,                     -- 关联本地 users.id；可为空
  status        TEXT NOT NULL DEFAULT 'active', -- active|merged|deleted
  metadata_json TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tenant_id, source_kind, external_id)
);
CREATE INDEX idx_actor_link ON source_actors(tenant_id, linked_user_id);
CREATE INDEX idx_actor_status ON source_actors(tenant_id, status);

-- 策略包：发布/灰度/回滚
CREATE TABLE policy_bundles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id     TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL,
  version       INTEGER NOT NULL,
  status        TEXT NOT NULL,             -- draft|active|rolled_back
  rules_json    TEXT NOT NULL,             -- 规则快照
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  activated_at  INTEGER,
  UNIQUE (tenant_id, version)
);
CREATE INDEX idx_policy_bundle_active ON policy_bundles(tenant_id, status, version DESC);
```

> `source_actors` 是外部身份的权威表：`triggers.actor_id` / `channel_messages.actor_id` 引用它；同一人跨平台用 `linked_user_id` 合并。
> `policy_bundles` 是策略发布单元：draft → active → rolled_back；`policy_rules.bundle_id` 记录来源，回滚只切 active bundle。

---

## 4. 状态枚举

| 表 | 字段 | 值 |
|---|---|---|
| threads | status | active / archived / deleted |
| turns | status | queued / running / waiting_approval / waiting_input / completed / failed / cancelled |
| runs | status | leased / running / waiting / completed / failed / cancelled |
| tickets | state | open / ended |
| tickets | bucket | attention / running / queued / done |
| assignments | state | pending / running / ended / dead |
| attentions | status | pending / answered / expired / dismissed |
| connector_instances | status | active / expired / disabled / error |
| knowledge_docs | status | uploading / processing / ready / failed |
| agent_versions | is_current | 0/1（同 agent 唯一部分索引） |
| tools | source | builtin / mcp / plugin / openapi / skill |
| policy_rules | effect | allow / ask / deny |
| channel_messages | direction | inbound / outbound |
| channel_messages | status | received / sent / failed |
| delegations | state | pending / running / ended / dead |
| control_sessions | kind | terminal / browser |
| control_sessions | status | starting / running / closed / error |
| memory_atoms | kind | fact / preference / episode / profile / skill |
| memory_atoms | status | candidate / active / retired / pending_review |
| cloud_accounts | provider | tencent / aws / aliyun |
| cloud_accounts | status | active / expired / revoked / error |
| cloud_instances | state | running / stopped / starting / stopping / rebooting / error / unknown |
| cloud_ops | action | start / stop / reboot |
| cloud_ops | status | pending / running / succeeded / failed |
| steer_queue | status | queued / drained / removed / rejected |
| cron_runs | status | queued / running / succeeded / failed / skipped |
| watchdog_alerts | status | open / acked / resolved |
| plugins | status | installed / enabled / disabled / failed |
| storage_backends | status | active / error / disabled |
| backups | status | creating / ready / failed / restored |
| knowledge_acl | permission | read / write / manage |
| resource_group_grants | permission | view / edit / manage |
| resource_group_grants | effect | allow / deny（v1 只用 allow） |
| notifications | kind | task / cloud / export / system |
| source_actors | kind | human / bot / system |
| source_actors | status | active / merged / deleted |
| policy_bundles | status | draft / active / rolled_back |
| delegations | state | pending / running / ended / dead |
| data_jobs | kind | export / delete |
| data_jobs | status | queued / running / ready / failed / done |
| instances | role | api / worker / scheduler |
| config_versions | scope | settings / permissions / policy / plugins / acl |

---

## 5. 索引与唯一约束原则

1. 列表页索引：`(tenant_id, status, updated_at DESC)`。
2. 事件：`(thread_id, seq)` 唯一；`(tenant_id, turn_id, seq)`。
3. 任务：`(tenant_id, state, bucket, priority DESC, updated_at DESC)`。
4. 连接器：`(tenant_id, owner_id, display_name)` 唯一。
5. 知识库：`(tenant_id, name)` 唯一；`(kb_id, sha256)` 唯一。
6. 软删表：唯一索引加 `WHERE deleted_at IS NULL`（PG 部分索引；SQLite 用触发器/应用校验）。
7. 所有外键列建索引；所有 `tenant_id` 放首列。

---

## 6. 保留与归档

| 数据 | 热保留 | 归档 | 说明 |
|---|---|---|---|
| events | 90 天 | 对象存储 JSONL | 按 thread 归档 |
| messages | 永久（随会话删） | — | 投影可重建 |
| attachments | 随消息 | 对象存储 | DB 只存元数据/hash |
| usage_ledger | 24 个月 | 月聚合表 | 明细可归档 |
| audit_log | 12 个月 | 冷存储 | 只追加 |
| oauth_states | 24 小时 | 删除 | 过期清理 |
| idempotency_keys | 24 小时 | 删除 | 定时清理 |

---

## 7. 迁移策略

1. 每个功能一个迁移：`020_connectors.sql` + `.pg.sql`。
2. 迁移只前进；破坏性变更分两步（加列→回填→切读→删旧列）。
3. 大表加索引用 `CREATE INDEX CONCURRENTLY`（PG）。
4. 迁移前自动备份；失败回滚到备份点。
5. `schema_migrations(version, name, checksum, applied_at)` 校验 checksum，禁止改历史迁移。
6. 双写期：新列写双份，读旧列；回滚只需停双写。
7. 每个迁移必须有 `-- up` / `-- down`（或配套 rollback 脚本）。

---

## 8. 与 Octop 的差异

| 项 | Octop | PolyOpus |
|---|---|---|
| 迁移 | 001…015 分功能 | 同样分功能，增加 checksum/回滚 |
| 事件 | trajectory_events | events + steps，投影可重建 |
| 连接器 | connector_instances | 增加 oauth_states 独立表 |
| 权限 | user_permissions | roles + role_permissions + user_roles |
| 租户 | 单实例 | 全表 tenant_id |
| 幂等 | 部分 | 统一 idempotency_keys |
| Outbox | 进程内队列 | 持久化 outbox |
| 附件 | workspace inbound | artifacts + 对象存储 CAS |

---

## 9. 验收

- [ ] 94 张首版表全部有迁移与回滚
- [ ] 所有业务表有 `tenant_id`
- [ ] 所有列表有覆盖索引
- [ ] 事件 seq 无空洞/重复
- [ ] 幂等键 24h 清理
- [ ] 备份恢复后 checksum 一致
- [ ] 迁移 checksum 不可变
