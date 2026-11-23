"""Ask/Plan turns: mode persists, tools are withheld and prompts differ."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from polyopus.domains.conversations import service as conversations
from polyopus.kernel.models.gateway import (
    FinishDelta,
    ModelCaps,
    ModelDelta,
    ModelRequest,
    TextDelta,
)
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> tuple[sqlite3.Connection, EventStore, str]:
    conn = m.connect(tmp_path / "modes.db")
    m.apply(conn, m.discover(MIGRATIONS))
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default','th_m','us_1','t','active',1,1)"
    )
    conn.commit()
    return conn, EventStore(conn), "th_m"


def test_ask_and_plan_modes_persist_and_withhold_tools(
    env: tuple[sqlite3.Connection, EventStore, str],
) -> None:
    conn, store, thread_id = env
    for index, mode in enumerate(("ask", "plan"), start=1):
        turn_id, _ = conversations.post_turn(
            conn, store, tenant_id="default", owner_id="us_1",
            thread_id=thread_id, content=f"mode {mode}", mode=mode,
        )
        row = conn.execute(
            "SELECT mode FROM turns WHERE turn_id = ?", (turn_id,)
        ).fetchone()
        assert row[0] == mode
        event = conn.execute(
            "SELECT payload_json FROM events WHERE turn_id = ? AND type='turn.queued'",
            (turn_id,),
        ).fetchone()
        assert f'"mode":"{mode}"' in event[0]
        assert index


class CaptureMode:
    def __init__(self, mode_word: str) -> None:
        self.mode_word = mode_word
        self.seen: list[ModelRequest] = []

    def capabilities(self, model: str) -> ModelCaps:
        return ModelCaps()

    async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
        self.seen.append(req)
        yield TextDelta(text=f"{self.mode_word} response")
        yield FinishDelta(reason="stop")


def test_engine_plan_prompt_has_no_tools(
    env: tuple[sqlite3.Connection, EventStore, str],
) -> None:
    conn, store, thread_id = env
    turn_id, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="us_1",
        thread_id=thread_id, content="做一个发布计划", mode="plan",
    )
    gateway = CaptureMode("Plan")
    from polyopus.domains.agents.models import Registry

    result = asyncio.run(engine.run_turn(
        conn, store, turn_id,
        model=gateway,  # type: ignore[arg-type]
        registry=Registry(conn, env_base_url="", env_api_key="", env_model=""),
    ))
    assert result == "completed"
    request = gateway.seen[0]
    assert request.tools == ()
    assert "Plan 模式" in request.messages[0].content
    assert conn.execute("SELECT count(*) FROM approvals").fetchone()[0] == 0


def test_engine_ask_prompt_requests_structured_questions(
    env: tuple[sqlite3.Connection, EventStore, str],
) -> None:
    conn, store, thread_id = env
    turn_id, _ = conversations.post_turn(
        conn, store, tenant_id="default", owner_id="us_1",
        thread_id=thread_id, content="帮我理需求", mode="ask",
    )
    gateway = CaptureMode("Ask")
    from polyopus.domains.agents.models import Registry

    result = asyncio.run(engine.run_turn(
        conn, store, turn_id,
        model=gateway,  # type: ignore[arg-type]
        registry=Registry(conn, env_base_url="", env_api_key="", env_model=""),
    ))
    assert result == "completed"
    request = gateway.seen[0]
    assert request.tools == ()
    assert "Ask 模式" in request.messages[0].content
    assert '"questions"' in request.messages[0].content
