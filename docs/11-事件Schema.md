# 11 · 事件 Schema（完整字段表）

> 这是全系统的**唯一事件契约**：WS 推送、SSE 回放、内部总线、IM 投影、审计与评测都从它派生。
> 原则：**事件是事实（过去时），命令是请求（现在时）**。本文件只定义事件；客户端到服务端的命令见 §3.3。

---

## 1. 设计原则

| # | 原则 | 落地 |
|---|---|---|
| 1 | **单一信封** | 所有事件同一组顶层字段，`payload` 才是类型专属内容 |
| 2 | **可排序、可续传** | 每个流一条单调 `seq`；客户端用 `after_seq` 续传 |
| 3 | **幂等** | 全局唯一 `event_id`（ULID）；消费方按 `event_id` 去重 |
| 4 | **自描述** | `type` + `v` 足以路由与反序列化；不依赖上下文 |
| 5 | **可审计** | 谁触发（`actor`）、因何触发（`causation_id`）、属于哪条链路（`trace_id`） |
| 6 | **有界** | 单事件 ≤ 32 KB；大内容走 `artifact` + `data_ref` |
| 7 | **可演进** | 只做加法；破坏性变更升 `v`，双发一个版本周期 |
| 8 | **脱敏** | 密钥/令牌/PII 永不进 payload；工具参数只留 digest + 截断预览 |

---

## 2. 信封（Envelope）

```json
{
  "v": 1,
  "event_id": "ev_01J9Z8Q3K7Y2N5M4P6R8S0T2V4",
  "stream_id": "conv:th_01J9Z8...",
  "seq": 10231,
  "type": "message.delta",
  "ts": "2026-11-05T13:20:00.123Z",
  "tenant_id": "default",
  "actor": { "kind": "agent", "id": "ag_01J..." },
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": "ev_01J9Z8Q3...",
  "correlation_id": "tu_01J9Z8...",
  "refs": {
    "thread_id": "th_01J9Z8...",
    "turn_id": "tu_01J9Z8...",
    "run_id": "rn_01J9Z8...",
    "ticket_id": null,
    "assignment_id": null,
    "event_thread_id": null,
    "source_id": null
  },
  "payload": { "message_id": "msg_01J...", "index": 0, "text": "你好" },
  "meta": { "coalesced": false, "producer": "kernel" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|:--:|---|
| `v` | `int` | ● | 信封版本，当前 `1` |
| `event_id` | `id(ev_)` | ● | ULID；全局唯一；时间有序 |
| `stream_id` | `string` | ● | 所属流：`conv:` / `ticket:` / `src:` / `user:` / `sys:` |
| `seq` | `int` | ● | 流内单调递增，从 1 开始，**不留洞** |
| `type` | `string` | ● | `domain.action`，见 §4 |
| `ts` | `timestamp` | ● | ISO-8601 UTC 毫秒；DB 存 epoch ms |
| `tenant_id` | `string` | ● | 租户隔离 |
| `actor` | `Actor` | ● | 谁产生：`user` / `agent` / `system` / `executor` / `source` |
| `trace_id` | `string` | ○ | OTel trace |
| `causation_id` | `id(ev_)` | ○ | 直接触发本事件的事件 |
| `correlation_id` | `string` | ○ | 业务链路（turn_id / ticket_id / eval_id） |
| `refs` | `Refs` | ● | 关联实体（可空字段） |
| `payload` | `object` | ● | 类型专属，≤ 32 KB |
| `meta` | `object` | ○ | 生产者附加：`coalesced`、`producer`、`model`、`source` |

**`Actor`**

```json
{ "kind": "user|agent|system|executor|source", "id": "u_123", "name": "alice", "on_behalf_of": null }
```

**`Refs`**：全部为可空字符串；至少一个非空（由事件类型约束）。

---

## 3. 命名、语义与命令

### 3.1 命名规范

```
<domain>.<action>
domain: turn | message | reasoning | tool | approval | steer | context | plan
      | artifact | error | trigger | eval | ticket | assignment | attention
      | watchdog | channel | usage | cron | delegation | memory | plugin
action: 过去时（事实）：started / delta / completed / failed / queued / decided
        或状态变更：opened / resumed / ended / invalidated / merged / dead
