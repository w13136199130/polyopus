# v1.0 安全威胁模型与越权矩阵

> 证据：`uv run pytest tests/security -q`（90 条）；`uv run python tools/security_report.py`（高危 0）。
> 矩阵由 `tests/security/test_permission_matrix.py` 以 resource × role 参数化，新增资源必须登记否则测试缺失。

## 1. 威胁模型（八类）

| 类别 | 威胁 | 控制 | 证据 |
|---|---|---|---|
| 认证 | 过期/伪造 token、query token、refresh 重放 | 短 access token + refresh family 撤销、`TOKEN_IN_QUERY` 拒绝、API Key 只走 scope | `test_auth_hardening.py`、`test_gate_batch.py` |
| 授权 | 越权读/写/删、隐藏入口代替鉴权 | `require_permission` 全部端点，服务层再按 tenant/owner 过滤 | `test_permission_matrix.py`、`test_rbac.py` |
| 多租户 | 跨租户 ID 枚举 | 所有查询带 tenant；跨租户统一 404；worker 从行派生 tenant | `test_tenant_isolation.py` |
| 注入 | SQL/路径/提示注入 | 参数化 SQL、fs tools 工作区 jail、policy 规则不允许 eval | `test_injection_eval.py`、`test_tools.py` |
| SSRF | webhook/连接器出站打内网 | 出站 allowlist + 超时；连接器 probe 只做本地配置校验 | `test_outbound*.py`、`test_connectors.py` |
| 路径 | `../`、绝对路径、symlink 逃逸 | `_resolve_jailed` 统一解析并拒绝 | `test_injection_eval.py` |
| 插件 | 未签名插件、API 版本漂移 | 本地 signer HMAC 白名单、`apiVersion` 主版本 1、工具必须 `plugin.` 前缀 | `test_plugins.py` |
| 泄漏 / Dos | secret 进日志/导出、无界队列 | audit/connector 脱敏；备份/导出只读；队列深度指标 + 预算/配额 | `test_audit_export.py`、`test_observability.py`、`test_quota.py` |

## 2. 角色 × 资源矩阵（读/写）

| 资源 | admin | member | auditor |
|---|---|---|---|
| threads / turns | R/W | R/W | R |
| tickets / attentions | R/W | R/W | R |
| sources / cron | R/W | R/W | — |
| usage / quotas | R/W | R/W | R |
| audit | R/W | — | R |
| users / roles / invites | R/W | — | R |
| agents / tools / extensions / plugins | R/W | R/W | — |
| knowledge | R/W | R/W | R |
| connectors | R/W | R/W | — |
| settings / backup / data-jobs / tenant purge | R/W | R (settings only) | R (settings only) |

写列中的 “—” 表示 403；测试在资源不存在时也先断言 403（不泄露存在性）。

## 3. 高危项

`tools/security_report.py` 对 `shell=True`、`eval`、`exec`、`os.system/popen`、硬编码 `sk-`/password/secret 做静态扫描；v1.0 为 **0 高危**。误报通过显式代码改写或人工登记处理，不允许把高危降级为忽略。
