"""V05-14 schedule sources: cron/once/interval, timezone, missed-once,
restart resume, single-writer (G6).

covers: docs/48 V05-14 验收 — 每 5 分钟任务跑 3 次工单 3 张；停机 2 小时后
只补 1 次。The injected clock (`run_due(now=...)`) drives everything: no
sleeping, no wall-clock dependence.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from polyopus.domains.intake import schedule
from polyopus.platform.db import migrator as m
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
TZ_SH = ZoneInfo("Asia/Shanghai")


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    conn = m.connect(tmp_path / "cron.db")
    m.apply(conn, m.discover(MIGRATIONS))
    yield conn
    conn.close()


def _job(conn: sqlite3.Connection, *, schedule_spec: str = "interval:300",
         tz: str = "Asia/Shanghai", text: str = "[定时] 例行巡检",
         name: str = "patrol") -> tuple[str, str]:
    source_id = schedule.create_schedule_source(conn, name=f"{name}-src",
                                                timezone=tz)
    job_id = schedule.upsert_job(conn, source_id=source_id, name=name,
                                 schedule=schedule_spec, timezone=tz, text=text)
    return job_id, source_id


def _tickets(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT count(*) FROM tickets").fetchone()[0])


# ---- 验收: 每 5 分钟任务跑 3 次 → 工单 3 张 ---------------------------------------


def test_interval_job_fires_three_times_three_tickets(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    job_id, _ = _job(env)

    base = int(time.time())
    fired = sum(
        schedule.run_due(env, store, now=base + offset)
        for offset in (301, 601, 901)
    )
    assert fired == 3
    assert _tickets(env) == 3  # one ticket per fire, never a fan-out merge

    runs = env.execute(
        "SELECT status, trigger_id FROM cron_runs WHERE cron_job_id = ?"
        " ORDER BY id", (job_id,),
    ).fetchall()
    assert [r[0] for r in runs] == ["succeeded"] * 3
    assert all(r[1] for r in runs)  # trigger_id backfilled (docs/32 §13A)

    threads = {
        r[0] for r in env.execute(
            "SELECT DISTINCT thread_key FROM triggers WHERE source_id IN ("
            "SELECT source_id FROM sources WHERE kind = 'schedule')"
        ).fetchall()
    }
    assert len(threads) == 3  # schedule:{job}:{date} — unique per fire


def test_two_hour_outage_catches_up_exactly_once(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    job_id, _ = _job(env)
    base = int(time.time())
    assert schedule.run_due(env, store, now=base + 301) == 1  # first tick
    tickets_after_first = _tickets(env)

    # the process was DOWN for two hours: next_run_at is long past due
    assert schedule.run_due(env, store, now=base + 301 + 7200) == 1
    assert _tickets(env) == tickets_after_first + 1  # catch-up fired ONCE

    nxt = env.execute(
        "SELECT next_run_at FROM cron_jobs WHERE cron_job_id = ?", (job_id,),
    ).fetchone()[0]
    assert nxt > base + 301 + 7200  # pushed into the future again
    assert schedule.run_due(env, store, now=base + 301 + 7200 + 1) == 0

    late = env.execute(
        "SELECT payload_json FROM events WHERE type = 'cron.fired'"
        " ORDER BY seq DESC LIMIT 1"
    ).fetchone()
    assert late is not None and __import__("json").loads(late[0])["late"] is True


# ---- timezone & cron expressions ----------------------------------------------------


def test_cron_next_lands_on_local_time_with_explicit_timezone(
    env: sqlite3.Connection,
) -> None:
    spec = schedule.parse_schedule("cron:0 9 * * *")
    # 2026-11-13 01:00 UTC == 09:00 in Shanghai: next after 00:59Z is 09:00 SH
    after = int(datetime(2026, 11, 13, 0, 59, tzinfo=ZoneInfo("UTC")).timestamp())
    nxt = schedule.next_after(spec, TZ_SH, after)
    assert datetime.fromtimestamp(nxt, TZ_SH).hour == 9
    assert datetime.fromtimestamp(nxt, TZ_SH).minute == 0
    # the same instant in UTC is 01:00 — the zone actually shifts the fire
    assert datetime.fromtimestamp(nxt, ZoneInfo("UTC")).hour == 1


def test_cron_dow_weekday_semantics() -> None:
    """cron `0 9 * * 1` = Mondays (0 is Sunday in cron, not python)."""
    spec = schedule.parse_schedule("cron:0 9 * * 1")
    # Friday 2026-11-13 10:00 Shanghai -> next Monday 09:00
    after = int(datetime(2026, 11, 13, 10, 0, tzinfo=TZ_SH).timestamp())
    nxt = schedule.next_after(spec, TZ_SH, after)
    hit = datetime.fromtimestamp(nxt, TZ_SH)
    assert hit.weekday() == 0 and hit.hour == 9 and hit.minute == 0


def test_bad_schedule_and_timezone_rejected(env: sqlite3.Connection) -> None:
    with pytest.raises(AppError):
        schedule.parse_schedule("cron:0 9 * *")  # 4 fields
    with pytest.raises(AppError):
        schedule.parse_schedule("interval:0")
    with pytest.raises(AppError):
        schedule.parse_schedule("every:5m")  # unknown prefix
    with pytest.raises(AppError):
        schedule.timezone_of("Mars/Olympus")


# ---- once / restart resume -----------------------------------------------------------


def test_once_job_fires_then_retires(env: sqlite3.Connection) -> None:
    store = EventStore(env)
    at = int(time.time()) + 3600
    job_id, _ = _job(env, schedule_spec=f"once:{at}")

    assert schedule.run_due(env, store, now=at - 1) == 0  # not yet
    assert schedule.run_due(env, store, now=at) == 1
    assert _tickets(env) == 1
    row = env.execute(
        "SELECT enabled, next_run_at FROM cron_jobs WHERE cron_job_id = ?",
        (job_id,),
    ).fetchone()
    assert row[0] == 0 and row[1] is None  # retired
    assert schedule.run_due(env, store, now=at + 10_000) == 0  # stays quiet


def test_restart_resumes_from_persisted_next_run_at(
    env: sqlite3.Connection, tmp_path: Path,
) -> None:
    store = EventStore(env)
    job_id, _ = _job(env)  # interval:300
    base = int(time.time())
    assert schedule.run_due(env, store, now=base + 301) == 1
    expected = env.execute(
        "SELECT next_run_at FROM cron_jobs WHERE cron_job_id = ?", (job_id,),
    ).fetchone()[0]

    # a brand-new connection (fresh process) sees the same next_run_at and
    # does not double-fire before it is due
    db = tmp_path / "cron.db"
    fresh = m.connect(db)
    try:
        assert schedule.run_due(fresh, EventStore(fresh),
                                now=expected - 1) == 0
        assert schedule.run_due(fresh, EventStore(fresh), now=expected) == 1
    finally:
        fresh.close()
    assert _tickets(env) == 2


# ---- single writer under two schedulers ----------------------------------------------


def test_two_concurrent_schedulers_fire_a_due_job_once(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    _job(env)
    base = int(time.time()) + 10_000
    env.execute("UPDATE cron_jobs SET next_run_at = ?", (base - 60,))
    env.commit()

    fired: list[int] = []
    barrier = threading.Barrier(2)

    def racer() -> None:
        barrier.wait()
        fired.append(schedule.run_due(env, store, now=base))

    threads = [threading.Thread(target=racer) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)

    assert sum(fired) == 1  # the CAS claim picked one winner
    assert _tickets(env) == 1


# ---- the scheduled trigger rides the normal intake pipeline -------------------------


def test_scheduled_trigger_opens_ticket_through_the_gate(
    env: sqlite3.Connection,
) -> None:
    store = EventStore(env)
    job_id, source_id = _job(env)
    base = int(time.time())
    assert schedule.run_due(env, store, now=base + 301) == 1

    row = env.execute(
        "SELECT t.strength, t.source_id, m.matched_rules_json FROM tickets t"
        " JOIN mandates m ON m.ticket_id = t.ticket_id",
    ).fetchone()
    assert row[0] == "explicit"  # gate:explicit — the job IS the signal
    assert row[1] == source_id
    import json as _json
    assert _json.loads(row[2]) == ["gate:explicit"]
    kinds = {r[0] for r in env.execute(
        "SELECT type FROM events").fetchall()}
    assert "cron.fired" in kinds and "trigger.received" in kinds
    assert "ticket.opened" in kinds
