"""V05-18 cost & budget: seeded prices, ticket rollup, three-layer caps.

covers: docs/48 V05-18 验收 — 20 个 turn 后 ticket cost > 0（不再
unpriced）；超预算 → blocked + Attention。
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.conversations import service as conversations
from polyopus.domains.tickets import service as tickets
from polyopus.domains.usage import service as usage
from polyopus.kernel.models import FakeModel
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    connection = m.connect(tmp_path / "cost.db")
    m.apply(connection, m.discover(MIGRATIONS))
    yield connection
    connection.close()


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "cost_api.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    usage.upsert_price(conn, model="fake", currency="CNY",
                       input_per_mtok=2.0, output_per_mtok=8.0)
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _seed_ticket_thread(conn: sqlite3.Connection) -> tuple[str, str]:
    now = int(time.time())
    thread_id = "th_cost"
    ticket_id = "tk_cost"
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at)"
        " VALUES ('default', ?, 'system', 'c', 'active', ?, ?)",
        (thread_id, now, now),
    )
    conn.execute(
        "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
        " strength, policy_version, scope_json, cost_micros, created_at, updated_at)"
        " VALUES ('default', ?, 'cost', 'open', 'running', 'explicit', 1,"
        " '[\"workspace:default\"]', 0, ?, ?)",
        (ticket_id, now, now),
    )
    conn.execute(
        "INSERT INTO timeline_events (event_id, tenant_id, ticket_id, kind,"
        " title, actor, payload_json, created_at)"
        " VALUES ('tl_cost', 'default', ?, 'execution_thread', 'thread', 'system',"
        " ?, ?)",
        (ticket_id, json.dumps({"thread_id": thread_id}), now),
    )
    conn.commit()
    return ticket_id, thread_id


def _run_one_turn(
    conn: sqlite3.Connection, thread_id: str, text: str, workspace: Path
) -> str:
    turn_id, _ = conversations.post_turn(
        conn, EventStore(conn), tenant_id="default", owner_id="system",
        thread_id=thread_id, content=text,
    )
    return asyncio.run(engine.run_turn(
        conn, EventStore(conn), turn_id, model=FakeModel(),
        config=engine.EngineConfig(model_hint="deepseek-flash", workspace=workspace),
    ))


def _make_source(client: TestClient, **source_overrides: object) -> dict:
    body: dict[str, object] = {
        "name": f"cost-{time.time_ns()}",
        "allow_actors": ["alice"],
        "explicit_patterns": ["/polyopus"],
        "generateSecret": False,
    }
    body.update(source_overrides)
    source = client.post("/api/v1/sources", json=body).json()
    assert source.get("sourceId"), source
    return source


def _fire(client: TestClient, source: dict) -> str:
    payload = {
        "external_id": f"e-{time.time_ns()}",
        "actor": {"id": "alice"},
        "thread_key": f"cost-{time.time_ns()}",
        "text": "/polyopus 修复构建",
    }
    response = client.post(f"/api/v1/webhooks/{source['sourceId']}", json=payload)
    assert response.status_code == 202, response.text
    ticket_id = response.json()["ticketId"]
    assert ticket_id
    return str(ticket_id)


def _open_ticket(client: TestClient, **source_overrides: object) -> str:
    return _fire(client, _make_source(client, **source_overrides))


# ---- price seed + per-ticket rollup -----------------------------------------


def test_deepseek_flash_price_is_seeded(conn: sqlite3.Connection) -> None:
    row = usage.price_for(conn, "deepseek-flash")
    assert row is not None
    assert int(row["version"]) == 1
    assert row["currency"] == "CNY"
    assert float(row["input_per_mtok"]) > 0
    assert float(row["output_per_mtok"]) > 0
    assert row["cached_per_mtok"] is not None


def test_twenty_turns_roll_up_to_a_priced_ticket(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    ticket_id, thread_id = _seed_ticket_thread(conn)
    workspace = tmp_path / "ws"
    workspace.mkdir()

    for i in range(20):
        assert _run_one_turn(conn, thread_id, f"第 {i} 轮成本测试", workspace) == "completed"

    ledger = conn.execute(
        "SELECT count(*) AS n, SUM(cost_micros) AS cost,"
        " SUM(CASE WHEN price_version = 'unpriced' THEN 1 ELSE 0 END) AS unpriced"
        " FROM usage_ledger WHERE ticket_id = ?",
        (ticket_id,),
    ).fetchone()
    assert int(ledger["n"]) == 20
    assert int(ledger["cost"]) > 0
    assert int(ledger["unpriced"]) == 0

    ticket = conn.execute(
        "SELECT cost_micros FROM tickets WHERE ticket_id = ?", (ticket_id,)
    ).fetchone()
    assert int(ticket["cost_micros"]) == int(ledger["cost"])
    assert usage.ticket_cost_micros(conn, ticket_id) == int(ledger["cost"])


# ---- ticket cost cap -> blocked + Attention ---------------------------------


def test_ticket_cost_budget_blocks_with_attention(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    ticket_id = _open_ticket(client, maxCostMicros=1)

    conn = m.connect(db)
    try:
        state = tickets.run_assignment(conn, EventStore(conn), ticket_id)
        ticket = conn.execute(
            "SELECT cost_micros FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
    finally:
        conn.close()

    assert state == "blocked"
    assert int(ticket["cost_micros"]) > 1
    inbox = client.get("/api/v1/attentions").json()["items"]
    blocked = [item for item in inbox if item["ticketId"] == ticket_id]
    assert len(blocked) == 1 and blocked[0]["kind"] == "blocked"
    assert blocked[0]["payload"]["reason"] == "budget_exceeded"
    assert "预算" in blocked[0]["payload"]["summary"]
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["costMicros"] == int(ticket["cost_micros"])


# ---- source/day cap is checked before a new assignment starts ----------------


def test_source_daily_budget_blocks_the_next_ticket(
    env: tuple[Path, TestClient]
) -> None:
    db, client = env
    source = _make_source(client, maxCostMicrosPerDay=1)
    first = _fire(client, source)

    conn = m.connect(db)
    try:
        # Simulate a previous ticket of this source spending today; the cap
        # is already exceeded before the next assignment starts.
        now = int(time.time())
        conn.execute(
            "INSERT INTO usage_ledger (tenant_id, entry_id, ticket_id, turn_id,"
            " model, input_tokens, output_tokens, cost_micros, currency,"
            " price_version, created_at)"
            " VALUES ('default', 'us_prior', ?, 'tu_prior', 'fake', 10, 10, 100,"
            " 'CNY', 'v1', ?)",
            (first, now),
        )
        conn.commit()
        second = _fire(client, source)
        before = conn.execute("SELECT count(*) FROM usage_ledger").fetchone()[0]
        state = tickets.run_assignment(conn, EventStore(conn), second)
        after = conn.execute("SELECT count(*) FROM usage_ledger").fetchone()[0]
        report = conn.execute(
            "SELECT summary FROM reports WHERE ticket_id = ? ORDER BY id DESC LIMIT 1",
            (second,),
        ).fetchone()
    finally:
        conn.close()

    assert state == "blocked"
    assert int(after) == int(before)  # precheck never launched a turn
    assert "source" in str(report["summary"])
    inbox = client.get("/api/v1/attentions").json()["items"]
    assert any(item["ticketId"] == second and item["kind"] == "blocked"
               for item in inbox)
