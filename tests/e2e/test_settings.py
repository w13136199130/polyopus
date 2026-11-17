"""V1-16: settings snapshot, API-key step-up and MFA lifecycle."""

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
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "settings.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as c:
        login = c.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield c


def test_settings_snapshot_is_read_only_and_secret_free(client: TestClient) -> None:
    response = client.get("/api/v1/admin/settings")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["readOnly"] is True
    assert body["auditRetentionDays"] == 365
    assert "secret" not in str(body).lower()


def test_api_key_requires_step_up_then_mfa_lifecycle(client: TestClient) -> None:
    me = client.get("/api/v1/auth/me")
    assert me.json()["user"]["mfaEnabled"] is False

    denied = client.post("/api/v1/me/api-keys", json={
        "name": "ci", "scopes": ["chat:read"],
    })
    assert denied.status_code == 401, denied.text
    assert denied.json()["error"]["code"] == "REAUTH_REQUIRED"

    reauth = client.post("/api/v1/auth/reauth", json={"password": PASSWORD})
    assert reauth.status_code == 200, reauth.text

    created = client.post("/api/v1/me/api-keys", json={
        "name": "ci", "scopes": ["chat:read"],
    })
    assert created.status_code == 201, created.text
    key = created.json()
    assert key["secret"].startswith("poly_")
    key_id = key["key"]["id"]

    keys = client.get("/api/v1/me/api-keys").json()["items"]
    assert any(row["id"] == key_id for row in keys)
    assert client.delete(f"/api/v1/me/api-keys/{key_id}").status_code == 200

    enrolled = client.post("/api/v1/auth/mfa/totp/enroll")
    assert enrolled.status_code == 200, enrolled.text
    secret = enrolled.json()["secret"]
    code = mfa.totp_at(secret, int(time.time()))
    verified = client.post("/api/v1/auth/mfa/totp/verify", json={"code": code})
    assert verified.status_code == 200, verified.text
    assert len(verified.json()["recoveryCodes"]) == 8
    assert client.get("/api/v1/auth/me").json()["user"]["mfaEnabled"] is True

    disabled = client.delete("/api/v1/auth/mfa/totp")
    assert disabled.status_code == 200, disabled.text
    assert client.get("/api/v1/auth/me").json()["user"]["mfaEnabled"] is False
