# PolyOpus 技术 Spikes

> 对应 [`docs/41-技术Spike设计与验证方案`](../docs/41-技术Spike设计与验证方案.md)。
> 原则：每个 spike 只回答一个 yes/no；允许丢代码，不允许丢结论。
> 本目录不进入生产构建。

## 运行

```bash
python spikes/s1_event_replay/run.py
python spikes/s2_tenant_isolation/test_isolation.py
python spikes/s3_policy/test_policy.py
```

均为纯 stdlib，无第三方依赖。

## 结论汇总（2026-11-10）

| Spike | 问题 | 结果 | 指标 | 结论 |
|---|---|---|---|---|
| S1 事件重放 | events 可否作唯一真相 | 7/7 PASS | 11,986 事件全量重放 **89ms**（预算 2s）；峰值内存 0.1MB | **GO** |
| S2 租户隔离 | 跨租户能否被彻底挡住 | 11/11 PASS | 错误体零泄露；审计覆盖 | **GO** |
| S3 策略 fail-closed | 异常会不会变成 allow | 12/12 PASS | 异常路径意外 allow = **0** | **GO** |

## Go/No-Go 判定（docs/41 §7）

| 门 | 条件 | 结果 |
|---|---|---|
| G-S1 | 10k 重放 hash 一致 + ≤2s | ✅ 89ms，hash 一致 |
| G-S2 | 10/10 跨租户被拒 | ✅ 11/11（含 SQL lint） |
| G-S3 | 异常场景 0 allow | ✅ 0 次 |

**M0 准入达成**：G-S1/G-S2/G-S3 全绿。S4（插件子进程）与 S5（记忆探针）可在 M1/M2 前完成，不阻塞 M0。

## 关键设计决定（由 spike 输出固化）

1. **幂等口径 = `(thread_id, seq)` 去重**（S1）：与 SSE `Last-Event-ID` 口径一致；delta 天然增量，靠 seq 去重而非内容判重。
2. **快照暂不需要**（S1）：12k 事件 89ms，全量重放即够；`context_snapshots` 保留给 100k+ 线程。
3. **跨租户一律 404**（S2）：不泄露存在性；附件签名绑 `HMAC(tenant:ref)`。
4. **repo 基类 fail-closed + SQL lint 进 CI**（S2）。
5. **fail-closed 双闸**（S3）：catch-all 异常 → deny + deadline 超时 → deny；默认链 critical→deny / 写→ask / 只读→allow。
6. **执行期二次校验无视"声称已批准"**（S3）：`invoke()` 是唯一放行点。

## 待做（M1/M2 前）

- [ ] S4 插件子进程 + 只读挂载（3d，M2 前完成）
- [ ] S5 记忆 20 条探针（2d，M2 前完成）
