# S2 · 租户隔离负向测试

## 假设

任何入口（API / 检索 / 事件流 / 签名 URL / 聚合 / 审计）都不能跨租户读写；跨租户返回 404（不泄露存在性）；所有尝试写审计。

## 环境与命令

```bash
python spikes/s2_tenant_isolation/test_isolation.py
```

纯 stdlib（sqlite3 / hmac / hashlib），模拟 `TenantRepo` 基类（强制注入 tenant）+ API 错误语义（`ApiError`）。

## 设计要点

- **repo 基类 fail-closed**：`_require_tenant()` 缺 tenant 直接 RuntimeError，不允许任何裸查询。
- **404 而非 403**：跨租户资源一律 `THREAD_NOT_FOUND` / `KB_NOT_FOUND`（docs/28 AUTH-007：不泄露存在性）。
- **检索 ACL 前置**：KB 检索先判 KB 归属（404），再在 SQL 内带 tenant 过滤 chunks（docs/32 §13B）。
- **签名 URL**：`HMAC(secret, tenant:ref)`，换租户重放 403。
- **SQL lint**：repo 基类区域内不允许出现无 tenant 条件的 SELECT（CI 化的雏形）。

## 结果（2026-11-10，本机）

| # | 用例 | 结果 |
|---|---|---|
| 1 | GET /threads/{id} 跨租户 | PASS 404 |
| 2 | GET /threads 列表 | PASS 仅本租户 |
| 3 | SSE events 跨租户 | PASS 404 |
| 4 | POST turns 跨租户写 | PASS 404 |
| 5 | KB 检索跨租户 | PASS 404 且不泄露 KB 名 |
| 6 | 记忆检索跨租户 | PASS 0 命中 |
| 7 | 附件签名 URL 换租户重放 | PASS 403 |
| 8 | 用量聚合 | PASS 不串租户 |
| 9 | 审计读取非管理员 | PASS 403 |
| 10 | WS 订阅跨租户 | PASS 关闭 + 审计 |
| 11 | SQL lint | PASS 无裸 SELECT |

**11/11 通过**；每个错误体均验证不含他租户资源名/内容。

## 结论

**GO —— 租户隔离模型成立**。repo 强制注入 + 404 语义 + 签名绑定租户 + 审计，四件套可进 M0。

## 回退方案

无需触发。实现期注意：PG 下用 RLS 可再加一层保险，但 repo 层过滤仍是第一道（跨库一致）。

## 对 M0 的输入

- `TenantRepo._require_tenant()` 语义进 `33 §3.1` domain repo 基类。
- SQL lint 升级为 CI 步骤（`coverage_check` 旁挂 `repo_lint.py`）。
- 附件签名格式 `HMAC(tenant:ref)` 进 `02 §8.2`。
