"""v1.1 Feishu channel: CRUD, challenge, inbound ticket, probe and send."""

from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.channels import cards
from polyopus.domains.channels import service as channels
from polyopus.domains.tickets import service as tickets
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

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


def _create(
    client: TestClient, *,
    approvers: list[str] | None = None,
    encrypt_key: str | None = None,
) -> dict:
    response = client.post("/api/v1/channels", json={
        "kind": "feishu",
        "displayName": "研发群飞书",
        "appId": "cli_test",
        "appSecret": "secret",
        "verificationToken": "verify-me",
        "approvers": approvers or [],
        "encryptKey": encrypt_key,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _encrypt_event(body: dict, encrypt_key: str) -> dict:
    raw = json.dumps(body, ensure_ascii=False).encode()
    pad = 16 - len(raw) % 16
    padded = raw + bytes([pad]) * pad
    iv = b"\x0e" * 16
    cipher = Cipher(
        algorithms.AES(hashlib.sha256(encrypt_key.encode()).digest()),
        modes.CBC(iv),
    )
    encryptor = cipher.encryptor()
    blob = iv + encryptor.update(padded) + encryptor.finalize()
    return {"encrypt": base64.b64encode(blob).decode()}


def _message_body(token: str = "verify-me", *, message_id: str = "om_1",
                  text: str = "/polyopus 保存结果到 out.txt",
                  chat_type: str = "p2p", mentions: list | None = None,
                  sender: str = "ou_alice") -> dict:
    return {
        "schema": "2.0",
        "header": {"event_type": "im.message.receive_v1", "token": token},
        "event": {
            "sender": {"sender_id": {"open_id": sender}},
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
    assert created["approvers"] == []
    assert created["credentialsSet"] == {
        "appSecret": True, "verificationToken": True, "encryptKey": False,
    }
    assert created["webhookPath"].endswith("/events")

    patched = client.patch(
        f"/api/v1/channels/{created['channelId']}",
        json={"approvers": ["ou_bob", "ou_bob", " ou_carol "]},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["approvers"] == ["ou_bob", "ou_carol"]

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


def test_encrypted_events_are_decrypted(env: tuple[Path, TestClient]) -> None:
    _db, client = env
    created = _create(client, encrypt_key="enc-secret")
    path = f"/api/v1/channels/feishu/{created['channelId']}/events"

    challenge = client.post(path, json=_encrypt_event({
        "type": "url_verification", "challenge": "enc-abc",
        "token": "verify-me",
    }, "enc-secret"))
    assert challenge.status_code == 200, challenge.text
    assert challenge.json()["challenge"] == "enc-abc"

    inbound = client.post(
        path, json=_encrypt_event(_message_body(message_id="om_enc"), "enc-secret"),
    )
    assert inbound.status_code == 200, inbound.text
    assert inbound.json()["ticketId"]

    wrong_key = client.post(
        path, json=_encrypt_event(_message_body(message_id="om_bad"), "wrong-key"),
    )
    assert wrong_key.status_code == 401


def test_encrypted_event_without_key_is_rejected(
    env: tuple[Path, TestClient],
) -> None:
    _db, client = env
    created = _create(client)
    response = client.post(
        f"/api/v1/channels/feishu/{created['channelId']}/events",
        json=_encrypt_event(_message_body(), "some-key"),
    )
    assert response.status_code == 401


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


def test_mention_placeholder_is_removed_from_ticket_title(
    env: tuple[Path, TestClient],
) -> None:
    db, client = env
    created = _create(client)
    response = client.post(
        f"/api/v1/channels/feishu/{created['channelId']}/events",
        json=_message_body(
            message_id="om_title", text="@_user_1 /polyopus 整理发布记录",
            chat_type="group", mentions=[{"key": "@_user_1"}],
        ),
    )
    assert response.status_code == 200, response.text
    conn = sqlite3.connect(str(db))
    try:
        title = conn.execute(
            "SELECT title FROM tickets WHERE ticket_id = ?",
            (response.json()["ticketId"],),
        ).fetchone()[0]
    finally:
        conn.close()
    assert title == "整理发布记录"


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


class FakeFeishu:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.patched: list[dict] = []
        self.patch_ok = True

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sent = self.sent
        patched = self.patched

        class Response:
            def __init__(self, payload: dict) -> None:
                self._payload = payload

            def json(self) -> dict:
                return self._payload

        def fake_post(url: str, **kwargs: object) -> Response:
            if "tenant_access_token" in url:
                return Response({"code": 0, "tenant_access_token": "tok"})
            body = kwargs.get("json") or {}
            content = body.get("content") if isinstance(body, dict) else "{}"
            if body.get("msg_type") == "interactive":
                sent.append(str(content))
            else:
                try:
                    sent.append(json.loads(str(content)).get("text", ""))
                except ValueError:
                    sent.append("")
            return Response({"code": 0, "data": {"message_id": f"om_out_{len(sent)}"}})

        def fake_patch(url: str, **kwargs: object) -> Response:
            patched.append({"url": url, "json": kwargs.get("json")})
            if not self.patch_ok:
                return Response({"code": 99991663, "msg": "update failed"})
            return Response({"code": 0, "data": {}})

        monkeypatch.setattr(channels.httpx, "post", fake_post)
        monkeypatch.setattr(channels.httpx, "patch", fake_patch)


def _open_ticket(client: TestClient, channel_id: str, text: str,
                 message_id: str) -> str:
    response = client.post(
        f"/api/v1/channels/feishu/{channel_id}/events",
        json=_message_body(message_id=message_id, text=text),
    )
    assert response.status_code == 200, response.text
    ticket_id = response.json()["ticketId"]
    assert ticket_id
    return str(ticket_id)


def _card_body(
    attention_id: str, decision: str = "approved",
    operator: str = "ou_alice", token: str = "verify-me",
) -> dict:
    return {
        "schema": "2.0",
        "header": {
            "event_type": "card.action.trigger", "token": token,
            "event_id": "evt_card",
        },
        "event": {
            "operator": {"open_id": operator},
            "action": {
                "tag": "button",
                "value": {"decision": decision, "attentionId": attention_id},
            },
        },
    }


def test_terminal_ticket_reply_is_queued_and_delivered(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 总结一下这次发布", "om_done",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        state = tickets.run_assignment(
            conn, store, ticket_id, content="总结一下这次发布",
            engine_config=engine.EngineConfig(workspace=ws),
        )
        assert state in ("ready", "completed", "done", "blocked")
        queued = conn.execute(
            "SELECT count(*) FROM channel_messages WHERE direction='outbound'"
            " AND status='queued' AND ticket_id = ?", (ticket_id,),
        ).fetchone()[0]
        assert queued == 1
        fake = FakeFeishu()
        fake.install(monkeypatch)
        channels.deliver_queued(conn)
        assert fake.sent and "任务完成" in fake.sent[0]
        assert "总结一下这次发布" in fake.sent[0]
    finally:
        conn.close()


def test_approve_command_resumes_ticket_and_replies(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_write",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        command = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_message_body(message_id="om_approve", text="/approve"),
        )
        assert command.status_code == 200, command.text
        assert command.json()["decision"] == "approved"
        row = conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
        assert row[0] == "ended"
        assert (ws / "out.txt").is_file()

        fake = FakeFeishu()
        fake.install(monkeypatch)
        channels.deliver_queued(conn, limit=10)
        assert any("已批准" in text for text in fake.sent)
        assert any("任务完成" in text for text in fake.sent)
    finally:
        conn.close()


def test_waiting_ticket_queues_approval_hint(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_hint",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        rows = conn.execute(
            "SELECT payload_json FROM channel_messages"
            " WHERE direction = 'outbound' AND status = 'queued' AND ticket_id = ?",
            (ticket_id,),
        ).fetchall()
        payloads = [json.loads(str(row[0])) for row in rows]
        card_items = [
            item["card"] for item in payloads if isinstance(item.get("card"), dict)
        ]
        assert card_items, payloads
        dump = json.dumps(card_items, ensure_ascii=False)
        assert "需要你确认" in dump and "写入文件" in dump and "批准" in dump
        # raw tool keys and JSON args must not leak into the card
        assert "fs.write" not in dump and "args_preview" not in dump

        fake = FakeFeishu()
        fake.install(monkeypatch)
        channels.deliver_queued(conn)
        assert any("需要你确认" in text for text in fake.sent)
    finally:
        conn.close()


def test_reject_command_denies_and_replies(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_write2",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        command = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_message_body(message_id="om_reject", text="/reject"),
        )
        assert command.status_code == 200, command.text
        assert command.json()["decision"] == "denied"
        assert not (ws / "out.txt").exists()

        fake = FakeFeishu()
        fake.install(monkeypatch)
        channels.deliver_queued(conn, limit=10)
        assert any("已拒绝" in text for text in fake.sent)
    finally:
        conn.close()


def test_command_without_pending_attention_replies(
    env: tuple[Path, TestClient], monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    response = client.post(
        f"/api/v1/channels/feishu/{created['channelId']}/events",
        json=_message_body(message_id="om_none", text="/approve"),
    )
    assert response.status_code == 200
    assert response.json()["ignored"] == "no_ticket"
    conn = m.connect(db)
    try:
        fake = FakeFeishu()
        fake.install(monkeypatch)
        channels.deliver_queued(conn)
        assert fake.sent == ["当前没有待处理审批。"]
    finally:
        conn.close()


def test_command_requires_creator_or_listed_approver(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    path = f"/api/v1/channels/feishu/{created['channelId']}/events"
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_owner",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"

        denied = client.post(path, json=_message_body(
            message_id="om_mallory", text="/approve", sender="ou_mallory",
        ))
        assert denied.status_code == 200, denied.text
        assert denied.json()["denied"] == "not_approver"
        assert not (ws / "out.txt").exists()
        state = conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()[0]
        assert state == "open"
        audit_row = conn.execute(
            "SELECT result FROM audit_log WHERE action = 'channel.approval_denied'"
            " ORDER BY id DESC LIMIT 1"
        ).fetchone()
        assert audit_row is not None and audit_row[0] == "denied"

        fake = FakeFeishu()
        fake.install(monkeypatch)
        channels.deliver_queued(conn)
        assert any("没有审批权限" in text for text in fake.sent)

        allowed = client.post(path, json=_message_body(
            message_id="om_creator", text="/approve", sender="ou_alice",
        ))
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["decision"] == "approved"
        assert (ws / "out.txt").is_file()
    finally:
        conn.close()


def test_listed_approver_can_approve_another_users_ticket(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client, approvers=["ou_bob"])
    assert created["approvers"] == ["ou_bob"]
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_owner2",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        allowed = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_message_body(
                message_id="om_bob", text="/approve", sender="ou_bob",
            ),
        )
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["decision"] == "approved"
        assert (ws / "out.txt").is_file()
        state = conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()[0]
        assert state == "ended"
    finally:
        conn.close()


def test_card_action_approves_and_resumes(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_card",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        attention_id = conn.execute(
            "SELECT attention_id FROM attentions WHERE ticket_id = ?"
            " AND status = 'pending'", (ticket_id,),
        ).fetchone()[0]

        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id),
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["toast"]["type"] == "success"
        # Feishu only refreshes the card for {"type": "raw", "data": card}
        assert payload["card"]["type"] == "raw"
        updated = json.dumps(payload["card"]["data"], ensure_ascii=False)
        assert "已批准，正在执行" in updated
        assert "写入文件" in updated
        assert "actions" not in updated
        assert (ws / "out.txt").is_file()
        state = conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = ?", (ticket_id,),
        ).fetchone()[0]
        assert state == "ended"

        fake = FakeFeishu()
        fake.install(monkeypatch)
        channels.deliver_queued(conn, limit=10)
        assert any("任务完成" in text for text in fake.sent)
    finally:
        conn.close()


def test_card_action_denies_and_updates_card_in_place(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_card_deny2",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        attention_id = conn.execute(
            "SELECT attention_id FROM attentions WHERE ticket_id = ?"
            " AND status = 'pending'", (ticket_id,),
        ).fetchone()[0]

        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id, decision="denied"),
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["toast"]["type"] == "success"
        assert payload["card"]["type"] == "raw"
        updated = json.dumps(payload["card"]["data"], ensure_ascii=False)
        assert "已拒绝" in updated and "这次操作不会执行" in updated
        assert "approve" not in updated.lower()
        assert not (ws / "out.txt").exists()
        attention_status = conn.execute(
            "SELECT status FROM attentions WHERE attention_id = ?", (attention_id,),
        ).fetchone()[0]
        assert attention_status == "answered"
    finally:
        conn.close()


def test_result_card_keeps_answer_line_breaks() -> None:
    card = cards.result_card(
        state="ready",
        summary="已经保存好了 ✅\n\n- 文件：`out.txt`\n- 内容：你好",
        ticket_title="保存结果到 out.txt",
    )
    content = card["elements"][0]["text"]["content"]
    assert "• 文件：`out.txt`\n• 内容：你好" in content


def _expire_pending_approval(
    conn: sqlite3.Connection, ticket_id: str,
) -> str:
    """Make the pending approval overdue without running the sweeper."""
    row = conn.execute(
        "SELECT attention_id, source_id FROM attentions"
        " WHERE ticket_id = ? AND status = 'pending'", (ticket_id,),
    ).fetchone()
    assert row is not None
    conn.execute(
        "UPDATE approvals SET expires_at = 1 WHERE approval_id = ?",
        (row["source_id"],),
    )
    conn.execute(
        "UPDATE attentions SET expires_at = 1 WHERE attention_id = ?",
        (row["attention_id"],),
    )
    conn.commit()
    return str(row["attention_id"])


def test_card_action_repeat_click_does_not_overwrite_result(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_repeat",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        attention_id = conn.execute(
            "SELECT attention_id FROM attentions WHERE ticket_id = ?"
            " AND status = 'pending'", (ticket_id,),
        ).fetchone()[0]

        first = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id),
        )
        assert first.status_code == 200, first.text
        assert first.json()["card"]["data"]["header"]["title"]["content"] == "已批准，正在执行"

        # The background resume already ended the ticket; a late click must not
        # downgrade the result card that now owns the message.
        second = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id),
        )
        assert second.status_code == 200, second.text
        assert second.json()["toast"]["type"] == "info"
        assert "已处理" in second.json()["toast"]["content"]
        assert "card" not in second.json()
        assert (ws / "out.txt").is_file()
    finally:
        conn.close()