```

- **不用** `tool.end` 这种省略式；统一 `tool.completed`。
- 动作一旦发布不改名；要改就新增类型并弃用旧类型（保留 2 个版本）。

### 3.2 事件 vs 命令

| | 事件（本文件） | 命令（WS 客户端帧） |
|---|---|---|
| 方向 | 服务端 → 客户端 | 客户端 → 服务端 |
| 语义 | 已发生的事实 | 请求做某事 |
| 示例 | `message.delta` | `user_turn` |
| 幂等 | `event_id` 去重 | `client_msg_id` 去重 |
| 持久化 | 追加到 `events` | 转成 Turn/Ticket 后落库 |

### 3.3 客户端命令（非事件，列出以划清边界）

| 命令 | 字段 | 说明 |
|---|---|---|
| `user_turn` | `text, thread_id?, session_key?, model?, knowledge_base_ids[], delivery, client_msg_id` | 发一轮 |
| `subscribe` | `stream_id, after_seq` | 订阅/续传 |
| `cancel` | `turn_id` | 停止本轮 |
| `steer` | `turn_id, text, client_msg_id` | 中途插话 |
| `steer_remove` | `turn_id, steer_id` | 撤回插话 |
| `answer_attention` | `attention_id, answer` | 回答待决 |
| `ping` | — | 心跳 |

**帧校验（N-08）**：每个命令帧按 Pydantic 模型校验；非法帧回错误帧 `{type:"error", code:"FRAME_INVALID", cause:"..."}` 并**不关闭连接**；未知 `type` 同样回 `FRAME_INVALID`。每连接入站限 60 帧/分钟，超限回 `FRAME_RATE_LIMITED` 并关闭。

---

## 4. 流与序号

| 流 | `stream_id` | 内容 | 订阅者 |
|---|---|---|---|
| 会话 | `conv:{thread_id}` | turn/message/tool/approval/steer/context/plan/artifact/error | 对话页、IM 投影、回放 |
| 工单 | `ticket:{ticket_id}` | ticket/assignment/delegation/report/channel | 工单详情、任务中心（按 ticket 查询） |
| 来源 | `src:{source_id}` | trigger/eval/cron/channel.inbound | 来源调试、审计 |
| 用户 | `user:{user_id}` | attention | 收件箱、通知中心 |
| 系统 | `sys:{tenant_id}` | usage/watchdog/memory/plugin/notification/workspace/control | 管理台、告警、通知中心 |

**规则**
1. 每个事件只属于一个流；跨流用 `refs` 关联。
2. 流内 `seq` 严格 +1，**不允许洞**；出现洞说明事件丢失，客户端应 `GET /events?after_seq=` 补齐。
3. 跨流顺序不保证；需要因果时用 `causation_id`。
4. 每个流保留最近 200 条在内存（热推送），其余从 `events` 表回放。

---

## 5. 事件目录

| # | type | 流 | 生产者 | 保留 | 说明 |
|---|---|---|---|---|---|
| 1 | `turn.queued` | conv | conversations | 90d | 已入队 |
| 2 | `turn.started` | conv | worker | 90d | 开始执行 |
| 3 | `turn.resumed` | conv | worker | 90d | 恢复执行 |
| 4 | `turn.finished` | conv | worker | 永久 | 终态（含 usage） |
| 5 | `message.started` | conv | kernel | 90d | 消息开始 |
| 6 | `message.delta` | conv | kernel | 90d | 文本增量 |
| 7 | `message.completed` | conv | kernel | 永久 | 消息完成 |
| 8 | `reasoning.delta` | conv | kernel | 30d | 思考增量 |
| 9 | `reasoning.summary` | conv | kernel | 90d | 思考摘要 |
| 10 | `tool.started` | conv | kernel | 90d | 工具开始 |
| 11 | `tool.delta` | conv | executor | 30d | 工具进度 |
| 12 | `tool.completed` | conv | kernel | 90d | 工具完成 |
| 13 | `tool.failed` | conv | kernel | 90d | 工具失败 |
| 14 | `tool.async_started` | conv | kernel | 90d | 异步工具启动 |
| 15 | `tool.async_completed` | conv | kernel | 90d | 异步工具完成 |
| 16 | `tool.async_cancelled` | conv | kernel | 90d | 异步工具取消 |
| 17 | `approval.requested` | conv | kernel | 永久 | 审批单 |
| 18 | `approval.resolved` | conv | conversations | 永久 | 审批结果 |
| 19 | `steer.queued` | conv | conversations | 30d | 插话入队 |
| 20 | `steer.drained` | conv | kernel | 30d | 插话已注入 |
| 21 | `steer.removed` | conv | conversations | 30d | 已撤回 |
| 22 | `steer.rejected` | conv | conversations | 30d | 被拒 |
| 23 | `context.updated` | conv | kernel | 30d | 上下文用量 |
| 24 | `context.compacted` | conv | kernel | 90d | 已压缩 |
| 25 | `plan.updated` | conv | kernel | 90d | 计划/待办 |
| 26 | `artifact.created` | conv | tools | 永久 | 产物 |
| 27 | `artifact.updated` | conv | tools | 永久 | 产物更新 |
| 28 | `error` | conv | any | 90d | 结构化错误 |
| 29 | `trigger.received` | src | intake | 30d | 收到事件 |
| 30 | `trigger.filtered` | src | intake | 30d | 被过滤 |
| 31 | `trigger.fanned_out` | src | intake | 30d | 扇出给工单 |
| 32 | `eval.started` | src | intake | 90d | 研判开始 |
| 33 | `eval.decided` | src | intake | 180d | 研判结果 |
| 34 | `ticket.opened` | ticket | intake | 永久 | 建单 |
| 35 | `ticket.resumed` | ticket | intake | 永久 | 恢复 |
| 36 | `ticket.ended` | ticket | intake | 永久 | 结束 |
| 37 | `ticket.mandate_invalidated` | ticket | intake | 永久 | 授权失效 |
| 38 | `ticket.merged` | ticket | intake | 永久 | 合并 |
| 39 | `assignment.started` | ticket | intake | 1y | 派工开始 |
| 40 | `assignment.reported` | ticket | executor | 1y | 执行报告 |
| 41 | `assignment.ended` | ticket | intake | 1y | 派工结束 |
| 42 | `assignment.dead` | ticket | intake | 1y | 死信 |
| 43 | `attention.requested` | user | intake | 永久 | 待决 |
| 44 | `attention.resolved` | user | user | 永久 | 已决 |
| 45 | `watchdog.alert` | sys | watchdog | 90d | 巡检告警 |
| 46 | `channel.sent` | ticket | channels | 1y | 已回复 |
| 47 | `channel.failed` | ticket | channels | 1y | 回复失败 |
| 48 | `usage.recorded` | sys | any | 1y | 用量/成本 |
| 49 | `cron.fired` | src | scheduler | 1y | 定时触发（转 Trigger） |
| 50 | `channel.inbound` | src | channels | 30d | 渠道入站消息 |
| 51 | `delegation.started` | ticket | orchestration | 1y | 团队派工开始 |
| 52 | `delegation.ended` | ticket | orchestration | 1y | 派工结束/死信 |
| 53 | `memory.written` | sys | memory | 永久 | 记忆写入 |
| 54 | `memory.updated` | sys | memory | 永久 | 记忆状态/替代 |
| 55 | `plugin.installed` | sys | capabilities | 1y | 插件安装/启用 |
| 56 | `plugin.failed` | sys | capabilities | 1y | 插件加载失败 |
| 57 | `notification.created` | sys | notifications | 90d | 站内/系统通知 |
| 58 | `workspace.changed` | sys | capabilities | 90d | 工作区文件变更 |
| 59 | `control.started` | sys | control | 90d | 终端/浏览器会话开始 |
| 60 | `control.ended` | sys | control | 90d | 终端/浏览器会话结束 |
| 61 | `subscription.created` | ticket | intake | 1y | Ticket 订阅事件线程 |

> 共 61 类：会话 28 + 入口 7 + 工单 14 + 用户 2 + 系统 10。
> 49–61 是 2026-11 补齐项，修掉 `cron.fired` 幽灵引用，并覆盖渠道入站、团队派工、记忆、插件、通知、工作区与控制面。

---

## 6. 字段表

图例：● 必填｜○ 可选。类型：`id(x)` 带前缀的 ULID；`ts`；`enum`；`json`。

### 6.1 会话生命周期

**`turn.queued`**
| 字段 | 类型 | 必 | 说明 |
|---|---|:--:|---|
| `turn_id` | `id(tu_)` | ● | 轮次 |
| `delivery` | `enum(auto\|steer\|follow_up)` | ● | 投递方式 |
| `input_ref` | `id(msg_)` | ● | 用户输入消息 |

**`turn.started`**
| `turn_id` | `id(tu_)` | ● | |
| `run_id` | `id(rn_)` | ● | 本次执行 |
| `attempt` | `int` | ● | 第几次 |
| `model` | `string` | ● | 实际路由到的模型 |

**`turn.resumed`**
| `turn_id` / `run_id` | id | ● | |
| `from_step` | `int` | ● | 从第几步恢复 |
| `reason` | `enum(lease_expired\|user_resume\|approval)` | ● | |

**`turn.finished`**
| `turn_id` / `run_id` | id | ● | |
| `status` | `enum(completed\|failed\|cancelled)` | ● | |
| `duration_ms` | `int` | ● | |
| `usage` | `Usage` | ○ | 见 §6.8 |
| `error` | `Error` | ○ | status=failed 时必填 |
| `finish_reason` | `enum(stop\|length\|tool_calls\|error\|cancelled)` | ○ | |

### 6.2 消息与推理

**`message.started`**
| `message_id` | `id(msg_)` | ● | |
| `role` | `enum(assistant\|tool\|system)` | ● | |
| `index` | `int` | ● | 本轮内序号 |
| `speaker` | `string` | ○ | 团队/桥接的说话人 |

**`message.delta`**
| `message_id` | id | ● | |
| `index` | `int` | ● | 块序号（默认 0） |
| `text` | `string` | ● | ≤ 4 KB/帧 |
| `coalesced` | `bool` | ○ | 是否合并帧 |

**`message.completed`**
| `message_id` | id | ● | |
| `blocks` | `array<Block>` | ● | 文本/图片/文件/引用块 |
| `finish_reason` | `enum(stop\|length\|tool_calls\|error)` | ● | |
| `usage` | `Usage` | ○ | |

**`reasoning.delta` / `reasoning.summary`**
| `message_id` | id | ● | |
| `text` | `string` | ● | 增量/摘要 |

### 6.3 工具

**`tool.started`**
| `tool_call_id` | `id(tc_)` | ● | |
| `name` | `string` | ● | 工具名 |
| `source` | `enum(builtin\|mcp\|plugin\|openapi\|skill)` | ● | |
| `risk` | `enum(low\|medium\|high\|critical)` | ● | |
| `args_digest` | `string` | ● | sha256(args) 前 16 位 |
| `args_preview` | `string` | ○ | 截断 500 字，已脱敏 |

**`tool.delta`**
| `tool_call_id` | id | ● | |
| `text` | `string` | ○ | 进度文本 |
| `progress` | `float` | ○ | 0–1 |

**`tool.completed`**
| `tool_call_id` | id | ● | |
| `output` | `json` | ● | 工具返回值（≤ 32 KB） |
| `artifacts` | `array<ArtifactRef>` | ○ | 大内容引用 |
| `ui` | `json` | ○ | 插件渲染描述 |
| `usage` | `Usage` | ○ | 工具自身成本（如搜索 API） |

**`tool.failed`**
| `tool_call_id` | id | ● | |
| `code` | `string` | ● | 错误码 |
| `message` | `string` | ● | 可读信息 |
| `retryable` | `bool` | ● | |

**`tool.async_started` / `async_completed` / `async_cancelled`**
| `tool_call_id` | id | ● | |
| `handle_id` | `id(h_)` | ● | 异步句柄 |
| `output` | `json` | ○ | completed 时必填 |
| `reason` | `string` | ○ | cancelled 时必填 |

### 6.4 审批与插话

**`approval.requested`**
| `approval_id` | `id(ap_)` | ● | |
| `actions` | `array<Action>` | ● | `{tool, args_preview, risk, scope}` |
| `allowed_decisions` | `array<enum>` | ● | `approve/approve_session/deny` |
| `expires_at` | `ts` | ● | |
| `summary` | `string` | ● | 人话摘要 |

**`approval.resolved`**
| `approval_id` | id | ● | |
| `decision` | `enum(approved\|approved_session\|denied\|expired)` | ● | |
| `by` | `id(u_)` | ○ | 人 |
| `scope` | `json` | ○ | 会话授权的范围 |

**`steer.queued`**
| `steer_id` | `id(st_)` | ● | |
| `preview` | `string` | ● | ≤ 200 字 |
| `queue_length` | `int` | ● | |

**`steer.drained`**
| `steer_id` / `turn_id` | id | ● | |
| `injected_at` | `enum(before_model\|turn_end)` | ● | |

**`steer.removed` / `steer.rejected`**
| `steer_id` | id | ● | |
| `reason` | `string` | ● | `user_removed` / `too_large` / `awaiting_approval` |

### 6.5 上下文、计划、产物、错误

**`context.updated`**
| `used` / `max` | `int` | ● | tokens |
| `breakdown` | `json` | ● | system/tools/skills/memory/knowledge/history |

**`context.compacted`**
| `before` / `after` | `int` | ● | tokens |
| `strategy` | `enum(summary\|truncate\|evict)` | ● | |

**`plan.updated`**
| `steps` | `array<Step>` | ● | `{id, title, status, note}` |
| `status` | `enum(draft\|active\|done\|cancelled)` | ● | |

**`artifact.created` / `artifact.updated`**
| `artifact_id` | `id(art_)` | ● | |
| `kind` | `enum(file\|image\|pdf\|pr\|diff\|report\|link)` | ● | |
| `mime` | `string` | ○ | |
| `size` | `int` | ○ | |
| `ref` | `string` | ● | 存储引用或 URL |
| `ticket_id` | `id(tk_)` | ○ | 属于某工单时 |

**`error`**
| `code` | `string` | ● | 与 `ErrorCode` 对齐 |
| `message` | `string` | ● | 已本地化 |
| `retryable` | `bool` | ● | |
| `source` | `enum(model\|tool\|executor\|intake\|platform)` | ● | |
| `details` | `json` | ○ | 已脱敏 |

### 6.6 入口

**`trigger.received`**
| `trigger_id` | `id(tr_)` | ● | |
| `source_id` | `id(src_)` | ● | |
| `kind` | `string` | ● | `issue_comment.created` 等 |
| `actor` | `Actor` | ● | |
| `thread_key` | `string` | ● | |
| `dedupe_key` | `string` | ● | |

**`trigger.filtered`**
| `trigger_id` | id | ● | |
| `reason` | `enum(actor_not_allowed\|bot_not_allowed\|not_explicit\|rate_limited\|rule_denied\|self_message)` | ● | |
| `rule_id` | `string` | ○ | 命中的规则 |

**`trigger.fanned_out`**
| `trigger_id` / `ticket_id` | id | ● | |
| `event_thread_id` | `id(et_)` | ● | |

**`eval.started`**
| `eval_id` | `id(ev_)` | ● | |
| `event_thread_id` | id | ● | |
| `batch_size` | `int` | ● | 合并了几条 Trigger |
| `model` | `string` | ● | |

**`eval.decided`**
| `eval_id` | id | ● | |
| `decision` | `enum(accept\|stop\|ignore\|unavailable)` | ● | |
| `strength` | `enum(explicit\|inferred)` | ○ | |
| `scope` | `array<string>` | ○ | |
| `confidence` | `float` | ● | 0–1 |
| `policy_version` | `int` | ● | |
| `reasons` | `array<string>` | ● | 命中规则/模型理由 |
| `duplicate_of` | `id(tk_)` | ○ | |

### 6.7 工单、派工、待决、巡检

**`ticket.opened`**
| `ticket_id` | `id(tk_)` | ● | |
| `title` | `string` | ● | |
| `source_id` | id | ● | |
| `mandate` | `Mandate` | ● | 见 §6.7 末 |
| `event_thread_id` | id | ● | |

**`ticket.resumed`**
| `ticket_id` | id | ● | |
| `by` | `id(u_)` | ● | |
| `input_id` | `id(tr_)` | ● | 触发恢复的消息 |

**`ticket.ended`**
| `ticket_id` | id | ● | |
| `reason` | `enum(completed\|stopped_by_human\|policy_revoked\|abandoned\|merged)` | ● | |
| `by` | `id(u_)` | ○ | 人停止时 |
| `summary` | `string` | ○ | |

**`ticket.mandate_invalidated`**
| `ticket_id` | id | ● | |
| `policy_version` | `int` | ● | 新版本 |
| `reasons` | `array<string>` | ● | |

**`ticket.merged`**
| `ticket_id` / `into` | id | ● | 被并入的工单 |

**`assignment.started`**
| `assignment_id` | `id(as_)` | ● | |
| `ticket_id` | id | ● | |
| `executor_kind` | `enum(builtin\|codex\|claude_code\|dsh)` | ● | |
| `session_ref` | `string` | ○ | 外部 session id |

**`assignment.reported`**
| `assignment_id` | id | ● | |
| `state` | `enum(progress\|waiting\|ready\|blocked\|failed\|dropped)` | ● | |
| `progress` | `float` | ○ | 0–1，单调不减 |
| `summary` | `string` | ● | ≤ 500 字 |
| `facts` | `json` | ○ | 结构化事实（文件数/测试结果） |
| `artifacts` | `array<ArtifactRef>` | ○ | |
| `usage` | `Usage` | ○ | |

**`assignment.ended`**
| `assignment_id` | id | ● | |
| `state` | `enum(ended\|dead)` | ● | |
| `reason` | `string` | ○ | |

**`assignment.dead`**
| `assignment_id` | id | ● | |
| `attempts` | `int` | ● | |
| `reason` | `string` | ● | |

**`attention.requested`**
| `attention_id` | `id(at_)` | ● | |
| `ticket_id` | id | ● | |
| `kind` | `enum(approval\|question\|blocked)` | ● | |
| `question` | `string` | ● | |
| `options` | `array<string>` | ○ | |
| `expires_at` | `ts` | ● | |

**`attention.resolved`**
| `attention_id` | id | ● | |
| `status` | `enum(answered\|expired\|dismissed)` | ● | |
| `answer` | `json` | ○ | |
| `by` | `id(u_)` | ○ | |

**`watchdog.alert`**
| `assignment_id` | id | ● | |
| `kind` | `enum(stalled\|drifting\|error_loop)` | ● | |
| `detail` | `string` | ● | |
| `action` | `enum(notify\|stop\|requeue)` | ● | |

**`Mandate` 对象**
```json
{
  "policy_version": 7,
  "scope": ["repo:acme/api", "path:src/auth"],
  "strength": "explicit",
  "matched_rules": ["allow-assigned"],
  "actor": {"source": "github", "id": "u_123", "name": "alice"},
  "granted_at": "2026-11-05T10:02:11Z"
}
```

### 6.8 渠道与用量

**`channel.sent`**
| `channel_id` | `id(ch_)` | ● | |
| `ticket_id` | id | ● | |
| `target` | `json` | ● | `{kind, id}` |
| `external_id` | `string` | ● | 平台消息 id |
| `idem_key` | `string` | ● | |

**`channel.failed`**
| `channel_id` | id | ● | |
| `code` / `message` | `string` | ● | |
| `retryable` | `bool` | ● | |

**`usage.recorded`**
| `scope` | `enum(turn\|eval\|tool\|embedding\|executor)` | ● | |
| `model` | `string` | ○ | |
| `input_tokens` / `output_tokens` / `cached_tokens` | `int` | ● | |
| `cost_micros` | `int` | ● | |
| `currency` | `string` | ● | `CNY` / `USD` |
| `price_version` | `string` | ● | |

**`Usage`（内嵌对象）**
```json
{ "input_tokens": 1200, "output_tokens": 340, "cached_tokens": 800, "cost_micros": 42000, "model": "deepseek-v4" }
```

---

### 6.9 补齐事件（2026-11）

**`cron.fired`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cron_job_id` | `id(cj_)` | ● | 定时任务 |
| `scheduled_at` / `fired_at` | `ts` | ● | 计划/实际触发 |
| `action` | `enum(notify\|run_agent\|run_workflow)` | ● | 动作 |
| `trigger_id` | `id(tr_)` | ○ | 转成 Trigger 后回填 |
| `late` | `bool` | ○ | 是否补跑 |

