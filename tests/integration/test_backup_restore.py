"""V1-07: SQLite consistency snapshot, checksum/schema checks, restore."""

from __future__ import annotations

import hashlib
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.backup import service as backup
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.errors import AppError

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


def _seed(db: Path, workspace: Path) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "hello.txt").write_text("workspace-data", encoding="utf-8")
    conn = m.connect(db)
    try:
        m.apply(conn, m.discover(MIGRATIONS))
        ensure_admin(conn, password=PASSWORD)
        now = int(time.time())
        conn.execute(
            "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
            " created_at, updated_at) VALUES ('default', 'th_bk', 'system',"
            " 'backup', 'active', ?, ?)", (now, now),
        )
        for seq in (1, 2):
            conn.execute(
                "INSERT INTO events (tenant_id, thread_id, seq, type,"
                " payload_json, ts) VALUES ('default', 'th_bk', ?,"
                " 'turn.queued', '{}', ?)", (seq, now),
            )
        conn.execute(
            "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
            " strength, policy_version, scope_json, created_at, updated_at)"
            " VALUES ('default', 'tk_bk', 'backup ticket', 'open', 'queued',"
            " 'explicit', 1, '[]', ?, ?)", (now, now),
        )
        conn.execute(
            "INSERT INTO reports (report_id, tenant_id, ticket_id,"
            " assignment_id, state, summary, progress, facts_json, created_at)"
            " VALUES ('rp_bk', 'default', 'tk_bk', 'as_bk', 'ready',"
            " 'all good', 1.0, '{}', ?)", (now,),
        )
        conn.commit()
    finally:
        conn.close()


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, Path, Path]]:
    db = tmp_path / "backup.db"
    workspace = tmp_path / "workspace"
    data_dir = tmp_path / "data"
    _seed(db, workspace)
    yield db, data_dir, workspace


def test_backup_delete_restore_keeps_events_and_reports(
    env: tuple[Path, Path, Path]
) -> None:
    db, data_dir, workspace = env
    conn = m.connect(db)
    try:
        made = backup.create_backup(
            conn, db_path=db, data_dir=data_dir, workspace_dir=workspace,
        )
    finally:
        conn.close()
    assert made["status"] == "ready"
    assert made["manifest"]["schemaVersion"] == max(
        migration.version for migration in m.discover(MIGRATIONS)
    )
    root = Path(str(made["storageRef"]))
    assert (root / "db.sqlite").is_file()
    assert (root / "workspace.tar.gz").is_file()

    for suffix in ("", "-wal", "-shm"):
        path = Path(str(db) + suffix)
        if path.exists():
            path.unlink()
    workspace_file = workspace / "hello.txt"
    workspace_file.unlink()
    workspace.rmdir()

    restored_conn = m.connect(db)
    try:
        restored = backup.restore_backup(
            restored_conn, str(made["backupId"]), workspace_dir=workspace,
            data_dir=data_dir,
        )
        assert restored["status"] == "restored"
        seqs = [
            int(row[0]) for row in restored_conn.execute(
                "SELECT seq FROM events WHERE thread_id = 'th_bk' ORDER BY seq"
            ).fetchall()
        ]
        ticket = restored_conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = 'tk_bk'"
        ).fetchone()
        report = restored_conn.execute(
            "SELECT state, summary FROM reports WHERE report_id = 'rp_bk'"
        ).fetchone()
        version = restored_conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        restored_conn.close()
    assert seqs == [1, 2]
    assert ticket is not None and ticket[0] == "open"
    assert report is not None and report[0] == "ready" and report[1] == "all good"
    assert version == max(migration.version for migration in m.discover(MIGRATIONS))
    assert workspace_file.read_text(encoding="utf-8") == "workspace-data"


def test_restore_rejects_checksum_and_schema_mismatch(
    env: tuple[Path, Path, Path]
) -> None:
    db, data_dir, workspace = env
    conn = m.connect(db)
    try:
        made = backup.create_backup(
            conn, db_path=db, data_dir=data_dir, workspace_dir=workspace,
        )
        snapshot = Path(str(made["storageRef"])) / "db.sqlite"
        original = snapshot.read_bytes()
        snapshot.write_bytes(original + b"corrupt")
        with pytest.raises(AppError) as bad_checksum:
            backup.restore_backup(conn, str(made["backupId"]))
        assert bad_checksum.value.details["reason"] == "checksum_mismatch"

        snapshot.write_bytes(original)
        source = sqlite3.connect(str(snapshot))
        try:
            source.execute("PRAGMA user_version = 1")
            source.commit()
        finally:
            source.close()
        digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        conn.execute(
            "UPDATE backups SET checksum = ? WHERE backup_id = ?",
            (digest, made["backupId"]),
        )
        conn.commit()
        with pytest.raises(AppError) as bad_schema:
            backup.restore_backup(conn, str(made["backupId"]))
        assert bad_schema.value.details["reason"] == "schema_version_mismatch"
    finally:
        conn.close()


def test_backup_api_lists_and_deletes(env: tuple[Path, Path, Path]) -> None:
    db, data_dir, workspace = env
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
        data_dir=data_dir, workspace_dir=workspace,
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        created = client.post("/api/v1/admin/backup", json={})
        assert created.status_code == 201, created.text
        backup_id = str(created.json()["backupId"])
        assert created.json()["status"] == "ready"

        listed = client.get("/api/v1/admin/backup")
        assert listed.status_code == 200
        assert any(
            row["backupId"] == backup_id for row in listed.json()["items"]
        )
        status = client.get("/api/v1/admin/backup/status")
        assert status.status_code == 200
        assert status.json()["busy"] is False

        auto = client.put("/api/v1/admin/backup/auto", json={
            "autoEnabled": True, "intervalHours": 12, "retentionCount": 3,
        })
        assert auto.status_code == 200, auto.text
        assert auto.json()["intervalHours"] == 12

        storage = Path(str(created.json()["storageRef"]))
        deleted = client.delete(f"/api/v1/admin/backup/{backup_id}")
        assert deleted.status_code == 200
        assert not any(
            row["backupId"] == backup_id
            for row in client.get("/api/v1/admin/backup").json()["items"]
        )
        assert not storage.exists()
