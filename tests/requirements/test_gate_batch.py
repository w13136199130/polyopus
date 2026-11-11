"""Requirement gate tests (W11 batch 4): first mapped T-IDs turn hard.

Each test names the docs/28 requirement it covers in its docstring; the
map lives in contracts/test_map.json and coverage_check G-4 fails hard if
a mapped id loses its test.
"""

# covers: T-AUTH-02 T-AUTH-14 T-TEN-01 T-CHAT-13 T-CHAT-15 T-CHAT-07 T-TASK-01 T-INTAKE-01 T-MEM-07 T-ADM-03

from __future__ import annotations

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains import memory as mem
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.platform.security import tokens as tok

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "gate.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


# ---- AUTH --------------------------------------------------------------------


def test_expired_token_returns_401(env: tuple[Path, TestClient]) -> None:
    """covers: T-AUTH-02 — 过期 token 401，客户端跳登录。"""
    db, client = env
    settings = client.app.state.settings
    expired = tok.issue(settings.secret_key, {"sid": "se_x"}, ttl_seconds=-10)
    response = client.get(
        "/api/v1/threads", headers={"Authorization": f"Bearer {expired}"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_token_in_query_rejected(env: tuple[Path, TestClient]) -> None:
    """covers: T-AUTH-14 — query 传 token 返回 TOKEN_IN_QUERY。"""
    _, client = env
    for param in ("access_token", "token"):
        response = client.get(f"/api/v1/threads?{param}=abc")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "TOKEN_IN_QUERY"


# ---- tenancy -----------------------------------------------------------------


def test_business_tables_carry_tenant_id(env: tuple[Path, TestClient]) -> None:
    """covers: T-TEN-01 — 所有业务表带 tenant_id。"""
    db, _ = env
    conn = sqlite3.connect(str(db))
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'kb_chunks_fts'"
        )
    ]
    # global by design in docs/31: migration ledger, price catalog, model
    # catalog, and the KB ACL join (tenancy flows through kb_id)
    exempt = {"schema_migrations", "model_prices", "models", "knowledge_acl"}
    missing = []
    for table in tables:
        if table in exempt:
            continue
        columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
        if "tenant_id" not in columns:
            missing.append(table)
    conn.close()
    assert not missing, f"tables without tenant_id: {missing}"


# ---- chat --------------------------------------------------------------------


def test_after_seq_resume_returns_only_later_events(
    env: tuple[Path, TestClient],
) -> None:
    """covers: T-CHAT-13 — 断线重连从 last_seq 恢复（不重发已收事件）。"""
    _, client = env
    thread_id = client.post("/api/v1/threads", json={"title": "t"}).json()["threadId"]
    for key in ("k1", "k2", "k3"):
        client.post(
            f"/api/v1/threads/{thread_id}/turns",
            json={"content": f"msg {key}"},
            headers={"Idempotency-Key": key},
        )

    def seqs_after(after: int) -> list[int]:
        text = client.get(
            f"/api/v1/threads/{thread_id}/events?after_seq={after}"
        ).text
        return [
            int(line[4:])
            for line in text.splitlines()
            if line.startswith("id: ")
        ]

    all_seqs = seqs_after(0)
    resumed = seqs_after(all_seqs[-1] - 1)
    assert resumed == [all_seqs[-1]]  # exactly the events after last seen seq


def test_plain_turn_creates_no_ticket(env: tuple[Path, TestClient]) -> None:
    """covers: T-CHAT-15 — 普通只读对话不建 Ticket（懒 Ticket 前半）。"""
    db, client = env
    thread_id = client.post("/api/v1/threads", json={}).json()["threadId"]
    client.post(f"/api/v1/threads/{thread_id}/turns", json={"content": "你好"})
    conn = sqlite3.connect(str(db))
    count = conn.execute("SELECT count(*) FROM tickets").fetchone()[0]
    turns = conn.execute(
        "SELECT ticket_id FROM turns WHERE thread_id = ?", (thread_id,)
    ).fetchall()
    conn.close()
    assert count == 0
    assert all(row[0] is None for row in turns)


