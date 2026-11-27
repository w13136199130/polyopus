"""Memory API: list/create/correct/pause/export/delete (MEM-004..006)."""

# covers: T-MEM-04 T-MEM-06

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


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "app.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="test-pass")
    conn.close()
    settings = Settings(
        db_path=db,
        secret_key="test-secret",
        access_ttl_seconds=3600,
        session_ttl_seconds=86400,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def login(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "test-pass"}
    )
    assert response.status_code == 200, response.text


def test_memory_crud_search_export_and_pause(client: TestClient) -> None:
    login(client)

    empty = client.get("/api/v1/memories")
    assert empty.status_code == 200
    assert empty.json()["items"] == []

    created = client.post(
        "/api/v1/memories",
        json={"kind": "preference", "text": "回答尽量用中文，先给结论"},
    )
    assert created.status_code == 201, created.text
    atom = created.json()
    assert atom["id"].startswith("ma_")
    assert atom["status"] == "active"
    assert atom["source"] == "explicit_user"

    listed = client.get("/api/v1/memories")
    assert [item["id"] for item in listed.json()["items"]] == [atom["id"]]

    got = client.get(f"/api/v1/memories/{atom['id']}")
    assert got.status_code == 200
    assert got.json()["text"] == atom["text"]

    patched = client.patch(
        f"/api/v1/memories/{atom['id']}",
        json={"text": "回答用中文，先给结论，再给依据", "reason": "clarify"},
    )
    assert patched.status_code == 200
    assert "依据" in patched.json()["text"]

    searched = client.get("/api/v1/memories/search", params={"q": "中文"})
    assert searched.status_code == 200
    assert searched.json()["items"][0]["atom"]["id"] == atom["id"]

    exported = client.get("/api/v1/memories/export")
    assert exported.status_code == 200
    assert exported.json()["format"] == "json"
    assert exported.json()["items"][0]["id"] == atom["id"]

    paused = client.post("/api/v1/memories/pause", json={"paused": True})
    assert paused.status_code == 200
    assert paused.json()["paused"] is True
    assert client.get("/api/v1/memories/pause").json()["paused"] is True

    resumed = client.post("/api/v1/memories/pause", json={"paused": False})
    assert resumed.json()["paused"] is False

    removed = client.delete(f"/api/v1/memories/{atom['id']}")
    assert removed.status_code == 200
    retired = client.get("/api/v1/memories", params={"status": "retired"})
    assert retired.json()["items"][0]["id"] == atom["id"]
    assert client.get(f"/api/v1/memories/{atom['id']}").json()["status"] == "retired"


def test_memory_missing_returns_stable_code(client: TestClient) -> None:
    login(client)
    response = client.patch("/api/v1/memories/ma_missing", json={"text": "x"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MEMORY_NOT_FOUND"
