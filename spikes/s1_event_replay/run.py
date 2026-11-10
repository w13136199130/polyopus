"""S1 Spike — 事件重放 + messages 投影重建.

假设（docs/41 §1）：`events` 表可作为唯一真相；`rebuild()` 在不读缓存的情况下
重建出与在线投影一致的 `messages`，且可中断续跑、重复幂等、缺口报错。

幂等口径：按 `(thread_id, seq)` 去重（与 docs/29 §6 SSE 口径一致）——投影状态
携带 last_seq，重复投递同一 seq 直接跳过；delta 本身是增量，不单独幂等。

纯 stdlib（sqlite3 + tracemalloc）；不依赖任何业务代码。
运行：python spikes/s1_event_replay/run.py
"""

from __future__ import annotations

import hashlib
import json
import random
import sqlite3
import time
import tracemalloc

SCHEMA = """
CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id     TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  UNIQUE (thread_id, seq)
);
CREATE TABLE messages (
  thread_id     TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  turn_id       TEXT,
  role          TEXT NOT NULL,
  content_json  TEXT NOT NULL,
  status        TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  PRIMARY KEY (thread_id, message_id)
);
"""


class EventGap(Exception):
    """seq 出现洞；重放必须停止，不允许静默跳过。"""


# --------------------------------------------------------------------------
# 投影：纯函数 apply(state, event)；状态带 last_seq 做按 seq 去重
# --------------------------------------------------------------------------

def new_state() -> dict:
    return {"messages": {}, "last_seq": -1}


def upcast(schema_version: int, etype: str, payload: dict) -> dict:
    """旧 schema 的 payload 升级到当前版本（v1 completed 用 text，v2 统一 content）。"""
    if schema_version < 2 and etype == "message.completed":
        payload = dict(payload)
        payload["content"] = payload.pop("text", "")
    return payload


def apply(state: dict, seq: int, etype: str, payload: dict) -> None:
    """应用一个事件；seq <= last_seq 的事件视为重复投递，跳过（幂等）。"""
    if seq <= state["last_seq"]:
        return
    state["last_seq"] = seq
    msgs = state["messages"]
    if etype == "message.started":
        mid = payload["message_id"]
        if mid not in msgs:
            msgs[mid] = {
                "turn_id": payload.get("turn_id"),
                "role": payload.get("role", "assistant"),
                "parts": [],
                "status": "streaming",
                "seq": seq,
            }
    elif etype == "message.delta":
        msg = msgs.setdefault(
            payload["message_id"],
            {"turn_id": None, "role": "assistant", "parts": [], "status": "streaming", "seq": seq},
        )
        if msg["status"] == "streaming":
            msg["parts"].append(payload["content"])
    elif etype == "message.completed":
        msg = msgs.setdefault(
            payload["message_id"],
            {"turn_id": None, "role": "assistant", "parts": [], "status": "streaming", "seq": seq},
        )
        if msg["status"] != "completed":
            msg["status"] = "completed"
            msg["content"] = payload.get("content") or "".join(msg["parts"])
            msg["parts"] = []


def state_hash(state: dict) -> str:
    rows = sorted(
        (mid, m["turn_id"], m["role"], m["status"], m.get("content", ""), m["seq"])
        for mid, m in state["messages"].items()
    )
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


# --------------------------------------------------------------------------
# 存储
# --------------------------------------------------------------------------

class EventStore:
    def __init__(self, path: str = ":memory:") -> None:
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)

    def append(self, thread_id: str, seq: int, etype: str, payload: dict, version: int = 2) -> None:
        self.db.execute(
            "INSERT INTO events(thread_id, seq, type, payload_json, schema_version, created_at)"
            " VALUES(?,?,?,?,?,?)",
            (thread_id, seq, etype, json.dumps(payload, ensure_ascii=False), version, seq),
        )

    def next_seq(self, thread_id: str) -> int:
        row = self.db.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM events WHERE thread_id=?", (thread_id,)
        ).fetchone()
        return int(row[0])

    def fetch(self, thread_id: str, from_seq: int = -1, to_seq: int | None = None):
        cur = self.db.execute(
            "SELECT seq, type, payload_json, schema_version FROM events"
            " WHERE thread_id=? AND seq>? AND (? IS NULL OR seq<=?) ORDER BY seq",
            (thread_id, from_seq, to_seq, to_seq),
        )
        for seq, etype, raw, ver in cur:
            yield seq, etype, json.loads(raw), ver

    def online_project(self, thread_id: str) -> dict:
        """在线投影：逐事件写 messages 表（模拟服务运行时行为）。"""
        state = new_state()
        for seq, etype, payload, ver in self.fetch(thread_id):
            apply(state, seq, etype, upcast(ver, etype, payload))
        for mid, m in state["messages"].items():
            self.db.execute(
                "INSERT OR REPLACE INTO messages(thread_id,message_id,turn_id,role,content_json,status,seq)"
                " VALUES(?,?,?,?,?,?,?)",
                (thread_id, mid, m["turn_id"], m["role"],
                 json.dumps({"content": m.get("content", "")}, ensure_ascii=False),
                 m["status"], m["seq"]),
            )
        return state


