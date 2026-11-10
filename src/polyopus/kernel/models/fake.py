"""FakeModel: deterministic streaming model for tests/dev (no API key).

Emits word-by-word deltas so the SSE path, approval pause and resume can be
exercised end-to-end. Chunk size/delay are configurable.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelReply:
    text: str
    finish_reason: str = "stop"


class FakeModel:
    """Replies with a canned transform of the input; streams by chunk."""

    def __init__(self, chunk_words: int = 3, delay_seconds: float = 0.0) -> None:
        self.chunk_words = chunk_words
        self.delay_seconds = delay_seconds
        self.calls: list[str] = []

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        self.calls.append(prompt)
        words = [
            f"echo[{w}]" for w in prompt.split() or ["empty"]
        ]
        for start in range(0, len(words), self.chunk_words):
            if self.delay_seconds:
                await asyncio.sleep(self.delay_seconds)
            yield " ".join(words[start : start + self.chunk_words]) + " "

    async def reply(self, prompt: str) -> ModelReply:
        chunks = [chunk async for chunk in self.stream(prompt)]
        return ModelReply(text="".join(chunks))
