"""Chat session parity API: rename/pin/branch/delete, per-session settings,
model catalog, workspace browser and the Dock trace tail."""

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
    db = tmp_path / "sessions.db"
    workspace = tmp_path / "ws"
    (workspace / "src").mkdir(parents=True)
    (workspace / "src" / "auth.ts").write_text("export const x = 1;\n")
    (workspace / "README.md").write_text("# demo\n")
    (tmp_path / "secret.txt").write_text("do not leak")

    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()

    settings = Settings(
        db_path=db,
        secret_key="s",
        access_ttl_seconds=3600,
        session_ttl_seconds=86400,
        workspace_dir=workspace,
    )
    with TestClient(create_app(settings)) as test_client:
        test_client.post(
            "/api/v1/auth/login", json={"username": "admin", "password": "p"}
        )
        yield test_client


def _create(client: TestClient, title: str = "会话") -> str:
    response = client.post("/api/v1/threads", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()["threadId"]


def test_rename_pin_and_settings_roundtrip(client: TestClient) -> None:
    first = _create(client, "旧标题")
    second = _create(client, "另一个")

    patch = client.patch(
        f"/api/v1/threads/{first}",
        json={"title": "新标题", "pinned": True},
    )
    assert patch.status_code == 200, patch.text
    body = patch.json()
    assert body["title"] == "新标题"
    assert body["pinned"] is True

    # pinned sorts first even though it is older than `second`
    listed = client.get("/api/v1/threads").json()["items"]
    assert [t["threadId"] for t in listed[:2]] == [first, second]

    settings = {
        "model": "deepseek-chat",
        "kbIds": ["kb_1"],
        "connectorIds": [],
        "subagentIds": ["ag_x"],
        "approvalPolicy": "auto",
    }
    patched = client.patch(
        f"/api/v1/threads/{first}", json={"settings": settings}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["settings"] == settings

    # un-pin restores pure recency order
    client.patch(f"/api/v1/threads/{first}", json={"pinned": False})
    listed = client.get("/api/v1/threads").json()["items"]
    assert {t["threadId"] for t in listed} == {first, second}


def test_branch_copies_history_and_settings(client: TestClient) -> None:
    source = _create(client, "主线")
    client.patch(
        f"/api/v1/threads/{source}",
        json={"settings": {"model": "m", "kbIds": ["kb_1"]}},
    )
    turn = client.post(
        f"/api/v1/threads/{source}/turns",
        json={"content": "第一问"},
        headers={"Idempotency-Key": "branch-1"},
    )
    assert turn.status_code == 202

    branched = client.post(f"/api/v1/threads/{source}/branch", json={})
    assert branched.status_code == 201, branched.text
    clone = branched.json()
    assert clone["threadId"] != source
    assert clone["branchOf"] == source
    assert clone["title"].endswith("（分支）")
    assert clone["settings"]["kbIds"] == ["kb_1"]

    copied = client.get(
        f"/api/v1/threads/{clone['threadId']}/messages"
    ).json()["items"]
    assert [m["content"] for m in copied] == ["第一问"]


def test_delete_hides_thread_from_list_and_detail(client: TestClient) -> None:
    thread_id = _create(client)
    assert client.delete(f"/api/v1/threads/{thread_id}").status_code == 200
    assert client.get("/api/v1/threads").json()["items"] == []
    assert client.get(f"/api/v1/threads/{thread_id}/messages").status_code == 404


def test_delete_compact_purges_and_vacuums(client: TestClient) -> None:
    thread_id = _create(client)
    turn = client.post(
        f"/api/v1/threads/{thread_id}/turns",
        json={"content": "待清理"},
        headers={"Idempotency-Key": "compact-1"},
    )
    assert turn.status_code == 202

    response = client.delete(f"/api/v1/threads/{thread_id}?compact=true")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["compact"] is True
    assert body["vacuumed"] is True
    assert client.get("/api/v1/threads").json()["items"] == []
    assert client.get(f"/api/v1/threads/{thread_id}/messages").status_code == 404


def test_trace_tail_returns_queued_event(client: TestClient) -> None:
    thread_id = _create(client)
    client.post(f"/api/v1/threads/{thread_id}/turns", json={"content": "hello"})
    trace = client.get(f"/api/v1/threads/{thread_id}/trace").json()["items"]
    assert any(item["type"] == "turn.queued" for item in trace)
    # user messages are merged in as synthetic records (no event row)
    assert any(
        item["type"] == "message.user" and item["payload"]["content"] == "hello"
        for item in trace
    )


def test_workspace_tree_and_file_are_confined(client: TestClient) -> None:
    tree = client.get("/api/v1/workspace/tree")
    assert tree.status_code == 200, tree.text
    names = {item["name"] for item in tree.json()["items"]}
    assert {"src", "README.md"} <= names

    file = client.get("/api/v1/workspace/file", params={"path": "src/auth.ts"})
    assert file.status_code == 200
    assert "export const x" in file.json()["content"]

    escape = client.get("/api/v1/workspace/file", params={"path": "../secret.txt"})
    assert escape.status_code == 403
    assert escape.json()["error"]["code"] == "FORBIDDEN"


def test_models_endpoint_is_honest_without_providers(client: TestClient) -> None:
    body = client.get("/api/v1/models").json()
    assert body["source"] == "fake"
    assert body["items"] == []


def test_models_endpoint_prefers_env_provider(tmp_path: Path) -> None:
    """Registry.resolve() ignores DB rows when POLY_MODEL_* is set, so the
    picker must offer exactly that model instead of dead choices."""
    db = tmp_path / "env.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(
        db_path=db,
        secret_key="s",
        access_ttl_seconds=3600,
        session_ttl_seconds=86400,
        model_base_url="http://127.0.0.1:9/v1",
        model_api_key="k",
        model_name="deepseek-flash",
    )
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login", json={"username": "admin", "password": "p"})
        body = client.get("/api/v1/models").json()
        assert body["source"] == "env"
        assert body["defaultModel"] == "deepseek-flash"
        assert [item["name"] for item in body["items"]] == ["deepseek-flash"]


def test_patch_rejects_bad_settings_shape(client: TestClient) -> None:
    thread_id = _create(client)
    response = client.patch(
        f"/api/v1/threads/{thread_id}",
        json={"settings": {"approvalPolicy": "yolo"}},
    )
    assert response.status_code == 422
    response = client.patch(
        f"/api/v1/threads/{thread_id}",
        json={"settings": {"kbIds": "kb_1"}},
    )
    assert response.status_code == 422


def test_session_settings_bad_json_degrades_to_empty(tmp_path: Path) -> None:
    from polyopus.domains.conversations.service import parse_settings

    assert parse_settings(None) == {}
    assert parse_settings("{not-json") == {}
    assert parse_settings("[1, 2]") == {}
    assert parse_settings('{"kbIds": ["kb_1"]}') == {"kbIds": ["kb_1"]}


def test_kb_context_uses_selected_bases(tmp_path: Path) -> None:
    """The composer's 知识库 chip is not decorative: enabled KBs contribute
    retrieved chunks to the turn's system context."""
    from polyopus.domains.knowledge import service as kb_service
    from polyopus.workers.engine import _kb_context

    conn = m.connect(tmp_path / "kb.db")
    m.apply(conn, m.discover(MIGRATIONS))
    kb_id = kb_service.create_kb(conn, "运维手册", tenant_id="default")
    kb_service.ingest_markdown(
        conn, kb_id, "deploy.md",
        "# 发布流程\n\n生产发布必须先走灰度，确认无异常后再全量。",
        tenant_id="default",
    )

    context = _kb_context(
        conn, tenant_id="default",
        query="生产发布流程是什么", kb_ids=[kb_id],
    )
    assert context is not None
    assert "灰度" in context
    assert "运维手册" in context
    # no selection -> no injection (old threads keep their exact behaviour)
    assert _kb_context(
        conn, tenant_id="default", query="生产发布流程", kb_ids=[]
    ) is None
    conn.close()


def test_thread_list_carries_latest_message_preview(client: TestClient) -> None:
    thread_id = _create(client, "带预览的会话")
    empty_id = _create(client, "还没有消息的会话")
    conn = m.connect(client.app.state.settings.resolved_db_path())
    try:
        for seq, (role, content) in enumerate(
            [("user", "第一问"), ("assistant", "  第一答\n第二行  "), ("system", "")], start=1
        ):
            conn.execute(
                "INSERT INTO messages (tenant_id, message_id, thread_id, role,"
                " content, status, seq, created_at, updated_at)"
                " VALUES ('default', ?, ?, ?, ?, 'completed', ?, 1, 1)",
                (f"msg_p{seq}", thread_id, role, content, seq),
            )
        conn.commit()
    finally:
        conn.close()
    row = next(
        item for item in client.get("/api/v1/threads").json()["items"]
        if item["threadId"] == thread_id
    )
    assert row["preview"] == "第一答 第二行"
    # a session without messages has no preview rather than a fake one
    empty = next(
        item for item in client.get("/api/v1/threads").json()["items"]
        if item["threadId"] == empty_id
    )
    assert empty["preview"] is None


def test_thread_preview_strips_markdown(client: TestClient) -> None:
    thread_id = _create(client, "带格式的会话")
    conn = m.connect(client.app.state.settings.resolved_db_path())
    try:
        conn.execute(
            "INSERT INTO messages (tenant_id, message_id, thread_id, role,"
            " content, status, seq, created_at, updated_at)"
            " VALUES ('default', 'msg_md', ?, 'assistant', ?, 'completed', 1, 1, 1)",
            (thread_id, "## 标题\n\n**重点** `code`\n\n| a | b |\n| --- | --- |\n"
             "\n[链接](https://example.com)"),
        )
        conn.commit()
    finally:
        conn.close()
    row = next(
        item for item in client.get("/api/v1/threads").json()["items"]
        if item["threadId"] == thread_id
    )
    assert row["preview"] == "标题 重点 code a b 链接"
