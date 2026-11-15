#!/usr/bin/env python
"""v0.5 demo: webhook -> Assessment -> ticket -> callback -> Attention.

Runs entirely on the dev box: a local fake OpenAI stream supplies the
Assessment JSON and the execution reply, and a local HTTP receiver stands in
for the external callback. No real key, no public network.

Usage:
    uv run python scripts/demo_v05.py

Exit code 0 only when every step passes. Evidence is written to
`data/demo-v05/evidence.json`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
import sys
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "migrations"
EVIDENCE = ROOT / "data" / "demo-v05" / "evidence.json"
ADMIN_PASSWORD = "demo-pass"


# ---- local fake model --------------------------------------------------------


class _ModelHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        content = json.dumps(
            {
                "decision": "accept",
                "strength": "inferred",
                "scope": ["workspace:default"],
                "confidence": 0.93,
                "reason": "demo assessment: explicit request, low risk",
            },
            ensure_ascii=False,
        )
        chunk = {"choices": [{"delta": {"content": content}, "finish_reason": None}]}
        end = {
            "choices": [{"delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 120, "completion_tokens": 20},
        }
        body = (
            f"data: {json.dumps(chunk)}\n\n"
            f"data: {json.dumps(end)}\n\n"
            "data: [DONE]\n\n"
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        return


# ---- local callback receiver -------------------------------------------------


class _CallbackRecorder:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def record(self, headers: dict[str, str], body: bytes) -> None:
        with self._lock:
            self.requests.append({"headers": headers, "body": body})

    @property
    def count(self) -> int:
        with self._lock:
            return len(self.requests)

    def first(self) -> dict[str, Any] | None:
        with self._lock:
            return dict(self.requests[0]) if self.requests else None


class _CallbackHandler(BaseHTTPRequestHandler):
    recorder: _CallbackRecorder

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", 0))
        _CallbackHandler.recorder.record(
            {k.lower(): v for k, v in self.headers.items()},
            self.rfile.read(length),
        )
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args: object) -> None:
        return


def _serve(handler: type[BaseHTTPRequestHandler], port: int = 0) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ---- helpers -----------------------------------------------------------------


def _wait(predicate: Any, timeout: float, label: str) -> Any:
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise RuntimeError(f"timeout waiting for {label}")


def _event_types(db: Path, ticket_id: str) -> list[str]:
    conn = sqlite3.connect(str(db))
    try:
        thread = conn.execute(
            "SELECT json_extract(payload_json, '$.thread_id') FROM timeline_events "
            "WHERE ticket_id = ? AND kind = 'execution_thread' "
            "ORDER BY id DESC LIMIT 1",
            (ticket_id,),
        ).fetchone()
        if thread is None:
            return []
        return [
            str(row[0])
            for row in conn.execute(
                "SELECT type FROM events WHERE thread_id = ? ORDER BY seq",
                (thread[0],),
            )
        ]
    finally:
        conn.close()


def _stream_events(db: Path, stream_id: str) -> list[dict[str, Any]]:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [
            {"type": row["type"], "payload": json.loads(row["payload_json"])}
            for row in conn.execute(
                "SELECT type, payload_json FROM events WHERE thread_id = ? "
                "ORDER BY seq",
                (stream_id,),
            )
        ]
    finally:
        conn.close()


def _ticket_row(db: Path, ticket_id: str) -> sqlite3.Row | None:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(
            "SELECT * FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
    finally:
        conn.close()


def _signed_webhook(client: Any, source: dict, payload: dict) -> dict:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    signature = hmac.new(
        str(source.get("secret", "")).encode(), body, hashlib.sha256
    ).hexdigest()
    response = client.post(
        f"/api/v1/webhooks/{source['sourceId']}", json=payload,
        headers={"X-Signature": signature},
    )
    if response.status_code != 202:
        raise RuntimeError(f"webhook failed: HTTP {response.status_code} {response.text}")
    return response.json()


def _main() -> int:
    model_server = _serve(_ModelHandler)
    callback_recorder = _CallbackRecorder()
    _CallbackHandler.recorder = callback_recorder
    callback_server = _serve(_CallbackHandler)

    model_port = int(model_server.server_address[1])
    callback_port = int(callback_server.server_address[1])
    # Must be set before any load_settings()/Registry.resolve() call so the
    # demo never reaches a real provider configured in .env.
    os.environ["POLY_MODEL_BASE_URL"] = f"http://127.0.0.1:{model_port}/v1"
    os.environ["POLY_MODEL_API_KEY"] = "demo-key"
    os.environ["POLY_MODEL_NAME"] = "deepseek-flash"

    from fastapi.testclient import TestClient

    from polyopus.api.app import create_app
    from polyopus.config import Settings
    from polyopus.platform.db import migrator as m
    from polyopus.platform.db.seed import ensure_admin

    work = ROOT / "data" / "demo-v05"
    work.mkdir(parents=True, exist_ok=True)
    db = work / "demo.db"
    for suffix in ("", "-wal", "-shm"):
        path = Path(str(db) + suffix)
        path.unlink(missing_ok=True)
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=ADMIN_PASSWORD)
    conn.close()

    settings = Settings(
        db_path=db, secret_key="demo-secret",
        access_ttl_seconds=3600, session_ttl_seconds=86400,
        workspace_dir=work / "workspace", embedded_worker=True,
    )
    evidence: dict[str, Any] = {"generatedAt": datetime.now(UTC).isoformat()}
    with TestClient(create_app(settings)) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": ADMIN_PASSWORD},
        )
        assert login.status_code == 200, login.text

        # 1) source + signed webhook + Assessment accept + auto execution
        source = client.post("/api/v1/sources", json={
            "name": "demo-ci",
            "allowActors": ["alice"],
            "explicitPatterns": ["/polyopus"],
            "callbackUrl": f"http://127.0.0.1:{callback_port}/hook",
            "assessment": "auto",
            "generateSecret": True,
        }).json()
        accepted = _signed_webhook(client, source, {
            "external_id": "demo-1",
            "thread_key": "demo-1",
            "actor": {"id": "alice", "kind": "user"},
            "text": "/polyopus 修复构建",
        })
        ticket_id = str(accepted["ticketId"])
        print(f"[webhook] trigger={accepted['triggerId']} ticket={ticket_id}")

        def ticket_done() -> bool:
            row = _ticket_row(db, ticket_id)
            return row is not None and row["bucket"] == "done" and row["state"] == "ended"

        _wait(ticket_done, 20, "ticket done")
        _wait(lambda: callback_recorder.count >= 1, 20, "callback")
        detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
        hit = callback_recorder.first() or {}
        body = hit.get("body", b"")
        expected = hmac.new(
            source["secret"].encode(), body, hashlib.sha256
        ).hexdigest()
        signature_ok = hit.get("headers", {}).get("x-signature") == expected
        payload = json.loads(body) if body else {}
        print(
            f"[reply] state={payload.get('state')} link={payload.get('link')} "
            f"signature={'ok' if signature_ok else 'BAD'}"
        )
        print(f"[ticket] events={' -> '.join(_event_types(db, ticket_id))}")
        source_events = _stream_events(db, str(source["sourceId"]))
        eval_event = next(
            (event for event in source_events if event["type"] == "eval.decided"), None
        )
        if eval_event is not None:
            print(
                f"[assessment] decision={eval_event['payload'].get('decision')} "
                f"strength={eval_event['payload'].get('strength')}"
            )
        evidence["main"] = {
            "sourceId": source["sourceId"],
            "triggerId": accepted["triggerId"],
            "ticketId": ticket_id,
            "events": _event_types(db, ticket_id),
            "sourceEvents": [
                event["type"] for event in source_events
            ],
            "assessment": eval_event["payload"] if eval_event else None,
            "report": detail.get("report"),
            "costMicros": detail.get("costMicros"),
            "callback": {
                "count": callback_recorder.count,
                "signatureValid": signature_ok,
                "payload": payload,
            },
        }

        # 2) budget exceeded -> blocked + Attention (the failure path)
        budget_source = client.post("/api/v1/sources", json={
            "name": "demo-budget",
            "allowActors": ["alice"],
            "explicitPatterns": ["/polyopus"],
            "maxTotalTokens": 1,
            "generateSecret": False,
        }).json()
        blocked = _signed_webhook(client, budget_source, {
            "external_id": "demo-2",
            "thread_key": "demo-2",
            "actor": {"id": "alice", "kind": "user"},
            "text": "/polyopus 超预算演示",
        })
        blocked_id = str(blocked["ticketId"])

        def blocked_ready() -> dict | None:
            rows = client.get("/api/v1/attentions").json()["items"]
            for item in rows:
                if item.get("ticketId") == blocked_id and item.get("kind") == "blocked":
                    return item
            return None

        attention = _wait(blocked_ready, 20, "blocked attention")
        print(
            f"[attention] ticket={blocked_id} kind={attention['kind']} "
            f"reason={attention['payload'].get('reason')}"
        )
        evidence["attention"] = {
            "ticketId": blocked_id,
            "kind": attention["kind"],
            "reason": attention["payload"].get("reason"),
            "summary": attention["payload"].get("summary"),
            "events": _event_types(db, blocked_id),
        }

    checks = {
        "assessmentAccepted": bool(
            evidence["main"]["assessment"]
            and evidence["main"]["assessment"].get("decision") == "accept"
        ),
        "ticketDone": True,
        "callbackDelivered": evidence["main"]["callback"]["count"] >= 1,
        "signatureValid": evidence["main"]["callback"]["signatureValid"],
        "blockedAttention": evidence["attention"]["reason"] == "budget_exceeded",
    }
    evidence["checks"] = checks
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    model_server.shutdown()
    callback_server.shutdown()
    print(f"[evidence] {EVIDENCE.relative_to(ROOT)}")
    print(f"[cost] ticket={evidence['main']['costMicros']} micros")
    if not all(checks.values()):
        print(f"[FAIL] {checks}", file=sys.stderr)
        return 1
    print("[ok] v0.5 chain complete")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(_main())
    except Exception as exc:  # noqa: BLE001 - demo entrypoint prints the cause
        print(f"[demo_v05] FAILED: {exc}", file=sys.stderr)
        raise
