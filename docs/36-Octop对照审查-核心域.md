# 36 · Octop 对照审查：上下文 / 记忆 / 知识 / 用户权限 / 技能工具

> 目的：不是再列一遍功能，而是回答"**同样是这些能力，Octop 怎么实现的、PolyOpus 怎么设计的、差在哪、实现步骤有什么不同**"。
> 证据：Octop `1.0.3b2` 运行时代码（`src/octop/` + `.venv` 中 `octop-harness 1.0.6` / `deepagents` / `octop-memory 1.0.2`）。
> 对照：PolyOpus `02/03/13/28/29/31/34`。
>
> **版本提示**：本文基于 b2；b3/b4 的增量（云主机、多实例、通知、TOS、技能包 PG/文件树等）见
> [`37-Octop-1.0.3b4对照与问题清单.md`](37-Octop-1.0.3b4对照与问题清单.md)。

---

## 0. 结论先行

| 判断 | 说明 |
|---|---|
| Octop 强在"**单机体验与交互细节**" | 渐进披露技能、工具结果 offload、压缩不销毁原文、记忆引擎分层、SSO/MFA 完整 |
| Octop 弱在"**状态、治理、隔离**" | 进程内缓存、五套工具治理、任意 Python 插件、无租户、IM 身份塌缩 |
| PolyOpus 强在"**骨架与契约**" | 事件溯源、持久化 Turn/Run/Step、单一策略引擎、多租户、契约先行 |
| PolyOpus 弱在"**部分能力的实现深度**" | 记忆抽取/实体页、技能渐进披露、上下文实现细节仍停留在设计 |
| 两者不是"谁抄谁" | Octop 是"把 deepagents + octop-memory 组装到极致"；PolyOpus 是"把引擎收回来自己控" |

**一句话**：Octop 是**产品级组装**，PolyOpus 是**平台级重写**；短期 Octop 的交互与记忆质量更成熟，长期 PolyOpus 的恢复性、可审计性与多租户是硬优势。

---

## 1. 设计哲学对照

| 维度 | Octop | PolyOpus | 差异性质 |
|---|---|---|---|
| 会话真相 | LangGraph checkpoint + jsonl + thread_messages + trajectory 四套并存 | `events` append-only 为真相，`messages` 为投影 | 架构替换 |
| 运行状态 | 进程内 dict / LRU / 内存队列 | DB + 租约 + outbox | 架构替换 |
| 上下文 | 外包给 deepagents 中间件，无硬预算 | 自研 `ContextAssembler`，分段预算 + 硬保留 | 控制权收回 |
| 记忆 | 独立引擎 `octop-memory`（5 层） | `MemoryProvider` 端口 + 轻量默认实现 | 自研薄层 + 可换引擎 |
| 知识 | 固定 800/120 字符 + 每 KB SQLite 暴力余弦 | 结构感知切片 + pgvector/BM25 + RRF/rerank/MMR | 重做 |
| 用户/权限 | 单实例、角色模板 + 权限快照、组可见性 | 多租户、RBAC + 资源 ACL、refresh 轮换 | 重做 |
| 工具治理 | 5 套并行（catalog/plugin/skill/security/MCP） | 单一策略引擎（allow/ask/deny + obligations） | 收敛 |
| 扩展 | 任意 Python 插件，无 api_version | manifest + permissions + 签名 + dev 模式 | 加固 |
| 失败策略 | 大量 fail-soft、静默降级 | fail-closed + 事件/审计 + 可观测 | 反向取舍 |
| 演进方式 | 运行时反射、monkeypatch、版本探测 | 契约/端口/依赖方向 CI | 工程化 |

---

## 2. 上下文工程

### 2.1 Octop 的实现步骤

