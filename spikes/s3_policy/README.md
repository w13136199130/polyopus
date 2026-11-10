# S3 · 策略引擎 fail-closed

## 假设

策略求值的任何异常（规则语法错、DSL 抛错、超时、无匹配）都不会导致工具被执行；默认 deny/ask 而非 allow；执行期二次校验防绕过。

## 环境与命令

```bash
python spikes/s3_policy/test_policy.py
```

纯 stdlib（dataclasses / time），模拟 `Rule`（受限 DSL）/`PolicyEngine`/`ToolRuntime`。

## 设计要点

- **求值顺序**：priority 降序先命中先生效（deny 规则给最高 priority）；无命中走默认链：`critical → deny`、未签名插件 → ask、`high/side_effects → ask`、只读 → allow。
- **fail-closed 双闸**：`evaluate()` 外层 catch-all（任何异常 → `deny(policy_error)`）+ 超时检查（超 deadline → `deny(policy_timeout)`）。
- **执行期二次校验**（ADR-011）：`ToolRuntime.invoke()` 无视 `claim_approved`，任何来源（模型/插件/直构 ToolCall）都重新 evaluate。
- **决策留痕**：每次 Decision（含 matched rules）可写审计/`policy_decisions`。
- **故障注入**：`BrokenRule`（DSL 抛 ValueError）、`SlowRule`（sleep 80ms > 50ms deadline）。

## 结果（2026-11-10，本机）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 规则 allow → 执行 | PASS |
| 2 | 规则 deny（rm -rf /）→ 结构化拒绝 | PASS |
| 3 | 规则 ask → 暂停 + Attention | PASS |
| 4 | 规则语法/DSL 异常 → deny | PASS |
| 5 | 求值超时 → deny | PASS（80ms > 50ms deadline） |
| 6 | 无规则 + 写工具 → ask | PASS |
| 7 | 无规则 + 只读工具 → allow | PASS |
| 8 | 未签名插件 → ask | PASS |
| 9 | critical 工具 → deny | PASS |
| 10 | prompt 伪造「已批准」无效 | PASS |
| 11 | 绕过 UI 直构 ToolCall → 执行期拒绝 | PASS |
| 12 | 决策留痕（matched rules） | PASS |

**12/12 通过；异常路径意外 allow = 0。**

## 结论

**GO —— fail-closed 成立**。catch-all + deadline + 默认链三层保证"求值失败 ≠ 放行"。

## 回退方案

无需触发。若实现期 DSL 需求变复杂（表达式/正则），优先收缩 DSL 能力而不是放开 eval；正则超时单独限。

## 对 M0 的输入

- `Decision{effect, matched, reason, obligations}` 结构进 `32 §6`。
- `policy_error / policy_timeout` 拒绝原因进错误码（`29 §2.6`）。
- LKG 策略：单实例下规则加载失败直接用上一份内存规则（bundle 快照），与 `policy_bundles` 配合。
