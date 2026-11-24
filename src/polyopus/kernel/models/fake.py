"""FakeModel: deterministic streaming model for tests/dev (no API key).

Implements the ModelGateway protocol: `stream(ModelRequest)` yields
TextDelta/UsageDelta/FinishDelta so the engine treats it exactly like a real
provider. The legacy `reply()`/`echo_stream()` helpers stay for the older
turn_worker fake runner.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

from polyopus.kernel.models.gateway import (
    FinishDelta,
    ModelCaps,
    ModelDelta,
    ModelRequest,
    TextDelta,
    ToolCallDelta,
    UsageDelta,
)


@dataclass(frozen=True)
class ModelReply:
    text: str
    finish_reason: str = "stop"


class FakeModel:
    """Streams a canned transform of the input; deterministic, no network."""

    def __init__(self, chunk_words: int = 3, delay_seconds: float = 0.0) -> None:
        self.chunk_words = chunk_words
        self.delay_seconds = delay_seconds
        self.calls: list[str] = []
        self._async_started = False
        self._delegate_started = False

    def capabilities(self, model: str) -> ModelCaps:
        return ModelCaps()

    def _prompt_of(self, req: ModelRequest) -> str:
        parts = [m.content for m in req.messages if m.role in ("user", "system")]
        return parts[-1] if parts else ""

    _WRITE_INTENT = re.compile(r"写|保存|write|save", re.IGNORECASE)
    _FILENAME = re.compile(r"[\w.-]+\.(?:txt|md|yml|yaml|py|json)")
    _ASYNC_INTENT = re.compile(r"异步|async", re.IGNORECASE)
    _DELEGATE_INTENT = re.compile(r"委派|子智能体|delegate", re.IGNORECASE)
    _SECONDS = re.compile(r"(\d+(?:\.\d+)?)\s*(?:秒|s\b|sec(?:onds?)?)", re.I)

    def _delegate_call(self, req: ModelRequest) -> ToolCallDelta | None:
        """Simulate a parent that delegates once when the session selected a
        subagent (v1.1 demo/e2e path). The model picks the first enum value."""
        if self._delegate_started:
            return None
        spec = next((tool for tool in req.tools if tool.name == "subagent.delegate"), None)
        if spec is None:
            return None
        prompt = self._prompt_of(req)
        if not self._DELEGATE_INTENT.search(prompt):
            return None
        schema = spec.parameters_json_schema or {}
        properties = schema.get("properties") if isinstance(schema, dict) else None
        agent_schema = properties.get("agent_id") if isinstance(properties, dict) else None
        enum = agent_schema.get("enum") if isinstance(agent_schema, dict) else None
        if not isinstance(enum, list) or not enum:
            return None
        self._delegate_started = True
        return ToolCallDelta(
            id="tc_fake_delegate", name="subagent_delegate",
            arguments_json=json.dumps(
                {"agent_id": str(enum[0]), "task": prompt}, ensure_ascii=False
            ),
        )

    def _sleep_call(self, req: ModelRequest) -> ToolCallDelta | None:
        """Simulate an async tool call (V05-17): "异步 10 秒" -> demo.sleep.
        Only the first tool round starts it; later rounds answer."""
        if self._async_started:
            return None
        if not any(t.name == "demo.sleep" for t in req.tools):
            return None
        prompt = self._prompt_of(req)
        if not self._ASYNC_INTENT.search(prompt):
            return None
        match = self._SECONDS.search(prompt)
        seconds = float(match.group(1)) if match else 1.0
        seconds = min(seconds, 30.0)
        self._async_started = True
        return ToolCallDelta(
            id="tc_fake_sleep", name="demo_sleep",
            arguments_json=json.dumps({"seconds": seconds}),
        )

    def _write_call(self, req: ModelRequest) -> ToolCallDelta | None:
        """Simulate a model that decides to write a file (fs.write is high
        risk, so the policy gate pauses the turn — exercises the approval
        path without a real model)."""
        if not any(t.name == "fs.write" for t in req.tools):
            return None
        if any(message.role == "tool" for message in req.messages):
            return None  # a tool already ran: summarize instead of writing again
        prompt = self._prompt_of(req)
        if not self._WRITE_INTENT.search(prompt):
            return None
        match = self._FILENAME.search(prompt)
        path = match.group(0) if match else "output.txt"
        args = {"path": path, "content": f"# 由请求生成\n{prompt}\n"}
        return ToolCallDelta(
            id="tc_fake_write", name="fs_write",
            arguments_json=json.dumps(args, ensure_ascii=False),
        )

    async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
        prompt = self._prompt_of(req)
        self.calls.append(prompt)
        write = (
            self._delegate_call(req)
            or self._sleep_call(req)
            or self._write_call(req)
        )
        if write is not None:
            yield write
            yield UsageDelta(input_tokens=len(prompt.split()), output_tokens=1)
            yield FinishDelta(reason="tool_calls")
            return
        words = [f"echo[{w}]" for w in prompt.split() or ["empty"]]
        output = 0
        for start in range(0, len(words), self.chunk_words):
            if self.delay_seconds:
                await asyncio.sleep(self.delay_seconds)
            chunk = " ".join(words[start : start + self.chunk_words]) + " "
            output += len(chunk.split())
            yield TextDelta(text=chunk)
        yield UsageDelta(input_tokens=len(prompt.split()), output_tokens=output)
        yield FinishDelta(reason="stop")

    async def echo_stream(self, prompt: str) -> AsyncIterator[str]:
        async for delta in self.stream(ModelRequest(model="fake", messages=())):
            if isinstance(delta, TextDelta):
                yield delta.text

    async def reply(self, prompt: str) -> ModelReply:
        chunks = [chunk async for chunk in self.echo_stream(prompt)]
        return ModelReply(text="".join(chunks))