1. **建图时拼 system prompt**：`base_prompt + 工作目录指令 + memory policy + slash-skill prompt`（`octop_harness/agent.py:1777-1823`），deepagents 再追加 profile、BOOTSTRAP、Skills 段、memory 文件段。
2. **记忆文件固定四份**：`AGENTS.md → MEMORY.md → USER.md → SOUL.md`，包进 `<agent_memory>`，去掉 HTML 注释（`deepagents/middleware/memory.py:245-278`）。
3. **不设硬预算**：`DEFAULT_MAX_TOKENS=128k` 只是展示兜底；真实窗口取模型 profile 的 `max_input_tokens`，溢出靠压缩/驱逐。
4. **缓存前缀**：对 Anthropic 给 memory 块打 `cache_control: ephemeral`；召回内容**追加到 user message 末尾**，避免破坏 system/tool 前缀（`memory_recall.py:30-40`）。
5. **每次模型调用前检查压缩**：`wrap_model_call` 在 `0.85 × max_input_tokens` 触发，保留最近 `10%`；旧消息交给摘要模型（`summarization.py:262-297, 1524`）。
6. **压缩不销毁原文**：原始 `state["messages"]` 保留，用私有 `_summarization_event` 表示压缩；被驱逐消息追加写入 `conversation_history/<session>.md`，摘要里给路径让模型 `read_file`（`summarization.py:712-780`）。
7. **工具结果驱逐**：单次结果 >20k token 时写入 `large_tool_results/<call_id>`，消息里只留头尾各 5 行 + 路径；`read_file` 自己按 20k 截断，靠 `offset/limit` 分页（`filesystem.py:1785, 3340-3355`）。
8. **手工 `/compact` 更激进**：保留 6 条、最少 8 条才压缩；offload 失败会中止压缩（`octop_harness/compaction.py:34-43, 246-301`）。

### 2.2 PolyOpus 的设计步骤

1. `ContextAssembler.assemble()` 按 **稳定前缀** 组装：系统身份 → AGENTS → 工具定义 → 技能索引 → 记忆快照 → 知识片段 → 滚动摘要 → 最近 N 轮 → 当前输入（`13 §3.1`）。
2. 按 **128k 预算表** 分配：系统 4k / 工具 12k / 技能 3k / 记忆 10k / 知识 20k / 摘要 8k / 最近原文 50k / 输出 16k / 余量 5k。
3. 超限顺序写死：**先砍知识 → 再把原文转摘要 → 最后砍记忆**；system 与输出预留永不砍（`13 §3.2`）。
4. 压缩触发 `0.75` 预警、`0.85` 执行；工具结果占比 >50% 时**先 clearing 再压缩**（`13 §3.3`）。
5. 压缩提示词带**保留清单**：目标/约束、已做决策及理由、未解决问题、关键事实与数字、文件/PR/引用 ID、用户偏好。
6. 压缩后跑 **3–5 个探针问题**；答不上来回退到"只 clearing 不压缩"；保留 `context_snapshots` 可展开原文（`13 §3.3`）。
7. 工具结果 clearing 判据：>2k token、`replayable=true`、不在最近 3 次调用内；替换为占位但保留 `tool_use`（`13 §3.4`）。
8. 引用图 `ref://`：trigger → event_thread → ticket → assignment → run → tool_call；模型可 `recall(ref)` / `expand(ref)`（`13 §3.5`）。
9. 长任务放子 Agent，只回传结论 + 引用 ID（`13 §3.6`）。

### 2.3 差异与审查

| 项 | Octop | PolyOpus | 评价 |
|---|---|---|---|
| 预算 | 无硬预算，靠模型 profile + 压缩 | 显式分段预算 + 硬保留 | PolyOpus 更可控，但需按模型维护 profile |
| 触发 | 0.85 / 保留 10% | 0.75 预警 / 0.85 执行 | 基本一致 |
| 保留策略 | 最近 10% + 摘要，保留原文可读 | 保留清单 + 探针校验 + 快照回滚 | PolyOpus 更可验证 |
| 工具结果 | >20k token 落文件，保留头尾 | >2k token 且 replayable 才 clearing | PolyOpus 阈值更激进而保守，需按模型调 |
| 召回注入 | 追加 user message 后缀 + hash 后缀 | 记忆段在 system 之后、user 之前 | Octop 对缓存更友好；PolyOpus 需确保前缀稳定 |
| 失败 | offload 失败继续，可能丢旧消息 | 压缩失败回退，不丢 | PolyOpus 更安全 |
| 评测 | 无上下文探针 | 探针通过率 ≥95%、压缩比 ≥2.5、p95 ≤8s | PolyOpus 补上了闭环 |

