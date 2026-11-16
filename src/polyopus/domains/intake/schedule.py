"""Schedule sources: cron/once/interval jobs that fire Triggers (V05-14).

ADR-004: cron IS an intake source (kind='schedule'); a due job re-enters the
SAME intake pipeline as webhooks (receive -> gate -> ticket), so subscriptions,
assessment, budgets and outbound replies all apply unchanged. Each fire gets
its own event thread — thread_key = `schedule:{job}:{date}` (docs/09 §2.5) —
which means one ticket per fire, never a fan-out merge.

Timing rules (docs/48 G6 / ADR-004): DB time only (no system cron — Windows
precision is untrusted), single-writer via a CAS claim on next_run_at (a
second scheduler loses the UPDATE), and a missed window fires exactly once —
the single next_run_at column has no backlog to replay. `run_due(now=...)`
takes an injected clock: tests drive schedules in milliseconds, the loop
passes DB time.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from polyopus.domains.intake import service as intake
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

TENANT = "default"
SCHEDULER_ACTOR = "scheduler"
CRON_SCAN_LIMIT_MINUTES = 2 * 24 * 60  # cap the next-match scan at 2 days


# ---- schedule grammar: cron:<expr> | interval:<seconds> | once:<epoch> --------


@dataclass(frozen=True)
class ScheduleSpec:
    kind: str  # cron | interval | once
    cron: tuple[set[int], set[int], set[int], set[int], set[int]] | None = None
    interval_seconds: int = 0
    once_at: int = 0


def _parse_field(token: str, low: int, high: int) -> set[int]:
    values: set[int] = set()
    for part in token.split(","):
        step = 1
        if "/" in part:
            part, raw_step = part.split("/", 1)
            step = int(raw_step)
            if step <= 0:
                raise ValueError(f"bad step in {token}")
        if part == "*":
            start, end = low, high
        elif "-" in part:
            raw_start, raw_end = part.split("-", 1)
            start, end = int(raw_start), int(raw_end)
        else:
            start = end = int(part)
        if start < low or end > high or start > end:
            raise ValueError(f"{token} out of range {low}-{high}")
        values.update(range(start, end + 1, step))
    if not values:
        raise ValueError(f"empty field {token}")
    return values


def parse_schedule(spec: str) -> ScheduleSpec:
    try:
        kind, _, rest = spec.partition(":")
        if kind == "cron":
            fields = rest.split()
            if len(fields) != 5:
                raise ValueError("cron needs exactly 5 fields")
            ranges = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 6))
            parsed = tuple(
                _parse_field(field, low, high)
                for field, (low, high) in zip(fields, ranges, strict=True)
            )
            cron: tuple[set[int], set[int], set[int], set[int], set[int]] = (
                parsed[0], parsed[1], parsed[2], parsed[3], parsed[4],
            )
            return ScheduleSpec("cron", cron=cron)
        if kind == "interval":
            seconds = int(rest)
            if seconds <= 0:
                raise ValueError("interval must be positive")
            return ScheduleSpec("interval", interval_seconds=seconds)
        if kind == "once":
            return ScheduleSpec("once", once_at=int(rest))
    except ValueError as exc:
        raise AppError("VALIDATION_FAILED",
                       details={"field": "schedule", "reason": str(exc)}) from exc
    raise AppError("VALIDATION_FAILED",
                   details={"field": "schedule",
                            "reason": "use cron:/interval:/once: prefix"})


def next_after(spec: ScheduleSpec, tz: ZoneInfo, after: int,
               *, previous: int | None = None) -> int | None:
    """Next fire time strictly after `after`. `previous` anchors interval
    cadence (the last scheduled tick, not wall now) and is pushed forward
    arithmetically — a 2h outage of a 5-min job catches up exactly once."""
    if spec.kind == "interval":
        base = previous if previous is not None and previous > 0 else after
        nxt = base + spec.interval_seconds
        while nxt <= after:
            nxt += spec.interval_seconds
        return nxt
    if spec.kind == "once":
        return spec.once_at if spec.once_at > after else None
    assert spec.cron is not None
    minute, hour, dom, month, dow = spec.cron
    local = datetime.fromtimestamp(after, tz).replace(second=0, microsecond=0)
    local += timedelta(minutes=1)

    def _cron_dow(dt: datetime) -> int:
        # cron: 0=Sunday..6=Saturday; datetime.weekday(): Monday=0..Sunday=6
        return (dt.weekday() + 1) % 7

    for _ in range(CRON_SCAN_LIMIT_MINUTES):
        day_ok = local.day in dom and local.month in month and _cron_dow(local) in dow
        if day_ok and local.minute in minute and local.hour in hour:
            return int(local.timestamp())
        # day-level mismatches: jump to next local midnight instead of
        # scanning every minute of a day that cannot match
        if not day_ok:
            local = (local + timedelta(days=1)).replace(hour=0, minute=0)
        else:
            local += timedelta(minutes=1)
    return None  # unreachable schedule (e.g. Feb 30): job stays parked


def timezone_of(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise AppError("VALIDATION_FAILED",
                       details={"field": "timezone", "reason": f"unknown {name}"}
                       ) from exc


# ---- job storage ------------------------------------------------------------------


def upsert_job(
    conn: sqlite3.Connection, *, source_id: str, name: str, schedule: str,
    timezone: str, text: str, tenant_id: str = TENANT,
) -> str:
    """Create (or re-arm) a job against a kind='schedule' source. The next
    fire is computed from now; `payload_json` carries the source link and the
    trigger text (cron_jobs has no source column — docs/31 DDL is fixed)."""
    spec = parse_schedule(schedule)
    tz = timezone_of(timezone)
    now = int(time.time())
    nxt = next_after(spec, tz, now)
    cron_job_id = "cj_" + secrets.token_hex(8)
    conn.execute(
        """
        INSERT INTO cron_jobs
          (cron_job_id, tenant_id, name, schedule, timezone, action,
           payload_json, enabled, next_run_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'notify', ?, 1, ?, ?)
        """,
        (cron_job_id, tenant_id, name, schedule, timezone,
         json.dumps({"source_id": source_id, "text": text}, ensure_ascii=False),
         nxt, now),
    )
    conn.commit()
    return cron_job_id


def create_schedule_source(
    conn: sqlite3.Connection, *, name: str, timezone: str,
    tenant_id: str = TENANT,
) -> str:
    """A kind='schedule' source whose Gate config admits the scheduler actor
    and needs no explicit pattern: the job's existence IS the explicit signal."""
    timezone_of(timezone)  # fail fast on a bad zone
    source_id = "src_" + secrets.token_hex(8)
    now = int(time.time())
    conn.execute(
        "INSERT INTO sources (tenant_id, source_id, kind, name, config_json,"
        " status, created_at, updated_at) VALUES (?, ?, 'schedule', ?, ?,"
        " 'active', ?, ?)",
        (tenant_id, source_id, name,
         json.dumps({"secret": "", "allow_actors": [SCHEDULER_ACTOR],
                     "explicit_patterns": [], "timezone": timezone}),
         now, now),
    )
    conn.commit()
    return source_id


