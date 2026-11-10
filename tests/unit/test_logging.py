"""M0-20: JSON logs carry trace_id and structured fields."""

from __future__ import annotations

import io
import json
import logging

from polyopus.platform.telemetry import log as tlog


def test_json_log_contains_trace_and_fields() -> None:
    buf = io.StringIO()
    tlog.configure(level="INFO", stream=buf)
    trace_id = tlog.new_trace_id()
    tlog.set_trace_id(trace_id)
    try:
        tlog.log(tlog.get_logger("test"), logging.INFO, "turn.started", turn_id="tu1")
    finally:
        tlog.set_trace_id(None)

    payload = json.loads(buf.getvalue().strip())
    assert payload["trace_id"] == trace_id
    assert payload["event"] == "turn.started"
    assert payload["turn_id"] == "tu1"
    assert payload["level"] == "INFO"
    assert payload["ts"].endswith("Z")


def test_log_without_trace_omits_field() -> None:
    buf = io.StringIO()
    tlog.configure(level="INFO", stream=buf)
    tlog.set_trace_id(None)
    tlog.log(tlog.get_logger("test"), logging.WARNING, "no.trace")

    payload = json.loads(buf.getvalue().strip())
    assert "trace_id" not in payload
    assert payload["event"] == "no.trace"


def test_no_secret_like_fields_added() -> None:
    buf = io.StringIO()
    tlog.configure(level="INFO", stream=buf)
    tlog.set_trace_id(None)
    tlog.log(tlog.get_logger("test"), logging.INFO, "safe", tenant_id="default")

    payload = json.loads(buf.getvalue().strip())
    assert set(payload) == {"ts", "level", "logger", "event", "tenant_id"}
