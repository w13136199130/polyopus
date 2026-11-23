"""Task page actions: enriched list/detail payloads, reassign, add budget."""

from __future__ import annotations

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
    db = tmp_path / "tasks.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    # no embedded ticket worker: these tests assert the queue transition
    # deterministically instead of racing the executor to "done".
    settings = Settings(
        db_path=db,
        secret_key="s",
        access_ttl_seconds=3600,
        session_ttl_seconds=86400,
        workspace_dir=tmp_path / "ws",
        embedded_worker=False,
    )
    with TestClient(create_app(settings)) as test_client:
        test_client.post(
            "/api/v1/auth/login", json={"username": "admin", "password": "p"}
        )
        yield test_client


def _ticket(client: TestClient, title: str = "核对周报") -> str:
    response = client.post("/api/v1/tickets", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()["ticketId"]


def test_list_and_detail_expose_task_card_fields(client: TestClient) -> None:
    ticket_id = _ticket(client)
    listed = client.get("/api/v1/tickets").json()["items"]
    row = next(item for item in listed if item["ticketId"] == ticket_id)
    assert row["bucket"] == "queued"
    assert row["actor"]["id"].startswith("us_")
    assert row["actor"]["name"] == "admin"
    assert row["sourceName"] is None
    assert row["progress"] == 0
    assert row["summary"] == ""

    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["ticketId"] == ticket_id
    assert detail["strength"] == "explicit"
    assert detail["createdAt"] > 0
    assert detail["scope"] == ["workspace:default", "fs:write"]
    assert detail["artifacts"] == []


def test_add_budget_raises_ceiling_and_records_timeline(client: TestClient) -> None:
    ticket_id = _ticket(client)
    response = client.post(
        f"/api/v1/tickets/{ticket_id}/budget",
        json={"additionalCostMicros": 1_500_000, "additionalTokens": 20_000},
    )
    assert response.status_code == 200, response.text
    assert response.json()["maxCostMicros"] == 1_500_000
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["budget"]["max_cost_micros"] == 1_500_000
    assert detail["budget"]["max_total_tokens"] == 20_000
    timeline = client.get(f"/api/v1/tickets/{ticket_id}/timeline").json()["items"]
    assert any(item["title"] == "追加预算" for item in timeline)

    # a second top-up adds to the existing ceiling instead of replacing it
    client.post(
        f"/api/v1/tickets/{ticket_id}/budget",
        json={"additionalCostMicros": 500_000},
    )
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["budget"]["max_cost_micros"] == 2_000_000


def test_reassign_requeues_open_ticket_but_refuses_ended(
    client: TestClient,
) -> None:
    ticket_id = _ticket(client)
    response = client.post(f"/api/v1/tickets/{ticket_id}/reassign")
    assert response.status_code == 200, response.text
    assert response.json()["bucket"] == "queued"

    client.post(f"/api/v1/tickets/{ticket_id}/stop")
    refused = client.post(f"/api/v1/tickets/{ticket_id}/reassign")
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "CONFLICT"


def test_reassign_refuses_while_attention_pending(client: TestClient, tmp_path: Path) -> None:
    ticket_id = _ticket(client)
    # simulate a parked approval; re-running would duplicate the waiting turn
    conn = m.connect(tmp_path / "tasks.db")
    conn.execute(
        "INSERT INTO attentions (tenant_id, attention_id, ticket_id, turn_id,"
        " kind, source_type, source_id, payload_json, status, created_at)"
        " VALUES ('default', 'at_x', ?, 'tu_x', 'approval', 'approval', 'ap_x',"
        " '{}', 'pending', 1)",
        (ticket_id,),
    )
    conn.commit()
    conn.close()
    response = client.post(f"/api/v1/tickets/{ticket_id}/reassign")
    assert response.status_code == 409
    assert response.json()["error"]["details"]["reason"] == "pending_attention"


def test_assign_refuses_ticket_ended_by_stop(client: TestClient, tmp_path: Path) -> None:
    """Stop and the ticket worker can race; assign must never revive an ended
    ticket into bucket=running."""
    from polyopus.domains.tickets import service as tickets
    from polyopus.platform.errors import AppError
    from polyopus.platform.events.store import EventStore

    ticket_id = _ticket(client)
    client.post(f"/api/v1/tickets/{ticket_id}/stop")
    conn = m.connect(tmp_path / "tasks.db")
    try:
        with pytest.raises(AppError):
            tickets.assign(conn, EventStore(conn), ticket_id)
        row = conn.execute(
            "SELECT bucket, state FROM tickets WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()
    finally:
        conn.close()
    assert tuple(row) == ("done", "ended")


def test_rerun_reopens_ended_ticket_and_delete_hides_it(
    client: TestClient,
) -> None:
    ticket_id = _ticket(client)
    # running ticket cannot be re-run or deleted
    assert client.post(f"/api/v1/tickets/{ticket_id}/rerun").status_code == 409
    assert client.delete(f"/api/v1/tickets/{ticket_id}").status_code == 409

    client.post(f"/api/v1/tickets/{ticket_id}/stop")
    rerun = client.post(f"/api/v1/tickets/{ticket_id}/rerun")
    assert rerun.status_code == 200, rerun.text
    assert rerun.json()["bucket"] == "queued"
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["state"] == "open" and detail["bucket"] == "queued"
    timeline = client.get(f"/api/v1/tickets/{ticket_id}/timeline").json()["items"]
    assert any(item["title"] == "再次运行" for item in timeline)

    client.post(f"/api/v1/tickets/{ticket_id}/stop")
    deleted = client.delete(f"/api/v1/tickets/{ticket_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True
    rows = client.get("/api/v1/tickets").json()["items"]
    assert all(item["ticketId"] != ticket_id for item in rows)
    assert client.get(f"/api/v1/tickets/{ticket_id}").status_code == 404


def test_ticket_instruction_and_edit_only_after_stop(client: TestClient) -> None:
    ticket_id = _ticket(client, "初始标题")
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["instruction"] == "初始标题"

    active = client.patch(
        f"/api/v1/tickets/{ticket_id}",
        json={"title": "运行中标题", "content": "不应生效"},
    )
    assert active.status_code == 409

    client.post(f"/api/v1/tickets/{ticket_id}/stop")
    edited = client.patch(
        f"/api/v1/tickets/{ticket_id}",
        json={"title": "编辑后的标题", "content": "请分析天气并写入 weather.md"},
    )
    assert edited.status_code == 200, edited.text
    detail = client.get(f"/api/v1/tickets/{ticket_id}").json()
    assert detail["title"] == "编辑后的标题"
    assert detail["instruction"] == "请分析天气并写入 weather.md"