def test_card_action_after_other_decision_marks_card_handled(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_handled",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        row = conn.execute(
            "SELECT attention_id, source_id FROM attentions"
            " WHERE ticket_id = ? AND status = 'pending'", (ticket_id,),
        ).fetchone()
        attention_id = str(row["attention_id"])
        # Simulate another approver answering while the ticket is still resuming.
        conn.execute(
            "UPDATE approvals SET status = 'approved', decisions_json = ?"
            " WHERE approval_id = ?", ('{"by": "ou_bob", "decision": "approved"}',
                                       str(row["source_id"])),
        )
        conn.execute(
            "UPDATE attentions SET status = 'answered' WHERE attention_id = ?",
            (attention_id,),
        )
        conn.commit()

        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id),
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["toast"]["type"] == "info"
        assert "已处理" in payload["toast"]["content"]
        updated = json.dumps(payload["card"]["data"], ensure_ascii=False)
        assert "已批准，正在执行" in updated
        assert "actions" not in updated
    finally:
        conn.close()


def test_card_action_expired_approval_denies_and_marks_card(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_expired",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        attention_id = _expire_pending_approval(conn, ticket_id)

        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id),
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        # approve on an overdue approval must degrade to denied, never execute
        assert payload["toast"]["type"] == "warning"
        assert "过期" in payload["toast"]["content"]
        updated = json.dumps(payload["card"]["data"], ensure_ascii=False)
        assert "审批已过期" in updated and "这次操作没有执行" in updated
        assert not (ws / "out.txt").exists()
        assert conn.execute(
            "SELECT status FROM approvals WHERE approval_id ="
            " (SELECT source_id FROM attentions WHERE attention_id = ?)",
            (attention_id,),
        ).fetchone()[0] == "expired"
        assert conn.execute(
            "SELECT status FROM attentions WHERE attention_id = ?", (attention_id,),
        ).fetchone()[0] == "expired"
        assert conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = ?", (ticket_id,),
        ).fetchone()[0] == "ended"
        # the terminal card is an expired card, not a misleading "user rejected"
        queued = conn.execute(
            "SELECT payload_json FROM channel_messages WHERE direction = 'outbound'"
            " AND ticket_id = ? ORDER BY id DESC LIMIT 1", (ticket_id,),
        ).fetchone()
        result = json.dumps(
            json.loads(str(queued[0])).get("card") or {}, ensure_ascii=False,
        )
        assert "审批已过期" in result and "审批超时" in result
    finally:
        conn.close()


