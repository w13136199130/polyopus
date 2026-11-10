# 41 · 技术 Spike 设计与验证方案

> 目的：在 M0 前用最小成本验证 5 个“如果不成立就会返工”的假设。
> 原则：每个 spike 只回答一个 yes/no；允许丢代码，不允许丢结论。
> 时间盒：每个 1–3 天，总计不超过 8 个工作日。
>
> **执行状态（2026-11-10）**：
> - S1 ✅ **GO**：7/7 通过；11,986 事件全量重放 93ms（预算 2s）、峰值内存 0.1MB；kill 续跑/重复幂等/缺洞报错/upcaster 全绿 → **不需要快照即可满足恢复**。
> - S2 ✅ **GO**：11/11 通过；跨租户一律 404 不泄露存在性、签名 URL 绑租户、审计覆盖、repo 无裸 SELECT。
> - S3 ✅ **GO**：12/12 通过；异常/超时路径 0 次 allow；执行期二次校验无视"声称已批准"。
> - **M0 准入达成**（G-S1/G-S2/G-S3 全绿）。S4/S5 待做（M2 前完成，不阻塞 M0）。
> - 代码在 [`spikes/`](../spikes/README.md)，结论汇总见其 README。

---

## 0. 结论与执行顺序

| 顺序 | Spike | 回答的问题 | 时间盒 | 不通过时 |
|---|---|---|---|---|
| S1 | 事件重放 + `messages` 投影重建 | events 能不能作为唯一真相？ | 2d | 退化为 snapshot + tail replay |
| S2 | 租户隔离负向测试 | 跨租户能不能被彻底挡住？ | 2d | 收紧 repo 基类 + SQL lint |
| S3 | 策略引擎 fail-closed | 任何异常会不会变成 allow？ | 1.5d | 策略求值前移 + 默认 deny |
| S4 | 插件子进程 + 只读挂载 | 插件能不能不碰宿主？ | 3d | 降级为“仅内置插件”，外部插件 v2 |
| S5 | 记忆 20 条探针 | 三层记忆能不能达到可用质量？ | 2d | 接 `octop-memory` 适配器 |

**Go/No-Go**：S1/S2/S3 必须通过才能进 M0；S4/S5 可在 M1/M2 前完成。

---

## 1. S1 · 事件重放 + `messages` 投影重建

### 假设

给定 `events` 表，能在不读 checkpoint、不读缓存的情况下，重建出与在线投影一致的 `messages`；重放可中断、可续跑、可重复执行。

### 设计

```
events(thread_id, seq, type, payload_json, schema_version, created_at)
messages(thread_id, message_id, turn_id, role, content_json, status, seq)
```

- 投影只消费 `message.*` / `turn.*` / `tool.*` / `approval.*` 事件。
- 重放入口：`rebuild(thread_id, from_seq=0, to_seq=null)`。
- 幂等键：`(thread_id, message_id)`；重复应用同一事件不产生第二条。
- 顺序：严格按 `seq`；发现洞 → 停止并报 `EVENT_GAP`，不跳过。
- 快照：重放超过 N 条时先加载最近快照，再 tail replay。
- 版本：事件 `schema_version` 走 upcaster，不允许直接改旧 payload。

### 用例矩阵

| # | 场景 | 期望 |
|---|---|---|
| 1 | 1 个 thread，10k 事件，全量重放 | 与在线投影 hash 一致；≤2s；内存 ≤200MB |
| 2 | 100 个 thread 并行重放 | 无串线程；总耗时线性 |
| 3 | 重放到 5k 时 kill | 重启从 5k 继续；不重复 |
| 4 | 同一事件投递 2 次 | 投影仍只有 1 条 |
| 5 | 缺 seq=500 | 报 `EVENT_GAP`，不静默跳过 |
| 6 | 旧 schema_version | upcaster 后可重放 |
| 7 | 重放期间在线写入 | 重放只读；在线投影不受影响 |

### 验收

- 投影 hash 一致率 100%。
- 10k 事件全量重放 p95 ≤ 2s；断点续跑 ≤ 500ms 启动。
- 重复/乱序/缺口三类异常都有明确错误，不静默。
- 重放前后 `messages` 行数与内容一致。

### 实现步骤

1. 建 `events` / `messages` 最小表 + 3 个事件类型（turn.started/message.delta/message.completed）。
2. 写 `apply(event)` 纯函数；单测覆盖重复/乱序/缺口。
3. 写 `rebuild(thread_id)`；先全量，再加 snapshot。
4. 造 10k 事件 fixture；记录耗时/内存。
5. 做 kill -9 续跑演示。
6. 输出结论：全量重放可行 / 需要快照阈值。

