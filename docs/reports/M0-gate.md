# G-M0 出口评审

> 判据来源：`47 §5`。任一不过 → NO-GO，不带病进 M1。

| # | 判据 | 命令 | 结果 | 判定 |
|---|---|---|---|---|
| G1 | 环境自检 5 项 | `uv run poly doctor` | 5 项 OK | **PASS** |
| G2 | 迁移矩阵 | `uv run pytest tests/integration/test_migrator.py -q` | 6 类用例全过 | **PASS** |
| G3 | 崩溃恢复稳定性 | `for i in 1..10: pytest tests/e2e/test_kill9.py` | 10/10 | **PASS** |
| G4 | 演示可复现 | `uv run python scripts/demo_kill9.py` | 退出码 0，事件链完整 | **PASS** |
| G5 | 门禁 | `uv run python scripts/check.py` | 全绿 | **PASS** |
| G6 | 新同学 10 分钟 | 克隆新目录 → `uv sync` → doctor/migrate/pytest | 见下 | **PENDING** |

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

结果：待首次外部验证后填写。

---

## 结论

**GO（条件）**：G1–G5 已通过；G6 是文档与环境的可用性验证，不阻塞 M1 开工，但必须在 M1 第一周内补做。

### 进入 M1 的前置

1. G6 补做并记录；
2. `47 §0` 中移出的 5 项（队列完整实现、错误码/i18n、OTel、Executor 端口、intake 表）排进 M1 前两周；
3. 一次性口令输出改为非 stdout（接 CI 前）。
