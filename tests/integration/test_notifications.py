"""V1-10: unread aggregation, dedupe, read idempotency and ownership."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.notifications import service as notifications
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient, str]]:
    db = tmp_path / "notifications.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    now = int(time.time())
    conn.execute(
        "INSERT INTO users (tenant_id, user_id, username, password_hash, status,"
        " is_owner, created_at, updated_at) VALUES ('default', 'us_other',"
        " 'other', 'x', 'active', 0, ?, ?)", (now, now),
    )
    conn.commit()
    owner = str(conn.execute(
        "SELECT user_id FROM users WHERE is_owner = 1"
    ).fetchone()[0])
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield db, client, owner


def test_dedupe_unread_and_read_idempotent(
    env: tuple[Path, TestClient, str]
) -> None:
    db, client, owner = env
    conn = m.connect(db)
    try:
        first = notifications.notify(
            conn, tenant_id="default", user_id=owner, kind="task",
            title="任务完成", body="ticket one", dedupe_key="ticket:tk_1:ready",
        )
        second = notifications.notify(
            conn, tenant_id="default", user_id=owner, kind="task",
            title="任务完成", body="duplicate", dedupe_key="ticket:tk_1:ready",
        )
        other = notifications.notify(
            conn, tenant_id="default", user_id=owner, kind="task",
            title="任务阻塞", body="ticket two", dedupe_key="ticket:tk_2:blocked",
        )
    finally:
        conn.close()
    assert first is not None and first == second
    assert other is not None and other != first

    listed = client.get("/api/v1/notifications")
    assert listed.status_code == 200, listed.text
    assert listed.json()["unreadCount"] == 2
    ids = {row["notificationId"] for row in listed.json()["items"]}
    assert ids == {first, other}

    read = client.post(f"/api/v1/notifications/{first}/read")
    assert read.status_code == 200, read.text
    assert read.json()["readAt"] is not None
    again = client.post(f"/api/v1/notifications/{first}/read")
    assert again.status_code == 200
    assert again.json()["readAt"] == read.json()["readAt"]
    assert client.get("/api/v1/notifications").json()["unreadCount"] == 1

    all_read = client.post("/api/v1/notifications/read-all")
    assert all_read.status_code == 200
    assert client.get("/api/v1/notifications").json()["unreadCount"] == 0


def test_notifications_are_user_scoped(env: tuple[Path, TestClient, str]) -> None:
    db, client, owner = env
    conn = m.connect(db)
    try:
        hidden = notifications.notify(
            conn, tenant_id="default", user_id="us_other", kind="system",
            title="别的用户", dedupe_key="other:1",
        )
    finally:
        conn.close()
    assert hidden is not None
    listed = client.get("/api/v1/notifications")
    assert listed.status_code == 200
    assert all(row["notificationId"] != hidden for row in listed.json()["items"])
    assert listed.json()["unreadCount"] == 0
    missing = client.post(f"/api/v1/notifications/{hidden}/read")
    assert missing.status_code == 404


def test_approval_request_notifies_thread_owner(
    env: tuple[Path, TestClient, str]
) -> None:
    db, _client, owner = env
    now = int(time.time())
    conn = m.connect(db)
    try:
        conn.execute(
            "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
            " created_at, updated_at) VALUES ('default', 'th_notify', ?, 'n',"
            " 'active', ?, ?)", (owner, now, now),
        )
        conn.commit()
        from polyopus.domains.attention import service as attention
        from polyopus.platform.events.store import EventStore

        attention.request(
            conn, EventStore(conn), tenant_id="default",
            thread_id="th_notify", turn_id="tu_notify", run_id="run_notify",
            step_idx=0,
            req=attention.ApprovalRequest(
                tool="fs.write", args_preview="{}", risk="high",
                summary="写文件", args_json="{}",
            ),
        )
        rows = conn.execute(
            "SELECT kind, title, link FROM notifications WHERE user_id = ?",
            (owner,),
        ).fetchall()
    finally:
        conn.close()
    assert len(rows) == 1
    assert rows[0][0] == "task" and "需要审批" in rows[0][1]
    assert rows[0][2] == "/chat"
