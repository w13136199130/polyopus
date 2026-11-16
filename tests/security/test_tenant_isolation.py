"""V1-01: tenant context isolates every session-scoped resource.

Two tenants, one user each; the A session must never see or mutate B's
thread/source/ticket/attention/usage/audit/cron rows (404, not 403, so
existence is not leaked).
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.audit import service as audit
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import hash_password

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "tenants.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    now = int(time.time())
    for tenant, user in (("t_a", "u_a"), ("t_b", "u_b")):
        conn.execute(
            "INSERT INTO tenants (tenant_id, name, status, plan, created_at,"
            " updated_at) VALUES (?, ?, 'active', 'free', ?, ?)",
            (tenant, tenant, now, now),
        )
        conn.execute(
            "INSERT INTO users (tenant_id, user_id, username, display_name,"
            " password_hash, status, is_owner, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)",
            (tenant, user, user, user, hash_password(PASSWORD), now, now),
        )
        conn.execute(
            "INSERT INTO sources (tenant_id, source_id, kind, name, config_json,"
            " status, created_at, updated_at) VALUES (?, ?, 'webhook', ?, ?,"
            " 'active', ?, ?)",
            (tenant, f"src_{tenant}", tenant,
             json.dumps({"secret": "", "allow_actors": [user]}), now, now),
        )
    # B-only resources that A must never reach.
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('t_b', 'th_b', 'u_b', 'B thread',"
        " 'active', ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
        " source_id, strength, policy_version, scope_json, created_at, updated_at)"
        " VALUES ('t_b', 'tk_b', 'B ticket', 'open', 'attention', 'src_t_b',"
        " 'explicit', 1, '[\"workspace:default\"]', ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO attentions (tenant_id, attention_id, ticket_id, turn_id,"
        " kind, source_type, source_id, payload_json, status, expires_at,"
        " created_at) VALUES ('t_b', 'at_b', 'tk_b', NULL, 'approval',"
        " 'approval', 'ap_b', '{\"summary\": \"B approval\"}', 'pending', ?, ?)",
        (now + 600, now),
    )
    conn.execute(
        "INSERT INTO usage_ledger (tenant_id, entry_id, user_id, turn_id, model,"
        " input_tokens, output_tokens, cost_micros, currency, created_at)"
        " VALUES ('t_b', 'us_b', 'u_b', 'tu_b', 'deepseek-flash', 10, 5, 999,"
        " 'CNY', ?)",
        (now,),
    )
    conn.execute(
        "INSERT INTO cron_jobs (cron_job_id, tenant_id, name, schedule, timezone,"
        " action, payload_json, enabled, next_run_at, created_at)"
        " VALUES ('cj_b', 't_b', 'B job', 'interval:3600', 'UTC', 'notify', ?,"
        " 1, ?, ?)",
        (json.dumps({"source_id": "src_t_b", "text": "/polyopus B"}), now + 3600, now),
    )
    conn.execute(
        "INSERT INTO outbox (tenant_id, event_id, topic, payload_json, status,"
        " created_at) VALUES ('t_b', 'reply:tk_b:rp_b', 'reply', ?, 'pending', ?)",
        (json.dumps({"ticketId": "tk_b"}), now),
    )
    audit.record(
        conn, tenant_id="t_b", action="ticket.stop", result="ok",
        actor_id="u_b", resource_type="ticket", resource_id="tk_b",
        ticket_id="tk_b", detail={"which": "b"},
    )
    conn.commit()
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        yield db, client


def login(client: TestClient, tenant: str, user: str) -> None:
    response = client.post("/api/v1/auth/login", json={
        "username": user, "password": PASSWORD, "tenant": tenant,
    })
    assert response.status_code == 200, response.text


def test_cross_tenant_reads_and_writes_are_404(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    login(client, "t_a", "u_a")

    assert all(t["threadId"] != "th_b" for t in client.get("/api/v1/threads").json()["items"])
    assert client.get("/api/v1/threads/th_b/messages").status_code == 404

    assert all(s["sourceId"] != "src_t_b" for s in client.get("/api/v1/sources").json()["items"])
    assert client.post("/api/v1/sources/src_t_b/pause").status_code == 404
    assert client.delete("/api/v1/sources/src_t_b").status_code == 404

    assert all(t["ticketId"] != "tk_b" for t in client.get("/api/v1/tickets").json()["items"])
    assert client.get("/api/v1/tickets/tk_b").status_code == 404
    assert client.get("/api/v1/tickets/tk_b/timeline").status_code == 404
    assert client.post("/api/v1/tickets/tk_b/stop").status_code == 404

    assert all(a["attentionId"] != "at_b" for a in client.get("/api/v1/attentions").json()["items"])
    assert client.post("/api/v1/attentions/at_b/answer",
                       json={"decision": "approve"}).status_code == 404

    usage = client.get("/api/v1/usage/summary", params={"window": "month"}).json()
    assert usage["totalCostMicros"] == 0

    audit_rows = client.get("/api/v1/admin/audit", params={"ticketId": "tk_b"}).json()
    assert audit_rows["items"] == []

    assert all(j["cronJobId"] != "cj_b" for j in client.get("/api/v1/cron-jobs").json()["items"])
    assert client.delete("/api/v1/cron-jobs/cj_b").status_code == 404
    assert client.get("/api/v1/outbox").json()["items"] == []


def test_own_tenant_resources_are_visible_and_mutable(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    login(client, "t_b", "u_b")

    assert any(t["threadId"] == "th_b" for t in client.get("/api/v1/threads").json()["items"])
    assert any(s["sourceId"] == "src_t_b" for s in client.get("/api/v1/sources").json()["items"])
    assert any(t["ticketId"] == "tk_b" for t in client.get("/api/v1/tickets").json()["items"])
    assert any(a["attentionId"] == "at_b" for a in client.get("/api/v1/attentions").json()["items"])
    assert any(j["cronJobId"] == "cj_b" for j in client.get("/api/v1/cron-jobs").json()["items"])
    assert client.get("/api/v1/tickets/tk_b").status_code == 200

    audit_rows = client.get("/api/v1/admin/audit", params={"ticketId": "tk_b"}).json()
    assert len(audit_rows["items"]) == 1

    # Own-tenant mutation works (the shared helper must not over-filter).
    assert client.post("/api/v1/sources/src_t_b/pause").status_code == 200

    # A new B source/webhook must create a B ticket, invisible to A.
    created = client.post("/api/v1/sources", json={
        "name": "flow-b", "allowActors": ["u_b"],
        "explicitPatterns": ["/polyopus"], "generateSecret": False,
    }).json()
    accepted = client.post(
        f"/api/v1/webhooks/{created['sourceId']}",
        json={"external_id": f"flow-{time.time_ns()}",
              "thread_key": f"flow-{time.time_ns()}",
              "actor": {"id": "u_b"}, "text": "/polyopus B flow"},
    )
    assert accepted.status_code == 202, accepted.text
    new_ticket = accepted.json()["ticketId"]
    assert new_ticket
    assert any(t["ticketId"] == new_ticket
               for t in client.get("/api/v1/tickets").json()["items"])

    login(client, "t_a", "u_a")
    assert all(s["sourceId"] != created["sourceId"]
               for s in client.get("/api/v1/sources").json()["items"])
    assert all(t["ticketId"] != new_ticket
               for t in client.get("/api/v1/tickets").json()["items"])
    assert client.get(f"/api/v1/tickets/{new_ticket}").status_code == 404
