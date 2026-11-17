"""Prometheus metrics with a strict label whitelist (V1-08).

Prometheus text is rendered by hand instead of pulling a client library: the
set of metrics is small, and hand-rendering keeps label sets explicit (no
ticket ids, paths or user text can leak into labels).
"""

from __future__ import annotations

import math
import threading
from collections import defaultdict
from dataclasses import dataclass, field

_LABEL_WHITELIST = {
    "result", "tool", "queue", "direction", "slo", "status", "model",
}
_BUCKETS = (0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0)

SLO_TARGETS = {
    "turn_success": 0.995,
    "turn_latency_p95": 0.95,
    "tool_success": 0.99,
    "queue_freshness": 0.99,
    "budget_compliance": 0.99,
}

_KNOWN_COUNTERS = (
    "poly_turn_finished_total", "poly_tool_calls_total",
    "poly_usage_tokens_total", "poly_usage_cost_micros_total",
)
_KNOWN_HISTOGRAMS = ("poly_turn_duration_seconds",)
_KNOWN_GAUGES = ("poly_queue_depth", "poly_slo_target_ratio")
_KNOWN_TOOLS = frozenset({"fs.read", "fs.write", "demo.sleep"})


@dataclass
class _Histogram:
    counts: list[int] = field(default_factory=lambda: [0] * len(_BUCKETS))
    total: float = 0.0
    count: int = 0


_lock = threading.Lock()
_counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = defaultdict(float)
_gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
_histograms: dict[tuple[str, tuple[tuple[str, str], ...]], _Histogram] = {}


def _labels(labels: dict[str, str]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted(
        (key, str(value)) for key, value in labels.items()
        if key in _LABEL_WHITELIST
    ))


def counter(name: str, value: float = 1, **labels: str) -> None:
    with _lock:
        _counters[(name, _labels(labels))] += value


def set_counter(name: str, value: float, **labels: str) -> None:
    """Absolute counter value for DB-derived totals (usage)."""
    with _lock:
        _counters[(name, _labels(labels))] = value


def gauge(name: str, value: float, **labels: str) -> None:
    with _lock:
        _gauges[(name, _labels(labels))] = value


def observe(name: str, value: float, **labels: str) -> None:
    key = (name, _labels(labels))
    with _lock:
        hist = _histograms.setdefault(key, _Histogram())
        hist.count += 1
        hist.total += value
        for index, bound in enumerate(_BUCKETS):
            if value <= bound:
                hist.counts[index] += 1


def turn_finished(result: str, duration_seconds: float) -> None:
    counter("poly_turn_finished_total", result=result)
    observe("poly_turn_duration_seconds", duration_seconds)


def tool_call(tool: str, result: str) -> None:
    safe_tool = tool if tool in _KNOWN_TOOLS else "other"
    counter("poly_tool_calls_total", tool=safe_tool, result=result)


def _format_labels(labels: tuple[tuple[str, str], ...]) -> str:
    if not labels:
        return ""
    inner = ",".join(
        f'{key}="{value.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"'
        for key, value in labels
    )
    return "{" + inner + "}"


def _sample(name: str, labels: tuple[tuple[str, str], ...], value: float) -> str:
    if math.isnan(value):
        rendered = "NaN"
    elif math.isinf(value):
        rendered = "+Inf" if value > 0 else "-Inf"
    else:
        rendered = f"{value:g}"
    return f"{name}{_format_labels(labels)} {rendered}"


def render() -> str:
    """Prometheus text format; stable ordering makes scraping diffable."""
    with _lock:
        counters = dict(_counters)
        gauges = dict(_gauges)
        histograms = {key: _Histogram(
            counts=list(value.counts), total=value.total, count=value.count,
        ) for key, value in _histograms.items()}

    lines: list[str] = []
    counter_names = sorted(
        set(_KNOWN_COUNTERS) | {name for name, _ in counters}
    )
    for name in counter_names:
        lines.append(f"# HELP {name} counter")
        lines.append(f"# TYPE {name} counter")
        samples = sorted(
            (labels, value) for (metric, labels), value in counters.items()
            if metric == name
        )
        if not samples:
            lines.append(f"{name} 0")
        for labels, value in samples:
            lines.append(_sample(name, labels, value))

    histogram_names = sorted(
        set(_KNOWN_HISTOGRAMS) | {name for name, _ in histograms}
    )
    for name in histogram_names:
        lines.append(f"# HELP {name} histogram")
        lines.append(f"# TYPE {name} histogram")
        hist_samples = sorted(
            (labels, value) for (metric, labels), value in histograms.items()
            if metric == name
        )
        if not hist_samples:
            for bound in _BUCKETS:
                lines.append(_sample(
                    f"{name}_bucket", (("le", f"{bound:g}"),), 0
                ))
            lines.append(_sample(f"{name}_bucket", (("le", "+Inf"),), 0))
            lines.append(_sample(f"{name}_sum", (), 0))
            lines.append(_sample(f"{name}_count", (), 0))
        for labels, hist in hist_samples:
            for bound, count in zip(_BUCKETS, hist.counts, strict=True):
                bucket_labels = (*labels, ("le", f"{bound:g}"))
                lines.append(_sample(f"{name}_bucket", bucket_labels, count))
            lines.append(_sample(
                f"{name}_bucket", (*labels, ("le", "+Inf")), hist.count
            ))
            lines.append(_sample(f"{name}_sum", labels, hist.total))
            lines.append(_sample(f"{name}_count", labels, hist.count))

    gauge_names = sorted(set(_KNOWN_GAUGES) | {name for name, _ in gauges})
    for name in gauge_names:
        lines.append(f"# HELP {name} gauge")
        lines.append(f"# TYPE {name} gauge")
        samples = sorted(
            (labels, value) for (metric, labels), value in gauges.items()
            if metric == name
        )
        for labels, value in samples:
            lines.append(_sample(name, labels, value))

    return "\n".join(lines) + "\n"


def reset() -> None:
    """Test helper: clear samples (SLO gauges are restored by `set_slo_targets`)."""
    with _lock:
        _counters.clear()
        _gauges.clear()
        _histograms.clear()
    set_slo_targets()


def set_slo_targets() -> None:
    for slo, target in SLO_TARGETS.items():
        gauge("poly_slo_target_ratio", target, slo=slo)


set_slo_targets()
