"""ModelGateway port + normalized delta types (docs/02 §5.1).

Providers translate vendor SDK/stream shapes into these types. The engine
only ever sees `ModelRequest`/`ModelDelta`/`ModelUsage`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal, Protocol

type FinishReason = Literal["stop", "length", "tool_calls", "error", "cancelled"]


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant", "tool"]
    content: str


@dataclass(frozen=True)
class ReasoningConfig:
    effort: Literal["low", "medium", "high"] = "medium"


@dataclass(frozen=True)
class ModelCaps:
    max_input_tokens: int = 32_000
    max_output_tokens: int = 4_096
    supports_tools: bool = False
    supports_vision: bool = False
    supports_json: bool = False
    cache_style: Literal["anthropic", "openai", "none"] = "none"


@dataclass(frozen=True)
class ModelRequest:
    model: str
    messages: tuple[ChatMessage, ...]
    temperature: float = 0.7
    max_output_tokens: int = 2_048
    response_format: Literal["text", "json_object"] | None = None
    reasoning: ReasoningConfig | None = None
    tenant_id: str = "default"
    trace_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class TextDelta:
    text: str
    kind: ClassVar[str] = "text"


@dataclass(frozen=True)
class UsageDelta:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    kind: ClassVar[str] = "usage"


@dataclass(frozen=True)
class FinishDelta:
    reason: FinishReason
    kind: ClassVar[str] = "finish"


type ModelDelta = TextDelta | UsageDelta | FinishDelta


class ModelGateway(Protocol):
    def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]: ...

    def capabilities(self, model: str) -> ModelCaps: ...


class ModelUnavailableError(RuntimeError):
    """Provider/network/auth failure; carries a stable error code."""

    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.retryable = retryable
