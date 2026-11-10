"""M1-04: spans are created, attributes recorded, logs inherit trace id."""

from __future__ import annotations

from polyopus.platform.telemetry import log as tlog
from polyopus.platform.telemetry import tracing


def test_span_records_attributes_and_binds_log_trace() -> None:
    exporter = tracing.memory_exporter()
    tracing.configure(exporter=exporter)
    tlog.set_trace_id(None)
    try:
        with tracing.span("turn.run", turn_id="tu1") as current:
            tid = tlog.get_trace_id()
            assert tid is not None
            assert len(tid) == 32
            current.set_attribute("steps", 3)
    finally:
        tlog.set_trace_id(None)
        tracing.reset()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "turn.run"
    assert spans[0].attributes is not None
    assert spans[0].attributes["turn_id"] == "tu1"
    assert spans[0].attributes["steps"] == 3


def test_span_restores_previous_trace_id() -> None:
    exporter = tracing.memory_exporter()
    tracing.configure(exporter=exporter)
    tlog.set_trace_id("tr_previous")
    try:
        with tracing.span("x"):
            assert tlog.get_trace_id() != "tr_previous"
        assert tlog.get_trace_id() == "tr_previous"
    finally:
        tlog.set_trace_id(None)
        tracing.reset()


def test_no_span_means_no_trace_id() -> None:
    tracing.reset()
    assert tracing.current_trace_id() is None