**`channel.inbound`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `channel_id` | `id(ch_)` | ● | 渠道账号 |
| `channel_kind` | `string` | ● | feishu/dingtalk/wecom/... |
| `external_id` | `string` | ● | 平台消息 id（幂等键） |
| `sender` | `json` | ● | `{id,name,is_bot}` |
| `content` | `json` | ● | 文本/附件引用 |
| `thread_key` | `string` | ● | 群/会话标识 |
| `received_at` | `ts` | ● | |
| `dedupe_key` | `string` | ● | |

**`delegation.started` / `delegation.ended`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `delegation_id` | `id(dg_)` | ● | |
| `team_id` | `string` | ● | 仅 started |
| `parent_run_id` | `id(rn_)` | ● | 仅 started |
| `member_agent_id` | `string` | ● | 仅 started |
| `child_thread_id` | `id(th_)` | ○ | 仅 started |
| `dedupe_key` | `string` | ● | 仅 started |
| `state` | `enum(ended\|dead)` | ● | 仅 ended |
| `reason` | `string` | ○ | 仅 ended |
| `usage` | `Usage` | ○ | 仅 ended |

**`memory.written` / `memory.updated`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `atom_id` | `id(ma_)` | ● | |
| `tenant_id` / `agent_id` | `string` | ● | written |
| `kind` | `enum(fact\|preference\|episode\|profile\|skill)` | ● | written |
| `source` | `enum(explicit_user\|assistant_inferred\|import\|migration)` | ● | written |
| `confidence` | `float` | ● | written |
| `evidence` | `json` | ● | written |
| `status` | `enum(active\|retired\|pending_review)` | ● | updated |
| `supersedes` | `id(ma_)` | ○ | updated |
| `reason` | `string` | ○ | updated |

