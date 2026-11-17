"""V1-05: tenant/user/model quotas, 402, Attention and no oversell."""

from __future__ import annotations

import concurrent.futures
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
from polyopus.domains.usage import quota
from polyopus.domains.usage import service as usage
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "p"


def _owner(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        "SELECT user_id FROM users WHERE tenant_id = 'default' AND is_owner = 1"
    ).fetchone()
    assert row is not None
    return str(row[0])


def _db(tmp_path: Path) -> Path:
    db = tmp_path / "quota.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    owner = _owner(conn)
    now = int(time.time())
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default', 'th_q', ?, 'q',"
        " 'active', ?, ?)", (owner, now, now),
    )
    for i in range(3):
        conn.execute(
            "INSERT INTO usage_ledger (tenant_id, entry_id, user_id, turn_id,"
            " model, input_tokens, output_tokens, cost_micros, created_at)"
            " VALUES ('default', ?, ?, ?, 'deepseek-flash', 60, 40, 100, ?)",
            (f"us_{i}", owner, f"tu_{i}", now),
        )
    conn.commit()
    conn.close()
    return db


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    return _db(tmp_path)


@pytest.fixture()
def client(db: Path) -> Iterator[TestClient]:
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as c:
        response = c.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert response.status_code == 200, response.text
        yield c


def test_each_layer_and_zero_means_unlimited(db: Path) -> None:
    conn = m.connect(db)
    try:
        owner = _owner(conn)
        quota.set_limit(conn, tenant_id="default", scope="tenant",
                        scope_id="default", metric="tokens", limit_value=100,
                        window="day")
        violation = quota.check(conn, tenant_id="default", user_id=owner)
        assert violation is not None
        assert violation.scope == "tenant" and violation.metric == "tokens"

        conn.execute("DELETE FROM quota_limits")
        quota.set_limit(conn, tenant_id="default", scope="user",
                        scope_id=owner, metric="cost", limit_value=100,
                        window="day")
        violation = quota.check(conn, tenant_id="default", user_id=owner)
        assert violation is not None
        assert violation.scope == "user" and violation.metric == "cost"

        conn.execute("DELETE FROM quota_limits")
        quota.set_limit(conn, tenant_id="default", scope="model",
                        scope_id="deepseek-flash", metric="tokens",
                        limit_value=100, window="day")
        violation = quota.check(conn, tenant_id="default",
                                model="deepseek-flash")
        assert violation is not None
        assert violation.scope == "model"

        conn.execute("DELETE FROM quota_limits")
        quota.set_limit(conn, tenant_id="default", scope="model",
                        scope_id="deepseek-flash", metric="requests",
                        limit_value=2, window="day")
        violation = quota.check(conn, tenant_id="default",
                                model="deepseek-flash")
        assert violation is not None
        assert violation.metric == "requests" and violation.used == 3

        conn.execute("DELETE FROM quota_limits")
        quota.set_limit(conn, tenant_id="default", scope="tenant",
                        scope_id="default", metric="tokens", limit_value=0,
                        window="day")
        assert quota.check(conn, tenant_id="default", user_id=owner) is None
    finally:
        conn.close()


def test_usage_summary_matches_quota_used(db: Path) -> None:
    conn = m.connect(db)
    try:
        summary = usage.summary(conn, window="day")
        items = summary["items"]
        assert isinstance(items, list)
        tokens = sum(
            int(item["inputTokens"]) + int(item["outputTokens"])
            for item in items
            if isinstance(item, dict)
        )
        assert tokens == 300
        assert quota.used(
            conn, tenant_id="default", scope="tenant", scope_id="default",
            metric="tokens", window="day",
        ) == tokens
    finally:
        conn.close()


def test_post_turn_returns_402_when_tenant_requests_exceeded(
    db: Path, client: TestClient
) -> None:
    conn = m.connect(db)
    try:
        quota.set_limit(conn, tenant_id="default", scope="tenant",
                        scope_id="default", metric="requests", limit_value=1,
                        window="day")
    finally:
        conn.close()
    created = client.post("/api/v1/threads", json={"title": "q"})
    assert created.status_code == 201, created.text
    thread_id = created.json()["threadId"]
    first = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": "one"}
    )
    assert first.status_code == 202, first.text
    second = client.post(
        f"/api/v1/threads/{thread_id}/turns", json={"content": "two"}
    )
    assert second.status_code == 402, second.text
    error = second.json()["error"]
    assert error["code"] == "QUOTA_EXCEEDED"
    assert error["details"]["scope"] == "tenant"
    assert error["details"]["used"] == 1


