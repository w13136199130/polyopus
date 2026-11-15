"""V05-20 source/schedule management API smoke tests."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    db = tmp_path / "sources.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as c:
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        yield c


def test_source_list_pause_resume_delete(client: TestClient) -> None:
    created = client.post("/api/v1/sources", json={
        "name": "ci", "allowActors": ["alice"],
        "explicitPatterns": ["/polyopus"], "generateSecret": False,
    })
    assert created.status_code == 201, created.text
    source_id = created.json()["sourceId"]

    items = client.get("/api/v1/sources").json()["items"]
    item = next(row for row in items if row["sourceId"] == source_id)
    assert item["kind"] == "webhook"
    assert item["allowActors"] == ["alice"]
    assert "secret" not in item

    assert client.post(f"/api/v1/sources/{source_id}/pause").json()["status"] == "paused"
    assert client.post(f"/api/v1/sources/{source_id}/resume").json()["status"] == "active"
    assert client.delete(f"/api/v1/sources/{source_id}").json()["deleted"] is True
    assert all(row["sourceId"] != source_id
               for row in client.get("/api/v1/sources").json()["items"])


def test_cron_job_create_toggle_runs_delete(client: TestClient) -> None:
    created = client.post("/api/v1/cron-jobs", json={
        "name": f"job-{time.time_ns()}",
        "schedule": "interval:3600",
        "timezone": "UTC",
        "text": "/polyopus 定时巡检",
    })
    assert created.status_code == 201, created.text
    job = created.json()
    assert job["enabled"] is True
    assert job["sourceId"]

    jobs = client.get("/api/v1/cron-jobs").json()["items"]
    assert any(row["cronJobId"] == job["cronJobId"] for row in jobs)

    paused = client.patch(f"/api/v1/cron-jobs/{job['cronJobId']}",
                          json={"enabled": False})
    assert paused.status_code == 200
    assert paused.json()["enabled"] is False

    runs = client.get(f"/api/v1/cron-jobs/{job['cronJobId']}/runs")
    assert runs.status_code == 200 and runs.json()["items"] == []

    assert client.delete(f"/api/v1/cron-jobs/{job['cronJobId']}").json()["deleted"] is True
    assert all(row["cronJobId"] != job["cronJobId"]
               for row in client.get("/api/v1/cron-jobs").json()["items"])
