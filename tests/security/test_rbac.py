"""V1-02: builtin roles, permission gates and last-admin protection."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.identity import rbac
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import hash_password
from polyopus.platform.errors import AppError

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "pw"
TENANT = "t_rbac"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "rbac.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    now = int(time.time())
    conn.execute(
        "INSERT INTO tenants (tenant_id, name, status, plan, created_at,"
        " updated_at) VALUES (?, 'rbac', 'active', 'free', ?, ?)",
        (TENANT, now, now),
    )
    for user, owner in (("u_admin", 1), ("u_mem", 0), ("u_aud", 0)):
        conn.execute(
            "INSERT INTO users (tenant_id, user_id, username, display_name,"
            " password_hash, status, is_owner, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)",
            (TENANT, user, user, user, hash_password(PASSWORD), owner, now, now),
        )
    rbac.ensure_builtin_roles(conn, TENANT)
    rbac.set_roles(conn, tenant_id=TENANT, user_id="u_admin", role_names=["admin"])
    rbac.set_roles(conn, tenant_id=TENANT, user_id="u_mem", role_names=["member"])
    rbac.set_roles(conn, tenant_id=TENANT, user_id="u_aud", role_names=["auditor"])
    conn.commit()
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        yield db, client


def login(client: TestClient, user: str) -> dict:
    response = client.post("/api/v1/auth/login", json={
        "username": user, "password": PASSWORD, "tenant": TENANT,
    })
    assert response.status_code == 200, response.text
    return response.json()["user"]


def test_admin_member_auditor_matrix(env: tuple[Path, TestClient]) -> None:
    _db, client = env

    admin = login(client, "u_admin")
    assert admin["roles"] == ["admin"]
    assert admin["permissions"] == ["*"]
    assert client.get("/api/v1/admin/audit").status_code == 200
    assert client.post("/api/v1/sources", json={
        "name": "admin-src", "generateSecret": False,
    }).status_code == 201

    member = login(client, "u_mem")
    assert member["roles"] == ["member"]
    assert "ticket:read" in member["permissions"] and "audit:read" not in member["permissions"]
    assert client.get("/api/v1/tickets").status_code == 200
    assert client.get("/api/v1/usage/summary").status_code == 200
    assert client.get("/api/v1/cron-jobs").status_code == 200
    assert client.post("/api/v1/sources", json={
        "name": "member-src", "generateSecret": False,
    }).status_code == 201
    assert client.get("/api/v1/admin/audit").status_code == 403
    assert client.post("/api/v1/cron-jobs", json={
        "name": "member-job", "schedule": "interval:3600",
        "timezone": "UTC", "text": "/polyopus x",
    }).status_code == 201

    auditor = login(client, "u_aud")
    assert auditor["roles"] == ["auditor"]
    assert "audit:read" in auditor["permissions"]
    assert client.get("/api/v1/admin/audit").status_code == 200
    assert client.get("/api/v1/tickets").status_code == 200
    assert client.get("/api/v1/usage/summary").status_code == 200
    assert client.post("/api/v1/sources", json={
        "name": "auditor-src", "generateSecret": False,
    }).status_code == 403
    assert client.post("/api/v1/cron-jobs", json={
        "name": "auditor-job", "schedule": "interval:3600",
        "timezone": "UTC", "text": "/polyopus x",
    }).status_code == 403


def test_me_exposes_roles_and_permissions(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    login(client, "u_mem")
    me = client.get("/api/v1/auth/me").json()["user"]
    assert me["roles"] == ["member"]
    assert me["permissions"] == sorted(rbac.MEMBER_PERMISSIONS)


def test_last_admin_cannot_lose_admin(env: tuple[Path, TestClient]) -> None:
    _db, _client = env
    conn = m.connect(_db)
    try:
        with pytest.raises(AppError) as excinfo:
            rbac.set_roles(
                conn, tenant_id=TENANT, user_id="u_admin", role_names=["member"]
            )
        assert excinfo.value.normalized_code() == "CONFLICT"
        assert "last_admin" in str(excinfo.value.details)

        # A second admin allows the first to be demoted.
        rbac.set_roles(conn, tenant_id=TENANT, user_id="u_mem", role_names=["admin"])
        rbac.set_roles(
            conn, tenant_id=TENANT, user_id="u_admin", role_names=["member"]
        )
    finally:
        conn.close()