**审查结论**：
- 必须借 Octop 的 **"压缩不销毁原文 + offload 文件可 read_file"** 思路；PolyOpus 的 `context_snapshots` 已覆盖，但需明确"模型如何按需取回"。
- PolyOpus 的固定预算表要升级为 **按模型 profile**（如 32k/128k/200k 三档），否则小窗口模型会直接超限。
- Octop 的"召回放 user 后缀"值得保留，能保护 prompt cache；PolyOpus 应把"记忆快照"与"召回"分开：快照进前缀，召回进当前输入。

---

## 3. 记忆系统

### 3.1 Octop 的实现步骤

1. **分层存储**：`raw_events → candidates → AtomCard → Episode → Entity/EntityPage`，另有 `digests/journal`；用户文件 `MEMORY.md`、`USER.md`、`DREAMS.md`、`memory/YYYY-MM-DD.md` 单独索引（`octop_memory/types.py:136-370`）。
2. **捕获**：每次模型调用后只留触发用户消息 + 最终助手消息，丢 thinking/tool；后台线程写 raw（`octop_harness/middleware/memory.py:339-410`）。
3. **过滤**：只收 user/assistant、≥12 字符、无 tool_call/result、跳过 memory echo、密钥脱敏（`octop_memory/application/config.py:32-50`）。
4. **抽取时机**：会话结束、空闲 300s、或每 6h；批量最多 10k raw、产出 ≤20 候选、2048 completion token（`runtime.py:574`；`extractor/__init__.py:48`）。
5. **晋升规则优先**：value → evidence → entity → duplicate → conflict；重复用归一化断言 + 实体内/全局（仅 User）；冲突用 ≥3 共享内容词 + 否定极性翻转（`promotion/checks.py:445-557`）。
6. **结果**：promote / merge / conflict / needs_review / drop；atom **append-only**，用 `superseded_by` 表示替代。
7. **召回**：atom+raw 两路，各取 10；BM25 0.40 / importance 0.20 / confidence 0.15 / recency 0.15 / layer 0.10，30 天半衰期；Jaccard ≥0.85 去重；1500 token 预算（70/20/10）；默认 5 条、200ms；60s 缓存（`recall/rerank.py:40-58`、`budget.py:77-95`）。
8. **注入**：`<memory-context>` 包住，作为 user message 后缀，content-hash 保证回放一致（`memory_recall.py:11-70`）。
9. **人工复核**：`review_new_memory` 对比 `USER.md/MEMORY.md` 与 atoms，锁文档版本，退休矛盾 atom，生成 conflict 候选（`operations/retention.py:54-245`）。
10. **存储**：每 Agent 一个 SQLite `.octop/memory.sqlite`（或 PG），namespace `agent_<id>`；可选 Chroma/Qdrant。

### 3.2 PolyOpus 的设计步骤

1. 五层边界：Working / Session / Long-term / Knowledge / Artifacts（`13 §2`）。
2. **写路径**：turn 完成异步 → LLM 抽 `kind/text/confidence/evidence` → 过滤（工具/网页/临时/敏感不写）→ embedding 近邻 >0.92 去重 → 冲突保留双方 + `valid_from/valid_to/supersedes/requires_review` → 写 atoms + memory_events → 画像建议需确认（`13 §4.1`）。
3. 写入白名单：`explicit_user_request`、`assistant_inferred`（confidence ≥0.8）、`import`、`system_migration`（`13 §4.1`）。
4. **读路径**：当前输入 + 最近 3 轮摘要 → 向量 top40 + 关键词 top20 → 过滤 active/TTL/ACL → 打分 `0.5 相关 + 0.2 新近 + 0.2 重要 + 0.1 频次` → MMR → 预算内 top8 → 注入 `atom_id + 摘要 + 来源`（`13 §4.2`）。
5. 类型与 TTL：fact/preference/episode(180d)/profile/skill；冲突不静默覆盖；用户可查看/纠正/导出/暂停/删除（`13 §4.3-4.5`）。
6. 防投毒：工具输出默认不写、来源白名单、置信阈值、租户+Agent 隔离、配额 5k atoms、PII 检测（`13 §4.6`）。
7. 评测：写入准确率 ≥90%、top8 命中 ≥85%、矛盾率 ≤2%、陈旧率 ≤5%、污染率 0（`13 §4.8`）。
8. 端口：`MemoryProvider` 默认 `PgMemoryProvider`，可选 mem0/Zep（`13 §5-6`）。