### 回退

若 10k 全量重放 > 5s：改为“每 1k 事件一个快照 + tail replay”，在线投影不变。

---

## 2. S2 · 租户隔离负向测试

### 假设

任何 API、repo 查询、检索、事件流、附件 URL、导出，都不能跨租户读到或写到别人的数据；错误不泄露资源存在性。

### 设计

- `tenant_id` 由认证上下文注入，**不允许从请求体/query 取**。
- repo 基类强制 `WHERE tenant_id = ?`；service 不手写 tenant 条件。
- 资源 ID 全局唯一但查询必须带 tenant；跨租户返回 404（不是 403，避免泄露存在性）。
- 事件流/WS 订阅按 tenant + thread 校验。
- 附件/artifact URL 用短期签名，签名内含 tenant。

### 用例矩阵

| # | 入口 | 场景 | 期望 |
|---|---|---|---|
| 1 | `GET /threads/{id}` | A 租户读 B 的 thread | 404 |
| 2 | `GET /threads` | 列表 | 只返回本租户 |
| 3 | `GET /threads/{id}/events` | SSE 跨租户 | 404 / 关闭 |
| 4 | `POST /threads/{id}/turns` | 跨租户写 | 404 |
| 5 | `GET /knowledge-bases/{id}/search` | 跨租户检索 | 0 命中 + 不泄露 KB 名 |
| 6 | `GET /memories/search` | 跨租户记忆 | 0 命中 |
| 7 | 附件签名 URL | 换 tenant 重放 | 403 |
| 8 | `GET /usage/summary` | 跨租户聚合 | 只本租户 |
| 9 | `GET /admin/audit` | 非本租户管理员 | 403 |
| 10 | WS 订阅 | 跨租户 thread | 关闭 + 审计 |

### 验收

- 10/10 负向用例通过。
- 错误体不含对方资源名、ID、计数。
- 所有跨租户尝试写 `audit_log`。
- CI 静态检查：`SELECT ... FROM` 无 `tenant_id` 条件即失败。

### 实现步骤

1. 两个租户 fixture（A/B），各 1 用户、1 thread、1 KB、1 memory。
2. 用 FastAPI TestClient 跑 10 条负向用例。
3. 加 repo 基类测试：任何 list/get 必须带 tenant。
4. 加 SQL lint（正则/AST）检查裸查询。
5. 输出：通过的用例、失败原因、修复点。

### 回退

若某些表无法加 tenant（全局配置），列入白名单并写明“只读、无业务数据”。

---

## 3. S3 · 策略引擎 fail-closed

### 假设

策略求值的任何异常（规则加载失败、DSL 报错、超时、依赖不可用、无匹配）都不会导致工具被执行；默认是 deny 或 ask，而不是 allow。

### 设计

```
evaluate(subject, agent, tool, args) -> Decision{effect, matched[], obligations[], reason}
```

- 求值顺序：显式 deny → tenant 强制 → agent 覆盖 → 默认（risk>=high → ask，critical → deny）。
- 异常处理：任何异常 → `deny` + `reason=policy_error`，并写审计。
- 超时：默认 50ms；超时 → `deny`（不是跳过规则）。
- 无规则：`risk=low` 且只读 → allow；其余 → ask。
- 执行期再判一次：`ToolRuntime.invoke()` 重新 evaluate，防绕过。

### 用例矩阵

| # | 场景 | 期望 |
|---|---|---|
| 1 | 规则 allow | 执行 |
| 2 | 规则 deny | 不执行，结构化拒绝 |
| 3 | 规则 ask | 暂停 + Attention |
| 4 | 规则 YAML 语法错 | deny + 告警 |
| 5 | `when` DSL 抛异常 | deny |
| 6 | 求值超时 | deny |
| 7 | 无任何规则 + 写工具 | ask |
| 8 | 无任何规则 + 只读工具 | allow |
| 9 | 插件未签名 | ask |
| 10 | critical 工具 | deny |
| 11 | prompt 里伪造“已批准” | 仍走 evaluate，不执行 |
| 12 | 直接构造 ToolCall 绕过 UI | 执行期 deny/ask |

### 验收

- 12/12 通过；异常场景 0 次 allow。
- 每次决策写 `policy_decisions`（或审计）含 matched rules。
- 执行期二次校验可独立测试。

