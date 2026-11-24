"""v1.1 Feishu channel: CRUD, challenge, inbound ticket, probe and send."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.channels import service as channels
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "channel-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "channels.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="channel-secret", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield db, client


def _create(client: TestClient) -> dict:
    response = client.post("/api/v1/channels", json={
        "kind": "feishu",
        "displayName": "研发群飞书",
        "appId": "cli_test",
        "appSecret": "secret",
        "verificationToken": "verify-me",
    })
    assert response.status_code == 201, response.text
    return response.json()


def _message_body(token: str = "verify-me", *, message_id: str = "om_1",
                  text: str = "/polyopus 保存结果到 out.txt",
                  chat_type: str = "p2p", mentions: list | None = None) -> dict:
    return {
        "schema": "2.0",
        "header": {"event_type": "im.message.receive_v1", "token": token},
        "event": {
            "sender": {"sender_id": {"open_id": "ou_alice"}},
            "message": {
                "message_id": message_id,
                "chat_id": "oc_chat",
                "chat_type": chat_type,
                "message_type": "text",
                "content": json.dumps({"text": text}, ensure_ascii=False),
                "mentions": mentions or [],
            },
        },
    }


def test_channel_create_hides_credentials_and_backs_a_source(
    env: tuple[Path, TestClient],
) -> None:
    _db, client = env
    created = _create(client)
    assert created["displayName"] == "研发群飞书"
    assert created["status"] == "active"
    assert "appSecret" not in created and "verificationToken" not in created
    assert created["webhookPath"].endswith("/events")

    listed = client.get("/api/v1/channels").json()
    assert [item["channelId"] for item in listed["items"]] == [created["channelId"]]
    sources = client.get("/api/v1/sources").json()["items"]
    hidden = [src for src in sources if src["kind"] == "channel_feishu"]
    assert hidden and hidden[0]["name"] == "飞书 · 研发群飞书"


def test_url_verification_and_token_check(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    created = _create(client)
    path = f"/api/v1/channels/feishu/{created['channelId']}/events"

    ok = client.post(path, json={
        "type": "url_verification", "challenge": "abc", "token": "verify-me",
    })
    assert ok.status_code == 200 and ok.json()["challenge"] == "abc"

    bad = client.post(path, json={
        "type": "url_verification", "challenge": "abc", "token": "wrong",
    })
    assert bad.status_code == 401


def test_inbound_message_opens_ticket_and_dedupes(
    env: tuple[Path, TestClient],
) -> None:
    db, client = env
    created = _create(client)
    path = f"/api/v1/channels/feishu/{created['channelId']}/events"

    first = client.post(path, json=_message_body())
    assert first.status_code == 200, first.text
    ticket_id = first.json()["ticketId"]
    assert ticket_id
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["bucket"] == "queued"

    duplicate = client.post(path, json=_message_body())
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT direction, status, ticket_id FROM channel_messages"
        " WHERE channel_id = ?", (created["channelId"],),
    ).fetchall()
    assert len(rows) == 1
    assert rows[0]["direction"] == "inbound"
    assert rows[0]["ticket_id"] == ticket_id
    tickets = conn.execute(
        "SELECT count(*) FROM tickets WHERE title LIKE '%保存结果%'"
    ).fetchone()[0]
    assert tickets == 1
    conn.close()


def test_group_message_without_mention_is_ignored(
    env: tuple[Path, TestClient],
) -> None:
    _db, client = env
    created = _create(client)
    path = f"/api/v1/channels/feishu/{created['channelId']}/events"
    ignored = client.post(path, json=_message_body(chat_type="group"))
    assert ignored.status_code == 200
    assert ignored.json()["ignored"] == "no_mention"


def test_probe_and_send_text_use_feishu_api(
    env: tuple[Path, TestClient], monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)

    class FakeResponse:
        def __init__(self, payload: dict) -> None:
            self._payload = payload

        def json(self) -> dict:
            return self._payload

    calls: list[str] = []

    def fake_post(url: str, **kwargs: object) -> FakeResponse:
        calls.append(url)
        if "tenant_access_token" in url:
            return FakeResponse({"code": 0, "tenant_access_token": "tok"})
        return FakeResponse({"code": 0, "data": {"message_id": "om_out"}})

    monkeypatch.setattr(channels.httpx, "post", fake_post)
    probe = client.post(
        f"/api/v1/channels/{created['channelId']}/probe"
    )
    assert probe.status_code == 200 and probe.json()["ok"] is True

    conn = m.connect(db)
    try:
        channels.send_text(
            conn, tenant_id="default", channel_id=created["channelId"],
            chat_id="oc_chat", text="任务完成",
        )
    finally:
        conn.close()
    assert any("tenant_access_token" in url for url in calls)
    conn = sqlite3.connect(str(db))
    outbound = conn.execute(
        "SELECT direction, status FROM channel_messages WHERE direction='outbound'"
    ).fetchall()
    assert outbound == [("outbound", "sent")]
    conn.close()


def test_delete_disables_channel_and_pauses_source(
    env: tuple[Path, TestClient],
) -> None:
    _db, client = env
    created = _create(client)
    deleted = client.delete(f"/api/v1/channels/{created['channelId']}")
    assert deleted.status_code == 200
    assert client.get("/api/v1/channels").json()["items"] == []
    sources = client.get("/api/v1/sources").json()["items"]
    hidden = [src for src in sources if src["kind"] == "channel_feishu"][0]
    assert hidden["status"] == "paused"
    event = client.post(
        f"/api/v1/channels/feishu/{created['channelId']}/events",
        json=_message_body(),
    )
    assert event.status_code >= 400