**`plugin.installed` / `plugin.failed`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `plugin_id` | `id(pl_)` | ● | |
| `version` | `string` | ● | installed |
| `permissions` | `arr(string)` | ● | installed |
| `signature` | `string` | ○ | installed |
| `code` / `message` | `string` | ● | failed |

### 6.10 通知 / 工作区 / 控制面 / 订阅

**`notification.created`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `notification_id` | `id(nt_)` | ● | |
| `user_id` | `id(u_)` | ● | 接收人 |
| `kind` | `enum(task\|cloud\|export\|system)` | ● | |
| `title` | `string` | ● | |
| `link` | `string` | ○ | 站内跳转 |
| `dedupe_key` | `string` | ● | 幂等 |

**`workspace.changed`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `agent_id` | `string` | ● | |
| `thread_id` | `id(th_)` | ○ | |
| `path` | `string` | ● | 工作区相对路径 |
| `change` | `enum(created\|updated\|deleted)` | ● | |
| `size` | `int` | ○ | |

**`control.started` / `control.ended`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | `id(cs_)` | ● | |
| `kind` | `enum(terminal\|browser)` | ● | started |
| `agent_id` | `id(ag_)` | ○ | started |
| `status` | `enum(closed\|error)` | ● | ended |
| `reason` | `string` | ○ | ended |

