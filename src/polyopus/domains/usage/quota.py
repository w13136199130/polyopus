"""Three-layer quotas (V1-05): tenant / user / model.

Limits live in `quota_limits`; usage is read from `usage_ledger` (tokens,
cost) and `turns` (requests, so queued work counts before it completes).
`limit_value=0` means unlimited.
"""

from __future__ import annotations

import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

from polyopus.platform.errors import AppError

TENANT = "default"
METRICS = ("tokens", "cost", "requests")
WINDOWS = ("day", "month", "absolute")


@dataclass(frozen=True)
class QuotaViolation:
    scope: str
    scope_id: str
    metric: str
    limit: int
    used: int
    window: str

    def details(self) -> dict[str, Any]:
        return {
            "scope": self.scope,
            "scopeId": self.scope_id,
            "metric": self.metric,
            "limit": self.limit,
            "used": self.used,
            "window": self.window,
        }


def _bounds(window: str, now: int) -> tuple[int, int]:
    day = 86400
    if window == "day":
        start = now - now % day
    elif window == "month":
        import calendar
        import datetime

        current = datetime.datetime.fromtimestamp(now, tz=datetime.UTC)
        start = calendar.timegm(
            datetime.datetime(current.year, current.month, 1, tzinfo=datetime.UTC)
            .utctimetuple()
        )
    elif window == "absolute":
        start = 0
    else:
        raise AppError("VALIDATION_FAILED", details={"window": window})
    return start, now + day


def set_limit(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    scope: str,
    scope_id: str,
    metric: str,
    limit_value: int,
    window: str,
) -> dict[str, Any]:
    if scope not in ("tenant", "user", "model"):
        raise AppError("VALIDATION_FAILED", details={"scope": scope})
    if metric not in METRICS:
        raise AppError("VALIDATION_FAILED", details={"metric": metric})
    if window not in WINDOWS:
        raise AppError("VALIDATION_FAILED", details={"window": window})
    if limit_value < 0:
        raise AppError("VALIDATION_FAILED", details={"limit": limit_value})
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO quota_limits
          (quota_id, tenant_id, scope, scope_id, metric, limit_value, window,
           updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, scope, scope_id, metric, window) DO UPDATE SET
          limit_value = excluded.limit_value,
          updated_at = excluded.updated_at
        """,
        ("ql_" + secrets.token_hex(8), tenant_id, scope, scope_id, metric,
         limit_value, window, now),
    )
    conn.commit()
    return {
        "scope": scope, "scopeId": scope_id, "metric": metric,
        "limit": limit_value, "window": window,
    }


def update_limit(
    conn: sqlite3.Connection, tenant_id: str, quota_id: str, limit_value: int
) -> dict[str, Any]:
    if limit_value < 0:
        raise AppError("VALIDATION_FAILED", details={"limit": limit_value})
    cur = conn.execute(
        "UPDATE quota_limits SET limit_value = ?, updated_at = ? "
        "WHERE tenant_id = ? AND quota_id = ?",
        (limit_value, int(time.time()), tenant_id, quota_id),
    )
    conn.commit()
    if not cur.rowcount:
        raise AppError("NOT_FOUND", details={"quotaId": quota_id})
    row = conn.execute(
        "SELECT * FROM quota_limits WHERE tenant_id = ? AND quota_id = ?",
        (tenant_id, quota_id),
    ).fetchone()
    assert row is not None
    return {
        "quotaId": row["quota_id"], "scope": row["scope"],
        "scopeId": row["scope_id"], "metric": row["metric"],
        "limit": int(row["limit_value"]), "window": row["window"],
    }


def list_limits(conn: sqlite3.Connection, tenant_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM quota_limits WHERE tenant_id = ? ORDER BY id",
        (tenant_id,),
    ).fetchall()
    return [
        {
            "quotaId": row["quota_id"],
            "scope": row["scope"],
            "scopeId": row["scope_id"],
            "metric": row["metric"],
            "limit": int(row["limit_value"]),
            "window": row["window"],
        }
        for row in rows
    ]


def used(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    scope: str,
    scope_id: str,
    metric: str,
    window: str,
    now: int | None = None,
) -> int:
    ts = now or int(time.time())
    start, end = _bounds(window, ts)
    if metric == "requests":
        if scope == "user":
            row = conn.execute(
                "SELECT count(*) FROM turns t JOIN threads th "
                "ON th.thread_id = t.thread_id WHERE t.tenant_id = ? "
                "AND th.owner_id = ? AND t.created_at >= ? AND t.created_at < ?",
                (tenant_id, scope_id, start, end),
            ).fetchone()
        elif scope == "model":
            # Turns can emit several ledger rows; one request per turn.
            row = conn.execute(
                "SELECT count(DISTINCT turn_id) FROM usage_ledger "
                "WHERE tenant_id = ? AND model = ? AND turn_id IS NOT NULL "
                "AND created_at >= ? AND created_at < ?",
                (tenant_id, scope_id, start, end),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT count(*) FROM turns WHERE tenant_id = ? "
                "AND created_at >= ? AND created_at < ?",
                (tenant_id, start, end),
            ).fetchone()
        return int(row[0] if row else 0)
    where = "tenant_id = ? AND created_at >= ? AND created_at < ?"
    params: list[object] = [tenant_id, start, end]
    if scope == "user":
        where += " AND user_id = ?"
        params.append(scope_id)
    elif scope == "model":
        where += " AND model = ?"
        params.append(scope_id)
    column = "SUM(cost_micros)" if metric == "cost" else "SUM(input_tokens + output_tokens)"
    row = conn.execute(
        f"SELECT COALESCE({column}, 0) FROM usage_ledger WHERE {where}", params
    ).fetchone()
    return int(row[0] if row else 0)


def default_model(conn: sqlite3.Connection) -> str:
    """The model the engine will use when no hint is given.

    Resolving through the same registry keeps the pre-turn quota check and
    the actual `usage_ledger.model` row on the same name.
    """
    from polyopus.domains.agents import models as agents_registry

    return agents_registry.Registry(conn).resolve().model


def check(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    user_id: str | None = None,
    model: str | None = None,
    now: int | None = None,
) -> QuotaViolation | None:
    """First exceeded limit in tenant -> user -> model order, or None."""
    scopes = [("tenant", tenant_id)]
    if user_id:
        scopes.append(("user", user_id))
    if model:
        scopes.append(("model", model))
    for scope, scope_id in scopes:
        rows = conn.execute(
            "SELECT * FROM quota_limits WHERE tenant_id = ? AND scope = ? "
            "AND scope_id = ? AND limit_value > 0 ORDER BY id",
            (tenant_id, scope, scope_id),
        ).fetchall()
        for row in rows:
            limit = int(row["limit_value"])
            metric = str(row["metric"])
            window = str(row["window"])
            current = used(
                conn, tenant_id=tenant_id, scope=scope, scope_id=scope_id,
                metric=metric, window=window, now=now,
            )
            if current >= limit:
                return QuotaViolation(
                    scope, scope_id, metric, limit, current, window
                )
    return None


__all__ = [
    "METRICS", "QuotaViolation", "WINDOWS", "check", "default_model",
    "list_limits", "set_limit", "update_limit", "used",
]
