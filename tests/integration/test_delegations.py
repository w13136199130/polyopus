"""v1.1 orchestration slice 2: delegations (team run pipeline)."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.orchestration import service as orchestration
from polyopus.kernel.models.fake import FakeModel
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine
from polyopus.workers.delegations_loop import process_once

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "deleg-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "delegations.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="deleg-secret", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield db, client


def _agent(client: TestClient, name: str) -> str:
    response = client.post("/api/v1/agents", json={"name": name})
    assert response.status_code == 201, response.text
    return str(response.json()["agentId"])


def _team(client: TestClient, lead: str, member: str) -> str:
    response = client.post("/api/v1/teams", json={
        "name": f"团队-{lead[-4:]}-{member[-4:]}",
        "leadId": lead, "memberIds": [member],
    })
    assert response.status_code == 201, response.text
    return str(response.json()["teamId"])


def _start(client: TestClient, team_id: str, task: str = "只读总结一下发布要点") -> dict:
    response = client.post(
        f"/api/v1/teams/{team_id}/runs", json={"task": task},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _delegation_row(conn: sqlite3.Connection, delegation_id: str) -> sqlite3.Row:
    return conn.execute(
        "SELECT * FROM delegations WHERE delegation_id = ?", (delegation_id,),
    ).fetchone()


def test_team_run_executes_member_and_summarizes(
    env: tuple[Path, TestClient], tmp_path: Path,
) -> None:
    db, client = env
    lead = _agent(client, "协调者")
    member = _agent(client, "执行者")
    team_id = _team(client, lead, member)

    run = _start(client, team_id)
    assert run["parentRunId"].startswith("rn_")
    assert len(run["delegations"]) == 1
    delegation = run["delegations"][0]
    assert delegation["memberAgentId"] == member
    assert delegation["speaker"] == "执行者"
    assert delegation["state"] == "pending"
    room = run["roomThreadId"]

    conn = m.connect(db)
    store = EventStore(conn)
    try:
        first = process_once(conn)
        assert first["started"] == 1
        row = _delegation_row(conn, delegation["delegationId"])
        assert row["state"] == "running"
        assert row["child_thread_id"]
        turn = conn.execute(
            "SELECT turn_id, status FROM turns WHERE thread_id = ?",
            (row["child_thread_id"],),
        ).fetchone()
        assert turn is not None and turn["status"] == "queued"

        workspace = tmp_path / "ws"
        status = asyncio.run(engine.run_turn(
            conn, store, str(turn["turn_id"]), model=FakeModel(),
            config=engine.EngineConfig(
                model_hint="deepseek-flash", workspace=workspace,
            ),
        ))
        assert status != "waiting_approval"

        second = process_once(conn)
        assert second["finished"] == 1
        row = _delegation_row(conn, delegation["delegationId"])
        assert row["state"] == "ended"
        payload = json.loads(str(row["payload_json"]))
        assert payload["summary"]

        events = conn.execute(
            "SELECT type, payload_json FROM events WHERE thread_id = ?"
            " AND type LIKE 'delegation.%' ORDER BY seq", (room,),
        ).fetchall()
        types = [row[0] for row in events]
        assert types == ["delegation.started", "delegation.ended"]
        speakers = {
            json.loads(str(row[1])).get("speaker") for row in events
        }
        assert speakers == {"执行者"}

        summary = conn.execute(
            "SELECT content FROM messages WHERE thread_id = ? AND role = 'assistant'"
            " AND turn_id IS NULL ORDER BY seq DESC LIMIT 1", (room,),
        ).fetchone()
        assert summary is not None
        assert str(summary[0]).startswith("【总结】")
        assert "执行者" in str(summary[0])

        listed = client.get(
            "/api/v1/delegations", params={"teamId": team_id},
        ).json()["items"]
        assert listed[0]["state"] == "ended"
        assert listed[0]["speaker"] == "执行者"
    finally:
        conn.close()


def test_stop_scopes(env: tuple[Path, TestClient]) -> None:
    db, client = env
    lead = _agent(client, "协调者")
    member = _agent(client, "执行者")
    team_id = _team(client, lead, member)
    conn = m.connect(db)
    try:
        pending_run = _start(client, team_id)
        stopped = client.post(
            f"/api/v1/teams/{team_id}/stop", json={"scope": "coordinator"},
        )
        assert stopped.status_code == 200, stopped.text
        assert stopped.json()["stopped"] == 1
        row = _delegation_row(
            conn, pending_run["delegations"][0]["delegationId"],
        )
        assert row["state"] == "ended"
        assert json.loads(str(row["payload_json"]))["reason"] == "stopped_coordinator"

        running_run = _start(client, team_id)
        process_once(conn)
        delegation_id = running_run["delegations"][0]["delegationId"]
        assert _delegation_row(conn, delegation_id)["state"] == "running"
        coordinator = client.post(
            f"/api/v1/teams/{team_id}/stop", json={"scope": "coordinator"},
        )
        assert coordinator.json()["stopped"] == 0
        room = client.post(
            f"/api/v1/teams/{team_id}/stop", json={"scope": "room"},
        )
        assert room.status_code == 200
        assert room.json()["stopped"] == 1
        row = _delegation_row(conn, delegation_id)
        assert row["state"] == "ended"
        payload = json.loads(str(row["payload_json"]))
        assert payload["reason"] == "stopped_room"
        turn = conn.execute(
            "SELECT status FROM turns WHERE thread_id = ?", (row["child_thread_id"],),
        ).fetchone()
        assert turn is not None and turn["status"] == "cancelled"
    finally:
        conn.close()


def test_retry_dead_delegation(env: tuple[Path, TestClient]) -> None:
    db, client = env
    lead = _agent(client, "协调者")
    member = _agent(client, "执行者")
    team_id = _team(client, lead, member)
    conn = m.connect(db)
    try:
        run = _start(client, team_id)
        delegation_id = run["delegations"][0]["delegationId"]
        process_once(conn)
        row = _delegation_row(conn, delegation_id)
        conn.execute(
            "UPDATE turns SET status = 'failed' WHERE thread_id = ?",
            (row["child_thread_id"],),
        )
        conn.commit()
        process_once(conn)
        dead = _delegation_row(conn, delegation_id)
        assert dead["state"] == "dead"
        assert json.loads(str(dead["payload_json"]))["reason"] == "turn_failed"

        retried = client.post(f"/api/v1/delegations/{delegation_id}/retry")
        assert retried.status_code == 200, retried.text
        assert retried.json()["state"] == "pending"

        process_once(conn)
        again = _delegation_row(conn, delegation_id)
        assert again["state"] == "running"
        assert again["attempts"] == 2

        conn.execute(
            "UPDATE delegations SET state = 'dead', attempts = max_attempts"
            " WHERE delegation_id = ?", (delegation_id,),
        )
        conn.commit()
        exhausted = client.post(f"/api/v1/delegations/{delegation_id}/retry")
        assert exhausted.status_code == 409
        assert "attempts_exhausted" in exhausted.text
    finally:
        conn.close()


def test_create_delegation_is_idempotent_and_tenant_scoped(
    env: tuple[Path, TestClient],
) -> None:
    db, client = env
    lead = _agent(client, "协调者")
    member = _agent(client, "执行者")
    team_id = _team(client, lead, member)
    conn = m.connect(db)
    try:
        first = orchestration.create_delegation(
            conn, tenant_id="default", team_id=team_id,
            parent_run_id="rn_dedupe", member_agent_id=member,
            task="同一件事", dedupe_key="dedupe-1",
        )
        second = orchestration.create_delegation(
            conn, tenant_id="default", team_id=team_id,
            parent_run_id="rn_dedupe", member_agent_id=member,
            task="同一件事", dedupe_key="dedupe-1",
        )
        assert first["delegationId"] == second["delegationId"]
        assert len(orchestration.list_delegations(
            conn, tenant_id="default", team_id=team_id,
        )) == 1
        assert orchestration.list_delegations(
            conn, tenant_id="other", team_id=team_id,
        ) == []
    finally:
        conn.close()