# ---- job read/manage surface (V05-20) ---------------------------------------


def _job_sql(where: str = "1=1") -> str:
    return (
        "SELECT j.*, s.name AS source_name, s.status AS source_status, "
        "json_extract(j.payload_json, '$.source_id') AS source_id, "
        "json_extract(j.payload_json, '$.text') AS text "
        "FROM cron_jobs j LEFT JOIN sources s "
        "ON s.source_id = json_extract(j.payload_json, '$.source_id') "
        f"WHERE j.tenant_id = ? AND {where}"
    )


def job_view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "cronJobId": row["cron_job_id"],
        "sourceId": row["source_id"],
        "sourceName": row["source_name"],
        "sourceStatus": row["source_status"],
        "name": row["name"],
        "schedule": row["schedule"],
        "timezone": row["timezone"],
        "text": row["text"] or "",
        "enabled": bool(row["enabled"]),
        "nextRunAt": row["next_run_at"],
        "lastRunAt": row["last_run_at"],
        "createdAt": row["created_at"],
    }


def list_jobs(
    conn: sqlite3.Connection, tenant_id: str = TENANT
) -> list[dict[str, Any]]:
    rows = conn.execute(
        _job_sql() + " ORDER BY j.id DESC", (tenant_id,)
    ).fetchall()
    return [job_view(row) for row in rows]


