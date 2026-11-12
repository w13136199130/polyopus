"""Ticket auto-execution (V05-07): webhook in, Report out, no manual calls.

Covers the three acceptance lines:
1. embedded worker drives queued -> running -> done with a ready Report
2. two workers racing 10 tickets: every ticket executed exactly once
3. a real process restart never loses a queued ticket
"""

# covers: T-INTAKE-05 T-TASK-02

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.telemetry import log as tlog
from polyopus.workers import ticket_loop

tlog.configure()  # JSON logs so worker fields (ticket.parked error=) are visible

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PY = sys.executable


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient]]:
    db = tmp_path / "auto.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, workspace_dir=tmp_path / "ws",
    )
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield db, client


def _open_ticket(client: TestClient, text: str) -> str:
    created = client.post("/api/v1/sources", json={
        "name": f"auto-{time.time_ns()}", "generate_secret": False,
        "allow_actors": ["alice"], "explicit_patterns": ["/polyopus"],
    }).json()
    accepted = client.post(
        f"/api/v1/webhooks/{created['sourceId']}",
        json={"external_id": f"auto-{time.time_ns()}", "thread_key": "auto",
              "actor": {"id": "alice"}, "text": text},
    ).json()
    return str(accepted["ticketId"])


def _ticket_bucket(client: TestClient, ticket_id: str) -> str:
    for row in client.get("/api/v1/tickets").json()["items"]:
        if row["ticketId"] == ticket_id:
            return str(row["bucket"])
    return ""


def test_webhook_drives_ticket_to_done(env: tuple[Path, TestClient]) -> None:
    """Pure black-box: post a webhook, watch queued -> ... -> done."""
    _, client = env
    ticket_id = _open_ticket(client, "/polyopus 汇总今天的构建状态")
    assert _ticket_bucket(client, ticket_id) in ("queued", "running")

    deadline = time.time() + 30
    bucket = ""
    while time.time() < deadline:
        bucket = _ticket_bucket(client, ticket_id)
        if bucket == "done":
            break
        time.sleep(0.2)

    assert bucket == "done", f"ticket never finished (bucket={bucket})"
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["state"] == "ended"
    assert detail["report"]["state"] == "ready"
    assert detail["report"]["facts"]["total_tokens"] > 0


def test_two_workers_ten_tickets_exactly_once(tmp_path: Path) -> None:
    """Direct-db race: two threads run the loop over 10 queued tickets;
    UNIQUE(ticket, attempt) must keep every ticket at one assignment."""
    db = tmp_path / "race.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    # seeding only: the two racing loops below are the workers under test
    settings = Settings(db_path=db, secret_key="s", workspace_dir=tmp_path / "ws",
                        embedded_worker=False)
    conn.close()

    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        ids = [_open_ticket(client, f"/polyopus 竞争测试 {i}") for i in range(10)]

    stop = threading.Event()

    def worker() -> None:
        run = ticket_loop.run_ticket_loop(lambda: db, stop=stop)
        assert run >= 0

    threads = [threading.Thread(target=worker, name=f"ticket-worker-{i}")
               for i in range(2)]
    for thread in threads:
        thread.start()

    deadline = time.time() + 60
    try:
        while time.time() < deadline:
            check = sqlite3.connect(str(db))
            try:
                done = check.execute(
                    "SELECT count(*) FROM tickets WHERE bucket = 'done'"
                ).fetchone()[0]
            finally:
                check.close()
            if done >= 10:
                break
            time.sleep(0.3)
    finally:
        stop.set()
        for thread in threads:
            thread.join(10)

    check = sqlite3.connect(str(db))
    check.row_factory = sqlite3.Row
    try:
        assert check.execute(
            "SELECT count(*) FROM tickets WHERE bucket = 'done'"
        ).fetchone()[0] == 10
        per_ticket = check.execute(
            "SELECT ticket_id, count(*) AS n FROM assignments "
            "WHERE state = 'ended' GROUP BY ticket_id"
        ).fetchall()
        assert {row["ticket_id"] for row in per_ticket} == set(ids)
        for row in per_ticket:
            assert row["n"] == 1, f"{row['ticket_id']} ran {row['n']} times"
    finally:
        check.close()


