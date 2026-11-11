"""Usage pricing + summary (W11 batch 3): versions, engine billing, filters."""

# covers: T-USE-01 T-USE-02

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.usage import service as usage
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = m.connect(tmp_path / "u.db")
    m.apply(c, m.discover(MIGRATIONS))
    yield c
    c.close()


def test_price_upsert_bumps_version_and_keeps_history(
    conn: sqlite3.Connection,
) -> None:
    v1 = usage.upsert_price(conn, model="deepseek-flash", currency="CNY",
                            input_per_mtok=2.0, output_per_mtok=8.0)
    v2 = usage.upsert_price(conn, model="deepseek-flash", currency="CNY",
                            input_per_mtok=1.0, output_per_mtok=4.0)
    assert (v1, v2) == (1, 2)
    rows = conn.execute(
        "SELECT version, input_per_mtok FROM model_prices WHERE model=? ORDER BY version",
        ("deepseek-flash",),
    ).fetchall()
    assert [r[0] for r in rows] == [1, 2]
    assert rows[0][1] == 2.0  # history untouched


def test_price_usage_uses_latest_version(conn: sqlite3.Connection) -> None:
    usage.upsert_price(conn, model="m", currency="CNY",
                       input_per_mtok=2.0, output_per_mtok=8.0, cached_per_mtok=0.5)
    cost = usage.price_usage(conn, model="m", input_tokens=1000,
                             output_tokens=500, cached_tokens=200)
    assert cost.cost_micros == round(2.0 * 1000 + 8.0 * 500 + 0.5 * 200)
    assert cost.currency == "CNY" and cost.price_version == "v1"


def test_unpriced_model_falls_back(conn: sqlite3.Connection) -> None:
    cost = usage.price_usage(conn, model="ghost", input_tokens=10, output_tokens=10)
    assert cost.cost_micros == 0
    assert cost.price_version == "unpriced"


def _seed_turn(conn: sqlite3.Connection, thread_id: str, turn_id: str,
               content: str) -> None:
    seq = conn.execute(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = ?",
        (thread_id,),
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
        " content, status, seq, created_at, updated_at)"
        " VALUES ('default', ?, ?, ?, 'user', ?, 'completed', ?, 1, 1)",
        (f"m_{turn_id}", thread_id, turn_id, content, seq),
    )
    conn.execute(
        "INSERT INTO turns (tenant_id, turn_id, thread_id, user_message_id, status,"
        " mode, seq, created_at, updated_at)"
        " VALUES ('default', ?, ?, ?, 'queued', 'act', 1, 1, 1)",
        (turn_id, thread_id, f"m_{turn_id}"),
    )
    conn.commit()


def test_engine_records_priced_usage(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "e.db")
    m.apply(conn, m.discover(MIGRATIONS))
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default','th_p','us_1','t','active',1,1)"
    )
    conn.commit()
    usage.upsert_price(conn, model="fake", currency="CNY",
                       input_per_mtok=1.5, output_per_mtok=6.0)
    _seed_turn(conn, "th_p", "tu_p", "计价测试内容若干字")
    asyncio.run(engine.run_turn(conn, EventStore(conn), "tu_p",
                                registry=_no_env_registry()))

    row = conn.execute(
        "SELECT model, input_tokens, output_tokens, cost_micros, currency,"
        " price_version FROM usage_ledger"
    ).fetchone()
    assert row["model"] == "fake"
    assert row["input_tokens"] > 0 and row["output_tokens"] > 0
    expected = round(1.5 * row["input_tokens"] + 6.0 * row["output_tokens"])
    assert row["cost_micros"] == expected
    assert row["currency"] == "CNY" and row["price_version"] == "v1"
    conn.close()


def _no_env_registry() -> object:
    from polyopus.domains.agents.models import Registry

    return Registry(None, env_base_url="", env_api_key="", env_model="")  # type: ignore[arg-type]


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "api.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    usage.upsert_price(conn, model="deepseek-flash", currency="CNY",
                       input_per_mtok=2.0, output_per_mtok=8.0)
    conn.execute(
        """
        INSERT INTO usage_ledger
          (tenant_id, entry_id, user_id, agent_id, turn_id, model, input_tokens,
           output_tokens, cache_read, cost_micros, currency, price_version, created_at)
        VALUES
          ('default','us_1','us_alice','ag_1','tu_1','deepseek-flash',1000,500,0,6000,'CNY','v1',strftime('%s','now')),
          ('default','us_2','us_bob',NULL,'tu_2','deepseek-flash',200,100,0,1200,'CNY','v1',strftime('%s','now')-86400*2)
        """
    )
    conn.commit()
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as c:
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, c


def test_summary_groups_by_model_and_filters(
    client: tuple[Path, TestClient],
) -> None:
    _, c = client
    data = c.get("/api/v1/usage/summary?window=day").json()
    assert data["window"] == "day"
    assert len(data["items"]) == 1  # the 2-day-old row is out of window
    item = data["items"][0]
    assert item["model"] == "deepseek-flash"
    assert item["inputTokens"] == 1000 and item["costMicros"] == 6000
    assert data["totalCostMicros"] == 6000

    monthly = c.get("/api/v1/usage/summary?window=month").json()
    assert monthly["totalCostMicros"] == 7200  # both rows

    bob = c.get("/api/v1/usage/summary?window=month&asUser=us_bob").json()
    assert bob["items"][0]["inputTokens"] == 200

    agent = c.get("/api/v1/usage/summary?window=month&agentId=ag_1").json()
    assert agent["items"][0]["turns"] == 1


def test_export_csv_matches_summary(client: tuple[Path, TestClient]) -> None:
    _, c = client
    summary = c.get("/api/v1/usage/summary?window=month").json()
    csv_text = c.get("/api/v1/usage/export?window=month").text
    assert csv_text.startswith("bucket,model,turns,inputTokens")
    assert "deepseek-flash" in csv_text
    total_in_csv = sum(
        int(line.split(",")[6]) for line in csv_text.strip().splitlines()[1:]
    )
    assert total_in_csv == summary["totalCostMicros"]