**`subscription.created`**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `subscription_id` | `id(sb_)` | ● | |
| `ticket_id` | `id(tk_)` | ● | |
| `event_thread_id` | `id(et_)` | ● | |

---

## 7. 完整示例

**流式增量**
```json
{
  "v": 1, "event_id": "ev_01J9Z8Q3K7", "stream_id": "conv:th_88",
  "seq": 41, "type": "message.delta", "ts": "2026-11-05T13:20:00.123Z",
  "tenant_id": "default", "actor": {"kind": "agent", "id": "ag_1"},
  "trace_id": "4bf92f...", "causation_id": "ev_01J9Z8Q3K6",
  "correlation_id": "tu_77",
  "refs": {"thread_id": "th_88", "turn_id": "tu_77", "run_id": "rn_66"},
  "payload": {"message_id": "msg_55", "index": 0, "text": "先看一下 "},
  "meta": {"coalesced": true, "producer": "kernel"}
}
```

**研判结果**
```json
{
  "v": 1, "event_id": "ev_01J9Z9...", "stream_id": "src:src_gh",
  "seq": 812, "type": "eval.decided", "ts": "2026-11-05T13:21:02.000Z",
  "tenant_id": "default", "actor": {"kind": "system", "id": "intake"},
  "causation_id": "ev_01J9Z9...", "correlation_id": "eval_9",
  "refs": {"event_thread_id": "et_12", "source_id": "src_gh"},
  "payload": {
    "eval_id": "eval_9", "decision": "accept", "strength": "explicit",
    "scope": ["repo:acme/api", "path:src/auth"],
    "confidence": 0.86, "policy_version": 7,
    "reasons": ["allow-assigned", "explicit_mention"],
    "duplicate_of": null
  }
}
```

