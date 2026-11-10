# G-M1（切片①）出口评审

> 判据来源：`45 §3` W3–6 行——"同一句'读文件改一行'：流式可见、审批可暂停、重启可续、轨迹可回放"。
> 结论先行：**条件通过（GO）**，L-5 已于 2026-11-10 清偿：**deepseek-flash 已接入实测**。
> 四条机制判据全部有命令级证据；真模型实测：首字 1750ms / in=34 out=97 tokens / 11 delta 帧；
> 审批链实测 228 帧流式 → approval.requested → approve → turn.resumed → turn.finished。
> 字面场景"读文件改一行"**已闭环**（2026-11-10 第二次更新）：fs.read 上线，deepseek-flash
> 真实调用工具读取 config.yml、给出改后全文、并如实说明自身无写权限（写动作由审批闸门拦截）。

---

## 1. 判据核对

| # | 判据 | 证据（2026-11-10 实测） | 判定 |
|---|---|---|---|
| 1 | **流式可见** | `pytest tests/e2e/test_slice1.py` → 3 passed；`test_stream_to_completion` 断言 `message.delta ≥ 2` 且非一坨；真实服务器 curl 可见逐块 data 帧 | **PASS** |
| 2 | **审批可暂停** | 同上：`test_approval_pause_answer_resume` / `test_denied_still_completes_the_turn`；waiting_approval 时收件箱恰 1 条；批准→`turn.resumed`→completed；拒绝同样收敛不悬空 | **PASS** |
| 3 | **重启可续** | (a) `pytest tests/e2e/test_kill9.py` → 1 passed（真进程 kill，10/10 历史）；(b) 审批跨请求存活：engine 暂停与 answer/resume 分属不同连接，状态全在库 | **PASS**（进程重启真验过；**服务器级重启未单独测**，见遗留 L-2） |
| 4 | **轨迹可回放** | `scripts/demo_kill9.py` → 10 事件链按 seq 输出无洞；`GET /threads/{id}/events?after_seq=N` 任意位点续读 | **PASS** |
| — | 前端只做一屏 | `GET /` 自包含页面：登录/线程/流式/审批卡/SSE 跟随 | PASS |

稳定性：`tests/e2e` 全量 7 passed；slice1+screen 连跑 3 遍全绿。

## 2. 真实服务器端到端（最终冒烟记录）

```
post {"content":"帮我写一下配置"} → 202 queued
1 turn.queued  2 turn.started  3 message.started  4 message.delta
5 message.completed  6 usage.recorded  7 approval.requested
POST /attentions/{id}/answer approve
8 approval.resolved  9 turn.resumed  10 turn.finished
```

## 3. 本切片抓出并修复的缺陷（佐证判据不是走过场）

| 缺陷 | 根因 | 修复 |
|---|---|---|
| 事件不合 L0 契约 | `turn.completed`/`step.completed` 不在 61 事件内 | 对齐 `turn.finished` 等；新增 `parse_event` 守卫测试 |
| 状态先翻、事件后发 | 读侧见 completed 无终止事件 | 事件先于状态翻转（真相先行） |
| waiting 状态先于 attention 行 | 收件箱短暂为空 | 行/事件先写，状态后翻 |
| 同 turn 双执行 | API 自动启动 + 手动跑 engine | `TURN_ACTIVE` 拒绝重复执行 |

## 4. 遗留（不阻塞切片②，按序清偿）

| # | 项 | 去向 |
|---|---|---|
| ~~L-1~~ | ~~仅缺 fs.read~~ **已清偿**：`kernel/tools/fs_read`（jail/行号/64KB 上限）+ provider 工具名点→下划线映射 + 工具环（≤2 轮，tool.* 契约事件） | — |
| L-2 | **服务器级重启**：turn 暂停中重启 `poly serve` 再 answer 的完整演练未单测 | M2 引入 turn_worker 进程时补 e2e |
| L-3 | engine 为线程内单进程启动（`workers/runner.py` 自认 demo 级） | M2 换队列 worker |
| L-4 | SSE `follow` 为 0.2s 轮询，非推送 | v1.1（多实例/Redis）再议 |
| ~~L-5~~ | ~~真模型未实测~~ **已清偿**：`deepseek-flash` 接入，doctor `model OK`；e2e 真流式+真审批链验证通过 | — |

## 5. 结论

**G-M1（切片①）：GO。** 允许进入切片②（工单+webhook）；L-1/L-2 在 M2 前清偿。