### 3.3 差异与审查

| 项 | Octop | PolyOpus | 评价 |
|---|---|---|---|
| 数据分层 | raw/candidate/atom/episode/entity/page 五层 | atom + event 两层 | **Octop 更深**；PolyOpus 首版偏薄 |
| 抽取 | 规则优先 + LLM 兜底，批量/空闲触发 | LLM 直接抽取 + 规则过滤 | Octop 更省 token、更稳 |
| 去重/冲突 | 归一化断言 + 实体内 + 否定极性 | embedding 近邻 + LLM 判定 | 各有优势；PolyOpus 需补确定性规则 |
| 召回 | BM25 + 多维打分 + 200ms/1500 token | 向量+关键词 + 线性打分 + 10k/8 条 | Octop 工程参数更细 |
| 时间/冲突 | `superseded_by` + 90 天 GC | valid_from/to + supersedes + TTL | PolyOpus 语义更完整 |
| 用户控制 | API + 文件双轨 | 查看/纠正/导出/暂停/删除 | PolyOpus 产品化更强 |
| 隔离 | 每 Agent 一个库，无租户 | tenant+agent namespace | PolyOpus 更强 |
| 证据链 | quote_event_id / raw | evidence turn/trigger/tool_call + ref 图 | PolyOpus 与工单结合更好 |
| 评测 | 无公开指标 | 5 个指标 + 探针 | PolyOpus 补上 |

**审查结论**：
- **PolyOpus 的记忆设计目前比 Octop 薄**，尤其在"候选层、情节聚合、实体页、规则优先晋升、BM25 权重"上。首版可以不做图谱，但至少应补：
  1. `candidates` 中间层（避免 LLM 直接污染 atoms）；
  2. 确定性去重/冲突规则（normalized assertion + 否定极性）；
  3. `episode` 按天聚合；
  4. BM25/关键词权重与 200ms 召回预算；
  5. 缓存失效策略（晋升后立即失效）。
- PolyOpus 的优势是**租户隔离、用户控制、工单证据、审计**，这些不要为了"像 Octop"而放弃。
- 若 M2 时间紧，**直接接 `octop-memory` 或 mem0 作为 `MemoryProvider`** 比自研薄层更稳；把自研留给"写入策略/用户控制/证据链"。

---

## 4. 知识库 / RAG

### 4.1 Octop 的实现步骤

1. 元数据在 SQLite/PG；**向量不在 DB**：每 KB 一个 `index.sqlite` sidecar（`knowledge/index.py:29-31`）。
2. 上传 → `status=pending` 行 → 全局 `Semaphore(1)` 串行处理（`jobs.py:17-32`）。
3. 解析：pypdf / python-docx / python-pptx / openpyxl / xlrd / stdlib HTML/CSV；扫描 PDF 与图片走 OCR（rapidocr 或视觉模型），带拒答检测（`parse.py`、`ocr.py`）。
4. 切片：**纯字符窗口 800 / overlap 120**，无结构感知（`chunk.py:6-21`）。
5. Embedding：本地 fastembed（batch=1、全局锁）或远程 OpenAI 兼容（batch=20）；维度首次写入 `embedding_dim`；无重试。
6. 写入：`DELETE` 旧 chunk + `executemany INSERT`，向量 float32 BLOB。
7. 检索：只作为工具 `search_knowledge`，每轮按绑定 KB 重写描述；无 KB 时直接移除工具（`hint.py:94-113`）。
8. 查询：embed → 可见 KB 交集 → 每 KB 暴力全表 cosine → 过滤 ready → 合并排序 → top8 → 6000 字符预算 → 文档级引用 HTML 注释（`retrieve.py:22-131`）。
9. 失败：无命中返回空串；异常 log 后吞掉；维度不匹配静默跳过。
10. 无评测、无混合检索、无 rerank、无阈值、无 MMR。

### 4.2 PolyOpus 的设计步骤