**执行报告**
```json
{
  "v": 1, "event_id": "ev_01J9ZA...", "stream_id": "ticket:tk_12",
  "seq": 9, "type": "assignment.reported", "ts": "2026-11-05T13:32:00.000Z",
  "tenant_id": "default", "actor": {"kind": "executor", "id": "builtin"},
  "refs": {"ticket_id": "tk_12", "assignment_id": "as_3"},
  "payload": {
    "assignment_id": "as_3", "state": "ready", "progress": 1.0,
    "summary": "已修复并提交 PR #418",
    "facts": {"files_changed": 3, "tests": "passing"},
    "artifacts": [{"kind": "pr", "ref": "https://github.com/acme/api/pull/418"}],
    "usage": {"input_tokens": 18000, "output_tokens": 2200, "cost_micros": 52000, "model": "x"}
  }
}
```

---

## 8. 一致性与投递语义

| 保证 | 说明 |
|---|---|
| 流内有序 | `seq` 严格 +1；客户端发现跳号 → 拉 `GET /events?after_seq=` 补齐 |
| 至少一次 | 断线重连可能重发；消费方按 `event_id` 去重，UI 按 `(stream_id, seq)` 去重 |
| 不保证跨流顺序 | 用 `causation_id` 还原因果 |
| 写入即持久 | 事件先落库再推送；推送失败不影响事实 |
| 回放确定性 | 同一 `stream_id + seq` 的事件内容不变（追加写，不更新） |