def _free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class _Api:
    """Minimal cookie-auth HTTP client against a spawned server."""

    def __init__(self, port: int) -> None:
        import http.cookiejar

        self.base = f"http://127.0.0.1:{port}"
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(self.jar),
        )

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.base + path, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        with self.opener.open(request, timeout=30) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else {}

    def login(self, password: str) -> None:
        self._call("POST", "/api/v1/auth/login",
                   {"username": "admin", "password": password})

    def open_ticket(self, text: str) -> str:
        source = self._call("POST", "/api/v1/sources", {
            "name": f"restart-{time.time_ns()}", "generate_secret": False,
            "allowActors": ["alice"], "explicitPatterns": ["/polyopus"],
        })
        accepted = self._call("POST", f"/api/v1/webhooks/{source['sourceId']}", {
            "externalId": f"restart-{time.time_ns()}", "threadKey": "auto",
            "actor": {"id": "alice"}, "text": text,
        })
        return str(accepted["ticketId"])


def _spawn_serve(db: Path, tmp: Path, port: int, workers: bool) -> subprocess.Popen:
    import os

    env = {
        **{k: v for k, v in os.environ.items() if not k.startswith("POLY_")},
        "POLY_DB_PATH": str(db),
        "POLY_WORKSPACE_DIR": str(tmp / "ws"),
        "POLY_ADMIN_PASSWORD": "restart-pass",
        "POLY_EMBEDDED_WORKER": "true" if workers else "false",
        "PYTHONPATH": str(ROOT / "src"),
    }
    return subprocess.Popen(
        [PY, "-m", "polyopus", "serve", "--port", str(port), "--host", "127.0.0.1"],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def _wait_healthy(port: int, timeout: float = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/healthz", timeout=2
            ) as response:
                if response.status == 200:
                    return
        except Exception:  # noqa: BLE001 - not up yet
            time.sleep(0.3)
    raise AssertionError("server did not become healthy")


def test_queued_ticket_survives_process_restart(tmp_path: Path) -> None:
    """No-worker phase 1 queues the ticket; kill -9; phase 2 with the
    embedded worker finishes it (docs/48: queued 重领, ticket 不丢)."""
    db = tmp_path / "restart.db"

    # phase 1: queue only (no workers), then hard-kill
    port1 = _free_port()
    proc = _spawn_serve(db, tmp_path, port1, workers=False)
    try:
        _wait_healthy(port1)
        api = _Api(port1)
        api.login("restart-pass")
        ticket_id = api.open_ticket("/polyopus 重启恢复测试")
        time.sleep(0.5)
    finally:
        proc.kill()
        proc.wait(10)

    assert sqlite3.connect(str(db)).execute(
        "SELECT bucket FROM tickets WHERE ticket_id = ?", (ticket_id,)
    ).fetchone()[0] == "queued"

    # phase 2: restart WITH workers -> the ticket must complete
    port2 = _free_port()
    proc2 = _spawn_serve(db, tmp_path, port2, workers=True)
    try:
        _wait_healthy(port2)
        deadline = time.time() + 60
        bucket = "queued"
        while time.time() < deadline:
            check = sqlite3.connect(str(db))
            try:
                row = check.execute(
                    "SELECT bucket FROM tickets WHERE ticket_id = ?", (ticket_id,)
                ).fetchone()
            finally:
                check.close()
            bucket = str(row[0]) if row else ""
            if bucket == "done":
                break
            time.sleep(0.3)
        assert bucket == "done", f"ticket lost across restart (bucket={bucket})"
    finally:
        proc2.kill()
        proc2.wait(10)
