"""Executor port (M1 pre-work, docs/32 §6).

Kernel-pure: stdlib only, no platform/domain imports. External executors
(Codex / Claude Code / DSH) implement the same protocol and may only influence
a Ticket through `report()`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Literal, Protocol

type ExecutorKind = Literal["builtin", "codex", "claude_code", "dsh"]
type ExecutorState = Literal["progress", "waiting", "ready", "blocked", "failed", "dropped"]
type EventGranularity = Literal["token", "step", "event"]


@dataclass(frozen=True)
class Artifact:
    kind: str
    url: str | None = None
    ref: str | None = None


@dataclass(frozen=True)
class Usage:
    tokens: int = 0
    cost_micros: int = 0


@dataclass(frozen=True)
class WaitingOn:
    """Structured question. Free-text parsing is forbidden (docs/32 §13B)."""

    kind: Literal["approval", "question"]
    question: str
    options: tuple[str, ...] = ()
    blocking: bool = True


@dataclass(frozen=True)
class Report:
    state: ExecutorState
    summary: str
    progress: float = 0.0
    facts: Mapping[str, Any] = field(default_factory=dict)
    artifacts: tuple[Artifact, ...] = ()
    usage: Usage = field(default_factory=Usage)
    waiting_on: WaitingOn | None = None

    def __post_init__(self) -> None:
        if not 0.0 <= self.progress <= 1.0:
            raise ValueError("progress must be within [0, 1]")
        if self.state == "waiting" and self.waiting_on is None:
            raise ValueError("WAITING_REQUIRES_STRUCTURED_QUESTION")


@dataclass(frozen=True)
class Delta:
    content: str
    kind: ClassVar[str] = "delta"


@dataclass(frozen=True)
class Reasoning:
    content: str
    kind: ClassVar[str] = "reasoning"


@dataclass(frozen=True)
class ToolCall:
    tool_key: str
    args: Mapping[str, Any] = field(default_factory=dict)
    kind: ClassVar[str] = "tool_call"


@dataclass(frozen=True)
class ToolResult:
    ref: str
    artifacts: tuple[Artifact, ...] = ()
    kind: ClassVar[str] = "tool_result"


@dataclass(frozen=True)
class Progress:
    pct: float
    summary: str = ""
    kind: ClassVar[str] = "progress"


@dataclass(frozen=True)
class Heartbeat:
    at: int
    kind: ClassVar[str] = "heartbeat"


@dataclass(frozen=True)
class ReportEvent:
    report: Report
    kind: ClassVar[str] = "report"


@dataclass(frozen=True)
class ErrorEvent:
    code: str
    retryable: bool = False
    message: str = ""
    kind: ClassVar[str] = "error"


type ExecutorEvent = (
    Delta | Reasoning | ToolCall | ToolResult | Progress | Heartbeat | ReportEvent | ErrorEvent
)


@dataclass(frozen=True)
class MandateRef:
    """The slice of a Mandate an executor is allowed to see."""

    ticket_id: str
    policy_version: int
    scope: tuple[str, ...] = ()


@dataclass(frozen=True)
class ExecutionContext:
    tenant_id: str
    turn_id: str
    ticket_id: str | None
    workspace: Path
    trace_id: str
    mandate: MandateRef | None = None
    budget_micros: int | None = None


@dataclass(frozen=True)
class ExecutorCaps:
    streaming: bool = False
    tools: bool = False
    approvals: bool = False
    event_granularity: EventGranularity = "step"


class Executor(Protocol):
    kind: ClassVar[ExecutorKind]

    def execute(self, ctx: ExecutionContext) -> AsyncIterator[ExecutorEvent]: ...

    def resume(self, run_id: str) -> AsyncIterator[ExecutorEvent]: ...

    async def cancel(self, run_id: str) -> None: ...

    def capabilities(self) -> ExecutorCaps: ...