**客户端状态机**：`connecting → syncing(after_seq) → live → resyncing`。`resyncing` 时暂停渲染增量，先补齐再继续。

---

## 9. 大小、截断与脱敏

| 规则 | 值 |
|---|---|
| 单事件 payload 上限 | 32 KB；超出 → 写 `artifact`，事件只带 `data_ref` |
| 单条 delta | ≤ 4 KB；超出拆帧 |
| 工具输出 | ≤ 32 KB；超出截断 + `truncated: true` + `data_ref` |
| 工具参数 | 只存 `args_digest` + `args_preview`（500 字，脱敏） |
| 思考内容 | 默认只发摘要；原文可选且 30 天过期 |
| 密钥/PII | 结构化脱敏（正则 + 已知 secret 值匹配）；`raw` 载荷 30 天 |

---

## 10. 版本化与兼容

- `v` 是**信封**版本；`payload` 只做加法（新增可选字段）。
- 破坏性变更（改名/删字段/改类型）→ 新 `type` 或 `v=2`，**双发一个版本周期**。
- 事件目录有 `deprecated_at`；被弃用类型至少保留 2 个版本。
- 生产/消费双方在启动时校验 `schema_version`，不匹配拒绝启动（fail-fast）。

---

## 11. 代码生成与校验（已落地）

