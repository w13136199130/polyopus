"""fs.read jail + provider tool_calls parsing + engine tool loop."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest

from polyopus.kernel.models import gateway as gt
from polyopus.kernel.models.fake import FakeModel
from polyopus.kernel.models.openai_compat import OpenAICompatProvider, ProviderConfig
from polyopus.kernel.tools import ToolError, execute_fs_read, fs_read

# ---------- fs.read jail ----------


def test_fs_read_numbered_lines(tmp_path: Path) -> None:
    (tmp_path / "hello.txt").write_text("alpha\nbeta\n", encoding="utf-8")
    result = fs_read(tmp_path, "hello.txt")
    assert result.ok
    assert "1|\talpha" in result.output["content"]
    assert "2|\tbeta" in result.output["content"]


def test_fs_read_rejects_traversal(tmp_path: Path) -> None:
    (tmp_path / "secret.txt").write_text("no", encoding="utf-8")
    with pytest.raises(ToolError) as exc:
        fs_read(tmp_path, "../secret.txt")
    assert exc.value.code == "TOOL_PATH_DENIED"


def test_fs_read_rejects_absolute(tmp_path: Path) -> None:
    with pytest.raises(ToolError) as exc:
        fs_read(tmp_path, str(tmp_path / "hello.txt"))
    assert exc.value.code in ("TOOL_PATH_DENIED", "TOOL_NOT_FOUND")


def test_fs_read_rejects_missing(tmp_path: Path) -> None:
    with pytest.raises(ToolError) as exc:
        fs_read(tmp_path, "nope.txt")
    assert exc.value.code == "TOOL_NOT_FOUND"


def test_execute_fs_read_bad_json(tmp_path: Path) -> None:
    with pytest.raises(ToolError) as exc:
        execute_fs_read(tmp_path, "{not json")
    assert exc.value.code == "TOOL_ARGS_INVALID"


# ---------- provider tool_calls parsing ----------


def test_provider_accumulates_tool_call_fragments(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = OpenAICompatProvider(ProviderConfig(base_url="http://x/v1"))
    sse = "\n".join(
        [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_1",'
            '"function":{"name":"fs.read","arguments":"{\\"pa"}}]}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
            '"function":{"arguments":"th\\": \\"hello.txt\\"}"}}]}}]}',
            'data: {"choices":[{"finish_reason":"tool_calls"}]}',
            "data: [DONE]",
        ]
    )

    class FakeResponse:
        def __iter__(self) -> Iterator[bytes]:
            return iter((line + "\n").encode("utf-8") for line in sse.split("\n"))

        def __enter__(self) -> FakeResponse:
            return self

        def __exit__(self, *args: object) -> None:
            pass

    monkeypatch.setattr(
        "polyopus.kernel.models.openai_compat.urlopen", lambda *a, **k: FakeResponse()
    )

    async def collect() -> list[gt.ModelDelta]:
        return [
            d
            async for d in provider.stream(
                gt.ModelRequest(model="m", messages=())
            )
        ]

    deltas = asyncio.run(collect())
    calls = [d for d in deltas if isinstance(d, gt.ToolCallDelta)]
    finish = [d for d in deltas if isinstance(d, gt.FinishDelta)]
    assert len(calls) == 1
    assert calls[0].name == "fs.read"
    assert calls[0].arguments_json == '{"path": "hello.txt"}'
    assert calls[0].id == "tc_1"
    assert finish and finish[0].reason == "tool_calls"


# ---------- engine tool loop (scripted gateway, no network) ----------


class ScriptedGateway:
    """Round 1: ask to read a file. Round 2: answer with its content."""

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace
        self.rounds = 0

    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(
        self, req: gt.ModelRequest
    ) -> AsyncIterator[gt.ModelDelta]:
        self.rounds += 1
        if self.rounds == 1:
            assert any(t.name == "fs.read" for t in req.tools)
            yield gt.ToolCallDelta(
                id="tc_1", name="fs.read",
                arguments_json='{"path": "note.txt"}',
            )
            yield gt.FinishDelta(reason="tool_calls")
            return
        # round 2: the tool result must be in the messages
        tool_msgs = [m for m in req.messages if m.role == "tool"]
        assert tool_msgs, "tool result not fed back"
        yield gt.TextDelta(text="第二行是 beta")
        yield gt.FinishDelta(reason="stop")


def test_engine_tool_loop_reads_and_answers(tmp_path: Path) -> None:

    from polyopus.platform.db import migrator as m
    from polyopus.platform.events.store import EventStore
    from polyopus.workers import engine

    root = tmp_path / "ws"
    root.mkdir()
    (root / "note.txt").write_text("alpha\nbeta\n", encoding="utf-8")

    migrations = Path(__file__).resolve().parents[2] / "migrations"
    conn = m.connect(tmp_path / "t.db")
    m.apply(conn, m.discover(migrations))
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status, created_at,"
        " updated_at) VALUES ('default','th_1','us_1','t','active',1,1)"
    )
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role, content,"
        " status, seq, created_at, updated_at) VALUES ('default','m_1','th_1','tu_1',"
        "'user','读 note.txt 告诉我第二行','completed',1,1,1)"
    )
    conn.execute(
        "INSERT INTO turns (tenant_id, turn_id, thread_id, user_message_id, status, mode,"
        " seq, created_at, updated_at) VALUES ('default','tu_1','th_1','m_1','queued',"
        "'act',1,1,1)"
    )
    conn.commit()

    store = EventStore(conn)
    gateway = ScriptedGateway(root)
    result = asyncio.run(
        engine.run_turn(
            conn, store, "tu_1",
            model=gateway,  # type: ignore[arg-type]
            registry=None,
            config=engine.EngineConfig(workspace=root),
        )
    )
    assert result == "completed"

    types = [r[0] for r in conn.execute(
        "SELECT type FROM events WHERE thread_id='th_1' ORDER BY seq"
    ).fetchall()]
    assert types == [
        "turn.started", "message.started",
        "tool.started", "tool.completed",
        "message.delta", "message.completed",
        "usage.recorded", "turn.finished",
    ], types

    steps = [r[0] for r in conn.execute(
        "SELECT kind FROM steps WHERE run_id IN"
        " (SELECT run_id FROM runs WHERE turn_id='tu_1') ORDER BY idx"
    ).fetchall()]
    assert "tool" in steps

    content = conn.execute(
        "SELECT content FROM messages WHERE role='assistant'"
    ).fetchone()[0]
    assert "beta" in content
    assert gateway.rounds == 2
    conn.close()


def test_fake_model_still_works_without_workspace(tmp_path: Path) -> None:
    """No workspace -> no tools advertised -> single-round streaming."""
    assert FakeModel(chunk_words=2).capabilities("fake").supports_tools is False
