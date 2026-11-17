"""Prometheus `/metrics` endpoint (V1-08).

Unauthenticated like the standard scrape endpoint, but it only exposes
aggregate counters/gauges; no ticket/user identifiers are labels.
"""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from polyopus.api.deps import get_db
from polyopus.platform.observability import metrics

router = APIRouter(tags=["observability"])


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
def prometheus_metrics(conn: Connection = Depends(get_db)) -> PlainTextResponse:
    turns = conn.execute(
        "SELECT count(*) FROM turns WHERE status IN"
        " ('queued', 'picking', 'running', 'waiting_approval')"
    ).fetchone()[0]
    outbox = conn.execute(
        "SELECT count(*) FROM outbox WHERE status = 'pending'"
    ).fetchone()[0]
    attentions = conn.execute(
        "SELECT count(*) FROM attentions WHERE status = 'pending'"
    ).fetchone()[0]
    metrics.gauge("poly_queue_depth", float(turns), queue="turns")
    metrics.gauge("poly_queue_depth", float(outbox), queue="outbox")
    metrics.gauge("poly_queue_depth", float(attentions), queue="attentions")

    usage = conn.execute(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),"
        " COALESCE(SUM(cost_micros), 0) FROM usage_ledger"
    ).fetchone()
    metrics.set_counter(
        "poly_usage_tokens_total", float(usage[0]), direction="input"
    )
    metrics.set_counter(
        "poly_usage_tokens_total", float(usage[1]), direction="output"
    )
    metrics.set_counter("poly_usage_cost_micros_total", float(usage[2]))
    return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")
