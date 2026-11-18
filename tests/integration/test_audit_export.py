"""V1-06: audit export/filters, retention, anonymization, data jobs, purge."""

from __future__ import annotations

import csv
import io
import json
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.audit import service as audit
from polyopus.domains.data_jobs import service as data_jobs
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, TestClient, Path]]:
    db = tmp_path / "audit.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
        data_dir=tmp_path / "data",
    )
    with TestClient(create_app(settings)) as client:
        login = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert login.status_code == 200, login.text
        yield db, client, tmp_path / "data"


def _admin_id(client: TestClient) -> str:
    return str(client.get("/api/v1/auth/me").json()["user"]["userId"])


def test_audit_filter_and_csv_jsonl_agree(
    env: tuple[Path, TestClient, Path]
) -> None:
    db, client, _data = env
    conn = m.connect(db)
    try:
        audit.record(conn, actor_id="u_a", action="chat.write", result="ok",
                     detail={"n": 1})
        audit.record(conn, actor_id="u_b", action="chat.write", result="ok",
                     detail={"n": 2})
        audit.record(conn, actor_id="u_a", action="tool.deny", result="denied",
                     detail={"n": 3})
        conn.commit()
    finally:
        conn.close()

    listed = client.get("/api/v1/admin/audit", params={"actorId": "u_a"})
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert len(items) == 2
    expected = {row["auditId"] for row in items}

    csv_response = client.get(
        "/api/v1/admin/audit/export", params={"actorId": "u_a", "format": "csv"}
    )
    assert csv_response.status_code == 200, csv_response.text
    rows = list(csv.DictReader(io.StringIO(csv_response.text)))
    assert {row["auditId"] for row in rows} == expected

    jsonl_response = client.get(
        "/api/v1/admin/audit/export", params={"actorId": "u_a", "format": "jsonl"}
    )
    assert jsonl_response.status_code == 200, jsonl_response.text
    lines = [json.loads(line) for line in jsonl_response.text.splitlines() if line]
    assert len(lines) == len(rows) == 2
    assert {row["auditId"] for row in lines} == expected


def test_retention_purges_only_expired_rows(
    env: tuple[Path, TestClient, Path]
) -> None:
    db, _client, _data = env
    now = int(time.time())
    conn = m.connect(db)
    try:
        audit.record(conn, actor_id="u_old", action="old.action", result="ok")
        audit.record(conn, actor_id="u_new", action="new.action", result="ok")
        conn.execute(
            "UPDATE audit_log SET created_at = ? WHERE action = 'old.action'",
            (now - 31 * 86400,),
        )
        audit.purge_expired(conn, retention_days=30, now=now)
    finally:
        conn.close()

    conn = m.connect(db)
    try:
        actions = {
            str(row[0]) for row in conn.execute(
                "SELECT action FROM audit_log"
            ).fetchall()
        }
    finally:
        conn.close()
    assert "old.action" not in actions
    assert "new.action" in actions


def test_user_delete_anonymizes_but_keeps_audit(
    env: tuple[Path, TestClient, Path]
) -> None:
    db, client, _data = env
    created = client.post("/api/v1/users", json={
        "username": "dave", "password": "dave-password", "roles": ["member"],
    })
    assert created.status_code == 201, created.text
    user_id = str(created.json()["userId"])

    conn = m.connect(db)
    try:
        audit.record(conn, actor_id=user_id, action="chat.write", result="ok",
                     detail={"note": "before deletion"})
        conn.commit()
    finally:
        conn.close()

    assert client.delete(f"/api/v1/users/{user_id}").status_code == 200

    conn = m.connect(db)
    try:
        row = conn.execute(
            "SELECT actor_id FROM audit_log WHERE action = 'chat.write'"
        ).fetchone()
    finally:
        conn.close()
    assert row is not None
    assert str(row[0]).startswith("deleted:")
    assert user_id not in str(row[0])


