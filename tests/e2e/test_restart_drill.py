"""Server-restart drill (v0.1 card 4, retires L-2).

The scenario docs/45 asks for: a turn paused at waiting_approval must
survive a full server restart, and the approval answered on the NEW
instance must still execute and finish the turn. State lives in the DB,
so this is exactly what the drill proves.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


def _settings(db: Path, ws: Path) -> Settings:
    return Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, workspace_dir=ws,
    )


def _wait_status(db: Path, turn_id: str, status: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        conn = sqlite3.connect(str(db), timeout=5)
        try:
            row = conn.execute(
                "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
            ).fetchone()
        finally:
            conn.close()
        if row and row[0] == status:
            return
        time.sleep(0.1)
    raise AssertionError(f"turn did not reach {status}")


def test_approval_survives_server_restart(tmp_path: Path) -> None:
    db = tmp_path / "rs.db"
    ws = tmp_path / "ws"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()

    # --- instance 1: start a turn that pauses at the policy gate ---
    with TestClient(create_app(_settings(db, ws))) as c1:
        c1.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        thread_id = c1.post("/api/v1/threads", json={"title": "重启演练"}).json()["threadId"]
        turn_id = c1.post(
            f"/api/v1/threads/{thread_id}/turns",
            json={"content": "请把内容写入 drill.txt"},
        ).json()["turnId"]
        # the pause must happen WHILE instance 1 is alive (worker polls at
        # 0.2s); only then does shutting it down count as "restart while paused"
        _wait_status(db, turn_id, "waiting_approval")
    # context exit = server shutdown (lifespan stops the embedded worker)
    assert not (ws / "drill.txt").exists()

    # --- instance 2: a fresh process answers the approval ---
    with TestClient(create_app(_settings(db, ws))) as c2:
        c2.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        inbox = c2.get("/api/v1/attentions").json()["items"]
        approvals = [i for i in inbox if i["kind"] == "approval" and i["status"] == "pending"]
        assert len(approvals) == 1

        answered = c2.post(
            f"/api/v1/attentions/{approvals[0]['attentionId']}/answer",
            json={"decision": "approve"},
        )
        assert answered.status_code == 200, answered.text

    _wait_status(db, turn_id, "completed")
    content = (ws / "drill.txt").read_text(encoding="utf-8")
    assert "drill.txt" in str(ws / "drill.txt")
    assert "写入" in content or "内容" in content

    conn = sqlite3.connect(str(db))
    types = [r[0] for r in conn.execute(
        "SELECT type FROM events WHERE thread_id = ? ORDER BY seq", (thread_id,)
    ).fetchall()]
    conn.close()
    assert "approval.resolved" in types
    assert "turn.resumed" in types
    assert types[-1] == "turn.finished"


def test_workspace_isolation_no_leak_into_repo(tmp_path: Path) -> None:
    """The drill's guard: instance-scoped workspaces must not fall back to
    the repo's data/workspace (the bug the drill surfaced)."""
    db = tmp_path / "iso.db"
    ws = tmp_path / "iso-ws"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    repo_ws = Path("data/workspace")
    before = set(repo_ws.glob("iso-*.txt")) if repo_ws.exists() else set()

    with TestClient(create_app(_settings(db, ws))) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        thread_id = client.post("/api/v1/threads", json={}).json()["threadId"]
        turn_id = client.post(
            f"/api/v1/threads/{thread_id}/turns",
            json={"content": "请把内容写入 iso-check.txt"},
        ).json()["turnId"]
        _wait_status(db, turn_id, "waiting_approval")
    with TestClient(create_app(_settings(db, ws))) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        item = client.get("/api/v1/attentions").json()["items"][0]
        client.post(f"/api/v1/attentions/{item['attentionId']}/answer",
                    json={"decision": "approve"})
    _wait_status(db, turn_id, "completed")

    assert (ws / "iso-check.txt").exists()
    after = set(repo_ws.glob("iso-*.txt")) if repo_ws.exists() else set()
    assert after == before  # nothing leaked into the repo workspace
