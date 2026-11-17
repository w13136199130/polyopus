"""V1-15: signed plugin installs, example set, enable/disable and uninstall."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.plugins import service as plugins
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[TestClient, str]]:
    db = tmp_path / "plugins.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="plugin-secret", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield client, settings.secret_key


def test_examples_install_toggle_and_uninstall(env: tuple[TestClient, str]) -> None:
    client, _secret = env
    installed = client.post("/api/v1/plugins/examples/install")
    assert installed.status_code == 200, installed.text
    assert len(installed.json()["items"]) == 3

    listed = client.get("/api/v1/plugins").json()["items"]
    assert len(listed) == 3
    echo = next(row for row in listed if row["pluginId"] == "example.echo")
    assert echo["status"] == "enabled" and "plugin.echo" in echo["tools"]

    tools = {row["toolKey"]: row for row in client.get("/api/v1/tools").json()["items"]}
    assert tools["plugin.echo"]["enabledGlobal"] is True

    disabled = client.patch("/api/v1/plugins/example.echo", json={"enabled": False})
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["status"] == "disabled"
    tools = {row["toolKey"]: row for row in client.get("/api/v1/tools").json()["items"]}
    assert tools["plugin.echo"]["enabledGlobal"] is False

    enabled = client.patch("/api/v1/plugins/example.echo", json={"enabled": True})
    assert enabled.json()["status"] == "enabled"
    assert client.delete("/api/v1/plugins/example.echo").status_code == 200
    assert len(client.get("/api/v1/plugins").json()["items"]) == 2


def test_invalid_signature_and_api_version_rejected(
    env: tuple[TestClient, str]
) -> None:
    client, secret = env
    manifest = {
        "id": "example.bad", "name": "Bad", "version": "1.0.0",
        "apiVersion": "1.0", "permissions": [], "tools": [],
    }
    bad = client.post("/api/v1/plugins/example.bad/install", json={
        "manifest": manifest, "signature": "deadbeef", "signer": "local",
    })
    assert bad.status_code == 403
    assert bad.json()["error"]["code"] == "PLUGIN_SIGNATURE_INVALID"

    future = dict(manifest, apiVersion="2.0")
    future_sig = plugins.sign_manifest(future, secret)
    rejected = client.post("/api/v1/plugins/example.bad/install", json={
        "manifest": future, "signature": future_sig, "signer": "local",
    })
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "VALIDATION_FAILED"
    assert rejected.json()["error"]["details"]["reason"] == "api_version_incompatible"

    unknown_signer = dict(manifest)
    sig = plugins.sign_manifest(unknown_signer, secret, signer="remote")
    untrusted = client.post("/api/v1/plugins/example.bad/install", json={
        "manifest": unknown_signer, "signature": sig, "signer": "remote",
    })
    assert untrusted.status_code == 403
