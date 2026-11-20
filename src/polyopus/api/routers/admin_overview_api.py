"""Admin overview: real health/queue/usage/backup/audit aggregates."""

from __future__ import annotations

import time
from sqlite3 import Connection

from fastapi import APIRouter, Depends

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/admin/overview", tags=["admin"])


def _day_start() -> int:
    now = time.localtime()
    return int(time.mktime((now.tm_year, now.tm_mon, now.tm_mday,
                            0, 0, 0, 0, 0, -1)))


def _p95(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))
    return ordered[index]


@router.get("")
def overview(
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    now = int(time.time())
    tenant = user.tenant_id
    day = _day_start()

    def scalar(sql: str, params: tuple[object, ...] = ()) -> int:
        row = conn.execute(sql, params).fetchone()
        return int(row[0] or 0) if row is not None else 0

    buckets = {
        str(row["bucket"]): int(row["n"])
        for row in conn.execute(
            "SELECT bucket, count(*) AS n FROM tickets WHERE tenant_id = ? "
            "GROUP BY bucket", (tenant,),
        ).fetchall()
    }
    tickets = {key: buckets.get(key, 0) for key in
               ("attention", "running", "queued", "done")}

    usage = conn.execute(
        "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,"
        " COALESCE(SUM(cost_micros), 0) AS cost FROM usage_ledger "
        "WHERE tenant_id = ? AND created_at >= ?", (tenant, day),
    ).fetchone()
    latencies = [
        int(row[0]) for row in conn.execute(
            "SELECT latency_ms FROM usage_ledger WHERE tenant_id = ? "
            "AND created_at >= ? AND latency_ms IS NOT NULL",
            (tenant, day),
        ).fetchall()
    ]

    runs_total = scalar(
        "SELECT count(*) FROM runs WHERE tenant_id = ? AND started_at >= ?",
        (tenant, now - 86_400),
    )
    runs_failed = scalar(
        "SELECT count(*) FROM runs WHERE tenant_id = ? AND started_at >= ? "
        "AND status = 'failed'", (tenant, now - 86_400),
    )
    backup = conn.execute(
        "SELECT backup_id, status, created_at, size_bytes FROM backups "
        "WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1", (tenant,),
    ).fetchone()
    audits = conn.execute(
        "SELECT action, actor_id, result, resource_type, resource_id, created_at "
        "FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 6",
        (tenant,),
    ).fetchall()
    attention = conn.execute(
        "SELECT ticket_id, title, bucket, created_at FROM tickets "
        "WHERE tenant_id = ? AND state = 'open' AND bucket IN "
        "('attention', 'queued', 'running') ORDER BY updated_at DESC LIMIT 6",
        (tenant,),
    ).fetchall()

    return {
        "generatedAt": now,
        "health": {
            "activeSessions": scalar(
                "SELECT count(*) FROM sessions WHERE tenant_id = ? "
                "AND revoked_at IS NULL AND expires_at > ?", (tenant, now),
            ),
            "queueDepth": scalar(
                "SELECT count(*) FROM turns WHERE tenant_id = ? "
                "AND status = 'queued'", (tenant,),
            ),
            "runningTurns": scalar(
                "SELECT count(*) FROM turns WHERE tenant_id = ? "
                "AND status = 'running'", (tenant,),
            ),
            "openAttentions": scalar(
                "SELECT count(*) FROM attentions WHERE tenant_id = ? "
                "AND status = 'pending'", (tenant,),
            ),
            "runs24h": runs_total,
            "failedRuns24h": runs_failed,
            "errorRate": round(runs_failed / runs_total, 4) if runs_total else 0.0,
            "p95LatencyMs": _p95(latencies),
        },
        "tickets": tickets,
        "usage": {
            "todayTokens": int(usage["tokens"] or 0),
            "todayCostMicros": int(usage["cost"] or 0),
        },
        "backup": (
            {
                "backupId": backup["backup_id"],
                "status": backup["status"],
                "createdAt": backup["created_at"],
                "sizeBytes": backup["size_bytes"],
            }
            if backup is not None else None
        ),
        "recentAudit": [
            {
                "action": row["action"],
                "actorId": row["actor_id"],
                "result": row["result"],
                "resourceType": row["resource_type"],
                "resourceId": row["resource_id"],
                "createdAt": row["created_at"],
            }
            for row in audits
        ],
        "recentTickets": [
            {
                "ticketId": row["ticket_id"],
                "title": row["title"],
                "bucket": row["bucket"],
                "createdAt": row["created_at"],
            }
            for row in attention
        ],
    }
