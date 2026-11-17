"""V1-04: user CRUD, role assignment, invites, last-admin protection."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "admin.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield db, client


def test_admin_user_crud_and_roles(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    users = client.get("/api/v1/users").json()["items"]
    admin = next(u for u in users if u["username"] == "admin")
    assert admin["roles"] == ["admin"]

    created = client.post("/api/v1/users", json={
        "username": "bob", "display_name": "Bob", "password": "bob-password",
        "roles": ["member"],
    })
    assert created.status_code == 201, created.text
    bob_id = created.json()["userId"]
    assert created.json()["role"] == "member"
    audit_rows = client.get("/api/v1/admin/audit",
                            params={"action": "user.create"}).json()["items"]
    assert any(row["resourceId"] == bob_id for row in audit_rows)

    updated = client.patch(f"/api/v1/users/{bob_id}", json={"roles": ["auditor"]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["role"] == "auditor"

    # Last admin cannot be demoted or deleted.
    me = next(u for u in client.get("/api/v1/users").json()["items"]
              if u["username"] == "admin")
    denied = client.patch(f"/api/v1/users/{me['userId']}", json={"roles": ["member"]})
    assert denied.status_code == 409
    assert denied.json()["error"]["details"]["reason"] == "last_admin"
    assert client.delete(f"/api/v1/users/{me['userId']}").status_code == 409

    roles = client.get("/api/v1/roles").json()["items"]
    assert {r["name"] for r in roles} == {"admin", "member", "auditor"}
    assert client.delete(f"/api/v1/users/{bob_id}").status_code == 200


def test_invite_create_preview_accept_and_reuse(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    created = client.post("/api/v1/invites", json={
        "email": "carol@example.com", "role": "member",
        "expiresInHours": 24,
    })
    assert created.status_code == 201, created.text
    invite = created.json()
    token = invite["token"]

    preview = client.get(f"/api/v1/invites/{token}")
    assert preview.status_code == 200
    assert preview.json()["email"] == "carol@example.com"

    accepted = client.post("/api/v1/invites/accept", json={
        "token": token, "password": "carol-password", "displayName": "Carol",
    })
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["user"]["username"] == "carol"

    reused = client.post("/api/v1/invites/accept", json={
        "token": token, "password": "carol-password",
    })
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "INVITE_USED"

    # Accept logged Carol in; go back to the admin session for management.
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/login", json={
        "username": "admin", "password": PASSWORD,
    }).status_code == 200
    second = client.post("/api/v1/invites", json={
        "email": "dave@example.com", "role": "member",
    })
    assert second.status_code == 201, second.text
    revoked = second.json()
    assert client.delete(f"/api/v1/invites/{revoked['inviteId']}").status_code == 200
    assert client.get(f"/api/v1/invites/{revoked['token']}").status_code == 400


def test_auditor_can_read_users_but_not_write(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    created = client.post("/api/v1/users", json={
        "username": "eve", "password": "eve-password", "roles": ["auditor"],
    })
    assert created.status_code == 201
    client.post("/api/v1/auth/logout")
    login = client.post("/api/v1/auth/login", json={
        "username": "eve", "password": "eve-password",
    })
    assert login.status_code == 200, login.text
    assert client.get("/api/v1/users").status_code == 200
    assert client.post("/api/v1/users", json={
        "username": "nope", "password": "nope-password", "roles": ["member"],
    }).status_code == 403
    assert client.get("/api/v1/invites").status_code == 200
