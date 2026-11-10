# S1 · 事件重放 + messages 投影重建

## 假设

`events` 表可作为唯一真相：`rebuild()` 不读 checkpoint/缓存即可重建与在线投影一致的 `messages`，且可中断续跑、重复投递幂等、seq 缺洞报错。

## 环境与命令

```bash
python spikes/s1_event_replay/run.py
```

纯 stdlib（sqlite3 / json / hashlib / tracemalloc），无业务依赖。

## 设计要点

- 事件类型：`message.started / message.delta / message.completed`（+ upcaster 验证 `schema_version=1` 的 `text` → `content`）。
- `apply(state, seq, type, payload)` 纯函数；状态带 `last_seq`，**按 `(thread_id, seq)` 去重**（与 docs/29 §6 SSE 口径一致）。
- `rebuild(store, thread_id, snapshot?, snapshot_seq?, to_seq?)`：全量或从快照续跑；`expect = last_seq+1`，seq 跳跃立即抛 `EVENT_GAP`。
- 在线投影 `online_project()` 逐事件写 `messages` 表，与重放结果做 sha256 对比。

## 结果（2026-11-10，本机）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 全量重放与在线投影 hash 一致 | PASS |
| 2 | 100 线程全量重放（线性） | PASS（106ms） |
| 3 | kill -9 后从快照续跑 | PASS（seq 60 → 120，hash 一致） |
| 4 | 重复投递（同 seq×2）幂等 | PASS |
| 5 | seq 缺洞报 EVENT_GAP | PASS（不静默跳过） |
| 6 | v1 payload upcaster | PASS |
| 7 | 重放与在线写入并发 | PASS（rebuild 只读） |

**指标**：11,986 事件全量重放 **89ms**（预算 ≤2000ms）；峰值内存 **0.1MB**（预算 ≤200MB）。

## 结论

**GO —— 事件溯源重放可行**，且余量充足（~22× 快于预算）。10k 事件全量重放无需快照即可满足交互恢复；快照机制保留给 100k+ 长线程的加速路径。

## 回退方案

无需触发。若未来单线程事件 >100k 导致重放 >2s：每 1k 事件落 `context_snapshots` 快照 + tail replay（`32 §4` 已预留该表）。

## 对 M0 的输入

- Turn 恢复实现直接采用本 spike 的投影/去重/缺口语义。
- `(thread_id, seq)` 唯一约束与 `EVENT_GAP` 错误码进 `29 §2.3`。