1. 解析保留页/段落/表格定位；结构感知切片 300–800 token + 10–15% overlap（`01 E4`、`03 §7`）。
2. Embedding 双通道 + 模型/维度版本；换模型可全量重建。
3. 索引：PG `pgvector(HNSW)` / SQLite `sqlite-vec`；同时建 BM25/FTS。
4. 检索：dense + BM25 → RRF 融合 → 可选 rerank → MMR 去冗余 → ACL 过滤 → 引用到 span（`01 E7`）。
5. 增量索引：文档级 hash、失败重试、死信；检索调试面板。
6. 评测：黄金问答集，入库即跑 recall@k / faithfulness（`01 E9`、`28 KB-010`）。
7. API：`/knowledge-bases/{id}/search`、`/reindex-all`、`/eval`（`29 §3.6/3.8`）。

### 4.3 差异与审查

| 项 | Octop | PolyOpus | 评价 |
|---|---|---|---|
| 切片 | 固定 800/120 字符 | 结构感知 300–800 token | PolyOpus 明显更好 |
| 索引 | 每 KB SQLite 暴力扫描 | pgvector HNSW + BM25 | PolyOpus 更快，但运维更重 |
| 检索 | 纯 dense cosine | hybrid + RRF + rerank + MMR | PolyOpus 质量上限更高 |
| 引用 | 文档级 HTML 注释 | 到 span + 可跳转 | PolyOpus 更可验证 |
| 失败 | 静默返回空 | 失败重试 + 死信 + 可观测 | PolyOpus 更可靠 |
| 评测 | 无 | 黄金集 + recall/faithfulness | PolyOpus 补上 |
| 增量 | `content_hash` 列但从不计算 | hash + 增量 | PolyOpus 更完整 |
| 运维 | 无外部依赖 | 需要 pgvector/BM25 扩展 | Octop 更轻 |

**审查结论**：
- 知识库是 PolyOpus **明确优于 Octop** 的域，方向正确。
- 风险在"过度工程"：首版必须保证 **SQLite + sqlite-vec/FTS5** 也能跑，pgvector 作为增强；否则自托管门槛变高。
- Octop 的"检索作为工具、无 KB 时隐藏工具"值得保留；PolyOpus 应显式写进 `ToolRegistry.resolve()`。
- 必须避免 Octop 的静默失败：检索异常要返回结构化错误 + 事件，而不是空串。

---

## 5. 用户 / 权限 / 租户

### 5.1 Octop 的实现步骤

1. **无租户**：一套实例一个 `~/.octop`，所有表没有 `tenant_id`；隔离靠实例。
2. 用户：`users.role` 存角色模板 ID，`users.permissions` 存**分配时的权限快照**；改模板不回溯。
3. 认证：Argon2id + HS256 JWT（默认 24h，滑动续期，无 refresh token）；登出只写审计，不撤 token。
4. MFA：TOTP/WebAuthn/恢复码；登录返回 300s `purpose=mfa` 挑战 token；enroll 需要 `purpose=reauth`。
5. SSO：OIDC/飞书/企微/钉钉；首次登录**自动建号**，无邮箱域白名单；LDAP 有 `allowed_groups`。
6. 权限：约 55 个模块权限点；`require_permission` 依赖逐路由校验；admin 绕过。
7. 分组可见性：`owner / (shared + groups) / all`；**无 grant 行 = 所有人可见**（fail-open）。
8. 守卫：非 admin 只能授自己有的权限；不能自降级；最后一个 `users` 持有者不能自剥。
9. 审计：登录/用户/邀请/角色/安全配置写 `audit_log`；工具调用与审批不写。

### 5.2 PolyOpus 的设计步骤

1. **多租户从第一天**：所有业务表 `tenant_id`，repo 层强制过滤，跨租户 404/403（`28 TEN-001`）。
2. 认证：access JWT 15min + refresh 14d，轮换 + 复用检测；登出撤销 refresh family；密码修改撤销全部（`02 §8.2`）。
3. MFA/TOTP/WebAuthn、OIDC/OAuth/LDAP、API Key（作用域/过期/速率）、邀请、分组、设备会话。
4. 授权：RBAC 权限点 `资源:动作` + 资源 ACL `owner/team/tenant/public`；Admin 降为 application service（`34 ADR-002`）。
5. 权限在 API 依赖 + service 用例双层校验；前端 `can()` 只做展示。
6. 审计：append-only，按 run/用户/资源检索，可导出。

