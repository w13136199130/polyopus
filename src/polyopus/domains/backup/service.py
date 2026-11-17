"""SQLite + workspace backups and restores (V1-07).

Snapshots use SQLite's backup API (never a file copy), so a live WAL database
is consistent. Every archive records the schema version and a sha256 of the
database snapshot; restore refuses a mismatch before touching the live DB.
"""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import sqlite3
import tarfile
import time
from pathlib import Path
from typing import Any, cast

from polyopus.platform.errors import AppError

SYSTEM = "system"
DEFAULT_INCLUDES = {"db": True, "workspace": True, "artifacts": True}


def _now() -> int:
    return int(time.time())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _expected_schema_version() -> int:
    from polyopus.platform.db import migrator as m

    root = Path(__file__).resolve().parents[4] / "migrations"
    migrations = m.discover(root)
    return max(migration.version for migration in migrations)


def _includes(raw: dict[str, Any] | None) -> dict[str, bool]:
    if raw is None:
        return dict(DEFAULT_INCLUDES)
    if not isinstance(raw, dict):
        raise AppError("VALIDATION_FAILED", details={"includes": "object"})
    merged = dict(DEFAULT_INCLUDES)
    for key in DEFAULT_INCLUDES:
        if key in raw:
            merged[key] = bool(raw[key])
    merged["db"] = True  # a backup without the DB cannot be restored
    return merged


def _view(row: sqlite3.Row) -> dict[str, Any]:
    manifest = json.loads(row["manifest_json"] or "{}")
    return {
        "id": row["backup_id"],
        "backupId": row["backup_id"],
        "kind": row["kind"],
        "manifest": manifest,
        "checksum": row["checksum"],
        "sizeBytes": int(row["size_bytes"]),
        "auto": bool(row["auto"]),
        "status": row["status"],
        "storageRef": row["storage_ref"],
        "createdAt": row["created_at"],
        "restoredAt": row["restored_at"],
    }


def _get(conn: sqlite3.Connection, backup_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM backups WHERE tenant_id = ? AND backup_id = ?",
        (SYSTEM, backup_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"backupId": backup_id})
    return cast(sqlite3.Row, row)


def list_backups(
    conn: sqlite3.Connection, *, limit: int = 50, cursor: str | None = None,
) -> dict[str, Any]:
    params: list[object] = [SYSTEM]
    where = "tenant_id = ?"
    if cursor:
        where += " AND backup_id < ?"
        params.append(cursor)
    rows = conn.execute(
        f"SELECT * FROM backups WHERE {where} ORDER BY id DESC LIMIT ?",
        [*params, max(1, min(limit, 200))],
    ).fetchall()
    return {
        "items": [_view(row) for row in rows],
        "nextCursor": rows[-1]["backup_id"] if rows else None,
    }


def get_status(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM backups WHERE tenant_id = ? "
        "AND status IN ('creating', 'restoring') ORDER BY id DESC LIMIT 1",
        (SYSTEM,),
    ).fetchone()
    if row is None:
        return {"busy": False, "operation": "none"}
    return {
        "busy": True,
        "operation": "create" if row["status"] == "creating" else "restore",
        "backupId": row["backup_id"],
        "since": row["created_at"],
    }


