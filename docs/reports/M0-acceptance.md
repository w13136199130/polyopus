# M0 验收报告

> 模板 + 本次运行记录。每次 G-M0 评审复制一份，填命令输出，不写形容词。
> 关联：`47 §5`（G-M0 判据）、`45 §3`（W1–2 切片）。

---

## 1. 环境

| 项 | 值 | 命令 |
|---|---|---|
| OS | Windows 11 10.0.22621 | `ver` |
| Python | 3.12.10 | `python --version` |
| uv | 0.13.7 | `uv --version` |
| SQLite | 3.49.1（FTS5 可用） | `poly doctor` |
| Node | v22.23.2（M0 未使用） | `node --version` |

---

## 2. 迁移矩阵

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 1 | 空库全量 | PASS | 12 表（11 + `schema_migrations`） |
| 2 | 已迁移再跑 | PASS | `up to date`，无重复 |
| 3 | 旧库补齐 | PASS | 先 0001 后全量 → 仅应用 0002 |
| 4 | 中途失败回滚 | PASS | 坏迁移不留表、不写版本行 |
| 5 | 校验和篡改 | PASS | `MIGRATION_CHECKSUM_MISMATCH` |
| 6 | 库版本过新 | PASS | `SCHEMA_TOO_NEW` |

命令：

```bash
uv run pytest tests/integration/test_migrator.py -q
```

---

## 3. 崩溃恢复

```
[1/4] db ready
[2/4] events before kill: 3 — killing pid ...
[3/4] lease expired
[4/4] recovered=1 attempts=[1, 2] turn=completed
   1 turn.started
   2 step.completed
   3 step.completed
   4 turn.resumed
   5..14 step.completed
  15 message.completed
  16 turn.completed
OK: 12 steps, no gaps, one turn.completed
```

- 事件 seq 连续，无空洞
- `step.completed` 0..11 各一次
- `turn.completed` 恰一次
- 恢复后 attempt=2

稳定性：`kill -9` e2e **10/10** 连跑通过。

---

## 4. 测试与门禁

| 项 | 结果 |
|---|---|
| `pytest` | 29 passed |
| `scripts/check.py` | all checks passed |
| `tools/extract_ddl.py --check` | 94 表 / 57 索引 / 8 延后 |
| `contracts.check` | passed |
| `coverage_check` | HARD 0 / WARN 157（测试未写，符合预期） |

---

## 5. 指标（M0）

| 指标 | 值 | 说明 |
|---|---|---|
| 迁移耗时（空库） | < 0.5s | 12 表 |
| 事件重放（S1 数据集） | 93ms / 11986 事件 | 见 `spikes/s1` |
| 恢复检测 | ≤ 1 个租约周期 | 轮询 `lease.expired` |
| 日志 | 单行 JSON + trace_id | 一次 turn 共享同一 trace |

---

## 6. 遗留（不阻塞 M0）

| 项 | 去向 |
|---|---|
| PG 方言 | v1.1 矩阵；M0 只跑 SQLite |
| 94 张表全量 | 按切片补；M0 只 12 张 |
| OTel / i18n / 错误码全表 | M1 前两周（`47 §0`） |
| API / SSE / 前端 | 切片① |
| 一次性口令打印到 stdout | 接 CI 前改为文件或 `POLY_ADMIN_PASSWORD` |

---

## 7. 结论

**GO**（见 `M0-gate.md`）。