### 实现步骤

1. 写纯函数 `evaluate()` + 6 条规则。
2. 用表驱动测试覆盖 allow/ask/deny/异常/超时。
3. 写 `ToolRuntime.invoke()` 包装：先 evaluate 再执行。
4. 注入 fault（抛异常/延迟）验证 fail-closed。
5. 输出：决策矩阵与审计样例。

### 回退

若 DSL 求值不可靠：退化为“只支持固定字段匹配”的 YAML，不做表达式。

---

## 4. S4 · 插件子进程 + 只读挂载

### 假设

插件在独立子进程中运行，只能读授权 workspace、不能写宿主、不能任意出网；崩溃/死循环/内存炸弹不影响宿主。

### 设计

- 进程模型：宿主 spawn 子进程；stdio JSON-RPC；每插件一个进程（或按需池）。
- 文件：workspace 只读挂载；临时目录可写；禁止访问宿主 env/其他目录。
- 网络：默认禁止；授权后走 egress proxy（allowlist + 审计）。
- 权限：`plugin.yaml permissions: [fs:workspace:read, http:outbound]`；运行时由宿主强制。
- 资源：CPU/内存/输出上限；超时 kill；崩溃自动禁用并记 `plugin.failed`。
- 签名：安装时记录 sha256；未签名默认 `risk=high`。

### 用例矩阵

| # | 场景 | 期望 |
|---|---|---|
| 1 | 读 workspace 文件 | 允许 |
| 2 | 写 workspace | 拒绝 |
| 3 | 读 `/etc/passwd` 或宿主 home | 拒绝 |
| 4 | 读环境变量 secret | 拒绝/脱敏 |
| 5 | 外网请求未授权 | 拒绝 |
| 6 | 外网请求 allowlist | 经代理成功 |
| 7 | 死循环 | 超时 kill，宿主正常 |
| 8 | 内存炸弹 | 限额 kill，宿主正常 |
| 9 | 输出 100MB | 截断 + artifact |
| 10 | 子进程崩溃 | `plugin.failed`，不影响其他插件 |
| 11 | 未签名插件 | ask/deny |
| 12 | 插件尝试 kill 宿主 | 无权限/失败 |

### 验收

- 12/12 通过；宿主进程零崩溃。
- 越权访问全部被拒且有审计。
- 插件故障隔离：其他插件/对话不受影响。

### 实现步骤

1. 用 Python `multiprocessing` 或 `subprocess` 起 echo 插件。
2. 只读挂载/临时目录；用 `os.access` 验证写拒绝。
3. 加 JSON-RPC 调用 + 超时 + kill。
4. 加网络代理（或先验证“无网络”）。
5. 加内存/输出限制。
6. 输出：权限矩阵与故障注入结果。

### 回退

若 3 天内做不到可靠隔离：v1 只允许内置/签名插件，第三方插件延后到 v2；文档明确“不承诺进程内沙箱”。

---

## 5. S5 · 记忆 20 条探针

### 假设

三层记忆（raw → candidate → atom）+ BM25/向量 + 冲突/TTL，在 20 条探针上达到可用质量，且不污染、不跨租户。

### 设计

- 20 条探针分布：
  - 事实 6：环境、地址、版本、负责人、端口、限制。
  - 偏好 4：语言、格式、称呼、禁用词。
  - 情节 4：某次故障、某次发布、某次回滚、某次评审。
  - 冲突 2：旧/新事实，验证 supersedes。
  - TTL 1：过期事实不再召回。
  - 删除 1：删除后不再召回。
  - 跨租户 1：B 租户不可见。
  - 污染 1：网页/工具输出里的“请记住”不写入。
- 写入：模拟 10 轮对话 + 2 条显式“记住”。
- 读取：用 20 个问题跑 top8。
- 指标：命中率、矛盾率、陈旧率、污染率、p95 延迟。

### 用例矩阵

| # | 类型 | 期望 |
|---|---|---|
| 1–6 | 事实 | top8 含正确 atom |
| 7–10 | 偏好 | top8 含偏好，回答遵守 |
| 11–14 | 情节 | top8 含对应 episode |
| 15–16 | 冲突 | 只召回新事实；旧 atom retired |
| 17 | TTL | 过期 atom 不出现 |
| 18 | 删除 | 删除后不出现 |
| 19 | 跨租户 | 0 命中 |
| 20 | 污染 | 工具输出不产生 atom |

### 验收