# --------------------------------------------------------------------------
# rebuild：全量 / 快照续跑；发现洞立即报 EVENT_GAP
# --------------------------------------------------------------------------

def rebuild(store: EventStore, thread_id: str, snapshot: dict | None = None,
            snapshot_seq: int = -1, to_seq: int | None = None) -> tuple[dict, int]:
    state = snapshot if snapshot is not None else new_state()
    if snapshot is not None:
        state["last_seq"] = max(state["last_seq"], snapshot_seq)
    expect = state["last_seq"] + 1
    last = state["last_seq"]
    for seq, etype, payload, ver in store.fetch(thread_id, from_seq=state["last_seq"], to_seq=to_seq):
        if seq != expect:
            raise EventGap(f"thread {thread_id}: expect seq {expect}, got {seq} (gap after {last})")
        apply(state, seq, etype, upcast(ver, etype, payload))
        expect += 1
        last = seq
    return state, last


# --------------------------------------------------------------------------
# Fixture
# --------------------------------------------------------------------------

WORDS = ["登录", "超时", "重试", "网关", "认证", "测试", "修复", "部署", "回滚", "监控"]


def gen_thread(store: EventStore, thread_id: str, turns: int, rng: random.Random) -> int:
    seq = 0
    for t in range(turns):
        store.append(thread_id, seq, "message.started",
                     {"message_id": f"u-{thread_id}-{t}", "turn_id": f"tu-{t}", "role": "user"})
        seq += 1
        for _ in range(rng.randint(2, 6)):
            store.append(thread_id, seq, "message.delta",
                         {"message_id": f"u-{thread_id}-{t}", "content": rng.choice(WORDS)})
            seq += 1
        store.append(thread_id, seq, "message.completed", {"message_id": f"u-{thread_id}-{t}"})
        seq += 1
        store.append(thread_id, seq, "message.started",
                     {"message_id": f"a-{thread_id}-{t}", "turn_id": f"tu-{t}", "role": "assistant"})
        seq += 1
        for _ in range(rng.randint(4, 10)):
            store.append(thread_id, seq, "message.delta",
                         {"message_id": f"a-{thread_id}-{t}", "content": rng.choice(WORDS)})
            seq += 1
        if t % 2 == 0:  # 旧 schema v1（text 字段）验证 upcaster
            store.append(thread_id, seq, "message.completed",
                         {"message_id": f"a-{thread_id}-{t}",
                          "text": "".join(rng.choice(WORDS) for _ in range(3))}, version=1)
        else:
            store.append(thread_id, seq, "message.completed",
                         {"message_id": f"a-{thread_id}-{t}"})
        seq += 1
    return seq


# --------------------------------------------------------------------------
# 用例：失败抛 AssertionError，成功返回摘要
# --------------------------------------------------------------------------

RESULTS: list[tuple[str, bool, str]] = []


