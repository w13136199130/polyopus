"""Policy engine wired into the real tool loop (v0.1 card 1).

The spike proved the engine's semantics in isolation; these prove the
production path: model tool calls route through allow/ask/deny, ask pauses
with the real tool+args, approve executes the write, deny and policy errors
never touch the workspace.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest

from polyopus.domains.attention import service as attention
from polyopus.kernel.models.gateway import (
    FinishDelta,
    ModelCaps,
    ModelDelta,
    ModelRequest,
    TextDelta,
    ToolCallDelta,
    UsageDelta,
)
from polyopus.kernel.tools import Rule
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
WRITE_ARGS = json.dumps({"path": "out.txt", "content": "hello policy"})


class WantsWrite:
    """Gateway script: round 1 asks to write, later rounds answer."""

    def __init__(self) -> None:
        self.rounds = 0

    def capabilities(self, model: str) -> ModelCaps:
        return ModelCaps()

    async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
        self.rounds += 1
        if self.rounds == 1:
            yield ToolCallDelta(id="tc_1", name="fs_write",
                                arguments_json=WRITE_ARGS)
            yield FinishDelta(reason="tool_calls")
            return
        yield TextDelta(text="已处理")
        yield UsageDelta(input_tokens=1, output_tokens=1)
        yield FinishDelta(reason="stop")


class BrokenRule:
    rid = "r-broken"
    priority = 999

    def matches(self, tool, args):  # noqa: ANN001 - raises on purpose
        raise RuntimeError("bad DSL")


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, sqlite3.Connection, Path]]:
    db = tmp_path / "pol.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "note.txt").write_text("seed", encoding="utf-8")
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default','th_1','us_1','t','active',1,1)"
    )
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
        " content, status, seq, created_at, updated_at)"
        " VALUES ('default','m_1','th_1','tu_1','user','请写入文件','completed',1,1,1)"
    )
    conn.execute(
        "INSERT INTO turns (tenant_id, turn_id, thread_id, user_message_id, status,"
        " mode, seq, created_at, updated_at)"
        " VALUES ('default','tu_1','th_1','m_1','queued','act',1,1,1)"
    )
    conn.commit()
    yield db, conn, workspace
    conn.close()


def _registry(conn: sqlite3.Connection):
    from polyopus.domains.agents.models import Registry

    return Registry(conn, env_base_url="", env_api_key="", env_model="")


def _run(conn, workspace, turn="tu_1", rules=()):
    return asyncio.run(engine.run_turn(
        conn, EventStore(conn), turn,
        model=WantsWrite(),  # type: ignore[arg-type]
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=workspace, policy_rules=rules),
    ))


def test_write_pauses_and_approval_executes_file(env) -> None:
    db, conn, ws = env
    assert _run(conn, ws) == "waiting_approval"
    assert not (ws / "out.txt").exists()  # nothing written before approval

    approval = conn.execute(
        "SELECT request_json FROM approvals ORDER BY id DESC LIMIT 1"
    ).fetchone()
    action = json.loads(approval["request_json"])["actions"][0]
    assert action["tool"] == "fs.write"
    assert action["args_json"] == WRITE_ARGS  # full args survive for resume

    # real order (attentions router): resolve first, then resume
    approval_id = conn.execute(
        "SELECT approval_id FROM approvals ORDER BY id DESC LIMIT 1"
    ).fetchone()[0]
    attention.resolve(
        conn, EventStore(conn),
        tenant_id="default", thread_id="th_1",
        approval_id=str(approval_id), decision="approved", by="us_test",
    )
    result = engine.resume_after_approval(
        conn, EventStore(conn), "tu_1", decision="approved",
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=ws),
    )
    assert result == "completed"
    assert (ws / "out.txt").read_text(encoding="utf-8") == "hello policy"

    types = [r[0] for r in conn.execute(
        "SELECT type FROM events WHERE thread_id='th_1' ORDER BY seq"
    ).fetchall()]
    assert "approval.requested" in types and "approval.resolved" in types
    assert "tool.started" in types and "tool.completed" in types
    assert types[-1] == "turn.finished"
    status = conn.execute("SELECT status FROM turns WHERE turn_id='tu_1'").fetchone()[0]
    assert status == "completed"


def test_write_denied_by_human_leaves_file_absent(env) -> None:
    db, conn, ws = env
    assert _run(conn, ws) == "waiting_approval"
    result = engine.resume_after_approval(
        conn, EventStore(conn), "tu_1", decision="denied",
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=ws),
    )
    assert result == "completed"
    assert not (ws / "out.txt").exists()

    failures = [r[0] for r in conn.execute(
        "SELECT payload_json FROM events WHERE type='tool.failed'"
    ).fetchall()]
    assert any("approval_denied" in payload for payload in failures)


def test_broken_rules_fail_closed_no_write(env) -> None:
    db, conn, ws = env
    # a broken rule must deny the write instead of executing it
    rules = (Rule("r-ask", 40, {"risk": "high"}, "ask"), BrokenRule())  # type: ignore[arg-type]
    asyncio.run(engine.run_turn(
        conn, EventStore(conn), "tu_1",
        model=WantsWrite(),  # type: ignore[arg-type]
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=ws, policy_rules=rules),
    ))
    # PolicyEngine sees BrokenRule raise -> POLICY_ERROR (deny) has priority
    # over r-ask? priority 999 sorts first and matches() raises -> deny.
    # Either way: fail-closed, no pause on a broken policy, no file.
    assert not (ws / "out.txt").exists()
    turn_status = conn.execute(
        "SELECT status FROM turns WHERE turn_id='tu_1'"
    ).fetchone()[0]
    assert turn_status == "completed"  # denied, model informed, turn finished


def test_unknown_tool_denied(env) -> None:
    db, conn, ws = env

    class WantsGhost:
        def capabilities(self, model: str) -> ModelCaps:
            return ModelCaps()

        async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
            yield ToolCallDelta(id="tc_g", name="ghost_tool", arguments_json="{}")
            yield FinishDelta(reason="tool_calls")

    asyncio.run(engine.run_turn(
        conn, EventStore(conn), "tu_1",
        model=WantsGhost(),  # type: ignore[arg-type]
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=ws),
    ))
    failures = conn.execute(
        "SELECT payload_json FROM events WHERE type='tool.failed'"
    ).fetchall()
    assert any("tool_not_found" in row[0] for row in failures)
    status = conn.execute(
        "SELECT status FROM turns WHERE turn_id='tu_1'"
    ).fetchone()[0]
    assert status == "completed"


def test_fs_read_still_allows_without_approval(env) -> None:
    db, conn, ws = env

    class WantsRead:
        def capabilities(self, model: str) -> ModelCaps:
            return ModelCaps()

        async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
            if not req.tools:
                yield TextDelta(text="done")
                yield FinishDelta(reason="stop")
                return
            yield ToolCallDelta(
                id="tc_r", name="fs_read",
                arguments_json=json.dumps({"path": "note.txt"}),
            )
            yield FinishDelta(reason="tool_calls")

    result = asyncio.run(engine.run_turn(
        conn, EventStore(conn), "tu_1",
        model=WantsRead(),  # type: ignore[arg-type]
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=ws),
    ))
    assert result == "completed"
    approvals = conn.execute("SELECT count(*) FROM approvals").fetchone()[0]
    assert approvals == 0  # read-only: no approval card
    completions = [r[0] for r in conn.execute(
        "SELECT payload_json FROM events WHERE type='tool.completed'"
    ).fetchall()]
    assert any("note.txt" in payload for payload in completions)
