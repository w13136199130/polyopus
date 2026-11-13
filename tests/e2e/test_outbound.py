"""V05-08 出站回复 e2e: signed delivery, idempotency, retry -> dead letter.

covers: docs/48 §5 G3 回复闭环 — callback 收到 1 条；重试幂等；500 进死信。
The TestClient lifespan starts the embedded turn+ticket+outbox workers
(FakeModel), so this is the full webhook -> ticket -> report -> callback
loop against a real local HTTP receiver.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


# ---- local callback receiver -------------------------------------------------


class _Recorder:
    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.requests: list[dict] = []
        self._lock = threading.Lock()

    def record(self, headers, body: bytes) -> None:
        with self._lock:
            self.requests.append({"headers": dict(headers), "body": body})

    @property
    def count(self) -> int:
        with self._lock:
            return len(self.requests)

    def wait_for(self, n: int, timeout: float = 20.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.count >= n:
                return
            time.sleep(0.1)
        raise AssertionError(f"receiver got {self.count}/{n} callback(s)")


class _CallbackHandler(BaseHTTPRequestHandler):
    recorder: _Recorder  # bound per server

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", 0))
        self.recorder.record(self.headers, self.rfile.read(length))
        self.send_response(self.recorder.status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args: object) -> None:  # keep pytest output clean
        return


@pytest.fixture()
def callback() -> Iterator[tuple[_Recorder, int]]:
    recorder = _Recorder()
    _CallbackHandler.recorder = recorder
    server = ThreadingHTTPServer(("127.0.0.1", 0), _CallbackHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield recorder, int(server.server_address[1])
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "outbound.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _make_source(client: TestClient, callback_url: str,
                 **extra: object) -> tuple[dict, str]:
    body: dict[str, object] = {
        "name": "cb",
        "allow_actors": ["alice"],
        "explicit_patterns": ["/polyopus"],
        "callbackUrl": callback_url,
    }
    body.update(extra)
    response = client.post("/api/v1/sources", json=body)
    assert response.status_code == 201, response.text
    source = response.json()
    return source, str(source["secret"])


def _fire_webhook(client: TestClient, source: dict, secret: str, *,
                  external: str, text: str) -> dict:
    payload = {
        # webhook bodies are the public snake_case contract (normalize());
        # a deterministic external_id keeps dedupe minute-independent
        "external_id": external,
        "thread_key": "outbound",
        "actor": {"id": "alice"},
        "text": "/polyopus " + text,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    sig = hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()
    response = client.post(f"/api/v1/webhooks/{source['sourceId']}",
                           json=payload, headers={"X-Signature": sig})
    assert response.status_code == 202, response.text
    return response.json()


def _wait_outbox_row(db: Path, *, status: str, timeout: float = 30.0) -> sqlite3.Row:
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = sqlite3.connect(str(db)).execute(
            "SELECT event_id, status, attempts FROM outbox WHERE topic='reply'"
        ).fetchone()
        if row is not None and row[1] == status:
            return row
        time.sleep(0.2)
    raise AssertionError(f"outbox row never reached status={status}")


# ---- G3: delivery, signature, idempotency -------------------------------------


def test_reply_delivered_once_with_valid_signature(
    callback: tuple[_Recorder, int], env: tuple[Path, TestClient]
) -> None:
    recorder, port = callback
    db, client = env
    source, secret = _make_source(client, f"http://127.0.0.1:{port}/hook")

    accepted = _fire_webhook(client, source, secret,
                             external="happy-1", text="回复闭环 happy path")
    ticket_id = str(accepted["ticketId"])
    assert ticket_id

    recorder.wait_for(1)
    time.sleep(1.0)  # settle window: a duplicate delivery would land here
    assert recorder.count == 1  # 重试不重复

    hit = recorder.requests[0]
    body: bytes = hit["body"]
    expected_sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert hit["headers"].get("X-Signature") == expected_sig
    assert str(hit["headers"].get("X-Timestamp", "")).isdigit()
    assert hit["headers"].get("Idempotency-Key", "").startswith(f"reply:{ticket_id}:")

    payload = json.loads(body)
    assert payload["kind"] == "reply"
    assert payload["ticketId"] == ticket_id
    assert payload["state"] == "ready"
    assert payload["link"].endswith(f"/tasks?ticketId={ticket_id}")
    assert payload["idemKey"].startswith(f"reply:{ticket_id}:")
    # 回复内容不含密钥/绝对路径 (V05-08 验收)
    assert secret.encode() not in body
    assert b"E:\\" not in body and b"/tmp/" not in body and b"/etc/" not in body

    # replayed webhook dedupes upstream: still exactly one delivery
    again = _fire_webhook(client, source, secret,
                          external="happy-1", text="回复闭环 happy path")
    assert again["duplicate"] is True
    time.sleep(1.5)
    assert recorder.count == 1


def test_callback_500_retries_three_times_then_dead_letter(
    callback: tuple[_Recorder, int], env: tuple[Path, TestClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder, port = callback
    db, client = env
    recorder.status = 500
    from polyopus.workers import outbox_loop

    monkeypatch.setattr(outbox_loop, "RETRY_DELAYS", (0.05, 0.05, 0.05))

    source, secret = _make_source(client, f"http://127.0.0.1:{port}/hook")
    accepted = _fire_webhook(client, source, secret,
                             external="dead-1", text="死信路径测试")
    ticket_id = str(accepted["ticketId"])

    row = _wait_outbox_row(db, status="failed")
    assert row[2] >= 3  # attempts: three deliveries before the dead letter
    recorder.wait_for(3, timeout=10)
    time.sleep(0.5)
    assert recorder.count == 3  # bounded retries, then stop

    # outbox 状态可查 (V05-08 验收)
    response = client.get("/api/v1/outbox", params={"status": "failed"})
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert any(
        i["ticketId"] == ticket_id and i["status"] == "failed"
        and str(i["eventId"]).startswith(f"reply:{ticket_id}:")
        for i in items
    )

    # dead letter journaled for audit (V05-19 seam): EventStore truth is the
    # `events` table; timeline_events is a projection
    failed_events = sqlite3.connect(str(db)).execute(
        "SELECT count(*) FROM events WHERE type='channel.failed'"
    ).fetchone()[0]
    assert failed_events >= 1


def test_blocked_budget_report_replies_blocked_state(
    callback: tuple[_Recorder, int], env: tuple[Path, TestClient]
) -> None:
    recorder, port = callback
    db, client = env
    source, secret = _make_source(client, f"http://127.0.0.1:{port}/hook",
                                  maxTotalTokens=1)

    _fire_webhook(client, source, secret,
                  external="blocked-1", text="超预算回复测试")

    recorder.wait_for(1)
    payload = json.loads(recorder.requests[0]["body"])
    assert payload["kind"] == "reply"
    assert payload["state"] == "blocked"
    assert "预算" in payload["summary"]


def test_waiting_report_never_enqueues(
    callback: tuple[_Recorder, int], env: tuple[Path, TestClient]
) -> None:
    recorder, port = callback
    db, client = env
    from polyopus.domains.outbound import service as outbound

    source, secret = _make_source(client, f"http://127.0.0.1:{port}/hook")
    accepted = _fire_webhook(client, source, secret,
                             external="wait-1", text="等待不回复测试")

    conn = m.connect(db)
    try:
        # `waiting` still owes a human: no outbound row, ever
        assert outbound.on_report(conn, str(accepted["ticketId"]),
                                  "rp_manual", "waiting", "still on a human") is None
    finally:
        conn.close()


# ---- test-reply endpoint -------------------------------------------------------


def test_test_reply_probes_with_signed_test_payload(
    callback: tuple[_Recorder, int], env: tuple[Path, TestClient]
) -> None:
    recorder, port = callback
    db, client = env
    source, secret = _make_source(client, f"http://127.0.0.1:{port}/hook")

    response = client.post(f"/api/v1/sources/{source['sourceId']}/test-reply")
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["delivered"] is True and out["statusCode"] == 200

    recorder.wait_for(1)
    hit = recorder.requests[0]
    expected_sig = hmac.new(secret.encode(), hit["body"], hashlib.sha256).hexdigest()
    assert hit["headers"].get("X-Signature") == expected_sig
    assert json.loads(hit["body"])["kind"] == "test"
    # the probe is synchronous: it never enters the outbox
    assert client.get("/api/v1/outbox").json()["items"] == []


def test_callback_url_validated_on_create_and_test_reply(
    env: tuple[Path, TestClient],
) -> None:
    db, client = env

    rejected = client.post("/api/v1/sources", json={
        "name": "ssrf", "callbackUrl": "http://10.0.0.5/hook",
    })
    assert rejected.status_code == 400  # VALIDATION_FAILED (docs/09 §11 SSRF)

    plain = client.post("/api/v1/sources", json={"name": "nocallback"})
    assert plain.status_code == 201, plain.text
    missing = client.post(f"/api/v1/sources/{plain.json()['sourceId']}/test-reply")
    assert missing.status_code == 400

    bad_scheme = client.post(f"/api/v1/sources/{plain.json()['sourceId']}/test-reply",
                             json={"callbackUrl": "ftp://example.com/x"})
    assert bad_scheme.status_code == 400
