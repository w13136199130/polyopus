#!/usr/bin/env python
"""v1.0 acceptance demo: tenant -> RBAC -> expert -> knowledge -> quota ->
backup -> watchdog -> stop. Everything runs locally (TestClient + temp DB),
no external service.

Usage:
    uv run python scripts/demo_v10.py

Writes `data/demo-v10/evidence.json` (or `--evidence` path) and exits 0 only
when every step passes.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from fastapi.testclient import TestClient  # noqa: E402

from polyopus.api.app import create_app  # noqa: E402
from polyopus.config import Settings  # noqa: E402
from polyopus.domains.tickets import service as tickets  # noqa: E402
from polyopus.platform.db import migrator as m  # noqa: E402
from polyopus.platform.db.seed import ensure_admin  # noqa: E402
from polyopus.platform.events.store import EventStore  # noqa: E402

MIGRATIONS = ROOT / "migrations"
PASSWORD = "demo-pass"


def _login(client: TestClient, username: str) -> None:
    response = client.post("/api/v1/auth/login", json={
        "username": username, "password": PASSWORD,
    })
    assert response.status_code == 200, response.text


def _ticket(conn: sqlite3.Connection, ticket_id: str, thread_id: str, owner: str) -> None:
    now = int(time.time())
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default', ?, 'system', 'demo',"
        " 'active', ?, ?)", (thread_id, now, now),
    )
    conn.execute(
        "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
        " actor_json, strength, policy_version, scope_json, created_at,"
        " updated_at) VALUES ('default', ?, 'demo ticket', 'open', 'queued',"
        " ?, 'explicit', 1, '[]', ?, ?)",
        (ticket_id, json.dumps({"id": owner}), now, now),
    )
    conn.execute(
        "INSERT INTO timeline_events (event_id, tenant_id, ticket_id, kind,"
        " title, actor, payload_json, created_at) VALUES (?, 'default', ?,"
        " 'execution_thread', 'thread', 'system', ?, ?)",
        (f"tl_{ticket_id}", ticket_id, json.dumps({"thread_id": thread_id}), now),
    )
    conn.commit()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="v1.0 acceptance demo")
    parser.add_argument("--evidence", default=str(ROOT / "data/demo-v10/evidence.json"))
    args = parser.parse_args(argv)
    evidence: dict[str, Any] = {"steps": [], "startedAt": int(time.time())}

    def step(name: str, ok: bool, detail: Any) -> None:
        evidence["steps"].append({"step": name, "ok": ok, "detail": detail})
        print(f"[{'ok' if ok else 'FAIL'}] {name}: {detail}")
        if not ok:
            raise SystemExit(1)

    with tempfile.TemporaryDirectory(prefix="poly-demo-v10-") as tmp:
        base = Path(tmp)
        db = base / "demo.db"
        conn = m.connect(db)
        m.apply(conn, m.discover(MIGRATIONS))
        ensure_admin(conn, password=PASSWORD)
        owner = str(conn.execute(
            "SELECT user_id FROM users WHERE is_owner = 1"
        ).fetchone()[0])
        now = int(time.time())
        # Tenant B exists only as rows; tenant A admin must never see it.
        conn.execute(
            "INSERT INTO tenants (tenant_id, name, status, plan, created_at,"
            " updated_at) VALUES ('tenant_b', 'B', 'active', 'free', ?, ?)",
            (now, now),
        )
        conn.execute(
            "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
            " strength, policy_version, scope_json, created_at, updated_at)"
            " VALUES ('tenant_b', 'tk_tenant_b', 'B ticket', 'open', 'queued',"
            " 'explicit', 1, '[]', ?, ?)", (now, now),
        )
        conn.commit()
        conn.close()

        settings = Settings(
            db_path=db, secret_key="demo-secret", access_ttl_seconds=3600,
            session_ttl_seconds=86400, embedded_worker=False,
            data_dir=base / "data", workspace_dir=base / "workspace",
        )
        with TestClient(create_app(settings)) as client:
            _login(client, "admin")

            # 1. tenant isolation
            cross = client.get("/api/v1/tickets/tk_tenant_b")
            step("tenant isolation", cross.status_code == 404,
                 {"status": cross.status_code})

            # 2. RBAC
            for username, role in (("demo-member", "member"),
                                   ("demo-quota", "member")):
                created = client.post("/api/v1/users", json={
                    "username": username, "password": PASSWORD, "roles": [role],
                })
                assert created.status_code == 201, created.text
            _login(client, "demo-member")
            denied = client.get("/api/v1/admin/audit")
            step("rbac member cannot audit", denied.status_code == 403,
                 {"status": denied.status_code})

            # 3. expert draft -> publish -> thread pin
            _login(client, "admin")
            agent = client.post("/api/v1/agents", json={
                "name": "Demo Expert", "systemPrompt": "demo",
            })
            assert agent.status_code == 201, agent.text
            agent_id = agent.json()["agentId"]
            published = client.post(f"/api/v1/agents/{agent_id}/publish")
            assert published.status_code == 200, published.text
            thread = client.post("/api/v1/threads", json={
                "title": "expert", "agentId": agent_id,
            })
            assert thread.status_code == 201, thread.text
            step("expert publish and pin", published.json()["version"] == 1
                 and thread.json()["agentVersionId"] is not None,
                 {"version": published.json()["version"],
                  "agentVersionId": thread.json()["agentVersionId"]})

            # 4. knowledge upload + retrieval
            kb = client.post("/api/v1/knowledge-bases", json={"name": "Demo KB"})
            assert kb.status_code == 201, kb.text
            kb_id = kb.json()["kbId"]
            doc = client.post(f"/api/v1/knowledge-bases/{kb_id}/docs", json={
                "filename": "ops.md",
                "content": "# 运维\n## 备份\n每天备份，保留七份。\n",
            })
            assert doc.status_code == 201, doc.text
            found = client.post(f"/api/v1/knowledge-bases/{kb_id}/search", json={
                "query": "备份保留几份",
            })
            step("knowledge retrieval",
                 found.json().get("status") == "ok"
                 and found.json()["hits"][0]["doc"] == "ops.md",
                 {"status": found.json().get("status")})

            # 5. user quota: first accepted, second 402
            _login(client, "demo-quota")
            conn = m.connect(db)
            conn.execute(
                "INSERT INTO quota_limits (quota_id, tenant_id, scope, scope_id,"
                " metric, limit_value, window, updated_at) VALUES"
                " ('ql_demo', 'default', 'user',"
                " (SELECT user_id FROM users WHERE username = 'demo-quota'),"
                " 'requests', 1, 'day', ?)", (int(time.time()),),
            )
            conn.commit()
            conn.close()
            qthread = client.post("/api/v1/threads", json={"title": "quota"})
            qthread_id = qthread.json()["threadId"]
            first = client.post(f"/api/v1/threads/{qthread_id}/turns",
                                json={"content": "one"})
            second = client.post(f"/api/v1/threads/{qthread_id}/turns",
                                 json={"content": "two"})
            step("quota 402",
                 first.status_code == 202 and second.status_code == 402
                 and second.json()["error"]["code"] == "QUOTA_EXCEEDED",
                 {"first": first.status_code, "second": second.status_code})

            # 6. backup
            _login(client, "admin")
            made = client.post("/api/v1/admin/backup", json={})
            assert made.status_code == 201, made.text
            step("backup ready", made.json()["status"] == "ready",
                 {"backupId": made.json()["backupId"],
                  "checksum": made.json()["checksum"][:12]})

            # 7. watchdog alert
            conn = m.connect(db)
            _ticket(conn, "tk_demo_alert", "th_demo_alert", owner)
            assignment = tickets.assign(conn, EventStore(conn), "tk_demo_alert")
            conn.execute(
                "UPDATE assignments SET state='running', heartbeat_at = ?"
                " WHERE assignment_id = ?",
                (int(time.time()) - 400, assignment),
            )
            conn.commit()
            conn.close()
            watchdog = client.post("/api/v1/tickets/watchdog/run")
            step("watchdog alert", watchdog.status_code == 200
                 and len(watchdog.json()["alerts"]) == 1,
                 watchdog.json())

            # 8. stop
            stopped = client.post("/api/v1/tickets/tk_demo_alert/stop")
            step("ticket stop", stopped.status_code == 200
                 and stopped.json()["state"] == "ended",
                 stopped.json())

    evidence["finishedAt"] = int(time.time())
    evidence["ok"] = all(item["ok"] for item in evidence["steps"])
    out = Path(args.evidence)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    print(f"evidence: {out}")
    return 0 if evidence["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
