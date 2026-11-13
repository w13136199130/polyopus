"""V05-13 Assessment: model judgement with an untrusting pipeline (G5).

covers: docs/48 V05-13 验收 — 60 条标注样本 accept precision >= 0.9、误接率
<= 0.1（宁漏不乱）；poly eval --dry-run 全量产出 disposition 不建单。
A scripted gateway injects the model; everything else (evals rows,
post-processing, events, dispositions) is the real pipeline.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest

from polyopus.domains.intake import assessment
from polyopus.domains.intake import service as intake
from polyopus.kernel.models.gateway import (
    FinishDelta,
    ModelCaps,
    ModelRequest,
    TextDelta,
)
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


class ScriptedJudge:
    """Gateway that answers with the JSON mapped from a prompt substring."""

    def __init__(self, table: dict[str, dict] | None = None,
                 mode: str = "ok") -> None:
        self.table = table or {}
        self.mode = mode
        self.calls: list[str] = []

    def capabilities(self, model: str) -> ModelCaps:
        return ModelCaps()

    async def stream(self, req: ModelRequest) -> AsyncIterator:
        prompt = req.messages[-1].content
        self.calls.append(prompt)
        if self.mode == "garbage":
            yield TextDelta(text="我觉得这个应该接单处理。")
            yield FinishDelta(reason="stop")
            return
        if self.mode == "slow":
            await asyncio.sleep(0.5)
            yield TextDelta(text="{}")
            yield FinishDelta(reason="stop")
            return
        for key, raw in self.table.items():
            if key in prompt:
                yield TextDelta(text=json.dumps(raw, ensure_ascii=False))
                yield FinishDelta(reason="stop")
                return
        yield TextDelta(text=json.dumps({"decision": "ignore",
                                         "confidence": 0.9}))
        yield FinishDelta(reason="stop")


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    conn = m.connect(tmp_path / "ev.db")
    m.apply(conn, m.discover(MIGRATIONS))
    assessment.reset_runtime_state()
    yield conn
    assessment.reset_runtime_state()
    conn.close()


def _mk_source(conn: sqlite3.Connection, source_id: str = "src_ev",
               assessment_mode: str = "off") -> sqlite3.Row:
    now = int(time.time())
    config = {"secret": "", "allow_actors": ["alice"],
              "explicit_patterns": ["/polyopus"]}
    if assessment_mode != "off":
        config["assessment"] = assessment_mode
    conn.execute(
        "INSERT INTO sources (tenant_id, source_id, kind, name, config_json,"
        " status, created_at, updated_at) VALUES ('default', ?, 'webhook', 'ev',"
        " ?, 'active', ?, ?)",
        (source_id, json.dumps(config), now, now),
    )
    conn.commit()
    return conn.execute(
        "SELECT * FROM sources WHERE source_id = ?", (source_id,)
    ).fetchone()


def _mk_trigger(conn: sqlite3.Connection, source_id: str, text: str,
                thread: str = "ev-thread") -> sqlite3.Row:
    trigger_id = "tr_" + f"{time.time_ns():x}"[-14:]
    conn.execute(
        "INSERT INTO triggers (tenant_id, trigger_id, source_id, dedupe_key,"
        " thread_key, actor_id, actor_kind, payload_json, disposition,"
        " received_at) VALUES ('default', ?, ?, ?, ?, 'alice', 'user', ?,"
        " 'pending', ?)",
        (trigger_id, source_id, f"k:{trigger_id}", thread,
         json.dumps({"text": text}, ensure_ascii=False), int(time.time())),
    )
    conn.commit()
    return conn.execute(
        "SELECT * FROM triggers WHERE trigger_id = ?", (trigger_id,)
    ).fetchone()


def _accept(confidence: float = 0.9, scope: list[str] | None = None,
            strength: str = "explicit", duplicate_of: str | None = None) -> dict:
    return {"decision": "accept", "strength": strength,
            "scope": scope if scope is not None else ["workspace:default"],
            "title": "t", "reason": "明确请求", "confidence": confidence,
            "duplicate_of": duplicate_of}


# ---- G5: 60 条标注样本 precision ----------------------------------------------


def test_sixty_labeled_samples_precision_gate(
    env: sqlite3.Connection,
) -> None:
    """40 should-accept + 20 should-reject. The scripted model is right on
    57/60: three high-confidence wrong accepts survive the pipeline (the
    honest precision floor), two low-confidence wild accepts, one duplicate
    and one lying-explicit are corrected by post-processing."""
    store = EventStore(env)
    source = _mk_source(env)

    table: dict[str, dict] = {}
    labels: dict[str, bool] = {}  # text -> should_accept

    for i in range(40):  # true positives the model gets right
        text = f"/polyopus 请修复线上 5xx 错误 #{i}"
        table[text] = _accept()
        labels[text] = True
    for i in range(14):  # true negatives the model gets right
        text = f"今日天气不错 #{i}"
        table[text] = {"decision": "ignore", "confidence": 0.95}
        labels[text] = False
    traps = [
        ("低置信乱接甲", _accept(confidence=0.3)),      # pipeline: ignore
        ("低置信乱接乙", _accept(confidence=0.55)),     # pipeline: ignore
        ("谎报explicit", _accept(strength="explicit")),  # demoted, still accept
        ("越界scope", _accept(scope=["root:all"])),     # trimmed -> default
        ("乱接之一", _accept()),                        # pipeline can't fix
        ("乱接之二", _accept()),                        # pipeline can't fix
    ]
    for text, raw in traps:
        table[f"{text} 事件"] = raw
        labels[f"{text} 事件"] = False

    judge = ScriptedJudge(table)
    accepted: list[str] = []
    for index, text in enumerate(labels):
        # unique thread per sample: the snapshot must not leak other samples'
        # texts into this prompt (cross-talk would fake the model's matching)
        trigger = _mk_trigger(env, "src_ev", text, thread=f"bench-{index}")
        result = assessment.run_for_trigger(
            env, store, source, trigger, gateway=judge, gate_explicit=True,
        )
        if result.decision == "accept" and not result.duplicate_of:
            accepted.append(text)

    true_accepts = [t for t in accepted if labels[t]]
    false_accepts = [t for t in accepted if not labels[t]]
    precision = len(true_accepts) / len(accepted)
    assert precision >= 0.9, f"precision={precision:.3f} accepted={len(accepted)}"
    assert len(false_accepts) / len(labels) <= 0.1
    # the two low-confidence wild accepts and the lying explicit were handled
    assert all("低置信乱接" not in t for t in false_accepts)


def test_duplicate_of_fans_out_without_new_ticket(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    source = _mk_source(env)
    existing = intake.open_ticket(env, store, source,
                                  _mk_trigger(env, "src_ev", "/polyopus 原始请求")
                                  ["trigger_id"])
    trigger = _mk_trigger(env, "src_ev", "/polyopus 再看一下这个问题")

    result = assessment.run_for_trigger(
        env, store, source, trigger,
        gateway=ScriptedJudge({"再看一下": _accept(duplicate_of=existing)}),
        gate_explicit=True,
    )
    assert result.decision == "accept" and result.duplicate_of == existing
    assert env.execute(
        "SELECT disposition FROM triggers WHERE trigger_id = ?",
        (str(trigger["trigger_id"]),),
    ).fetchone()[0] == "fanned_out"
    assert env.execute(
        "SELECT count(*) FROM tickets"
    ).fetchone()[0] == 1  # no new ticket


# ---- post-processing clamps (docs/09 §4.2) ------------------------------------


def test_post_process_clamps_the_model(
    env: sqlite3.Connection,
) -> None:
    cfg = intake.SourceConfig(
        source_id="src_ev", kind="webhook", name="ev", status="active",
        secret="", allow_actors=("alice",), bot_actors=(),
        explicit_patterns=("/polyopus",), default_scope=("workspace:default",),
    )
    # low confidence + out-of-grammar scope + lying strength
    final = assessment.post_process(
        {"decision": "accept", "strength": "explicit",
         "scope": ["root:all", "ok-but-odd"], "confidence": 0.4},
        cfg, gate_explicit=False, conn=env,
    )
    assert final["decision"] == "ignore"
    assert "low_confidence" in final["reasons"]
    assert "strength_demoted_no_gate_signal" in final["reasons"]
    assert final["scope"] == ["workspace:default"]  # trimmed -> default
    assert "scope_trimmed" in final["reasons"] and "scope_defaulted" in final["reasons"]

    good = assessment.post_process(
        {"decision": "accept", "strength": "explicit",
         "scope": ["path:src"], "confidence": 0.9},
        cfg, gate_explicit=True, conn=env,
    )
    assert good["decision"] == "accept" and good["strength"] == "explicit"
    assert good["scope"] == ["path:src"]


# ---- failure path: invalid JSON, breaker, timeout ------------------------------


def test_invalid_json_retries_once_then_unavailable_and_breaks(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    source = _mk_source(env)
    judge = ScriptedJudge(mode="garbage")

    trigger = _mk_trigger(env, "src_ev", "/polyopus 第一条")
    result = assessment.run_for_trigger(env, store, source, trigger, gateway=judge)
    assert result.status == "unavailable"
    assert len(judge.calls) == 2  # one JSON-only retry (docs/09 §4.3)

    row = env.execute(
        "SELECT status, decision_json FROM evals WHERE eval_id = ?",
        (result.eval_id,),
    ).fetchone()
    assert row[0] == "unavailable" and json.loads(row[1])["error"] == "invalid_json"
    assert env.execute(
        "SELECT disposition FROM triggers WHERE trigger_id = ?",
        (str(trigger["trigger_id"]),),
    ).fetchone()[0] == "unavailable"

    # breaker: the next trigger never reaches the model
    before = len(judge.calls)
    second = assessment.run_for_trigger(
        env, store, source, _mk_trigger(env, "src_ev", "/polyopus 第二条"),
        gateway=judge,
    )
    assert second.status == "unavailable"
    assert len(judge.calls) == before  # breaker_open short-circuited


def test_timeout_marks_unavailable(
    env: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = EventStore(env)
    source = _mk_source(env)
    monkeypatch.setattr(assessment, "TIMEOUT_SECONDS", 0.05)

    result = assessment.run_for_trigger(
        env, store, source, _mk_trigger(env, "src_ev", "/polyopus 慢模型"),
        gateway=ScriptedJudge(mode="slow"),
    )
    assert result.status == "unavailable"
    assert "timeout_or_unavailable" in result.reasons


def test_thread_snapshot_cached_five_minutes(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    source = _mk_source(env)
    judge = ScriptedJudge({"第一条": _accept(), "第二条": _accept()})
    thread = "same-thread"

    first = assessment.run_for_trigger(
        env, store, source, _mk_trigger(env, "src_ev", "/polyopus 第一条", thread),
        gateway=judge, gate_explicit=True,
    )
    second = assessment.run_for_trigger(
        env, store, source, _mk_trigger(env, "src_ev", "/polyopus 第二条", thread),
        gateway=judge, gate_explicit=True,
    )
    assert first.status == "decided" and second.status == "decided"
    # the cached snapshot means the second prompt's SNAPSHOT section is byte-
    # identical to the first (the candidate event below it does change)
    def snapshot_of(prompt: str) -> str:
        return prompt.split("[线程快照]")[1].split("[候选事件]")[0]

    assert snapshot_of(judge.calls[0]) == snapshot_of(judge.calls[1])
    assert "第二条" not in snapshot_of(judge.calls[1])


# ---- process() 三态接线 -----------------------------------------------------------


def _wire_model(monkeypatch: pytest.MonkeyPatch, raw: dict) -> None:
    monkeypatch.setattr(
        assessment, "_ask_model",
        lambda conn, source, trigger, cfg, gateway: (dict(raw), "scripted", ""),
    )


def test_off_mode_keeps_today_behaviour(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    source = _mk_source(env, assessment_mode="off")
    ticket = intake.process(env, store, source,
                            _mk_trigger(env, "src_ev", "/polyopus 规则直通")
                            ["trigger_id"])
    assert ticket is not None
    row = env.execute(
        "SELECT strength, matched_rules_json FROM mandates WHERE ticket_id = ?",
        (ticket,),
    ).fetchone()
    assert row[0] == "explicit" and json.loads(row[1]) == ["gate:explicit"]


def test_dry_run_mode_judges_but_never_opens(
    env: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = EventStore(env)
    source = _mk_source(env, assessment_mode="dry_run")
    _wire_model(monkeypatch, _accept(confidence=0.95, strength="inferred"))

    trigger = _mk_trigger(env, "src_ev", "/polyopus 演练模式")
    ticket = intake.process(env, store, source, str(trigger["trigger_id"]))
    assert ticket is None  # docs/09 §3.5: 判定照写、不建单
    assert env.execute("SELECT count(*) FROM tickets").fetchone()[0] == 0
    assert env.execute(
        "SELECT disposition FROM triggers WHERE trigger_id = ?",
        (str(trigger["trigger_id"]),),
    ).fetchone()[0] == "evaluated"
    assert env.execute("SELECT count(*) FROM evals").fetchone()[0] == 1


def test_auto_mode_opens_with_judged_strength(
    env: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = EventStore(env)
    source = _mk_source(env, assessment_mode="auto")
    _wire_model(monkeypatch, _accept(confidence=0.95, strength="inferred",
                                     scope=["path:src"]))

    trigger = _mk_trigger(env, "src_ev", "/polyopus 自动研判建单")
    ticket = intake.process(env, store, source, str(trigger["trigger_id"]))
    assert ticket is not None
    row = env.execute(
        "SELECT strength, matched_rules_json, scope_json FROM mandates "
        "WHERE ticket_id = ?", (ticket,),
    ).fetchone()
    assert row[0] == "inferred"
    matched = json.loads(row[1])
    assert len(matched) == 1 and matched[0].startswith("assessment:ev_")
    assert json.loads(row[2]) == ["path:src"]  # judged scope carried


# ---- poly eval --dry-run ----------------------------------------------------------


def test_cli_dry_run_covers_all_triggers_without_tickets(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    _mk_source(env)
    table = {
        "该接甲": _accept(), "该接乙": _accept(),
        "不该接": {"decision": "ignore", "confidence": 0.9},
    }
    for text in table:
        _mk_trigger(env, "src_ev", f"/polyopus {text}", thread=f"cli-{text}")
    old = _mk_trigger(env, "src_ev", "/polyopus 24 小时外的旧触发")
    env.execute(
        "UPDATE triggers SET received_at = ? WHERE trigger_id = ?",
        (int(time.time()) - 25 * 3600, str(old["trigger_id"])),
    )
    env.commit()

    counts = assessment.eval_dry_run(
        env, store, "src_ev", hours=24, gateway=ScriptedJudge(table)
    )
    assert counts == {"accept": 2, "ignore": 1, "stop": 0, "unavailable": 0}
    assert env.execute("SELECT count(*) FROM tickets").fetchone()[0] == 0
    dispositions = {r[0] for r in env.execute(
        "SELECT disposition FROM triggers").fetchall()}
    assert dispositions == {"evaluated", "filtered", "pending"}  # old one untouched
