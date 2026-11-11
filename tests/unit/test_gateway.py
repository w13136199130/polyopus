"""Gateway/provider: parsing, retries, registry, usage accounting."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from polyopus.domains.agents.models import Registry
from polyopus.kernel.models import gateway as gt
from polyopus.kernel.models.fake import FakeModel
from polyopus.kernel.models.openai_compat import OpenAICompatProvider, ProviderConfig
from polyopus.platform.db import migrator as m

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


def _chunks(text: str) -> Iterator[str]:
    for line in text.splitlines():
        if line.strip():
            yield line + "\n"


def test_openai_stream_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = OpenAICompatProvider(ProviderConfig(base_url="http://x/v1"))
    sse = (
        'data: {"choices":[{"delta":{"content":"你"}}]}\n'
        'data: {"choices":[{"delta":{"content":"好"}}]}\n'
        'data: {"choices":[{"finish_reason":"stop"}],"usage":'
        '{"prompt_tokens":10,"completion_tokens":2,'
        '"prompt_tokens_details":{"cached_tokens":4}}}\n'
        "data: [DONE]\n"
    )

    class FakeResponse:
        def __iter__(self) -> Iterator[bytes]:
            for line in _chunks(sse):
                yield line.encode("utf-8")

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
                gt.ModelRequest(
                    model="m", messages=(gt.ChatMessage(role="user", content="hi"),)
                )
            )
        ]

    deltas = asyncio.run(collect())
    texts = [d.text for d in deltas if isinstance(d, gt.TextDelta)]
    usage = [d for d in deltas if isinstance(d, gt.UsageDelta)]
    finish = [d for d in deltas if isinstance(d, gt.FinishDelta)]
    assert texts == ["你", "好"]
    assert usage and usage[0].input_tokens == 10 and usage[0].cached_tokens == 4
    assert finish and finish[0].reason == "stop"


def test_openai_reasoning_delta(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = OpenAICompatProvider(ProviderConfig(base_url="http://x/v1"))
    sse = (
        'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\n'
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n'
        "data: [DONE]\n"
    )

    class FakeResponse:
        def __iter__(self) -> Iterator[bytes]:
            for line in _chunks(sse):
                yield line.encode("utf-8")

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
                gt.ModelRequest(
                    model="m", messages=(gt.ChatMessage(role="user", content="hi"),)
                )
            )
        ]

    deltas = asyncio.run(collect())
    reasoning = [d.text for d in deltas if isinstance(d, gt.ReasoningDelta)]
    texts = [d.text for d in deltas if isinstance(d, gt.TextDelta)]
    assert reasoning == ["先想"]
    assert texts == ["答案"]


def test_reasoning_content_is_sent_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """DeepSeek thinking mode rejects a follow-up that drops reasoning_content."""
    provider = OpenAICompatProvider(ProviderConfig(base_url="http://x/v1"))
    seen: dict[str, object] = {}

    class EmptyResponse:
        def __iter__(self) -> Iterator[bytes]:
            yield b"data: [DONE]\n"

        def __enter__(self) -> EmptyResponse:
            return self

        def __exit__(self, *args: object) -> None:
            pass

    def fake_urlopen(request: Any, **kwargs: Any) -> EmptyResponse:
        seen["body"] = json.loads(request.data.decode("utf-8"))
        return EmptyResponse()

    monkeypatch.setattr("polyopus.kernel.models.openai_compat.urlopen", fake_urlopen)
    message = gt.ChatMessage(
        role="assistant",
        content="",
        reasoning_content="thinking...",
        tool_calls=(gt.ToolCallMessagePart(
            id="tc1", name="fs.write", arguments_json="{}"),),
    )

    async def run() -> None:
        async for _ in provider.stream(
            gt.ModelRequest(model="m", messages=(message,))
        ):
            pass

    asyncio.run(run())
    wire = seen["body"]
    assert isinstance(wire, dict)
    sent = wire["messages"][0]
    assert sent["reasoning_content"] == "thinking..."
    assert sent["tool_calls"][0]["function"]["name"] == "fs_write"


def test_fake_model_matches_gateway_protocol() -> None:
    async def run() -> None:
        deltas = [
            d
            async for d in FakeModel(chunk_words=2).stream(
                gt.ModelRequest(
                    model="fake",
                    messages=(gt.ChatMessage(role="user", content="a b c d"),),
                )
            )
        ]
        texts = "".join(d.text for d in deltas if isinstance(d, gt.TextDelta))
        assert "echo[a]" in texts and "echo[d]" in texts
        usage = [d for d in deltas if isinstance(d, gt.UsageDelta)][0]
        assert usage.output_tokens >= 2

    asyncio.run(run())


NO_ENV = {"env_base_url": "", "env_api_key": "", "env_model": ""}


def test_registry_falls_back_to_fake(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    m.apply(conn, m.discover(MIGRATIONS))
    registry = Registry(conn, **NO_ENV)
    resolved = registry.resolve(None)
    assert resolved.fake is True
    conn.close()


def test_registry_uses_env_provider_first(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    m.apply(conn, m.discover(MIGRATIONS))
    registry = Registry(conn, env_base_url="http://local/v1", env_model="deepseek-chat")
    resolved = registry.resolve(None)
    assert resolved.fake is False
    assert resolved.model == "deepseek-chat"
    assert resolved.provider_id == "env"
    conn.close()


def test_registry_reads_models_table(tmp_path: Path) -> None:
    conn: sqlite3.Connection = m.connect(tmp_path / "t.db")
    m.apply(conn, m.discover(MIGRATIONS))
    now = 1
    conn.execute(
        "INSERT INTO providers (tenant_id, provider_id, name, kind, base_url, status,"
        " models_json, created_at, updated_at) VALUES ('default','pv_1','local',"
        "'openai_compat','http://local/v1','authorized','[]',?,?)", (now, now))
    conn.execute(
        "INSERT INTO models (model_id, provider_id, name, caps_json) VALUES "
        "('m_1','pv_1','qwen3',?)",
        (json.dumps({"max_input_tokens": 131072, "supports_tools": True}),),
    )
    conn.commit()
    registry = Registry(conn, **NO_ENV)
    resolved = registry.resolve("qwen3")
    assert resolved.fake is False
    assert resolved.caps.max_input_tokens == 131072
    assert resolved.caps.supports_tools is True
    conn.close()
