"""Slice ① API: auth + threads + SSE."""

# covers: T-AUTH-03 T-CHAT-02

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin, hash_password

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


def login(client: TestClient, username: str = "admin", password: str = "test-pass") -> dict:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_login_rejects_bad_password(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "nope"}
    )
    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "AUTH_FAILED"
    assert body["error"]["traceId"]


def test_login_me_logout(client: TestClient) -> None:
    data = login(client)
    assert data["user"]["username"] == "admin"
    assert data["user"]["isOwner"] is True

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["userId"] == data["user"]["userId"]

    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401


def test_thread_crud_and_isolation(client: TestClient, tmp_path: Path) -> None:
    login(client)
    created = client.post("/api/v1/threads", json={"title": "hello"})
    assert created.status_code == 201
    thread_id = created.json()["threadId"]

    listed = client.get("/api/v1/threads")
    assert [t["threadId"] for t in listed.json()["items"]] == [thread_id]

    # a second user must not see it (private by default -> 404)
    conn = m.connect(tmp_path / "app.db")
    conn.execute(
        "INSERT INTO users (tenant_id, user_id, username, password_hash, status, is_owner,"
        " created_at, updated_at) VALUES ('default','us_other','other',?,'active',0,1,1)",
        (hash_password("other-pass"),),
    )
    conn.commit()
    conn.close()

    other = TestClient(client.app)
    other.post("/api/v1/auth/login", json={"username": "other", "password": "other-pass"})
    assert other.get(f"/api/v1/threads/{thread_id}/messages").status_code == 404


def test_post_turn_is_idempotent_and_replays(client: TestClient) -> None:
    login(client)
    thread_id = client.post("/api/v1/threads", json={"title": "t"}).json()["threadId"]

    first = client.post(
        f"/api/v1/threads/{thread_id}/turns",
        json={"content": "hello"},
        headers={"Idempotency-Key": "k-1"},
    )
    assert first.status_code == 202
    second = client.post(
        f"/api/v1/threads/{thread_id}/turns",
        json={"content": "hello"},
        headers={"Idempotency-Key": "k-1"},
    )
    assert second.status_code == 202
    assert first.json()["turnId"] == second.json()["turnId"]

    messages = client.get(f"/api/v1/threads/{thread_id}/messages").json()["items"]
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "hello"

    stream = client.get(f"/api/v1/threads/{thread_id}/events?after_seq=0")
    assert stream.status_code == 200
    assert "turn.queued" in stream.text
    assert stream.text.startswith("id: 1")


def test_empty_message_rejected(client: TestClient) -> None:
    login(client)
    thread_id = client.post("/api/v1/threads", json={}).json()["threadId"]
    response = client.post(f"/api/v1/threads/{thread_id}/turns", json={"content": "  "})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_unauthenticated_is_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/threads")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_unknown_route_uses_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    assert "traceId" in response.json()["error"]