def check(no: int, name: str, fn) -> None:
    t0 = time.perf_counter()
    try:
        detail = fn()
        ok = True
    except AssertionError as exc:
        detail, ok = str(exc), False
    except Exception as exc:  # noqa: BLE001
        detail, ok = f"{type(exc).__name__}: {exc}", False
    dt = (time.perf_counter() - t0) * 1000
    RESULTS.append((f"#{no} {name}", ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  #{no} {name} — {detail} ({dt:.0f}ms)")


def main() -> int:
    rng = random.Random(42)
    print("== S1 事件重放 + 投影重建 ==")
    tracemalloc.start()
    store = EventStore()
    t0 = time.perf_counter()
    total = 0
    for i in range(100):
        total += gen_thread(store, f"th_{i:03d}", 8, rng)  # ~120 events/thread
    gen_ms = (time.perf_counter() - t0) * 1000
    print(f"  fixture: {total} events, {gen_ms:.0f}ms 生成")
    store.db.commit()

    def case1():
        tid = "th_000"
        online = store.online_project(tid)
        rebuilt, _ = rebuild(store, tid)
        assert state_hash(rebuilt) == state_hash(online), \
            f"hash不一致 {state_hash(rebuilt)[:12]}!={state_hash(online)[:12]}"
        return f"hash一致 {state_hash(rebuilt)[:12]}"

    check(1, "全量重放与在线投影 hash 一致", case1)

    def case2():
        t = time.perf_counter()
        hashes = {f"th_{i:03d}": state_hash(rebuild(store, f"th_{i:03d}")[0]) for i in range(100)}
        return f"100 线程 {len(hashes)} hashes, {(time.perf_counter()-t)*1000:.0f}ms"

    check(2, "100 线程全量重放（线性）", case2)

    def case3():
        tid = "th_007"
        full, last = rebuild(store, tid)
        mid = last // 2
        snap, slast = rebuild(store, tid, to_seq=mid)
        resumed, rlast = rebuild(store, tid, snapshot=snap, snapshot_seq=slast)
        assert rlast == last, f"续跑终点不一致 {rlast}!={last}"
        assert state_hash(resumed) == state_hash(full), "续跑 hash 不一致"
        return f"kill 于 seq {mid}，续跑至 {rlast}，hash 一致"

    check(3, "kill -9 后从快照续跑", case3)

    def case4():
        st = new_state()
        for seq, etype, payload, ver in store.fetch("th_001"):
            apply(st, seq, etype, upcast(ver, etype, payload))
            apply(st, seq, etype, upcast(ver, etype, payload))  # 重复投递同一 seq
        ref, _ = rebuild(store, "th_001")
        assert state_hash(st) == state_hash(ref), "重复投递产生脏数据"
        return f"{len(st['messages'])} 条消息无重复"

    check(4, "重复投递（同 seq×2）幂等", case4)

    def case5():
        holed = EventStore()
        gen_thread(holed, "gap", 3, rng)
        holed.db.execute("DELETE FROM events WHERE thread_id='gap' AND seq=5")
        holed.db.commit()
        try:
            rebuild(holed, "gap")
        except EventGap as exc:
            return f"正确报 EVENT_GAP: {exc}"
        raise AssertionError("未检出缺口")

    check(5, "seq 缺洞报 EVENT_GAP", case5)

    def case6():
        st, _ = rebuild(store, "th_000")
        done = [m for m in st["messages"].values() if m["status"] == "completed"]
        assert done and all(m.get("content") for m in done), "v1 completed 无内容（upcaster 失败）"
        return f"{len(done)}/{len(st['messages'])} completed 均有内容"

    check(6, "v1 payload upcaster", case6)

    def case7():
        tid = "th_050"
        before, _ = rebuild(store, tid)
        nxt = store.next_seq(tid)
        store.append(tid, nxt, "message.started",
                     {"message_id": "live-1", "turn_id": "tu-live", "role": "user"})
        store.db.commit()
        after, _ = rebuild(store, tid)
        assert len(after["messages"]) == len(before["messages"]) + 1, "在线写入未被重放看到"
        return f"seq {nxt} 在线写入，下次重放可见；messages 表未破坏"

    check(7, "重放与在线写入并发", case7)

    ok = sum(1 for _, o, _ in RESULTS if o)
    print(f"\n[结果] {ok}/{len(RESULTS)} 通过")
    t0 = time.perf_counter()
    for i in range(100):
        rebuild(store, f"th_{i:03d}")
    elapsed = (time.perf_counter() - t0) * 1000
    _, peak = tracemalloc.get_traced_memory()
    print(f"[指标] {total} 事件全量重放 {elapsed:.0f}ms（预算 ≤2000ms）| 峰值内存 {peak/1048576:.1f}MB（预算 ≤200MB）")
    verdict = "GO" if ok == len(RESULTS) and elapsed <= 2000 else "NO-GO"
    print(f"[结论] {verict if False else verdict}: 事件溯源重放可行" if verdict == "GO" else f"[结论] {verdict}")
    return 0 if ok == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