def job(
    conn: sqlite3.Connection, cron_job_id: str, tenant_id: str = TENANT
) -> dict[str, Any] | None:
    row = conn.execute(
        _job_sql("j.cron_job_id = ?"), (tenant_id, cron_job_id)
    ).fetchone()
    return job_view(row) if row is not None else None


def latest_job_for_source(
    conn: sqlite3.Connection, source_id: str, tenant_id: str = TENANT
) -> dict[str, Any] | None:
    row = conn.execute(
        _job_sql("json_extract(j.payload_json, '$.source_id') = ?")
        + " ORDER BY j.id DESC LIMIT 1",
        (tenant_id, source_id),
    ).fetchone()
    return job_view(row) if row is not None else None


def set_enabled(
    conn: sqlite3.Connection, cron_job_id: str, enabled: bool,
    tenant_id: str = TENANT,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM cron_jobs WHERE tenant_id = ? AND cron_job_id = ?",
        (tenant_id, cron_job_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND")
    next_run = row["next_run_at"]
    if enabled and next_run is None:
        spec = parse_schedule(str(row["schedule"]))
        next_run = next_after(spec, timezone_of(str(row["timezone"])), int(time.time()))
    conn.execute(
        "UPDATE cron_jobs SET enabled = ?, next_run_at = ? WHERE cron_job_id = ?",
        (1 if enabled else 0, next_run, cron_job_id),
    )
    source_id = json.loads(row["payload_json"] or "{}").get("source_id")
    if source_id:
        conn.execute(
            "UPDATE sources SET status = ?, updated_at = ? WHERE source_id = ?",
            ("active" if enabled else "paused", int(time.time()), str(source_id)),
        )
    conn.commit()
    view = job(conn, cron_job_id, tenant_id)
    assert view is not None
    return view


def delete_job(
    conn: sqlite3.Connection, cron_job_id: str, tenant_id: str = TENANT
) -> None:
    row = conn.execute(
        "SELECT payload_json FROM cron_jobs WHERE tenant_id = ? AND cron_job_id = ?",
        (tenant_id, cron_job_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND")
    source_id = json.loads(row["payload_json"] or "{}").get("source_id")
    conn.execute(
        "DELETE FROM cron_jobs WHERE tenant_id = ? AND cron_job_id = ?",
        (tenant_id, cron_job_id),
    )
    if source_id:
        conn.execute(
            "DELETE FROM sources WHERE tenant_id = ? AND source_id = ?",
            (tenant_id, str(source_id)),
        )
    conn.commit()


def runs(
    conn: sqlite3.Connection, cron_job_id: str, tenant_id: str = TENANT
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM cron_runs WHERE tenant_id = ? AND cron_job_id = ? "
        "ORDER BY scheduled_at DESC LIMIT 50",
        (tenant_id, cron_job_id),
    ).fetchall()
    return [
        {
            "runId": row["run_id"],
            "status": row["status"],
            "scheduledAt": row["scheduled_at"],
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
            "error": row["error"],
            "triggerId": row["trigger_id"],
        }
        for row in rows
    ]


# ---- the tick -----------------------------------------------------------------------


def run_due(conn: sqlite3.Connection, store: EventStore, *,
            now: int | None = None) -> int:
    """Fire every due job once. Returns how many fired. Safe under two
    schedulers: the CAS on next_run_at picks a single winner and the trigger
    dedupe key (`schedule:{job}:{date}`) collapses any residual race."""
    ts = now if now is not None else int(time.time())
    fired = 0
    rows = conn.execute(
        "SELECT * FROM cron_jobs WHERE enabled = 1 "
        "AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at",
        (ts,),
    ).fetchall()
    for job in rows:
        if _fire(conn, store, job, ts):
            fired += 1
    return fired


def _fire(conn: sqlite3.Connection, store: EventStore, job: sqlite3.Row,
          ts: int) -> bool:
    cron_job_id = str(job["cron_job_id"])
    tenant = str(job["tenant_id"] or TENANT)
    spec = parse_schedule(str(job["schedule"]))
    tz = timezone_of(str(job["timezone"]))
    previous = job["next_run_at"]
    nxt = next_after(spec, tz, ts, previous=previous)

    # single-writer claim: the winner moves next_run_at forward in the same
    # breath; a second scheduler's identical UPDATE matches zero rows
    if nxt is None:  # once-job (or unreachable cron): fire then retire
        cur = conn.execute(
            "UPDATE cron_jobs SET enabled = 0, next_run_at = NULL, "
            "last_run_at = ? WHERE cron_job_id = ? AND next_run_at = ? "
            "AND enabled = 1",
            (ts, cron_job_id, previous),
        )
    else:
        cur = conn.execute(
            "UPDATE cron_jobs SET next_run_at = ?, last_run_at = ? "
            "WHERE cron_job_id = ? AND next_run_at = ? AND enabled = 1",
            (nxt, ts, cron_job_id, previous),
        )
    if not cur.rowcount:
        conn.rollback()
        return False  # lost the claim (or already retired)

    payload: dict[str, Any] = json.loads(job["payload_json"] or "{}")
    run_id = "cr_" + secrets.token_hex(8)
    scheduled_at = int(previous or ts)
    conn.execute(
        "INSERT INTO cron_runs (run_id, tenant_id, cron_job_id, status,"
        " scheduled_at, started_at) VALUES (?, ?, ?, 'running', ?, ?)",
        (run_id, tenant, cron_job_id, scheduled_at, ts),
    )
    conn.commit()

    trigger_id = ""
    error = ""
    ticket_id: str | None = None
    try:
        source = conn.execute(
            "SELECT * FROM sources WHERE tenant_id = ? AND source_id = ?",
            (tenant, str(payload.get("source_id", ""))),
        ).fetchone()
        if source is None:
            raise AppError("SOURCE_NOT_FOUND")
        local = datetime.fromtimestamp(scheduled_at, tz)
        date = local.strftime("%Y%m%d-%H%M")
        body = {
            "kind": "schedule.fired",
            "external_id": f"{cron_job_id}:{date}",
            "thread_key": f"schedule:{cron_job_id}:{date}",
            "actor": {"id": SCHEDULER_ACTOR, "kind": "user"},
            "text": str(payload.get("text", "")) or f"[定时任务] {job['name']}",
        }
        trigger_id, _, duplicate = intake.receive(conn, store, source, body, None)
        if not duplicate:
            ticket_id = intake.process(conn, store, source, trigger_id)
    except Exception as exc:  # noqa: BLE001 - record the failure, keep ticking
        error = str(exc)

    status = "failed" if error else "succeeded"
    conn.execute(
        "UPDATE cron_runs SET status = ?, ended_at = ?, trigger_id = ?, "
        "error = ? WHERE run_id = ?",
        (status, int(time.time()), trigger_id, error or None, run_id),
    )
    conn.commit()
    store.append(
        str(payload.get("source_id", cron_job_id)),
        "cron.fired",
        {
            "cron_job_id": cron_job_id,
            "scheduled_at": scheduled_at,
            "fired_at": ts,
            "action": "notify",
            "trigger_id": trigger_id or None,
            "late": scheduled_at < ts - 60,
        },
        tenant_id=tenant,
    )
    _ = ticket_id
    return not error
