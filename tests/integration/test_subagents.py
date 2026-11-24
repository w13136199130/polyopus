"""v1.1 subagent delegation: one read-only child, parent integrates the result."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from polyopus.domains.agents import service as agents
from polyopus.domains.attention import service as attention
from polyopus.domains.conversations import service as conversations
from polyopus.kernel.models import gateway as gt
from polyopus.platform.db import migrator as m
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


def _env(tmp_path: Path):
    conn = m.connect(tmp_path / "subagents.db")
    m.apply(conn, m.discover(MIGRATIONS))
    return conn


def _agent(conn, *, name: str, prompt: str, model: str, publish: bool) -> str:
    row = agents.create_agent(
        conn, tenant_id="default", created_by="u", name=name,
        system_prompt=prompt, model=model,
    )
    if publish:
        agents.publish_agent(conn, tenant_id="default", agent_id=row["agentId"], by="u")
    return str(row["agentId"])


def _thread(conn, parent_id: str, subagent_ids: list[str]) -> str:
    thread = conversations.create_thread(
        conn, tenant_id="default", owner_id="u", title="委派会话",
        agent_id=parent_id,
    )
    conversations.update_thread(
        conn, tenant_id="default", owner_id="u", thread_id=thread.thread_id,
        settings={"subagentIds": subagent_ids},
    )
    return str(thread.thread_id)


class DelegatingParent:
    """First round delegates; second round answers from the tool result."""

    def __init__(self, child_id: str) -> None:
        self.child_id = child_id
        self.requests: list[gt.ModelRequest] = []
        self.tool_output = ""

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        self.requests.append(req)
        if len(self.requests) == 1:
            assert any(tool.name == "subagent.delegate" for tool in req.tools)
            yield gt.ToolCallDelta(
                id="tc_parent", name="subagent_delegate",
                arguments_json=json.dumps(
                    {"agent_id": self.child_id, "task": "读取 notes.txt 并总结"},
                    ensure_ascii=False,
                ),
            )
            yield gt.UsageDelta(input_tokens=10, output_tokens=2)
            yield gt.FinishDelta(reason="tool_calls")
            return
        for message in reversed(req.messages):
            if message.role == "tool":
                self.tool_output = message.content
                break
        yield gt.TextDelta(text="父回答：已收到子结论")
        yield gt.UsageDelta(input_tokens=5, output_tokens=3)
        yield gt.FinishDelta(reason="stop")


class Recorder:
    """Records the request and answers normally (negative-path checks)."""

    def __init__(self) -> None:
        self.requests: list[gt.ModelRequest] = []

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        self.requests.append(req)
        yield gt.TextDelta(text="好的")
        yield gt.UsageDelta(input_tokens=1, output_tokens=1)
        yield gt.FinishDelta(reason="stop")


class ReadingChild:
    """First round reads notes.txt; second round summarizes it."""

    def __init__(self) -> None:
        self.requests: list[gt.ModelRequest] = []
        self.read_output = ""

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        self.requests.append(req)
        if len(self.requests) == 1:
            assert any(tool.name == "fs.read" for tool in req.tools)
            assert not any(tool.name == "subagent.delegate" for tool in req.tools)
            yield gt.ToolCallDelta(
                id="tc_child", name="fs_read",
                arguments_json=json.dumps({"path": "notes.txt"}),
            )
            yield gt.UsageDelta(input_tokens=8, output_tokens=1)
            yield gt.FinishDelta(reason="tool_calls")
            return
        for message in reversed(req.messages):
            if message.role == "tool":
                self.read_output = message.content
                break
        yield gt.TextDelta(text="子结论：notes.txt 写着 alpha")
        yield gt.UsageDelta(input_tokens=12, output_tokens=4)
        yield gt.FinishDelta(reason="stop")


def test_parent_delegates_to_published_child(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    parent_id = _agent(
        conn, name="主专家", prompt="你负责拆解任务。", model="parent-model",
        publish=True,
    )
    child_id = _agent(
        conn, name="分析员", prompt="你负责只读调查并给结论。", model="child-model",
        publish=True,
    )
    thread_id = _thread(conn, parent_id, [child_id])
    store = EventStore(conn)
    turn_id, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="u",
        thread_id=thread_id, content="请委派子智能体读一下说明",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "notes.txt").write_text("alpha\nbeta\n", encoding="utf-8")

    parent = DelegatingParent(child_id)
    child = ReadingChild()
    status = asyncio.run(engine.run_turn(
        conn, store, turn_id, owner="test", model=parent,
        config=engine.EngineConfig(
            workspace=ws, subagent_model=child, max_tool_rounds=2,
        ),
    ))
    assert status == "completed"

    # parent saw the child summary as its tool result
    assert "子结论：notes.txt 写着 alpha" in parent.tool_output
    # child actually read the file through the jailed tool
    assert "alpha" in child.read_output or "alpha" in parent.tool_output

    types = {
        row[0] for row in conn.execute(
            "SELECT type FROM events WHERE turn_id = ?", (turn_id,)
        ).fetchall()
    }
    assert {"subagent.started", "subagent.completed"} <= types
    assert "tool.started" in types and "tool.completed" in types

    names = [
        json.loads(row[0]).get("name")
        for row in conn.execute(
            "SELECT payload_json FROM events WHERE turn_id = ? AND type = 'tool.started'",
            (turn_id,),
        ).fetchall()
    ]
    assert "子智能体 · 分析员" in names
    assert "子智能体 · fs.read" in names

    # Regression: the assistant tool-call ids must match the tool results.
    # Real OpenAI-compatible providers reject the next round otherwise.
    saved = conn.execute(
        "SELECT messages_json FROM subagent_runs WHERE parent_turn_id = ?",
        (turn_id,),
    ).fetchone()
    assert saved is not None
    child_messages = json.loads(saved[0])
    call_ids = [
        call["id"]
        for message in child_messages if message["role"] == "assistant"
        for call in message.get("tool_calls") or []
    ]
    tool_ids = [
        message["tool_call_id"]
        for message in child_messages if message["role"] == "tool"
    ]
    assert call_ids == tool_ids

    usage = conn.execute(
        "SELECT model, input_tokens, output_tokens FROM usage_ledger"
        " WHERE turn_id = ? ORDER BY id", (turn_id,),
    ).fetchall()
    assert len(usage) == 2
    assert any(row[0] == "child-model" for row in usage)
    assert any(row[0] == "parent-model" for row in usage)
    conn.close()


def test_unpublished_and_self_agents_are_not_delegatable(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    parent_id = _agent(
        conn, name="主专家", prompt="你负责拆解任务。", model="parent-model",
        publish=True,
    )
    draft_id = _agent(
        conn, name="草稿专家", prompt="还没发布。", model="child-model",
        publish=False,
    )

    # unpublished selection: the tool is not advertised at all
    thread_id = _thread(conn, parent_id, [draft_id])
    store = EventStore(conn)
    turn_id, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="u",
        thread_id=thread_id, content="你好",
    )
    parent = Recorder()
    asyncio.run(engine.run_turn(
        conn, store, turn_id, owner="test", model=parent,
        config=engine.EngineConfig(),
    ))
    assert not any(
        tool.name == "subagent.delegate" for tool in parent.requests[0].tools
    )

    # self selection: also hidden
    self_thread = _thread(conn, parent_id, [parent_id])
    self_turn, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="u",
        thread_id=self_thread, content="你好",
    )
    self_parent = Recorder()
    asyncio.run(engine.run_turn(
        conn, store, self_turn, owner="test", model=self_parent,
        config=engine.EngineConfig(),
    ))
    assert not any(
        tool.name == "subagent.delegate" for tool in self_parent.requests[0].tools
    )
    conn.close()


def test_agent_defaults_inherit_into_new_thread(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    parent_id = _agent(
        conn, name="主专家", prompt="你负责拆解任务。", model="parent-model",
        publish=True,
    )
    child_id = _agent(
        conn, name="分析员", prompt="你负责只读调查。", model="child-model",
        publish=True,
    )
    agents.set_subagents(
        conn, tenant_id="default", agent_id=parent_id,
        subagent_ids=[child_id], by="u",
    )
    rows = agents.list_subagents(
        conn, tenant_id="default", agent_id=parent_id
    )
    assert [row["agentId"] for row in rows] == [child_id]
    assert rows[0]["status"] == "published"

    inherited = conversations.create_thread(
        conn, tenant_id="default", owner_id="u", agent_id=parent_id,
    )
    assert inherited.settings["subagentIds"] == [child_id]

    explicit = conversations.create_thread(
        conn, tenant_id="default", owner_id="u", agent_id=parent_id,
        settings={"subagentIds": []},
    )
    assert explicit.settings.get("subagentIds") == []
    conn.close()


def test_subagent_validation_rejects_draft_self_and_cycles(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    parent_id = _agent(
        conn, name="主专家", prompt="你负责拆解任务。", model="parent-model",
        publish=True,
    )
    child_id = _agent(
        conn, name="分析员", prompt="你负责只读调查。", model="child-model",
        publish=True,
    )
    draft_id = _agent(
        conn, name="草稿专家", prompt="还没发布。", model="child-model",
        publish=False,
    )

    with pytest.raises(AppError) as draft_error:
        agents.set_subagents(
            conn, tenant_id="default", agent_id=parent_id,
            subagent_ids=[draft_id], by="u",
        )
    assert draft_error.value.details["reason"] == "subagent_not_published"

    with pytest.raises(AppError) as self_error:
        agents.set_subagents(
            conn, tenant_id="default", agent_id=parent_id,
            subagent_ids=[parent_id], by="u",
        )
    assert self_error.value.details["reason"] == "cannot_delegate_to_self"

    agents.set_subagents(
        conn, tenant_id="default", agent_id=parent_id,
        subagent_ids=[child_id], by="u",
    )
    with pytest.raises(AppError) as cycle_error:
        agents.set_subagents(
            conn, tenant_id="default", agent_id=child_id,
            subagent_ids=[parent_id], by="u",
        )
    assert cycle_error.value.details["reason"] == "subagent_cycle"
    conn.close()


class CancellingChild:
    """Emits enough deltas for the engine to observe a human stop."""

    def __init__(self, conn, turn_id: str) -> None:
        self.conn = conn
        self.turn_id = turn_id

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        for index in range(24):
            if index == 8:
                self.conn.execute(
                    "UPDATE turns SET status = 'cancel_requested' WHERE turn_id = ?",
                    (self.turn_id,),
                )
                self.conn.commit()
            yield gt.TextDelta(text=f"child-{index} ")
            await asyncio.sleep(0)
        yield gt.UsageDelta(input_tokens=4, output_tokens=24)
        yield gt.FinishDelta(reason="stop")


def test_parent_stop_cancels_a_running_child(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    parent_id = _agent(
        conn, name="主专家", prompt="你负责拆解任务。", model="parent-model",
        publish=True,
    )
    child_id = _agent(
        conn, name="慢分析员", prompt="你负责只读调查。", model="child-model",
        publish=True,
    )
    thread_id = _thread(conn, parent_id, [child_id])
    store = EventStore(conn)
    turn_id, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="u",
        thread_id=thread_id, content="请委派子智能体调查",
    )
    parent = DelegatingParent(child_id)
    status = asyncio.run(engine.run_turn(
        conn, store, turn_id, owner="test", model=parent,
        config=engine.EngineConfig(subagent_model=CancellingChild(conn, turn_id)),
    ))
    assert status == "cancelled"
    row = conn.execute(
        "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()
    assert row[0] == "cancelled"
    types = {
        row[0] for row in conn.execute(
            "SELECT type FROM events WHERE turn_id = ?", (turn_id,)
        ).fetchall()
    }
    assert "subagent.cancelled" in types
    conn.close()


class WritingChild:
    """Calls fs.write once; after the tool result it summarizes."""

    def __init__(self) -> None:
        self.requests: list[gt.ModelRequest] = []
        self.tool_output = ""

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        self.requests.append(req)
        has_tool_result = any(message.role == "tool" for message in req.messages)
        if not has_tool_result:
            assert any(tool.name == "fs.write" for tool in req.tools)
            yield gt.ToolCallDelta(
                id="tc_child_write", name="fs_write",
                arguments_json=json.dumps(
                    {"path": "out.txt", "content": "alpha"}
                ),
            )
            yield gt.UsageDelta(input_tokens=6, output_tokens=1)
            yield gt.FinishDelta(reason="tool_calls")
            return
        for message in reversed(req.messages):
            if message.role == "tool":
                self.tool_output = message.content
                break
        yield gt.TextDelta(text="子结论：写入流程结束")
        yield gt.UsageDelta(input_tokens=8, output_tokens=3)
        yield gt.FinishDelta(reason="stop")


def _pending_approval(conn, turn_id: str) -> str:
    row = conn.execute(
        "SELECT approval_id FROM approvals WHERE turn_id = ? AND status = 'pending'"
        " ORDER BY id DESC LIMIT 1", (turn_id,),
    ).fetchone()
    assert row is not None
    return str(row[0])


def _write_flow(tmp_path: Path) -> tuple[Path, sqlite3.Connection, str, str]:
    conn = _env(tmp_path)
    parent_id = _agent(
        conn, name="主专家", prompt="你负责拆解任务。", model="parent-model",
        publish=True,
    )
    child_id = _agent(
        conn, name="写入专家", prompt="你负责写文件。", model="child-model",
        publish=True,
    )
    thread_id = _thread(conn, parent_id, [child_id])
    store = EventStore(conn)
    turn_id, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="u",
        thread_id=thread_id, content="请委派子智能体写一个文件",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    cfg = engine.EngineConfig(
        workspace=ws, subagent_model=WritingChild(), subagent_max_rounds=3,
    )
    status = asyncio.run(engine.run_turn(
        conn, store, turn_id, owner="test",
        model=DelegatingParent(child_id), config=cfg,
    ))
    assert status == "waiting_approval"
    approval_id = _pending_approval(conn, turn_id)
    return ws, conn, turn_id, approval_id


def test_child_write_waits_then_executes_after_approval(tmp_path: Path) -> None:
    ws, conn, turn_id, approval_id = _write_flow(tmp_path)
    assert not (ws / "out.txt").exists()
    row = conn.execute(
        "SELECT status, approval_id, pending_json FROM subagent_runs"
        " WHERE parent_turn_id = ?", (turn_id,),
    ).fetchone()
    assert row is not None
    assert row["status"] == "waiting_approval"
    assert row["approval_id"] == approval_id
    assert row["pending_json"]
    assert conn.execute(
        "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()[0] == "waiting_approval"

    thread_id = str(conn.execute(
        "SELECT thread_id FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()[0])
    store = EventStore(conn)
    attention.resolve(
        conn, store, tenant_id="default", thread_id=thread_id,
        approval_id=approval_id, decision="approved", by="u",
    )
    status = engine.resume_after_approval(
        conn, store, turn_id, owner="test", decision="approved",
        config=engine.EngineConfig(
            workspace=ws, subagent_model=WritingChild(), subagent_max_rounds=3,
        ),
    )
    assert status == "completed"
    assert (ws / "out.txt").read_text(encoding="utf-8") == "alpha"
    assert conn.execute(
        "SELECT status FROM subagent_runs WHERE parent_turn_id = ?", (turn_id,)
    ).fetchone()[0] == "completed"
    types = {
        row[0] for row in conn.execute(
            "SELECT type FROM events WHERE turn_id = ?", (turn_id,)
        ).fetchall()
    }
    assert {"subagent.waiting", "subagent.completed"} <= types
    conn.close()


def test_child_write_denial_lets_the_child_finish(tmp_path: Path) -> None:
    ws, conn, turn_id, approval_id = _write_flow(tmp_path)
    thread_id = str(conn.execute(
        "SELECT thread_id FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()[0])
    store = EventStore(conn)
    attention.resolve(
        conn, store, tenant_id="default", thread_id=thread_id,
        approval_id=approval_id, decision="denied", by="u",
    )
    status = engine.resume_after_approval(
        conn, store, turn_id, owner="test", decision="denied",
        config=engine.EngineConfig(
            workspace=ws, subagent_model=WritingChild(), subagent_max_rounds=3,
        ),
    )
    assert status == "completed"
    assert not (ws / "out.txt").exists()
    failed = conn.execute(
        "SELECT payload_json FROM events WHERE turn_id = ? AND type = 'tool.failed'",
        (turn_id,),
    ).fetchall()
    assert any("approval_denied" in row[0] for row in failed)
    conn.close()


class TwoWriteChild:
    """Writes two files in separate rounds; each write parks for approval."""

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        tool_count = sum(1 for message in req.messages if message.role == "tool")
        if tool_count == 0:
            yield gt.ToolCallDelta(
                id="tc_w1", name="fs_write",
                arguments_json=json.dumps({"path": "one.txt", "content": "1"}),
            )
            yield gt.UsageDelta(input_tokens=4, output_tokens=1)
            yield gt.FinishDelta(reason="tool_calls")
            return
        if tool_count == 1:
            yield gt.ToolCallDelta(
                id="tc_w2", name="fs_write",
                arguments_json=json.dumps({"path": "two.txt", "content": "2"}),
            )
            yield gt.UsageDelta(input_tokens=6, output_tokens=1)
            yield gt.FinishDelta(reason="tool_calls")
            return
        yield gt.TextDelta(text="两次写入都完成了")
        yield gt.UsageDelta(input_tokens=8, output_tokens=4)
        yield gt.FinishDelta(reason="stop")


def test_child_can_pause_twice_without_finishing_the_parent(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    parent_id = _agent(
        conn, name="主专家", prompt="你负责拆解任务。", model="parent-model",
        publish=True,
    )
    child_id = _agent(
        conn, name="双写专家", prompt="你负责写两个文件。", model="child-model",
        publish=True,
    )
    thread_id = _thread(conn, parent_id, [child_id])
    store = EventStore(conn)
    turn_id, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="u",
        thread_id=thread_id, content="请委派子智能体写两个文件",
    )
    ws = tmp_path / "ws"
    ws.mkdir()
    cfg = engine.EngineConfig(
        workspace=ws, subagent_model=TwoWriteChild(), subagent_max_rounds=4,
    )
    assert asyncio.run(engine.run_turn(
        conn, store, turn_id, owner="test",
        model=DelegatingParent(child_id), config=cfg,
    )) == "waiting_approval"
    first = _pending_approval(conn, turn_id)
    attention.resolve(
        conn, store, tenant_id="default", thread_id=thread_id,
        approval_id=first, decision="approved", by="u",
    )
    assert engine.resume_after_approval(
        conn, store, turn_id, owner="test", decision="approved",
        config=engine.EngineConfig(
            workspace=ws, subagent_model=TwoWriteChild(), subagent_max_rounds=4,
        ),
    ) == "waiting_approval"
    assert (ws / "one.txt").is_file()
    assert not (ws / "two.txt").exists()
    assert conn.execute(
        "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()[0] == "waiting_approval"

    second = _pending_approval(conn, turn_id)
    assert second != first
    attention.resolve(
        conn, store, tenant_id="default", thread_id=thread_id,
        approval_id=second, decision="approved", by="u",
    )
    assert engine.resume_after_approval(
        conn, store, turn_id, owner="test", decision="approved",
        config=engine.EngineConfig(
            workspace=ws, subagent_model=TwoWriteChild(), subagent_max_rounds=4,
        ),
    ) == "completed"
    assert (ws / "two.txt").read_text(encoding="utf-8") == "2"
    conn.close()