def test_new_turns_do_not_overwrite_old(
    env: tuple[Path, TestClient],
) -> None:
    """covers: T-CHAT-07 — 后续 Turn 产生新记录，不覆盖旧 Turn。"""
    db, client = env
    thread_id = client.post("/api/v1/threads", json={}).json()["threadId"]
    first = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": "第一问"},
        headers={"Idempotency-Key": "a"}).json()["turnId"]
    second = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": "第二问"},
        headers={"Idempotency-Key": "b"}).json()["turnId"]
    conn = sqlite3.connect(str(db))
    rows = conn.execute(
        "SELECT turn_id, seq FROM turns WHERE thread_id = ? ORDER BY seq",
        (thread_id,),
    ).fetchall()
    user_msgs = conn.execute(
        "SELECT count(*) FROM messages WHERE thread_id = ? AND role = 'user'",
        (thread_id,),
    ).fetchone()[0]
    conn.close()
    assert first != second
    assert [r[0] for r in rows] == [first, second]
    assert [r[1] for r in rows] == [1, 2]
    assert user_msgs == 2


# ---- tickets -----------------------------------------------------------------


def test_task_buckets_grouped_and_counted(env: tuple[Path, TestClient]) -> None:
    """covers: T-TASK-01 — 任务按 bucket 分组，计数准确（API 侧）。"""
    db, client = env
    conn = m.connect(db)
    EventStore(conn)
    # three tickets in three buckets via direct rows
    for bucket in ("queued", "running", "done"):
        state = "ended" if bucket == "done" else "open"
        conn.execute(
            "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
            " strength, policy_version, scope_json, created_at, updated_at)"
            " VALUES ('default', ?, ?, ?, ?, 'explicit', 1, '[]', 1, 1)",
            (f"tk_{bucket}", bucket, state, bucket),
        )
    conn.commit()
    conn.close()

    items = client.get("/api/v1/tickets").json()["items"]
    buckets = [i["bucket"] for i in items]
    assert sorted(buckets) == ["done", "queued", "running"]
    assert len(items) == 3


# ---- intake ------------------------------------------------------------------


def test_paused_source_rejects_webhook(env: tuple[Path, TestClient]) -> None:
    """covers: T-INTAKE-01 — Source 可暂停（暂停后拒绝收单）。"""
    db, client = env
    source = client.post(
        "/api/v1/sources",
        json={"name": "paused-demo", "generate_secret": False},
    ).json()
    conn = sqlite3.connect(str(db))
    conn.execute(
        "UPDATE sources SET status = 'paused' WHERE source_id = ?",
        (source["sourceId"],),
    )
    conn.commit()
    conn.close()
    response = client.post(
        f"/api/v1/webhooks/{source['sourceId']}", json={"text": "hi"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SOURCE_PAUSED"


# ---- memory ------------------------------------------------------------------


def test_expired_atoms_not_recalled(tmp_path: Path) -> None:
    """covers: T-MEM-07 — TTL/valid_to 生效，过期不检索。"""
    conn = m.connect(tmp_path / "ttl.db")
    m.apply(conn, m.discover(MIGRATIONS))
    now = int(time.time())
    for atom_id, valid_to in (("ma_old", now - 10), ("ma_new", None)):
        conn.execute(
            """
            INSERT INTO memory_atoms
              (atom_id, tenant_id, agent_id, kind, text, confidence, status,
               valid_from, valid_to, source, evidence_json, created_at, updated_at)
            VALUES (?, 'default', 'agent:default', 'fact', '部署走 make deploy',
                    0.95, 'active', ?, ?, 'explicit_user_request', '{}', ?, ?)
            """,
            (atom_id, now, valid_to, now, now),
        )
    conn.commit()
    hits = mem.recall(conn, "default", "agent:default", "部署方式是什么")
    ids = [h["atomId"] for h in hits]
    assert "ma_old" not in ids
    assert "ma_new" in ids
    conn.close()


# ---- admin -------------------------------------------------------------------


def test_provider_probe_reports_reachability(tmp_path: Path) -> None:
    """covers: T-ADM-03 — 提供商配置可测试（探活给出明确失败）。"""
    from polyopus.domains.agents.models import Registry

    conn = m.connect(tmp_path / "probe.db")
    m.apply(conn, m.discover(MIGRATIONS))
    dead = Registry(conn, env_base_url="http://127.0.0.1:9/v1",
                    env_api_key="k", env_model="m")
    status, detail = dead.probe()
    assert status == "FAIL"
    assert "m" in detail
    unconfigured = Registry(conn, env_base_url="", env_api_key="",
                            env_model="")
    status2, _ = unconfigured.probe()
    assert status2 == "WARN"
    conn.close()