### 5.3 差异与审查

| 项 | Octop | PolyOpus | 评价 |
|---|---|---|---|
| 租户 | 无 | 全表 tenant_id | PolyOpus 企业化必需 |
| Token | 24h 滑动，无 refresh | 15m + 14d 轮换/复用检测 | PolyOpus 更安全 |
| 登出 | 不撤 token | 撤销 refresh family | PolyOpus 更正确 |
| 角色 | 模板 + 权限快照 | RBAC + ACL | 各有取舍；PolyOpus 更灵活 |
| 组可见性 | 无 grant = 公开（fail-open） | ACL 显式授权 | PolyOpus 更安全 |
| IM 身份 | **所有 IM 消息归 Agent owner** | Source actor + 租户隔离 | PolyOpus 必须避免 Octop 的塌缩 |
| 管理端 | `users` 权限可重置 admin 密码 | 需显式 last-admin/step-up 约束 | PolyOpus 要在设计里写死 |
| 审计 | 部分，工具调用不记 | 全量 + 可导出 | PolyOpus 更强 |

**审查结论**：
- 用户/权限是 PolyOpus **设计更正确** 的域，但实现复杂度最高，必须补三条硬约束：
  1. **last-admin 保护 + 目标角色校验**（不能重置/删除最后一个 admin）；
  2. **step-up 认证**（重置密码、关闭 MFA、创建 API Key 需重新验证）；
  3. **IM 身份映射**：外部消息必须带 `source_actor`，不能归到 Agent owner；这是 Octop 的明确缺陷（`message_keys.py:81-110`）。
- 租户过滤必须在 repo 基类统一注入，不能靠每个 service 记得写 `WHERE tenant_id`；CI 加"无 tenant 条件"检查。

---

## 6. 技能 / 工具 / 插件 / MCP

### 6.1 Octop 的实现步骤

1. **工具**：LangChain `StructuredTool` + Pydantic schema；内置工具目录只做 UI/策略分类，实现由 `octop-harness` 提供。
2. **执行**：LangGraph `ToolNode` + 中间件链（插件 hook、配额、推理、知识提示、浏览器 profile、二进制保护、MCP 错误整形、图片落盘、artifact 记录）。
3. **技能**：目录 + `SKILL.md` frontmatter（name/description/allowed-tools）；deepagents 扫描、缓存、**渐进披露**（system prompt 只放索引，正文按需读）；`skills_disabled` 与 per-turn allowlist 过滤。
4. **技能包**：zip 校验（2000 文件/64MB/路径穿越）、`shared` + 组可见性、`snapshot|lock|deny` 复制策略；**无版本列**。
5. **插件**：`plugin.yaml` + `setup(ctx)`，可注册 tool/skill/hook/channel；**任意 Python、无 api_version、无权限声明、无沙箱**；失败仅加载期隔离。
6. **MCP**：MultiServerMCPClient（stdio/http/sse），工具按 server 前缀，进程内缓存（fingerprint），per-server 锁；OAuth 完整（RFC 9728/8414、PKCE、动态注册）。
7. **治理五套并行**：catalog denylist、plugin/agent 开关、skills_disabled、SecurityPolicy（tool_guard + HITL）、MCP per-turn 列表。
8. **tool_guard**：YAML 正则，只覆盖 shell command，默认 `warn`；block 只写日志，不写审计。
9. **过滤在 prompt 表面**：`ToolsFilterMiddleware` 只改模型可见列表，`ToolNode` 仍持有 callable。

### 6.2 PolyOpus 的设计步骤