def test_user_export_job_writes_jsonl(
    env: tuple[Path, TestClient, Path]
) -> None:
    db, client, data_dir = env
    admin = _admin_id(client)
    now = int(time.time())
    conn = m.connect(db)
    try:
        conn.execute(
            "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
            " created_at, updated_at) VALUES ('default', 'th_export', ?, 'e',"
            " 'active', ?, ?)", (admin, now, now),
        )
        conn.execute(
            "INSERT INTO messages (tenant_id, message_id, thread_id, role,"
            " content, status, seq, created_at, updated_at) VALUES ('default',"
            " 'msg_export', 'th_export', 'user', 'hello', 'completed', 1, ?, ?)",
            (now, now),
        )
        conn.execute(
            "INSERT INTO artifacts (artifact_id, tenant_id, thread_id, kind, ref,"
            " mime, size, sha256, created_at) VALUES ('ar_export', 'default',"
            " 'th_export', 'file', 'file:///tmp/x', 'text/plain', 1, 'x', ?)",
            (now,),
        )
        conn.commit()
    finally:
        conn.close()

    created = client.post("/api/v1/me/export", json={
        "format": "jsonl", "includeArtifacts": True,
    })
    assert created.status_code == 202, created.text
    job_id = created.json()["jobId"]

    conn = m.connect(db)
    try:
        data_jobs.run_pending(conn, data_dir)
    finally:
        conn.close()

    job = client.get(f"/api/v1/me/export/{job_id}")
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "ready"
    path = Path(str(job.json()["storageRef"]))
    assert path.is_file()
    lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    kinds = {line["type"] for line in lines}
    assert {"user", "threads", "messages", "artifacts"} <= kinds
    assert (path.parent / "manifest.json").is_file()

    admin_job = client.get(f"/api/v1/admin/data-jobs/{job_id}")
    assert admin_job.status_code == 200
    assert admin_job.json()["jobId"] == job_id


def test_tenant_purge_exports_then_deletes_and_anonymizes(
    env: tuple[Path, TestClient, Path]
) -> None:
    db, client, data_dir = env
    now = int(time.time())
    conn = m.connect(db)
    try:
        conn.execute(
            "INSERT INTO tenants (tenant_id, name, status, plan, created_at,"
            " updated_at) VALUES ('tenant_b', 'B', 'active', 'free', ?, ?)",
            (now, now),
        )
        conn.execute(
            "INSERT INTO users (tenant_id, user_id, username, password_hash,"
            " status, is_owner, created_at, updated_at) VALUES ('tenant_b',"
            " 'us_b', 'b', 'x', 'active', 1, ?, ?)", (now, now),
        )
        conn.execute(
            "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
            " created_at, updated_at) VALUES ('tenant_b', 'th_b', 'us_b', 'b',"
            " 'active', ?, ?)", (now, now),
        )
        audit.record(conn, tenant_id="tenant_b", actor_id="us_b",
                     action="chat.write", result="ok", detail={"pii": "secret"})
        conn.commit()
    finally:
        conn.close()

    bad = client.request("DELETE", "/api/v1/admin/tenants/tenant_b", json={
        "confirmName": "wrong", "reason": "gdpr",
    })
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "VALIDATION_FAILED"

    created = client.request("DELETE", "/api/v1/admin/tenants/tenant_b", json={
        "confirmName": "tenant_b", "reason": "gdpr",
    })
    assert created.status_code == 202, created.text
    job_id = created.json()["jobId"]

    conn = m.connect(db)
    try:
        data_jobs.run_pending(conn, data_dir)
    finally:
        conn.close()

    job = client.get(f"/api/v1/admin/data-jobs/{job_id}")
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "done"
    assert Path(str(job.json()["storageRef"])).is_file()

    conn = m.connect(db)
    try:
        assert conn.execute(
            "SELECT count(*) FROM tenants WHERE tenant_id = 'tenant_b'"
        ).fetchone()[0] == 0
        assert conn.execute(
            "SELECT count(*) FROM users WHERE tenant_id = 'tenant_b'"
        ).fetchone()[0] == 0
        assert conn.execute(
            "SELECT count(*) FROM threads WHERE tenant_id = 'tenant_b'"
        ).fetchone()[0] == 0
        row = conn.execute(
            "SELECT actor_id, detail_json FROM audit_log WHERE tenant_id = 'tenant_b'"
        ).fetchone()
    finally:
        conn.close()
    assert row is not None
    assert row[0] is None
    assert json.loads(row[1]) == {}


def test_admin_data_jobs_listing(tmp_path: Path) -> None:
    """P2-7: the console table lists recent export/purge jobs."""
    db = tmp_path / "jobs.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
        data_dir=tmp_path / "data",
    )
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={
            "username": "admin", "password": PASSWORD,
        })
        assert client.post("/api/v1/me/export", json={"format": "jsonl"}).status_code == 202
        listed = client.get("/api/v1/admin/data-jobs")
        assert listed.status_code == 200, listed.text
        items = listed.json()["items"]
        assert len(items) == 1
        assert items[0]["kind"] == "export"
