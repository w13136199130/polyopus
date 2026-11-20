"""Context assembly: expert prefix, real history, MEM-001 trimming order."""

from __future__ import annotations

import json
from pathlib import Path

from polyopus.domains.conversations import context
from polyopus.kernel.models.gateway import ChatMessage
from polyopus.platform.db import migrator as m

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


def _conn(tmp_path: Path):
    conn = m.connect(tmp_path / "ctx.db")
    m.apply(conn, m.discover(MIGRATIONS))
    return conn


def _seed_agent_thread(conn, *, prompt: str, model: str = "") -> str:
    conn.execute(
        "INSERT INTO agents (tenant_id, agent_id, name, description, model,"
        " backend, status, visibility, draft_version, created_by,"
        " created_at, updated_at) VALUES ('default','ag_1','业务专家','', '',"
        " 'builtin','published','private',1,'u',1,1)"
    )
    cur = conn.execute(
        "INSERT INTO agent_versions (tenant_id, agent_id, version, config_json,"
        " published_at, is_current) VALUES ('default','ag_1',1,?,1,1)",
        (json.dumps({"systemPrompt": prompt, "model": model}),),
    )
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, agent_id,"
        " agent_version_id, title, status, created_at, updated_at)"
        " VALUES ('default','th_1','u','ag_1',?,'t','active',1,1)",
        (str(cur.lastrowid),),
    )
    conn.commit()
    return "th_1"


def _message(conn, seq: int, role: str, content: str, status: str = "completed") -> None:
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, role, content,"
        " status, seq, created_at, updated_at)"
        " VALUES ('default', ?, 'th_1', ?, ?, ?, ?, 1, 1)",
        (f"msg_{seq}", role, content, status, seq),
    )


def test_agent_context_uses_pinned_version(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    _seed_agent_thread(conn, prompt="你是业务专家；先查证据再回答。", model="expert-model")
    ctx = context.agent_context(conn, tenant_id="default", thread_id="th_1")
    assert ctx.system_prompt == "你是业务专家；先查证据再回答。"
    assert ctx.model == "expert-model"
    assert ctx.name == "业务专家"
    conn.close()


def test_agent_context_plain_thread_is_empty(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default','th_1','u','t','active',1,1)"
    )
    ctx = context.agent_context(conn, tenant_id="default", thread_id="th_1")
    assert ctx.system_prompt == ""
    assert ctx.model is None
    conn.close()


def test_history_is_ordered_and_filters_non_completed(tmp_path: Path) -> None:
    conn = _conn(tmp_path)
    _seed_agent_thread(conn, prompt="p")
    _message(conn, 1, "user", "第一问")
    _message(conn, 2, "assistant", "第一答")
    _message(conn, 3, "tool", "tool output")
    _message(conn, 4, "assistant", "失败的一半", status="failed")
    _message(conn, 5, "user", "第二问")
    history = context.message_history(
        conn, tenant_id="default", thread_id="th_1"
    )
    assert [(m.role, m.content) for m in history] == [
        ("user", "第一问"),
        ("assistant", "第一答"),
        ("user", "第二问"),
    ]
    conn.close()


def test_assemble_puts_expert_prefix_first_and_keeps_user_last() -> None:
    history = [
        ChatMessage(role="user", content="第一问"),
        ChatMessage(role="assistant", content="第一答"),
        ChatMessage(role="user", content="第二问"),
    ]
    messages, stats = context.assemble(
        system_prompt="你是业务专家",
        agent_name="业务专家",
        memory="已知记忆：部署走 make deploy",
        knowledge="知识依据：发布先灰度",
        history=history,
        current_user_content="第二问",
        max_input_tokens=32_000,
    )
    assert messages[0].role == "system"
    assert messages[0].content == "你是业务专家"
    assert [m.content for m in messages[-3:]] == ["第一问", "第一答", "第二问"]
    assert stats.dropped_history == 0
    assert stats.history_messages == 3


def test_assemble_drops_knowledge_before_history_and_memory() -> None:
    history = [
        ChatMessage(role="user", content="问题" * 100),
        ChatMessage(role="assistant", content="回答" * 100),
        ChatMessage(role="user", content="继续" * 20),
    ]
    messages, stats = context.assemble(
        system_prompt="专家提示",
        agent_name=None,
        memory="记忆" * 300,
        knowledge="知识依据" * 800,
        history=history,
        current_user_content="继续" * 20,
        max_input_tokens=3_000,  # budget = 952 tokens
    )
    assert stats.dropped_knowledge is True
    assert not any("知识依据" in m.content for m in messages if m.role == "system")
    assert messages[-1].content == "继续" * 20


def test_assemble_keeps_newest_user_and_reports_drops() -> None:
    history = [
        ChatMessage(role="user", content=f"旧问题{i}" + "细节" * 200)
        for i in range(10)
    ] + [ChatMessage(role="user", content="最新指令")]
    messages, stats = context.assemble(
        system_prompt="",
        agent_name="助手",
        memory="",
        knowledge="",
        history=history,
        current_user_content="最新指令",
        max_input_tokens=3_000,
    )
    assert messages[-1].content == "最新指令"
    assert stats.dropped_history >= 1
    assert stats.estimated_tokens <= stats.budget_tokens


def test_assemble_appends_missing_current_user() -> None:
    messages, _ = context.assemble(
        system_prompt="",
        agent_name=None,
        memory="",
        knowledge="",
        history=[ChatMessage(role="assistant", content="上一轮回答")],
        current_user_content="这一轮问题",
        max_input_tokens=32_000,
    )
    assert messages[-1] == ChatMessage(role="user", content="这一轮问题")
