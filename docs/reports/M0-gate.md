# G-M0 出口评审

> 判据来源：`47 §5`。任一不过 → NO-GO，不带病进 M1。

| # | 判据 | 命令 | 结果 | 判定 |
|---|---|---|---|---|
| G1 | 环境自检 5 项 | `uv run poly doctor` | 5 项 OK | **PASS** |
| G2 | 迁移矩阵 | `uv run pytest tests/integration/test_migrator.py -q` | 6 类用例全过 | **PASS** |
| G3 | 崩溃恢复稳定性 | `for i in 1..10: pytest tests/e2e/test_kill9.py` | 10/10 | **PASS** |
| G4 | 演示可复现 | `uv run python scripts/demo_kill9.py` | 退出码 0，事件链完整 | **PASS** |
| G5 | 门禁 | `uv run python scripts/check.py` | 全绿 | **PASS** |
| G6 | 新同学 10 分钟 | 克隆新目录 → `uv sync` → migrate/doctor/pytest | **47s，29 passed** | **PASS** |

---

## G6 记录

```bash
git clone <repo> /tmp/polyopus-g6
cd /tmp/polyopus-g6
uv sync
uv run poly doctor
uv run poly migrate
uv run pytest -q
```

结果（2026-11-10）：克隆成功 → `uv sync` → `poly migrate` → `poly doctor` → `pytest`，
**总耗时 47 秒**，29 passed。

---

## 结论

**GO**：G1–G6 全部通过。

### 进入 M1 的前置

1. `47 §0` 中移出的 5 项（队列完整实现、错误码/i18n、OTel、Executor 端口、intake 表）排进 M1 前两周；
3. 一次性口令输出改为非 stdout（接 CI 前）。
