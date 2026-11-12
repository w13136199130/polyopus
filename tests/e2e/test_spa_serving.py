"""SPA static serving (v0.1 card V05-01): fallback rules and cache headers.

`src/polyopus/web` is the committed Vite build; these tests pin the serving
contract from docs/49 §12: hashed assets immutable, index no-store,
unknown /api stays JSON 404.
"""

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
WEB = ROOT / "src" / "polyopus" / "web"


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "spa.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.mark.skipif(not (WEB / "index.html").is_file(), reason="dist not built")
def test_root_serves_spa_no_store(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "id=\"root\"" in response.text
    assert "/assets/" in response.text
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.skipif(not (WEB / "index.html").is_file(), reason="dist not built")
def test_spa_fallback_for_client_routes(client: TestClient) -> None:
    for path in ("/tasks", "/chat", "/agents", "/settings"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "id=\"root\"" in response.text, path
        assert response.headers["cache-control"] == "no-store", path


def test_api_404_stays_json(client: TestClient) -> None:
    response = client.get("/api/v1/definitely-not-a-route")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_healthz_not_swallowed(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.skipif(not (WEB / "index.html").is_file(), reason="dist not built")
def test_hashed_assets_immutable(client: TestClient) -> None:
    index = client.get("/").text
    asset_ref = next(
        line.split("src=\"")[1].split("\"")[0]
        for line in index.splitlines()
        if "src=\"/assets/" in line and line.strip().startswith("<script")
    )
    assert asset_ref.startswith("/assets/")

    response = client.get(asset_ref)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"

    missing = client.get("/assets/does-not-exist-12345678.js")
    assert missing.status_code == 404
