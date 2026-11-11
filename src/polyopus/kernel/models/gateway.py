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
class ToolCallMessagePart:
    """Assistant-message tool call (OpenAI shape)."""

    id: str
    name: str
    arguments_json: str


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tool_calls: tuple[ToolCallMessagePart, ...] = ()
    tool_call_id: str | None = None
    # DeepSeek thinking models require the assistant reasoning to be passed
    # back on the next turn, including when the message carries tool calls.
    reasoning_content: str | None = None


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
class ToolSpec:
    """OpenAI function-tool shape; providers translate as needed."""

    name: str
    description: str
    parameters_json_schema: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ModelRequest:
    model: str
    messages: tuple[ChatMessage, ...]
    temperature: float = 0.7
    max_output_tokens: int = 2_048
    response_format: Literal["text", "json_object"] | None = None
    reasoning: ReasoningConfig | None = None
    tools: tuple[ToolSpec, ...] = ()
    tenant_id: str = "default"
    trace_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class TextDelta:
    text: str
    kind: ClassVar[str] = "text"


@dataclass(frozen=True)
class ReasoningDelta:
    """Thinking-model reasoning stream; kept out of the user-visible message."""

    text: str
    kind: ClassVar[str] = "reasoning"


@dataclass(frozen=True)
class ToolCallDelta:
    """One complete tool call (providers accumulate streamed fragments)."""

    id: str
    name: str
    arguments_json: str
    kind: ClassVar[str] = "tool_call"


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


type ModelDelta = TextDelta | ReasoningDelta | ToolCallDelta | UsageDelta | FinishDelta


class ModelGateway(Protocol):
    def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]: ...

    def capabilities(self, model: str) -> ModelCaps: ...


class ModelUnavailableError(RuntimeError):
    """Provider/network/auth failure; carries a stable error code."""

    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.retryable = retryable