- 命中率 ≥ 85%（17/20）。
- 矛盾率 ≤ 2%；陈旧率 ≤ 5%；污染率 0。
- 召回 p95 ≤ 100ms；写入异步不阻塞回复。
- 重启后不重复抽取（event_id 幂等）。

### 实现步骤

1. 用 fixture 生成 10 轮对话与 20 个问题。
2. 跑抽取 → candidate → atom；检查白名单与去重。
3. 跑召回；记录 top8 与分数。
4. 注入冲突/TTL/删除/跨租户/污染用例。
5. 输出：命中矩阵、失败原因、是否接 `octop-memory`。

### 回退

若命中率 < 70%：先接 `octop-memory` 适配器（ADR-009），自研层只保留写入策略与用户控制。

---

## 5A. S6 · DSH 执行器适配（v1.5 前置，非 M0 门槛）

### 假设

把 `dsh` 作为外部执行器接入，只需实现 `08 §3` 端口与 `Report` 翻译，**不需要**改内核、状态机或数据库。

### 设计

- 适配器 `DshExecutor`：`start()` 建一个 DSH session + 独立 workdir；`send()` 投递人消息；`stop()` 杀进程树。
- 输入只给 `mandate.scope` 内的工具与路径；输出只认 `Report` 六态。
- Harness 版本、Node 版本、插件清单写进 `deploy/executors/dsh.lock`，启动时校验。

### 用例矩阵

| # | 用例 | 期望 |
|---|---|---|
| 1 | 正常改一行并开 PR | `Report.ready` + artifact(pr) |
| 2 | 请求 scope 外的路径 | 拒绝 + 审计 + Attention("外部执行器请求超出授权") |
| 3 | 执行中 kill -9 适配器进程 | 租约过期 → `pending`（attempt+1），不重复开 PR |
| 4 | 执行器内部审批拒绝、我们允许 | 以更严格者为准，不放行 |
| 5 | 长任务中途人插话 | 投递成功，任务不重启 |
| 6 | Harness 版本不匹配 | 启动失败 + 明确错误，不降级运行 |

### 验收

- 6/6 通过；`Report` 六态映射无歧义；`stop()` 后无残留子进程。
- 通过 → v1.5 启用 `executor_kind=dsh`；不通过 → 编码场景继续用 `codex`。

### 回退

删除适配器与 lock 文件即可，不影响内置执行器与库表（`executor_kind` 只是字符串枚举）。

---

## 6. 最小 Harness 与目录

```
spikes/
├─ s1_event_replay/
│  ├─ README.md          # 假设、命令、结论
│  ├─ fixtures/          # 10k events
│  └─ run.py
├─ s2_tenant_isolation/
│  ├─ README.md
│  └─ test_isolation.py
├─ s3_policy/
│  ├─ README.md
│  └─ test_policy.py
├─ s4_plugin_sandbox/
│  ├─ README.md
│  ├─ host.py
│  └─ plugin_echo/
├─ s5_memory_probes/
│  ├─ README.md
│  ├─ probes.yaml
│  └─ run.py
└─ README.md             # 索引、结论汇总、Go/No-Go
```

规则：

- `spikes/` 不进入生产构建；允许丢弃。
- 每个 spike 的 README 必须写：假设、命令、结果、结论、回退。
- 结论同步到 `40` 的 DoD 评审与 `38` 的缺陷状态。

---

## 7. Go/No-Go 判定

| 门 | 条件 | 不通过动作 |
|---|---|---|
| G-S1 | 10k 重放 hash 一致 + ≤2s | 加快照；仍不行则重新评估事件溯源范围 |
| G-S2 | 10/10 跨租户被拒 | 阻塞 M0，先修 repo 基类 |
| G-S3 | 异常场景 0 allow | 阻塞 M0，策略引擎重做 |
| G-S4 | 12/12 隔离通过 | 降级为“仅内置/签名插件” |
| G-S5 | 命中 ≥85%、污染 0 | 接 `octop-memory` 或降低记忆承诺 |
| G-S6 | 6/6 通过，且 0 次越权 | 编码场景继续用 `codex`，dsh 适配器不进 v1.5 |

**M0 准入**：G-S1、G-S2、G-S3 全绿；S4/S5 可在 M1/M2 前完成。

---

## 8. 交付物模板

每个 spike 的 README 固定 6 段：

1. 假设（一句话）
2. 环境与命令
3. 用例结果表（通过/失败/原因）
4. 指标（耗时/内存/命中率）
5. 结论（可行/不可行/需替代）
6. 回退方案与待办