def test_admin_quota_api_lists_and_updates(db: Path, client: TestClient) -> None:
    conn = m.connect(db)
    try:
        quota.set_limit(conn, tenant_id="default", scope="tenant",
                        scope_id="default", metric="tokens", limit_value=500,
                        window="month")
    finally:
        conn.close()
    listed = client.get("/api/v1/admin/quotas")
    assert listed.status_code == 200, listed.text
    item = listed.json()["items"][0]
    assert item["metric"] == "tokens" and item["limit"] == 500
    updated = client.patch(
        f"/api/v1/admin/quotas/{item['quotaId']}", json={"limit": 0}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["limit"] == 0


def test_ticket_over_quota_blocks_with_attention(db: Path) -> None:
    conn = m.connect(db)
    now = int(time.time())
    try:
        conn.execute(
            "INSERT INTO sources (tenant_id, source_id, kind, name, config_json,"
            " status, created_at, updated_at) VALUES ('default', 'src_q',"
            " 'webhook', 'q', ?, 'active', ?, ?)",
            (json.dumps({"secret": ""}), now, now),
        )
        conn.execute(
            "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
            " source_id, actor_json, strength, policy_version, scope_json,"
            " created_at, updated_at) VALUES ('default', 'tk_q', 'q', 'open',"
            " 'queued', 'src_q', ?, 'explicit', 1, '[\"workspace:default\"]',"
            " ?, ?)",
            (json.dumps({"id": _owner(conn)}), now, now),
        )
        conn.execute(
            "INSERT INTO timeline_events (event_id, tenant_id, ticket_id, kind,"
            " title, actor, payload_json, created_at) VALUES ('tl_q', 'default',"
            " 'tk_q', 'execution_thread', 'thread', 'system', ?, ?)",
            (json.dumps({"thread_id": "th_qt"}), now),
        )
        conn.commit()
        quota.set_limit(conn, tenant_id="default", scope="tenant",
                        scope_id="default", metric="tokens", limit_value=10,
                        window="absolute")
        state = tickets.run_assignment(conn, EventStore(conn), "tk_q")
        attention = conn.execute(
            "SELECT kind, payload_json FROM attentions WHERE ticket_id = 'tk_q'"
        ).fetchone()
    finally:
        conn.close()
    assert state == "blocked"
    assert attention is not None and attention[0] == "blocked"
    payload = json.loads(attention[1])
    assert payload["reason"] == "quota_exceeded"
    assert "配额超限" in payload["summary"]


def test_concurrent_post_turn_does_not_oversell(db: Path) -> None:
    conn = m.connect(db)
    try:
        owner = _owner(conn)
        quota.set_limit(conn, tenant_id="default", scope="tenant",
                        scope_id="default", metric="requests", limit_value=2,
                        window="day")
        now = int(time.time())
        for i in range(5):
            conn.execute(
                "INSERT INTO threads (tenant_id, thread_id, owner_id, title,"
                " status, created_at, updated_at) VALUES ('default', ?, ?,"
                " 'c', 'active', ?, ?)",
                (f"th_c{i}", owner, now, now),
            )
    finally:
        conn.close()

    def attempt(thread_id: str) -> bool:
        local = m.connect(db)
        try:
            try:
                conversations.post_turn(
                    local, EventStore(local), tenant_id="default",
                    owner_id=owner, thread_id=thread_id, content="x",
                )
                return True
            except AppError as exc:
                assert exc.normalized_code() == "QUOTA_EXCEEDED"
                return False
        finally:
            local.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(attempt, [f"th_c{i}" for i in range(5)]))
    conn = m.connect(db)
    try:
        accepted = conn.execute(
            "SELECT count(*) FROM turns WHERE thread_id LIKE 'th_c%'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert accepted == 2
    assert sum(1 for ok in results if ok) == 2