1. **Capability 统一模型**：builtin / MCP / plugin / skill / OpenAPI → 统一 `ToolSpec`（source/risk/side_effects/idempotent/timeout/scopes/renderer/output_schema）。
2. **执行管线**：参数校验 → 策略求值（allow/ask/deny + obligations）→ 脱敏/限流/预算 → 沙箱（超时/取消/截断/artifact）→ 审计 + usage + 事件（`02 §5.2`）。
3. **策略引擎**：声明式 YAML/JSON + `when` 受限 DSL；默认 `risk>=high → ask`、未签名插件 ask、critical deny；异常 fail-closed。
4. **沙箱**：shell 默认禁用；启用走容器/受限 subprocess；workspace jail；浏览器独立 profile；出站 allowlist（`02 §8.3`）。
5. **插件**：`plugin.yaml` + `api_version` + `permissions` + 签名 + dev 模式 + UI renderer 契约（`02 §7.2`）。
6. **技能**：`SKILL.md` + frontmatter（触发条件/依赖工具）+ 版本化技能包 + per-agent 绑定。
7. **异步工具**：`execution=sync|async`，`start()` 立即返回，结果回事件，最多 4 并发/ turn。
8. **工具治理端点**：`/tools`、`/agents/{id}/tools`、`/admin/policies`、`/admin/policies/evaluate`、`/connectors/openapi/import`（`29 §3.10`）。
9. **审计**：每次 tool call 落 `tool_calls` + usage + 事件。

### 6.3 差异与审查

| 项 | Octop | PolyOpus | 评价 |
|---|---|---|---|
| 工具定义 | LangChain Tool + Pydantic | 自有 ToolSpec + 生成类型 | PolyOpus 更可审计 |
| 治理 | 5 套并行，prompt 过滤 | 1 个策略引擎，执行期强制 | PolyOpus 更正确 |
| 插件安全 | 任意 Python，无沙箱 | permissions + 签名 + api_version | PolyOpus 更安全 |
| 技能 | 渐进披露 + per-turn allowlist | 索引 + frontmatter + 版本包 | **Octop 的披露机制更成熟** |
| MCP | 完整 OAuth + 缓存/锁 | 连接池 + 缓存 TTL + 降级 | 相当；PolyOpus 需补 OAuth 细节 |
| 失败 | 工具异常可中断 turn | fail-closed + 结构化错误 | PolyOpus 更可控 |
| 审计 | 工具调用不写审计 | 全量 | PolyOpus 更强 |
| 扩展性 | 插件生态现成 | 需自建 | Octop 起步快 |

**审查结论**：
- 必须借 Octop 的 **技能渐进披露** 与 **无 KB/无插件时隐藏工具** 机制；PolyOpus 的 `ToolRegistry.resolve()` 应明确"只给索引 + 按需读取"。
- Octop 的"过滤只在 prompt 表面"是**反面教材**；PolyOpus 的策略必须在 `ToolRuntime.invoke()` 再判一次，不能只靠模型可见列表。
- 插件沙箱是 PolyOpus 的最大实现风险：`permissions` 声明容易，**运行时强制**难（Python 进程内）。首版建议"子进程 + 只读挂载 + 网络代理"，不要承诺进程内隔离。
- 工具审计 PolyOpus 应默认开启；Octop 在这块是空白。

---

## 7. 实现步骤对照（M0–M2）

| 阶段 | Octop 的做法 | PolyOpus 的做法 | 关键差异 |
|---|---|---|---|
| M0 地基 | 依赖现成 harness/memory 包，先跑起来 | 自建 DB/队列/事件/契约，先保证恢复 | Octop 快，PolyOpus 稳 |
| M1 对话 | LangGraph + deepagents 中间件 | 自研 TurnEngine + 持久化 Turn/Run/Step | PolyOpus 可 `kill -9` 恢复 |
| 上下文 | 中间件自动压缩/驱逐 | `ContextAssembler` + 预算 + 探针 | PolyOpus 可测，Octop 黑盒 |
| 记忆 | 接 `octop-memory` | `MemoryProvider` + 自研薄层 | Octop 成熟，PolyOpus 可控 |
| 知识 | 固定切片 + 暴力检索 | 结构切片 + 混合检索 | PolyOpus 质量高、运维重 |
| 权限 | 单实例 + 权限点 | 多租户 + RBAC/ACL | PolyOpus 企业化 |
| 工具 | 5 套开关 + tool_guard | 单一策略引擎 + 沙箱 | PolyOpus 正确，落地难 |
| 扩展 | 任意 Python 插件 | manifest + 权限 + 签名 | PolyOpus 安全，生态慢 |

---

## 8. 审查结论

### 8.1 PolyOpus 明确更强的地方

