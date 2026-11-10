"""Minimal OpenTelemetry tracing (M1-04).

A tracer is created from a local provider (not the global singleton) so tests
can install an in-memory exporter without fighting OTel's one-time setup.
Logs pick up the active span's trace id automatically.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from polyopus.platform.telemetry import log as tlog

_tracer: trace.Tracer | None = None
_provider: TracerProvider | None = None


def configure(
    service_name: str = "polyopus",
    exporter: Any | None = None,
) -> TracerProvider:
    """(Re)create the tracer. Pass an exporter for tests or OTLP wiring."""
    global _tracer, _provider
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    if exporter is not None:
        provider.add_span_processor(SimpleSpanProcessor(exporter))
    _provider = provider
    _tracer = provider.get_tracer("polyopus")
    return provider


def get_tracer() -> trace.Tracer:
    if _tracer is None:
        configure()
    assert _tracer is not None
    return _tracer


def current_trace_id() -> str | None:
    span = trace.get_current_span()
    ctx = span.get_span_context()
    if not ctx.is_valid:
        return None
    return format(ctx.trace_id, "032x")


@contextmanager
def span(name: str, **attributes: Any) -> Iterator[trace.Span]:
    """Start a span and bind its trace id to structured logs."""
    previous = tlog.get_trace_id()
    with get_tracer().start_as_current_span(name) as current:
        for key, value in attributes.items():
            current.set_attribute(key, value)
        ctx = current.get_span_context()
        if ctx.is_valid:
            tlog.set_trace_id(format(ctx.trace_id, "032x"))
        try:
            yield current
        finally:
            tlog.set_trace_id(previous)


def reset() -> None:
    global _tracer, _provider
    _tracer = None
    _provider = None


def memory_exporter() -> InMemorySpanExporter:
    return InMemorySpanExporter()
