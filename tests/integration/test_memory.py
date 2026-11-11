"""Memory three tiers + probes (W11; G-S5: hit >= 85%, pollution 0)."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest

from polyopus.domains import memory as mem
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
TENANT = "default"
AGENT = "agent:default"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = m.connect(tmp_path / "mem.db")
    m.apply(c, m.discover(MIGRATIONS))
    yield c
    c.close()


def _feed(conn: sqlite3.Connection, texts: list[str]) -> list[mem.Candidate]:
    raw_items = [
        {"thread_id": "th_1", "turn_id": f"tu_{i}", "role": "user", "text": t}
        for i, t in enumerate(texts)
    ]
    candidates = mem.extract_candidates(raw_items)
    return mem.stage_candidates(conn, TENANT, AGENT, candidates)


def test_raw_capture_filters_short_and_roles(conn: sqlite3.Connection) -> None:
    for seq, (role, text, turn) in enumerate(
        (
            ("user", "记住我喜欢简洁的中文回答", "tu_1"),
            ("assistant", "好的，我会记住这一点并长期遵守", "tu_1"),
            ("user", "太短", "tu_1"),
            ("tool", '{"output": "工具输出内容超过十二个字符"}', "tu_1"),
        ),
        start=1,
    ):
        conn.execute(
            "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
            " content, status, seq, created_at, updated_at)"
            " VALUES ('default', ?, 'th_1', ?, ?, ?, 'completed', ?, 1, 1)",
            (f"m_{seq}_{turn}_{role}", turn, role, text, seq),
        )
    conn.commit()
    assert mem.capture_raw(conn, TENANT, "th_1", "tu_1") == 2
    raw = mem.load_raw(conn, TENANT)
    roles = {item["role"] for item in raw}
    assert roles == {"user", "assistant"}


def test_sensitive_never_promotes(conn: sqlite3.Connection) -> None:
    _feed(conn, [
        "记住我的密钥 sk-abcdefghijklmnop123456",
        "我的邮箱是 someone@example.com 记住",
        "身份证号 110101199001011234 记住一下",
    ])
    stats = mem.promote(conn, TENANT, AGENT)
    assert stats["rejected_sensitive"] == 3
    assert stats["promoted"] == 0
    audited = conn.execute(
        "SELECT count(*) FROM memory_events WHERE kind = 'deleted' "
        "AND payload_json LIKE '%sensitive%'"
    ).fetchone()[0]
    assert audited == 3
    active = list(conn.execute(
        "SELECT text FROM memory_atoms WHERE status = 'active'"
    ).fetchall())
    for row in active:
        assert mem.screen_sensitive(row[0]) is None
    assert len(active) == 0  # all three were sensitive -> pollution 0


def test_ephemeral_not_extracted(conn: sqlite3.Connection) -> None:
    candidates = mem.extract_candidates([
        {"role": "user", "text": "今天天气怎么样，临时问一下", "thread_id": "t", "turn_id": "x"},
    ])
    assert candidates == []


def test_low_confidence_inferred_not_promoted(conn: sqlite3.Connection) -> None:
    _feed(conn, ["我们的生产库部署在 ap-southeast-1 区域"])  # no explicit marker
    stats = mem.promote(conn, TENANT, AGENT)
    assert stats["skipped_low_confidence"] == 1
    assert stats["promoted"] == 0


def test_duplicate_merges(conn: sqlite3.Connection) -> None:
    _feed(conn, [
        "记住我喜欢简洁的中文回答",
        "记住我喜欢简洁的中文回答！",
    ])
    stats = mem.promote(conn, TENANT, AGENT)
    assert stats["promoted"] + stats["merged"] == 2
    assert stats["merged"] == 1
    active = conn.execute(
        "SELECT count(*) FROM memory_atoms WHERE status='active'"
    ).fetchone()[0]
    assert active == 1


def test_conflict_keeps_both_for_review(conn: sqlite3.Connection) -> None:
    _feed(conn, ["记住：发布窗口是周三", "记住：发布窗口是周四"])
    stats = mem.promote(conn, TENANT, AGENT)
    assert stats["conflict_review"] == 1
    review = conn.execute(
        "SELECT count(*) FROM memory_atoms WHERE status='pending_review'"
    ).fetchone()[0]
    assert review == 2
    superseded = conn.execute(
        "SELECT supersedes FROM memory_atoms WHERE supersedes IS NOT NULL"
    ).fetchone()
    assert superseded is not None


PROBES: list[tuple[str, str]] = [
    ("记住我喜欢简洁的中文回答", "回答风格偏好"),
    ("记住：我们的生产库在 ap-southeast-1", "生产库位置"),
    ("记住部署走 make deploy", "部署方式"),
    ("记住：发布窗口是周三", "发布窗口"),
    ("我喜欢深色主题的界面", "界面偏好"),
    ("记住：后端栈是 Python 3.12 + FastAPI", "后端技术栈"),
    ("记住：数据库默认用 SQLite", "默认数据库"),
    ("以后回答尽量给结论先行", "回答结构偏好"),
    ("记住：团队每周五做评审", "评审节奏"),
    ("记住：API 前缀统一是 /api/v1", "API 约定"),
    ("我喜欢用 git 而不是 svn", "版本控制偏好"),
    ("记住：测试框架是 pytest", "测试框架"),
]


def test_probe_hit_rate_and_zero_pollution(conn: sqlite3.Connection) -> None:
    """G-S5 gate: >=85% of stored memories recalled; zero sensitive leakage."""
    noise = [
        "记住我的密码: hunter2secret",
        "密钥 sk-abcdefghijklmnopqrstuv 记住",
        "临时提醒：今天天气晴",
        "记住：发布窗口是周三。",  # near-duplicate (punctuation only) merges away
    ]
    _feed(conn, [text for text, _ in PROBES] + noise)
    mem.promote(conn, TENANT, AGENT)

    hits = 0
    for text, probe_query in PROBES:
        results = mem.recall(conn, TENANT, AGENT, probe_query)
        if any(text[:10] in r["text"] for r in results):
            hits += 1
    rate = hits / len(PROBES)
    assert rate >= 0.85, f"hit rate {rate:.2f} < 0.85"

    # pollution: nothing sensitive ever active
    for row in conn.execute(
        "SELECT text FROM memory_atoms WHERE status='active'"
    ).fetchall():
        assert mem.screen_sensitive(row[0]) is None


def test_engine_injects_memory_and_harvests(tmp_path: Path) -> None:
    """Turn 1 stores a memory; turn 2's model request carries it."""
    from polyopus.workers import engine

    migrations = MIGRATIONS
    conn = m.connect(tmp_path / "eng.db")
    m.apply(conn, m.discover(migrations))
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default','th_m','us_1','t','active',1,1)"
    )
    seen_prompts: list[tuple[str, ...]] = []

    class Recorder:
        def capabilities(self, model: str) -> object:
            from polyopus.kernel.models.gateway import ModelCaps
            return ModelCaps()

        async def stream(self, req: object) -> AsyncIterator[object]:
            from polyopus.kernel.models.gateway import FinishDelta, TextDelta, UsageDelta

            seen_prompts.append(tuple(msg.content for msg in req.messages))  # type: ignore[attr-defined]
            yield TextDelta(text="好的")
            yield UsageDelta(input_tokens=1, output_tokens=1)
            yield FinishDelta(reason="stop")

    def make_turn(turn_id: str, content: str) -> None:
        seq = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = 'th_m'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
            " content, status, seq, created_at, updated_at)"
            " VALUES ('default', ?, 'th_m', ?, 'user', ?, 'completed', ?, 1, 1)",
            (f"m_{turn_id}", turn_id, content, seq),
        )
        conn.execute(
            "INSERT INTO turns (tenant_id, turn_id, thread_id, user_message_id,"
            " status, mode, seq, created_at, updated_at)"
            " VALUES ('default', ?, 'th_m', ?, 'queued', 'act', 1, 1, 1)",
            (turn_id, f"m_{turn_id}"),
        )
        conn.commit()

    store = EventStore(conn)
    make_turn("tu_1", "记住：我喜欢简洁的中文回答，不要长篇大论")
    asyncio.run(engine.run_turn(
        conn, store, "tu_1",
        model=Recorder(),  # type: ignore[arg-type]
        registry=_no_env_registry(),
    ))

    make_turn("tu_2", "回答风格有什么偏好吗")
    asyncio.run(engine.run_turn(
        conn, store, "tu_2",
        model=Recorder(),  # type: ignore[arg-type]
        registry=_no_env_registry(),
    ))

    assert len(seen_prompts) == 2
    assert not any("已知记忆" in c for c in seen_prompts[0])  # first turn: empty
    assert any("已知记忆" in c and "简洁" in c for c in seen_prompts[1])

    active = conn.execute(
        "SELECT count(*) FROM memory_atoms WHERE status='active'"
    ).fetchone()[0]
    assert active >= 1
    conn.close()


def _no_env_registry() -> object:
    from polyopus.domains.agents.models import Registry

    class _NullConn:
        pass

    return Registry(None, env_base_url="", env_api_key="", env_model="")  # type: ignore[arg-type]