def test_approve_command_after_expiry_is_denied(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_expired_cmd",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    fake = FakeFeishu()
    fake.install(monkeypatch)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        _expire_pending_approval(conn, ticket_id)

        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_message_body(message_id="om_expired_approve", text="/approve"),
        )
        assert response.status_code == 200, response.text
        assert response.json()["decision"] == "denied"
        assert not (ws / "out.txt").exists()
        assert conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = ?", (ticket_id,),
        ).fetchone()[0] == "ended"
        channels.deliver_queued(conn)
        assert any("审批已过期" in text for text in fake.sent)
    finally:
        conn.close()


def _delivered_approval_message(conn: sqlite3.Connection, ticket_id: str) -> str:
    row = conn.execute(
        "SELECT external_id FROM channel_messages"
        " WHERE direction = 'outbound' AND ticket_id = ?"
        " AND json_extract(payload_json, '$.kind') = 'approval'"
        " ORDER BY id DESC LIMIT 1",
        (ticket_id,),
    ).fetchone()
    assert row is not None
    return str(row[0])


def test_ticket_result_edits_the_clicked_card(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_one_card",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    fake = FakeFeishu()
    fake.install(monkeypatch)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        channels.deliver_queued(conn)
        card_message_id = _delivered_approval_message(conn, ticket_id)
        assert card_message_id
        sent_before = len(fake.sent)
        attention_id = conn.execute(
            "SELECT attention_id FROM attentions WHERE ticket_id = ?"
            " AND status = 'pending'", (ticket_id,),
        ).fetchone()[0]

        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id),
        )
        assert response.status_code == 200, response.text
        channels.deliver_queued(conn)

        assert len(fake.sent) == sent_before  # no second bubble for one task
        assert fake.patched, "expected the approval card to be edited"
        edit = fake.patched[-1]
        assert edit["url"].endswith(f"/open-apis/im/v1/messages/{card_message_id}")
        content = json.loads(str(edit["json"]["content"]))
        dump = json.dumps(content, ensure_ascii=False)
        assert "任务完成" in dump
        assert "已批准，正在执行" not in dump
    finally:
        conn.close()


