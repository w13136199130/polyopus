"""Data export / tenant purge jobs (V1-06).

Every export and purge is a `data_jobs` row so progress, the storage ref and
the "export before delete" evidence survive the request that created it.
The actual work is synchronous per job (the embedded worker calls
`run_pending`); the HTTP API only enqueues and reads.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

from polyopus.domains.audit import service as audit
from polyopus.platform.errors import AppError

JOB_KINDS = ("export", "delete")
TENANT_EXPORT_TABLES = (
    "tenants", "threads", "messages", "turns", "tickets", "reports",
    "timeline_events", "usage_ledger", "artifacts", "audit_log",
)
_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


def _now() -> int:
    return int(time.time())


def _safe(value: str, fallback: str = "tenant") -> str:
    cleaned = _SAFE.sub("_", value).strip("._-")
    return cleaned or fallback


def _view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["job_id"],
        "jobId": row["job_id"],
        "kind": row["kind"],
        "status": row["status"],
        "progress": float(row["progress"]),
        "storageRef": row["storage_ref"],
        "error": row["error"],
        "createdAt": row["created_at"],
        "finishedAt": row["finished_at"],
    }


def _insert(
    conn: sqlite3.Connection, *, tenant_id: str, user_id: str | None,
    kind: str, scope: dict[str, Any],
) -> dict[str, Any]:
    job_id = "dj_" + secrets.token_hex(8)
    conn.execute(
        "INSERT INTO data_jobs (job_id, tenant_id, user_id, kind, scope_json,"
        " status, progress, created_at) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)",
        (job_id, tenant_id, user_id, kind,
         json.dumps(scope, ensure_ascii=False, separators=(",", ":")), _now()),
    )
    conn.commit()
    return get_job(conn, tenant_id=tenant_id, job_id=job_id, user_id=user_id)


def create_export(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    user_id: str,
    fmt: str = "jsonl",
    include_artifacts: bool = True,
) -> dict[str, Any]:
    if fmt not in ("jsonl", "json"):
        raise AppError("VALIDATION_FAILED", details={"format": fmt})
    return _insert(
        conn, tenant_id=tenant_id, user_id=user_id, kind="export",
        scope={"scope": "user", "userId": user_id, "format": fmt,
               "includeArtifacts": include_artifacts},
    )


def create_tenant_purge(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    target_tenant_id: str,
    user_id: str,
    confirm_name: str,
    reason: str,
) -> dict[str, Any]:
    if target_tenant_id == tenant_id:
        raise AppError("CONFLICT", details={"reason": "cannot_purge_current_tenant"})
    if target_tenant_id in ("default", ""):
        raise AppError("CONFLICT", details={"reason": "cannot_purge_default_tenant"})
    if confirm_name != target_tenant_id:
        raise AppError(
            "VALIDATION_FAILED", details={"confirmName": "tenant name mismatch"}
        )
    row = conn.execute(
        "SELECT 1 FROM tenants WHERE tenant_id = ?", (target_tenant_id,)
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"tenantId": target_tenant_id})
    return _insert(
        conn, tenant_id=tenant_id, user_id=user_id, kind="delete",
        scope={"scope": "tenant", "tenantId": target_tenant_id,
               "reason": reason},
    )


def get_job(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    job_id: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    sql = "SELECT * FROM data_jobs WHERE tenant_id = ? AND job_id = ?"
    params: list[object] = [tenant_id, job_id]
    if user_id is not None:
        sql += " AND user_id = ?"
        params.append(user_id)
    row = conn.execute(sql, params).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"jobId": job_id})
    return _view(row)


def run_pending(
    conn: sqlite3.Connection, data_dir: Path, *, limit: int = 5,
) -> int:
    """Claim and run queued jobs; failures are recorded, never raised."""
    completed = 0
    for _ in range(max(0, limit)):
        row = conn.execute(
            "SELECT job_id FROM data_jobs WHERE status = 'queued' "
            "ORDER BY id LIMIT 1"
        ).fetchone()
        if row is None:
            break
        job_id = str(row[0])
        cur = conn.execute(
            "UPDATE data_jobs SET status = 'running', progress = 0.1 "
            "WHERE job_id = ? AND status = 'queued'", (job_id,),
        )
        conn.commit()
        if cur.rowcount != 1:
            continue
        try:
            run_job(conn, job_id, data_dir)
        except Exception as exc:  # noqa: BLE001 - the worker loop must survive
            _fail(conn, job_id, str(exc))
        completed += 1
    return completed


def run_job(conn: sqlite3.Connection, job_id: str, data_dir: Path) -> None:
    row = conn.execute(
        "SELECT * FROM data_jobs WHERE job_id = ?", (job_id,)
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"jobId": job_id})
    if str(row["status"]) in ("ready", "done"):
        return
    conn.execute(
        "UPDATE data_jobs SET status = 'running', progress = 0.1, error = NULL "
        "WHERE job_id = ?", (job_id,),
    )
    conn.commit()
    try:
        scope = json.loads(row["scope_json"] or "{}")
        if str(row["kind"]) == "export":
            storage_ref = _export_user(conn, row, scope, data_dir)
            status = "ready"
        elif str(row["kind"]) == "delete":
            storage_ref = _purge_tenant(conn, row, scope, data_dir)
            status = "done"
        else:
            raise AppError("VALIDATION_FAILED", details={"kind": row["kind"]})
    except Exception as exc:  # noqa: BLE001 - job status carries the failure
        _fail(conn, job_id, str(exc))
        raise
    conn.execute(
        "UPDATE data_jobs SET status = ?, progress = 1, storage_ref = ?,"
        " finished_at = ? WHERE job_id = ?",
        (status, storage_ref, _now(), job_id),
    )
    conn.commit()


def _fail(conn: sqlite3.Connection, job_id: str, error: str) -> None:
    conn.execute(
        "UPDATE data_jobs SET status = 'failed', error = ?, finished_at = ? "
        "WHERE job_id = ?", (error[:2000], _now(), job_id),
    )
    conn.commit()


def _job_dir(data_dir: Path, tenant_id: str, job_id: str) -> Path:
    root = Path(data_dir) / "exports" / _safe(tenant_id) / _safe(job_id, "job")
    root.mkdir(parents=True, exist_ok=True)
    return root


def _in(values: list[str]) -> str:
    return ",".join("?" for _ in values)


def _rows(
    conn: sqlite3.Connection, sql: str, params: list[object],
) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(sql, params).fetchall()]


def _user_data(
    conn: sqlite3.Connection, tenant_id: str, user_id: str,
    include_artifacts: bool,
) -> dict[str, list[dict[str, Any]]]:
    user = _rows(
        conn,
        "SELECT user_id, tenant_id, username, display_name, is_owner, status,"
        " created_at, last_login_at FROM users WHERE tenant_id = ? AND user_id = ?",
        [tenant_id, user_id],
    )
    threads = _rows(
        conn, "SELECT * FROM threads WHERE tenant_id = ? AND owner_id = ?",
        [tenant_id, user_id],
    )
    thread_ids = [str(r["thread_id"]) for r in threads]
    messages = turns = runs = steps = events = artifacts = []
    if thread_ids:
        place = _in(thread_ids)
        messages = _rows(
            conn, f"SELECT * FROM messages WHERE thread_id IN ({place})",
            list(thread_ids),
        )
        turns = _rows(
            conn, f"SELECT * FROM turns WHERE thread_id IN ({place})",
            list(thread_ids),
        )
        events = _rows(
            conn, f"SELECT * FROM events WHERE thread_id IN ({place})",
            list(thread_ids),
        )
        if include_artifacts:
            artifacts = _rows(
                conn, f"SELECT * FROM artifacts WHERE thread_id IN ({place})",
                list(thread_ids),
            )
    turn_ids = [str(r["turn_id"]) for r in turns]
    if turn_ids:
        place = _in(turn_ids)
        runs = _rows(
            conn, f"SELECT * FROM runs WHERE turn_id IN ({place})", list(turn_ids)
        )
    run_ids = [str(r["run_id"]) for r in runs]
    if run_ids:
        place = _in(run_ids)
        steps = _rows(
            conn, f"SELECT * FROM steps WHERE run_id IN ({place})", list(run_ids)
        )
    tickets = _rows(
        conn,
        "SELECT * FROM tickets WHERE tenant_id = ? "
        "AND json_extract(actor_json, '$.id') = ?",
        [tenant_id, user_id],
    )
    return {
        "user": user,
        "threads": threads,
        "messages": messages,
        "turns": turns,
        "runs": runs,
        "steps": steps,
        "events": events,
        "artifacts": artifacts,
        "tickets": tickets,
        "usage": _rows(
            conn, "SELECT * FROM usage_ledger WHERE tenant_id = ? AND user_id = ?",
            [tenant_id, user_id],
        ),
        "audit": _rows(
            conn, "SELECT * FROM audit_log WHERE tenant_id = ? AND actor_id = ?",
            [tenant_id, user_id],
        ),
    }


def _write_export(
    data_dir: Path, tenant_id: str, job_id: str, tables: dict[str, list[dict[str, Any]]],
    *, fmt: str, include_artifacts: bool,
) -> str:
    root = _job_dir(data_dir, tenant_id, job_id)
    counts = {name: len(items) for name, items in tables.items()}
    manifest = {
        "jobId": job_id,
        "tenantId": tenant_id,
        "format": fmt,
        "includeArtifacts": include_artifacts,
        "counts": counts,
        "createdAt": _now(),
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if fmt == "json":
        path = root / "export.json"
        path.write_text(
            json.dumps({"tables": tables, "counts": counts}, ensure_ascii=False,
                       indent=2) + "\n",
            encoding="utf-8",
        )
        return str(path)
    path = root / "export.jsonl"
    with path.open("w", encoding="utf-8") as handle:
        for name, items in tables.items():
            for item in items:
                handle.write(json.dumps(
                    {"type": name, "data": item}, ensure_ascii=False,
                    separators=(",", ":"),
                ) + "\n")
    return str(path)


def _export_user(
    conn: sqlite3.Connection, job: sqlite3.Row, scope: dict[str, Any],
    data_dir: Path,
) -> str:
    tenant_id = str(job["tenant_id"])
    user_id = str(job["user_id"] or scope.get("userId") or "")
    if not user_id:
        raise AppError("VALIDATION_FAILED", details={"userId": "required"})
    tables = _user_data(
        conn, tenant_id, user_id, bool(scope.get("includeArtifacts", True))
    )
    return _write_export(
        data_dir, tenant_id, str(job["job_id"]), tables,
        fmt=str(scope.get("format") or "jsonl"),
        include_artifacts=bool(scope.get("includeArtifacts", True)),
    )


def _tenant_data(conn: sqlite3.Connection, tenant_id: str) -> dict[str, list[dict[str, Any]]]:
    return {
        name: _rows(
            conn, f'SELECT * FROM "{name}" WHERE tenant_id = ?', [tenant_id]
        )
        for name in TENANT_EXPORT_TABLES
    }


def _tenant_tables(conn: sqlite3.Connection) -> list[str]:
    names = [
        str(row[0]) for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' "
            "AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]
    out: list[str] = []
    for name in names:
        cols = conn.execute(f'PRAGMA table_info("{name}")').fetchall()
        if any(str(col[1]) == "tenant_id" for col in cols):
            out.append(name)
    return out


def _purge_tenant(
    conn: sqlite3.Connection, job: sqlite3.Row, scope: dict[str, Any],
    data_dir: Path,
) -> str:
    target = str(scope.get("tenantId") or "")
    if not target:
        raise AppError("VALIDATION_FAILED", details={"tenantId": "required"})
    # 1. Export first: nothing is deleted until the evidence file exists.
    tables = _tenant_data(conn, target)
    storage_ref = _write_export(
        data_dir, str(job["tenant_id"]), str(job["job_id"]), tables,
        fmt="jsonl", include_artifacts=True,
    )
    now = _now()
    # 2. Soft delete in a separate committed step.
    conn.execute(
        "UPDATE users SET deleted_at = ?, status = 'disabled', updated_at = ? "
        "WHERE tenant_id = ?", (now, now, target),
    )
    conn.execute(
        "UPDATE threads SET deleted_at = ?, status = 'deleted', updated_at = ? "
        "WHERE tenant_id = ?", (now, now, target),
    )
    conn.commit()
    # 3. Rows without tenant_id but keyed by user.
    user_ids = [
        str(row[0]) for row in conn.execute(
            "SELECT user_id FROM users WHERE tenant_id = ?", (target,)
        ).fetchall()
    ]
    if user_ids:
        place = _in(user_ids)
        conn.execute(f"DELETE FROM user_mfa WHERE user_id IN ({place})", user_ids)
        conn.execute(f"DELETE FROM user_roles WHERE user_id IN ({place})", user_ids)
    # 4. Business/event/object rows, then the tenant itself.
    for name in _tenant_tables(conn):
        if name in ("audit_log", "data_jobs", "tenants"):
            continue
        conn.execute(f'DELETE FROM "{name}" WHERE tenant_id = ?', (target,))
    conn.execute("DELETE FROM tenants WHERE tenant_id = ?", (target,))
    conn.commit()
    # 5. Audit rows survive anonymized (docs/31: never physically delete).
    audit.anonymize_tenant(conn, target)
    return storage_ref
