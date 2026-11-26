"""v1.1 orchestration slice 1: teams + member roster."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.orchestration import service as orchestration
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.errors import AppError

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "team-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "teams.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="team-secret", access_ttl_seconds=3600,
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


def _create_team(
    client: TestClient, *, name: str = "发布小组",
    lead_id: str | None = None, member_ids: list[str] | None = None,
) -> dict:
    body: dict[str, object] = {"name": name}
    if lead_id:
        body["leadId"] = lead_id
    if member_ids:
        body["memberIds"] = member_ids
    response = client.post("/api/v1/teams", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_team_crud_and_roster(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    lead = _agent(client, "协调者")
    member = _agent(client, "执行者")
    extra = _agent(client, "审核者")

    team = _create_team(client, lead_id=lead, member_ids=[member])
    assert team["memberCount"] == 2
    assert [(m["agentId"], m["role"]) for m in team["members"]] == [
        (lead, "lead"), (member, "member"),
    ]
    assert team["members"][0]["name"] == "协调者"
    assert team["members"][0]["status"] == "draft"

    listed = client.get("/api/v1/teams").json()["items"]
    assert [item["teamId"] for item in listed] == [team["teamId"]]

    detail = client.get(f"/api/v1/teams/{team['teamId']}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "发布小组"

    patched = client.patch(
        f"/api/v1/teams/{team['teamId']}",
        json={"name": "发布小组 2", "description": "负责发布"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "发布小组 2"
    assert patched.json()["description"] == "负责发布"
    assert patched.json()["version"] == team["version"] + 1

    added = client.post(
        f"/api/v1/teams/{team['teamId']}/members",
        json={"agentId": extra, "role": "member"},
    )
    assert added.status_code == 200, added.text
    assert added.json()["memberCount"] == 3
    duplicate = client.post(
        f"/api/v1/teams/{team['teamId']}/members",
        json={"agentId": extra},
    )
    assert duplicate.status_code == 409

    removed = client.delete(
        f"/api/v1/teams/{team['teamId']}/members/{member}",
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["memberCount"] == 2
    missing = client.delete(
        f"/api/v1/teams/{team['teamId']}/members/{member}",
    )
    assert missing.status_code == 404

    deleted = client.delete(f"/api/v1/teams/{team['teamId']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/teams/{team['teamId']}").status_code == 404
    assert client.get("/api/v1/teams").json()["items"] == []


def test_team_validation_and_conflicts(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    lead = _agent(client, "协调者")
    _create_team(client, name="重名团队", lead_id=lead)

    same_name = client.post("/api/v1/teams", json={"name": "重名团队"})
    assert same_name.status_code == 409
    assert "CONFLICT" in same_name.json()["error"]["code"]

    blank = client.post("/api/v1/teams", json={"name": ""})
    assert blank.status_code in (400, 422)

    unknown_agent = client.post(
        "/api/v1/teams", json={"name": "空团队", "leadId": "ag_missing"},
    )
    assert unknown_agent.status_code == 404

    team = _create_team(client, name="角色校验", lead_id=lead)
    bad_role = client.post(
        f"/api/v1/teams/{team['teamId']}/members",
        json={"agentId": lead, "role": "owner"},
    )
    assert bad_role.status_code == 400


def test_teams_are_tenant_scoped(env: tuple[Path, TestClient]) -> None:
    db, client = env
    team = _create_team(client, name="租户隔离")
    conn = m.connect(db)
    try:
        with pytest.raises(AppError) as exc:
            orchestration.get_team(
                conn, tenant_id="other", team_id=team["teamId"],
            )
        assert exc.value.normalized_code() == "NOT_FOUND"
        assert orchestration.list_teams(conn, tenant_id="other") == []
    finally:
        conn.close()
    conn = m.connect(db)
    try:
        row = conn.execute(
            "SELECT action, result FROM audit_log WHERE action = 'team.create'"
            " ORDER BY id DESC LIMIT 1"
        ).fetchone()
        assert row is not None and row[0] == "team.create" and row[1] == "ok"
    finally:
        conn.close()