def create_backup(
    conn: sqlite3.Connection, *,
    db_path: Path,
    data_dir: Path,
    workspace_dir: Path | None = None,
    includes: dict[str, Any] | None = None,
    auto: bool = False,
    kind: str = "full",
) -> dict[str, Any]:
    if get_status(conn)["busy"]:
        raise AppError("CONFLICT", details={"reason": "backup_in_progress"})
    wanted = _includes(includes)
    backup_id = "bk_" + hashlib.sha256(
        f"{time.time_ns()}:{db_path}".encode()
    ).hexdigest()[:16]
    root = Path(data_dir) / "backups" / backup_id
    root.mkdir(parents=True, exist_ok=True)
    snapshot = root / "db.sqlite"
    conn.execute(
        "INSERT INTO backups (backup_id, tenant_id, kind, storage_ref,"
        " schema_version, manifest_json, checksum, size_bytes, auto, status,"
        " created_at) VALUES (?, ?, ?, ?, 0, '{}', '', 0, ?, 'creating', ?)",
        (backup_id, SYSTEM, kind, str(root), int(auto), _now()),
    )
    conn.commit()
    try:
        # SQLite backup API handles WAL; the checkpoint just keeps the
        # snapshot small when the DB is idle.
        try:
            conn.execute("PRAGMA wal_checkpoint(FULL)")
        except sqlite3.Error:
            pass
        target = sqlite3.connect(str(snapshot))
        try:
            conn.backup(target)
        finally:
            target.close()
        schema_version = int(
            conn.execute("PRAGMA user_version").fetchone()[0]
        )
        db_sha = _sha256(snapshot)
        artifacts_count = 0
        if wanted["artifacts"]:
            rows = conn.execute("SELECT * FROM artifacts").fetchall()
            artifacts_count = len(rows)
            with (root / "artifacts.jsonl").open("w", encoding="utf-8") as handle:
                for row in rows:
                    handle.write(json.dumps(dict(row), ensure_ascii=False,
                                            separators=(",", ":")) + "\n")
        workspace_sha = ""
        if wanted["workspace"] and workspace_dir and Path(workspace_dir).is_dir():
            archive = root / "workspace.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                tar.add(str(workspace_dir), arcname="workspace")
            workspace_sha = _sha256(archive)
        manifest = {
            "schemaVersion": schema_version,
            "includes": wanted,
            "dbSha256": db_sha,
            "workspaceSha256": workspace_sha,
            "artifactsCount": artifacts_count,
            "createdAt": _now(),
            "kind": kind,
        }
        (root / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        size = sum(path.stat().st_size for path in root.iterdir() if path.is_file())
        conn.execute(
            "UPDATE backups SET schema_version = ?, manifest_json = ?,"
            " checksum = ?, size_bytes = ?, status = 'ready' WHERE backup_id = ?",
            (schema_version, json.dumps(manifest, ensure_ascii=False),
             db_sha, size, backup_id),
        )
        conn.commit()
    except Exception as exc:  # noqa: BLE001 - surface via status and error
        conn.execute(
            "UPDATE backups SET status = 'failed', manifest_json = ? "
            "WHERE backup_id = ?",
            (json.dumps({"error": str(exc)}), backup_id),
        )
        conn.commit()
        raise
    return _view(_get(conn, backup_id))


def delete_backup(
    conn: sqlite3.Connection, backup_id: str, *, data_dir: Path,
) -> None:
    row = _get(conn, backup_id)
    if str(row["status"]) in ("creating", "restoring"):
        raise AppError("CONFLICT", details={"reason": "backup_in_progress"})
    root = Path(str(row["storage_ref"])).resolve()
    backups_root = (Path(data_dir) / "backups").resolve()
    if backups_root in root.parents and root.is_dir():
        shutil.rmtree(root)
    conn.execute(
        "DELETE FROM backups WHERE tenant_id = ? AND backup_id = ?",
        (SYSTEM, backup_id),
    )
    conn.commit()


def restore_backup(
    conn: sqlite3.Connection, backup_id: str, *,
    workspace_dir: Path | None = None,
    data_dir: Path | None = None,
) -> dict[str, Any]:
    """Restore by catalog row, or straight from `data_dir/backups/<id>`.

    The latter is what `poly restore` needs after the DB itself was lost:
    the catalog lives in the DB, so the on-disk manifest is the fallback.
    """
    row: sqlite3.Row | None
    try:
        row = _get(conn, backup_id)
    except (AppError, sqlite3.OperationalError):
        row = None
    if row is not None and str(row["status"]) == "restoring":
        raise AppError("CONFLICT", details={"reason": "restore_in_progress"})

    if row is not None:
        root = Path(str(row["storage_ref"]))
        manifest = json.loads(row["manifest_json"] or "{}")
        expected_checksum = str(row["checksum"])
        size_bytes = int(row["size_bytes"])
    else:
        if data_dir is None:
            raise AppError("NOT_FOUND", details={"backupId": backup_id})
        root = Path(data_dir) / "backups" / backup_id
        manifest_path = root / "manifest.json"
        if not manifest_path.is_file():
            raise AppError("NOT_FOUND", details={"backupId": backup_id})
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected_checksum = str(manifest.get("dbSha256") or "")
        size_bytes = sum(
            path.stat().st_size for path in root.iterdir() if path.is_file()
        )

    snapshot = root / "db.sqlite"
    if not snapshot.is_file():
        raise AppError("NOT_FOUND", details={"backupId": backup_id, "file": "db"})
    checksum = _sha256(snapshot)
    if not expected_checksum or checksum != expected_checksum:
        raise AppError(
            "VALIDATION_FAILED",
            details={"reason": "checksum_mismatch", "expected": expected_checksum,
                     "actual": checksum},
        )
    source = sqlite3.connect(str(snapshot))
    try:
        version = int(source.execute("PRAGMA user_version").fetchone()[0])
        expected = _expected_schema_version()
        if version != expected:
            raise AppError(
                "VALIDATION_FAILED",
                details={"reason": "schema_version_mismatch",
                         "expected": expected, "actual": version},
            )
        if row is not None:
            conn.execute(
                "UPDATE backups SET status = 'restoring' WHERE backup_id = ?",
                (backup_id,),
            )
            conn.commit()
        try:
            conn.execute("PRAGMA wal_checkpoint(FULL)")
        except sqlite3.Error:
            pass
        source.backup(conn)
        conn.execute("PRAGMA foreign_keys=ON")
        if workspace_dir and manifest.get("includes", {}).get("workspace"):
            archive = root / "workspace.tar.gz"
            if archive.is_file():
                target = Path(workspace_dir)
                target.parent.mkdir(parents=True, exist_ok=True)
                with tarfile.open(archive, "r:gz") as tar:
                    tar.extractall(target.parent, filter="data")
        restored_at = _now()
        try:
            conn.execute(
                "UPDATE backups SET status = 'restored', checksum = ?,"
                " manifest_json = ?, size_bytes = ?, schema_version = ?,"
                " restored_at = ? WHERE backup_id = ?",
                (checksum, json.dumps(manifest, ensure_ascii=False), size_bytes,
                 version, restored_at, backup_id),
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass  # imported DB without a catalog row
    finally:
        source.close()
    try:
        return _view(_get(conn, backup_id))
    except (AppError, sqlite3.OperationalError):
        return {
            "id": backup_id, "backupId": backup_id, "kind": "full",
            "manifest": manifest, "checksum": checksum,
            "sizeBytes": size_bytes, "auto": False, "status": "restored",
            "storageRef": str(root), "createdAt": manifest.get("createdAt"),
            "restoredAt": restored_at,
        }


def get_auto(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM backup_settings WHERE tenant_id = ?", (SYSTEM,)
    ).fetchone()
    if row is None:
        return {
            "autoEnabled": False,
            "intervalHours": 24,
            "retentionCount": 7,
            "includes": dict(DEFAULT_INCLUDES),
        }
    return {
        "autoEnabled": bool(row["auto_enabled"]),
        "intervalHours": int(row["interval_hours"]),
        "retentionCount": int(row["retention_count"]),
        "includes": json.loads(row["includes_json"] or "{}"),
    }


def update_auto(
    conn: sqlite3.Connection, *,
    auto_enabled: bool | None = None,
    interval_hours: int | None = None,
    retention_count: int | None = None,
    includes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current = get_auto(conn)
    enabled = current["autoEnabled"] if auto_enabled is None else auto_enabled
    interval = current["intervalHours"] if interval_hours is None else interval_hours
    retention = (
        current["retentionCount"] if retention_count is None else retention_count
    )
    include_map = _includes(includes) if includes is not None else current["includes"]
    if int(interval) <= 0 or int(retention) <= 0:
        raise AppError("VALIDATION_FAILED", details={"intervalHours": "positive"})
    conn.execute(
        "INSERT INTO backup_settings (tenant_id, auto_enabled, interval_hours,"
        " retention_count, includes_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(tenant_id) DO UPDATE SET auto_enabled = excluded.auto_enabled,"
        " interval_hours = excluded.interval_hours,"
        " retention_count = excluded.retention_count,"
        " includes_json = excluded.includes_json,"
        " updated_at = excluded.updated_at",
        (SYSTEM, int(bool(enabled)), int(interval), int(retention),
         json.dumps(include_map, ensure_ascii=False), _now()),
    )
    conn.commit()
    return get_auto(conn)


def run_auto(
    conn: sqlite3.Connection, *,
    db_path: Path,
    data_dir: Path,
    workspace_dir: Path | None = None,
) -> dict[str, Any]:
    settings = get_auto(conn)
    backup = create_backup(
        conn, db_path=db_path, data_dir=data_dir, workspace_dir=workspace_dir,
        includes=settings["includes"], auto=True,
    )
    _prune_auto(conn, data_dir, int(settings["retentionCount"]))
    return backup


def _prune_auto(conn: sqlite3.Connection, data_dir: Path, keep: int) -> None:
    rows = conn.execute(
        "SELECT backup_id FROM backups WHERE tenant_id = ? AND auto = 1 "
        "AND status != 'creating' ORDER BY id DESC LIMIT -1 OFFSET ?",
        (SYSTEM, max(0, keep)),
    ).fetchall()
    for row in rows:
        try:
            delete_backup(conn, str(row[0]), data_dir=data_dir)
        except AppError:
            continue


def import_backup(
    conn: sqlite3.Connection, *, content_base64: str, data_dir: Path,
) -> dict[str, Any]:
    try:
        raw = base64.b64decode(content_base64, validate=True)
    except Exception as exc:  # noqa: BLE001 - user input
        raise AppError("VALIDATION_FAILED", details={"contentBase64": "invalid"}) from exc
    if not raw.startswith(b"SQLite format 3\x00"):
        raise AppError("VALIDATION_FAILED", details={"contentBase64": "not sqlite"})
    backup_id = "bk_" + hashlib.sha256(raw).hexdigest()[:16]
    root = Path(data_dir) / "backups" / backup_id
    root.mkdir(parents=True, exist_ok=True)
    snapshot = root / "db.sqlite"
    snapshot.write_bytes(raw)
    source = sqlite3.connect(str(snapshot))
    try:
        version = int(source.execute("PRAGMA user_version").fetchone()[0])
    finally:
        source.close()
    expected = _expected_schema_version()
    if version != expected:
        shutil.rmtree(root, ignore_errors=True)
        raise AppError(
            "VALIDATION_FAILED",
            details={"reason": "schema_version_mismatch", "expected": expected,
                     "actual": version},
        )
    manifest = {
        "schemaVersion": version,
        "includes": dict(DEFAULT_INCLUDES),
        "dbSha256": _sha256(snapshot),
        "workspaceSha256": "",
        "artifactsCount": 0,
        "createdAt": _now(),
        "kind": "full",
        "imported": True,
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    checksum = _sha256(snapshot)
    size = sum(path.stat().st_size for path in root.iterdir() if path.is_file())
    conn.execute(
        "INSERT INTO backups (backup_id, tenant_id, kind, storage_ref,"
        " schema_version, manifest_json, checksum, size_bytes, auto, status,"
        " created_at) VALUES (?, ?, 'full', ?, ?, ?, ?, ?, 0, 'ready', ?)"
        " ON CONFLICT(backup_id) DO UPDATE SET schema_version = excluded.schema_version,"
        " manifest_json = excluded.manifest_json, checksum = excluded.checksum,"
        " size_bytes = excluded.size_bytes, status = 'ready'",
        (backup_id, SYSTEM, str(root), version,
         json.dumps(manifest, ensure_ascii=False), checksum, size, _now()),
    )
    conn.commit()
    return _view(_get(conn, backup_id))
