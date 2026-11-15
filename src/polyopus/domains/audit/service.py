"""Append-only audit log (V05-19).

`record()` is deliberately best-effort: audit must never roll back or block
the business action (docs/48 V05-19 risk). Secrets/tokens and absolute paths
are redacted before the JSON detail is stored.

`query()` is read-only and supports the admin filters (actor/action/result/
ticket). A ticket query also matches the ticket's originating trigger, so
gate + assessment rows are reachable from the ticket they admitted.
"""

from __future__ import annotations

import csv
import io
import json
import re
import secrets
import sqlite3
import time
from typing import Any

from polyopus.platform.telemetry import log as tlog

TENANT = "default"

_SENSITIVE_KEY = re.compile(
    r"(secret|token|password|api[_-]?key|authorization|cookie|credential)", re.I
)
_ABSOLUTE_PATH_RE = re.compile(
    r"(?<![A-Za-z])[A-Za-z]:[\\/][^\s\"']*"  # windows drive paths
    r"|/(?:home|Users|tmp|etc|var|root|opt|srv)/[^\s\"']*"  # unix prefixes
)

CSV_COLUMNS = (
    "auditId", "createdAt", "actorId", "action", "resourceType",
    "resourceId", "result", "ticketId", "detailJson",
)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[redacted]" if _SENSITIVE_KEY.search(str(key)) else _redact(val)
            for key, val in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        return _ABSOLUTE_PATH_RE.sub("[path]", value)
    return value


def record(
    conn: sqlite3.Connection,
    *,
    action: str,
    result: str,
    tenant_id: str = TENANT,
    actor_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    ticket_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip: str | None = None,
    trace_id: str | None = None,
) -> str | None:
    """Append one audit row; returns None (and logs) on any failure."""
    try:
        payload = dict(detail or {})
        if ticket_id:
            payload.setdefault("ticketId", ticket_id)
        audit_id = "au_" + secrets.token_hex(8)
        conn.execute(
            """
            INSERT INTO audit_log
              (tenant_id, audit_id, actor_id, action, resource_type,
               resource_id, result, detail_json, ip, trace_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (tenant_id, audit_id, actor_id, action, resource_type, resource_id,
             result, json.dumps(_redact(payload), ensure_ascii=False,
                                separators=(",", ":")),
             ip, trace_id, int(time.time())),
        )
        return audit_id
    except Exception as exc:  # noqa: BLE001 - audit must never block business
        tlog.log(tlog.get_logger("polyopus.audit"), 30, "audit.write_failed",
                 action=action, error=str(exc))
        return None


def _where(
    *,
    tenant_id: str,
    actor_id: str | None,
    action: str | None,
    result: str | None,
    ticket_id: str | None,
    resource_type: str | None,
    resource_id: str | None,
) -> tuple[str, list[object]]:
    clauses = ["tenant_id = ?"]
    params: list[object] = [tenant_id]
    if actor_id:
        clauses.append("actor_id = ?")
        params.append(actor_id)
    if action:
        clauses.append("action = ?")
        params.append(action)
    if result:
        clauses.append("result = ?")
        params.append(result)
    if resource_type:
        clauses.append("resource_type = ?")
        params.append(resource_type)
    if resource_id:
        clauses.append("resource_id = ?")
        params.append(resource_id)
    if ticket_id:
        clauses.append(
            "((resource_type = 'ticket' AND resource_id = ?) "
            "OR json_extract(detail_json, '$.ticketId') = ? "
            "OR resource_id = (SELECT trigger_id FROM tickets "
            "WHERE tenant_id = ? AND ticket_id = ?))"
        )
        params.extend([ticket_id, ticket_id, tenant_id, ticket_id])
    return " AND ".join(clauses), params


def _item(row: sqlite3.Row) -> dict[str, Any]:
    detail = json.loads(row["detail_json"] or "{}")
    return {
        "auditId": row["audit_id"],
        "createdAt": row["created_at"],
        "actorId": row["actor_id"],
        "action": row["action"],
        "resourceType": row["resource_type"],
        "resourceId": row["resource_id"],
        "result": row["result"],
        "ticketId": detail.get("ticketId"),
        "detail": detail,
        "ip": row["ip"],
        "traceId": row["trace_id"],
    }


def query(
    conn: sqlite3.Connection,
    *,
    tenant_id: str = TENANT,
    actor_id: str | None = None,
    action: str | None = None,
    result: str | None = None,
    ticket_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
    order: str = "desc",
) -> list[dict[str, Any]]:
    """Read-only filter. `order=asc` replays a ticket chronologically."""
    where, params = _where(
        tenant_id=tenant_id, actor_id=actor_id, action=action, result=result,
        ticket_id=ticket_id, resource_type=resource_type,
        resource_id=resource_id,
    )
    direction = "ASC" if order == "asc" else "DESC"
    rows = conn.execute(
        f"SELECT * FROM audit_log WHERE {where} "
        f"ORDER BY created_at {direction}, id {direction} LIMIT ? OFFSET ?",
        [*params, max(1, min(limit, 500)), max(0, offset)],
    ).fetchall()
    return [_item(row) for row in rows]


def export_csv(items: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for item in items:
        writer.writerow(
            {
                **item,
                "ticketId": item.get("ticketId") or "",
                "detailJson": json.dumps(item.get("detail") or {},
                                         ensure_ascii=False, separators=(",", ":")),
            }
        )
    return buffer.getvalue()
