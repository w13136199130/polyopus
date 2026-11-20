"""Engine context wiring: expert prompt/model + multi-turn history reach the
model request (docs/28 MEM-001)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

from polyopus.domains.agents import service as agents
from polyopus.domains.conversations import service as conversations
from polyopus.kernel.models import gateway as gt
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


class Recorder:
    """Captures every model request; always answers with one short round."""

    def __init__(self) -> None:
        self.requests: list[gt.ModelRequest] = []

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        self.requests.append(req)
        yield gt.TextDelta(text="好的")
        yield gt.UsageDelta(input_tokens=1, output_tokens=1)
        yield gt.FinishDelta(reason="stop")


class ThinkingRecorder(Recorder):
    """Adds a reasoning phase before the answer (DeepSeek-style)."""

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        self.requests.append(req)
        yield gt.ReasoningDelta(text="先确认问题指向，再给出结论。")
        yield gt.TextDelta(text="最终答案")
        yield gt.FinishDelta(reason="stop")


def _env(tmp_path: Path):
    conn = m.connect(tmp_path / "engine.db")
    m.apply(conn, m.discover(MIGRATIONS))
    return conn


def _expert_thread(conn, *, model: str) -> str:
    agent = agents.create_agent(
        conn, tenant_id="default", created_by="u", name="业务专家",
        system_prompt="你是业务专家；回答前先引用证据。", model=model,
    )
    agents.publish_agent(
        conn, tenant_id="default", agent_id=agent["agentId"], by="u"
    )
    thread = conversations.create_thread(
        conn, tenant_id="default", owner_id="u", title="专家会话",
        agent_id=agent["agentId"],
    )
    return thread.thread_id


def test_engine_sends_expert_prompt_and_prior_turns(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    thread_id = _expert_thread(conn, model="expert-model")
    first_turn, _ = conversations.post_turn(
        conn, EventStore(conn), tenant_id="default", owner_id="u",
        thread_id=thread_id, content="第一问：发布流程是什么？",
    )
    asyncio.run(
        engine.run_turn(
            conn, EventStore(conn), first_turn, owner="test", model=Recorder(),
        )
    )
    second_turn, _ = conversations.post_turn(
        conn, EventStore(conn), tenant_id="default", owner_id="u",
        thread_id=thread_id, content="第二问：测试怎么跑？",
    )
    recorder = Recorder()
    asyncio.run(
        engine.run_turn(
            conn, EventStore(conn), second_turn, owner="test", model=recorder,
        )
    )

    # second request = expert prefix + first round as real history
    request = recorder.requests[0]
    assert request.model == "expert-model"
    assert request.messages[0].role == "system"
    assert "你是业务专家" in request.messages[0].content
    contents = [message.content for message in request.messages]
    # real history, in order, ending with the current user message
    assert "第一问：发布流程是什么？" in contents
    assert "好的" in contents
    assert contents[-1] == "第二问：测试怎么跑？"
    assert contents.index("好的") < contents.index("第二问：测试怎么跑？")
    conn.close()


def test_session_model_choice_beats_expert_default(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    thread_id = _expert_thread(conn, model="expert-model")
    conversations.update_thread(
        conn, tenant_id="default", owner_id="u", thread_id=thread_id,
        settings={"model": "session-model"},
    )
    turn_id, _ = conversations.post_turn(
        conn, EventStore(conn), tenant_id="default", owner_id="u",
        thread_id=thread_id, content="你好",
    )
    recorder = Recorder()
    asyncio.run(
        engine.run_turn(
            conn, EventStore(conn), turn_id, owner="test", model=recorder,
        )
    )
    assert recorder.requests[0].model == "session-model"
    conn.close()


def test_plain_thread_has_no_expert_prefix(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    thread = conversations.create_thread(
        conn, tenant_id="default", owner_id="u", title="普通会话"
    )
    turn_id, _ = conversations.post_turn(
        conn, EventStore(conn), tenant_id="default", owner_id="u",
        thread_id=thread.thread_id, content="你好",
    )
    recorder = Recorder()
    asyncio.run(
        engine.run_turn(
            conn, EventStore(conn), turn_id, owner="test", model=recorder,
        )
    )
    messages = recorder.requests[0].messages
    assert messages[0].role == "user"
    assert messages[0].content == "你好"
    conn.close()


def test_reasoning_is_persisted_separately_from_text(tmp_path: Path) -> None:
    conn = _env(tmp_path)
    thread = conversations.create_thread(
        conn, tenant_id="default", owner_id="u", title="思考"
    )
    turn_id, _ = conversations.post_turn(
        conn, EventStore(conn), tenant_id="default", owner_id="u",
        thread_id=thread.thread_id, content="解释一下",
    )
    asyncio.run(
        engine.run_turn(
            conn, EventStore(conn), turn_id, owner="test",
            model=ThinkingRecorder(),
        )
    )
    message = conversations.list_messages(
        conn, thread_id=thread.thread_id
    )[-1]
    assert message["content"] == "最终答案"
    blocks = message["blocks"]
    assert isinstance(blocks, list)
    assert any(
        block.get("type") == "reasoning" and "先确认问题" in str(block.get("text"))
        for block in blocks
    )
    trace = conversations.list_trace(conn, thread_id=thread.thread_id)
    assert any(item["type"] == "message.reasoning" for item in trace)
    conn.close()
