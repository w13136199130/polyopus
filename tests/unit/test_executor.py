"""M1 pre-work: Report must be structured; events expose a stable kind."""

from __future__ import annotations

from pathlib import Path

import pytest

from polyopus.kernel.executor import (
    Delta,
    ExecutionContext,
    ExecutorCaps,
    Heartbeat,
    MandateRef,
    Report,
    ReportEvent,
    WaitingOn,
)

ROOT = Path(__file__).resolve().parents[2]


def test_waiting_requires_structured_question() -> None:
    with pytest.raises(ValueError, match="WAITING_REQUIRES_STRUCTURED_QUESTION"):
        Report(state="waiting", summary="need confirmation")


def test_waiting_with_structured_question_is_valid() -> None:
    report = Report(
        state="waiting",
        summary="need approval",
        waiting_on=WaitingOn(kind="approval", question="Allow write to src/?"),
    )
    assert report.waiting_on is not None
    assert report.waiting_on.kind == "approval"


def test_progress_bounds() -> None:
    with pytest.raises(ValueError):
        Report(state="progress", summary="x", progress=1.5)
    assert Report(state="progress", summary="x", progress=0.5).progress == 0.5


def test_event_kinds_are_stable() -> None:
    assert Delta(content="hi").kind == "delta"
    assert ReportEvent(report=Report(state="ready", summary="done")).kind == "report"
    assert Heartbeat(at=1).kind == "heartbeat"


def test_execution_context_keeps_mandate_slice() -> None:
    ctx = ExecutionContext(
        tenant_id="default",
        turn_id="tu1",
        ticket_id="tk1",
        workspace=ROOT,
        trace_id="tr_1",
        mandate=MandateRef(ticket_id="tk1", policy_version=3, scope=("path:src",)),
    )
    assert ctx.mandate is not None
    assert ctx.mandate.scope == ("path:src",)


def test_default_caps_are_conservative() -> None:
    caps = ExecutorCaps()
    assert (caps.streaming, caps.tools, caps.approvals) == (False, False, False)
    assert caps.event_granularity == "step"