1. **持久化执行**：Turn/Run/Step + 租约，重启可恢复；Octop 大量进程内状态。
2. **事件溯源**：`events` 单一真相 + 投影；Octop 四套会话存储并存。
3. **多租户**：全表 `tenant_id` + repo 强制过滤；Octop 无租户。
4. **工具治理**：单一策略引擎 + fail-closed；Octop 五套并行且可绕过。
5. **插件安全**：`api_version` + permissions + 签名；Octop 任意 Python。
6. **知识检索**：结构切片 + hybrid + rerank + 引用到 span + 评测；Octop 固定切片 + 暴力扫描。
7. **契约先行**：139 个操作 / 56 事件 / 生成类型；Octop 手写 + 局部生成。
8. **审计**：工具调用、审批、记忆变更都可追溯；Octop 只覆盖管理动作。

### 8.2 PolyOpus 更弱、需要补的地方

| # | 缺口 | 位置 | 建议 |
|---|---|---|---|
| 1 | 记忆缺候选层/情节/实体页/规则优先晋升 | `13 §4` | 补 `candidates` + episode + 确定性去重/冲突规则；或直接接 `octop-memory` |
| 2 | 记忆缺 BM25/200ms 预算/缓存失效 | `13 §4.2` | 补关键词通道、延迟预算、晋升后失效 |
| 3 | 上下文预算是固定值 | `13 §3.2` | 按模型 profile 分档（32k/128k/200k） |
| 4 | 技能缺渐进披露/每轮 allowlist 细节 | `02 §7.1`、`13 §3.1` | 明确"索引进 prompt、正文按需读、按轮过滤" |
| 5 | 插件沙箱只有原则，无实现方案 | `02 §8.3` | 首版子进程 + 只读挂载 + 网络代理；明确不承诺进程内隔离 |
| 6 | MCP OAuth 细节未写 | `03 §6` | 补 RFC 9728/8414、PKCE、token 刷新、SSRF 校验 |
| 7 | last-admin / step-up / IM 身份映射未写死 | `28 AUTH/ADM` | 加三条硬约束与负向测试 |
| 8 | 知识 hybrid 的降级路径未写 | `03 §7` | 明确 SQLite 单机必须可跑，pgvector 为增强 |

### 8.3 必须避免的 Octop 坑

1. **IM 身份塌缩**：外部消息归属 Agent owner（`message_keys.py:81-110`）。
2. **工具过滤只改 prompt**：`ToolNode` 仍可调用（`tools_filter.py:47-65`）。
3. **插件任意代码**：无沙箱/签名/api_version（`plugins/loader.py:64-94`）。
4. **登出不撤 token**：只写审计（`auth.py:215-219`）。
5. **无 grant = 公开**：组可见性 fail-open（`groups.py:113-118`）。
6. **检索静默失败**：异常吞成空串（`retrieve.py:53-55`）。
7. **压缩失败继续**：旧消息可能不可恢复（`summarization.py:1557`）。
8. **进程内缓存当真相**：context usage / recall cache / LRU 重启即丢。

### 8.4 建议增补（按优先级）

**P0（M1 前）**
- last-admin + step-up + IM source actor。
- 上下文预算按模型 profile。
- 工具策略执行期二次校验 + 工具调用审计。
- 记忆 candidates 层与确定性去重/冲突。

**P1（M2 前）**
- 技能渐进披露 + 每轮 allowlist。
- 插件子进程沙箱方案。
- 知识混合检索的 SQLite 降级路径 + 评测。
- MCP OAuth 细节与缓存 TTL。

**P2（v1.5）**
- 记忆 episode/entity page/图谱。
- 工作流 DAG、Bridge、SDK。

---

## 9. 验收清单

- [ ] 上下文：预算按模型分档；压缩有探针与快照；工具结果可重取
- [ ] 记忆：候选层、去重/冲突规则、TTL、用户控制、租户隔离、评测指标
- [ ] 知识：结构切片、hybrid、引用到 span、失败可观测、黄金集
- [ ] 用户/权限：tenant 全表、refresh 轮换、last-admin、step-up、IM actor
- [ ] 工具：单一策略引擎、执行期校验、沙箱、审计、插件权限
- [ ] 技能：索引注入、按需读取、每轮 allowlist、版本化包
- [ ] 跨域：所有状态在库、重启可恢复、事件可回放、错误不静默