def test_ticket_result_falls_back_when_card_edit_fails(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_card_edit_fail",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    fake = FakeFeishu()
    fake.install(monkeypatch)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        channels.deliver_queued(conn)
        assert _delivered_approval_message(conn, ticket_id)
        sent_before = len(fake.sent)
        attention_id = conn.execute(
            "SELECT attention_id FROM attentions WHERE ticket_id = ?"
            " AND status = 'pending'", (ticket_id,),
        ).fetchone()[0]

        fake.patch_ok = False
        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id),
        )
        assert response.status_code == 200, response.text
        channels.deliver_queued(conn)

        assert fake.patched
        assert len(fake.sent) == sent_before + 1  # fallback sends a new card
        assert "任务完成" in fake.sent[-1]
    finally:
        conn.close()


def test_card_action_rejects_non_approver(
    env: tuple[Path, TestClient], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, client = env
    created = _create(client)
    ticket_id = _open_ticket(
        client, created["channelId"], "/polyopus 保存结果到 out.txt", "om_card_deny",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setattr(channels, "_workspace", lambda: ws)
    conn = m.connect(db)
    store = EventStore(conn)
    try:
        assert tickets.run_assignment(
            conn, store, ticket_id, content="/polyopus 保存结果到 out.txt",
            engine_config=engine.EngineConfig(workspace=ws),
        ) == "waiting"
        attention_id = conn.execute(
            "SELECT attention_id FROM attentions WHERE ticket_id = ?"
            " AND status = 'pending'", (ticket_id,),
        ).fetchone()[0]

        response = client.post(
            f"/api/v1/channels/feishu/{created['channelId']}/events",
            json=_card_body(attention_id, operator="ou_mallory"),
        )
        assert response.status_code == 200, response.text
        assert response.json()["toast"]["type"] == "error"
        status = conn.execute(
            "SELECT status FROM attentions WHERE attention_id = ?", (attention_id,),
        ).fetchone()[0]
        assert status == "pending"
        assert not (ws / "out.txt").exists()
    finally:
        conn.close()
