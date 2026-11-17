"""V1-08: /metrics groups, SLO gauges, label whitelist, trace sampling."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.observability import metrics
from polyopus.platform.telemetry import tracing

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "admin-pw"


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    metrics.reset()
    db = tmp_path / "obs.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    now = int(time.time())
    conn.execute(
        "INSERT INTO turns (tenant_id, turn_id, thread_id, status, mode, seq,"
        " created_at, updated_at) VALUES ('default', 'tu_q', 'th_q', 'queued',"
        " 'act', 1, ?, ?)", (now, now),
    )
    conn.execute(
        "INSERT INTO usage_ledger (tenant_id, entry_id, turn_id, model,"
        " input_tokens, output_tokens, cost_micros, created_at) VALUES"
        " ('default', 'ul_1', 'tu_q', 'deepseek-flash', 100, 50, 42, ?)",
        (now,),
    )
    conn.commit()
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    with TestClient(create_app(settings)) as c:
        yield c


def test_metrics_contains_four_groups_and_slo_targets(client: TestClient) -> None:
    metrics.turn_finished("completed", 0.4)
    metrics.tool_call("fs.read", "ok")
    response = client.get("/metrics")
    assert response.status_code == 200, response.text
    text = response.text
    assert "poly_turn_finished_total" in text
    assert "poly_turn_duration_seconds_bucket" in text
    assert "poly_tool_calls_total" in text
    assert 'poly_queue_depth{queue="turns"}' in text
    assert 'poly_usage_tokens_total{direction="input"} 100' in text
    assert 'poly_usage_tokens_total{direction="output"} 50' in text
    assert "poly_usage_cost_micros_total 42" in text
    assert text.count('poly_slo_target_ratio{slo="') == 5
    assert text.count("# TYPE") >= 7


def test_metric_labels_are_whitelisted() -> None:
    metrics.reset()
    metrics.counter(
        "poly_tool_calls_total", tool="read_file", result="ok",
        ticket_id="tk_secret", user_id="us_secret",
    )
    text = metrics.render()
    assert 'tool="read_file"' in text
    assert "tk_secret" not in text
    assert "us_secret" not in text
    metrics.reset()


def test_trace_sampling_always_keeps_risky_spans() -> None:
    assert tracing.should_sample(error=True, random_value=0.99)
    assert tracing.should_sample(approval=True, random_value=0.99)
    assert tracing.should_sample(deny=True, random_value=0.99)
    assert tracing.should_sample(duration_ms=1500, random_value=0.99)
    assert not tracing.should_sample(random_value=0.99, ratio=0.1)
    assert tracing.should_sample(random_value=0.01, ratio=0.1)