契约已实现为可执行代码，位于 [`contracts/`](../contracts/)：

```
contracts/spec/events.py            ← 作者源（61 事件 + 共享对象）
      │  python -m contracts.generate
      ├─→ schemas/events/**/*.schema.json    （发布契约，61 个文件 + common + envelope + index）
      ├─→ schemas/api/openapi.json           （OpenAPI 3.1，11 paths / 21 schemas）
      ├─→ generated/py/poly_contracts/events.py（Pydantic v2：EventBase + 61 payload + 61 event + PolyEvent）
      └─→ generated/ts/src/events.gen.ts     （TS：信封 + 共享对象 + 61 事件 + 联合类型）
```

> 注意：作者源是 Python spec，不是 JSON Schema。JSON Schema 是**发布产物**，供其它语言与网关消费；改字段先改 spec 再生成。

**校验命令**

```bash
python -m contracts.generate          # 生成
python -m contracts.check             # 生成物同步 + schema/index/示例/OpenAPI/TS 数量
python -m contracts.runtime_check     # 需 pydantic：真实解析示例 + 拒绝未知类型/多余字段
```

**CI 门禁（已实现）**

1. `python -m contracts.generate --check`：生成物与 spec 不一致即失败，并列出过期文件；
2. `python -m contracts.check`：61 个 schema 与 index 对齐、示例通过校验、OpenAPI operationId 唯一、路径参数齐全、`$ref` 可解析；
3. `python -m contracts.runtime_check`：Pydantic 能解析三个事件样例与三个 API 样例，且拒绝未知 `type`、拒绝 payload 多余字段；
4. 命名约束：事件类统一加 `Event` 后缀（`ErrorEvent`、`UsageEvent`），避免与共享对象 `Error`/`Usage` 冲突。

---

## 12. 与其它文档的对应

| 文档 | 对应内容 |
|---|---|
| `02` §3.4 | 信封与事件分类（本文是其完整化） |
| `03` §5/§6 | kernel/capabilities 产生的事件 |
| `07` §4.4 | intake 的 12 类事件（本文扩到 19 类） |
| `09` §2–§9 | 字段语义与边界条件 |
| `04` §4.10 | 前端如何消费这些帧（批量、重连、降级） |
