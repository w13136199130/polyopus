"""V1-03: refresh rotation, API keys, MFA and step-up."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.identity import mfa
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import hash_password

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "pw"


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "auth.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    now = int(time.time())
    conn.execute(
        "INSERT INTO users (tenant_id, user_id, username, display_name,"
        " password_hash, status, is_owner, created_at, updated_at)"
        " VALUES ('default', 'u_1', 'alice', 'alice', ?, 'active', 1, ?, ?)",
        (hash_password(PASSWORD), now, now),
    )
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as c:
        yield c


def login(client: TestClient, **extra: object) -> dict:
    response = client.post("/api/v1/auth/login", json={
        "username": "alice", "password": PASSWORD, **extra,
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_refresh_rotation_and_reuse_revokes_family(client: TestClient) -> None:
    first = login(client)
    refreshed = client.post(
        "/api/v1/auth/refresh", json={"refreshToken": first["refreshToken"]}
    )
    assert refreshed.status_code == 200, refreshed.text
    second = refreshed.json()
    assert second["refreshToken"] != first["refreshToken"]

    # Replaying the rotated token burns the whole family.
    replay = client.post(
        "/api/v1/auth/refresh", json={"refreshToken": first["refreshToken"]}
    )
    assert replay.status_code == 401
    after = client.post(
        "/api/v1/auth/refresh", json={"refreshToken": second["refreshToken"]}
    )
    assert after.status_code == 401


def test_api_keys_are_scoped_and_need_step_up(client: TestClient) -> None:
    login(client)
    denied = client.post("/api/v1/me/api-keys", json={
        "name": "no-step-up", "scopes": ["ticket:read"],
    })
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "REAUTH_REQUIRED"

    reauth = client.post("/api/v1/auth/reauth", json={"password": PASSWORD})
    assert reauth.status_code == 200, reauth.text
    created = client.post("/api/v1/me/api-keys", json={
        "name": "reader", "scopes": ["ticket:read"],
    })
    assert created.status_code == 201, created.text
    key = created.json()["secret"]

    client.cookies.clear()
    headers = {"Authorization": f"Bearer {key}"}
    assert client.get("/api/v1/tickets", headers=headers).status_code == 200
    assert client.get("/api/v1/admin/audit", headers=headers).status_code == 403

    # Revocation is a step-up action; re-auth as the session user first.
    login(client)
    client.post("/api/v1/auth/reauth", json={"password": PASSWORD})
    revoked = client.delete(f"/api/v1/me/api-keys/{created.json()['key']['id']}")
    assert revoked.status_code == 200
    client.cookies.clear()
    assert client.get("/api/v1/tickets", headers=headers).status_code == 401


def test_mfa_enroll_login_reauth_and_disable(client: TestClient) -> None:
    login(client)
    enrolled = client.post("/api/v1/auth/mfa/totp/enroll")
    assert enrolled.status_code == 200, enrolled.text
    secret = enrolled.json()["secret"]
    code = mfa.totp_at(secret, int(time.time()))
    verified = client.post("/api/v1/auth/mfa/totp/verify", json={"code": code})
    assert verified.status_code == 200, verified.text
    recovery = verified.json()["recoveryCodes"]
    assert len(recovery) == 8

    missing = client.post("/api/v1/auth/login", json={
        "username": "alice", "password": PASSWORD,
    })
    assert missing.status_code == 401
    assert missing.json()["error"]["details"]["mfaRequired"] is True

    current = mfa.totp_at(secret, int(time.time()))
    assert client.post("/api/v1/auth/login", json={
        "username": "alice", "password": PASSWORD, "mfaCode": current,
    }).status_code == 200

    # Recovery codes are one-time.
    assert client.post("/api/v1/auth/login", json={
        "username": "alice", "password": PASSWORD, "mfaCode": recovery[0],
    }).status_code == 200
    assert client.post("/api/v1/auth/login", json={
        "username": "alice", "password": PASSWORD, "mfaCode": recovery[0],
    }).status_code == 401

    # Disable requires step-up; reauth itself needs a current TOTP.
    client.post("/api/v1/auth/login", json={
        "username": "alice", "password": PASSWORD,
        "mfaCode": mfa.totp_at(secret, int(time.time())),
    })
    assert client.delete("/api/v1/auth/mfa/totp").status_code == 401
    reauth = client.post("/api/v1/auth/reauth", json={
        "password": PASSWORD,
        "mfaCode": mfa.totp_at(secret, int(time.time())),
    })
    assert reauth.status_code == 200, reauth.text
    assert client.delete("/api/v1/auth/mfa/totp").status_code == 200


def test_token_in_query_is_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me", params={"access_token": "x"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "TOKEN_IN_QUERY"
