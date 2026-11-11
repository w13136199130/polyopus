"""Minimal forward-only migrator (SQLite, M0).

Design notes:
- `docs/31` is the DDL source; `migrations/*.sql` are generated/curated from it.
- `schema_migrations(version, applied_at, checksum)` follows `31 §2.7`.
- Each migration runs in its own transaction; checksums are verified on re-run.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

VERSION_RE = re.compile(r"^(\d+)_([a-z0-9_]+)\.sql$")

BOOTSTRAP_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
  version       INTEGER PRIMARY KEY,
  applied_at    INTEGER NOT NULL,
  checksum      TEXT NOT NULL
)
"""


class MigratorError(RuntimeError):
    """Migration failure with a stable error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path
    sql: str
    checksum: str


def _normalize(sql: str) -> str:
    return sql.replace("\r\n", "\n")


def _checksum(sql: str) -> str:
    return hashlib.sha256(_normalize(sql).encode("utf-8")).hexdigest()


def discover(migrations_dir: Path) -> list[Migration]:
    if not migrations_dir.is_dir():
        raise MigratorError("MIGRATIONS_DIR_MISSING", f"{migrations_dir} not found")
    found: list[Migration] = []
    for path in migrations_dir.glob("*.sql"):
        m = VERSION_RE.match(path.name)
        if not m:
            raise MigratorError("MIGRATION_NAME_INVALID", f"invalid name: {path.name}")
        sql = path.read_text(encoding="utf-8")
        found.append(
            Migration(version=int(m.group(1)), name=m.group(2), path=path,
                      sql=sql, checksum=_checksum(sql))
        )
    found.sort(key=lambda x: x.version)
    versions = [m.version for m in found]
    if len(set(versions)) != len(versions):
        raise MigratorError("MIGRATION_VERSION_DUPLICATE", f"versions: {versions}")
    return found


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")  # concurrent writers wait, not fail
    return conn


def ensure_bootstrap(conn: sqlite3.Connection) -> None:
    conn.execute(BOOTSTRAP_SQL)


def applied(conn: sqlite3.Connection) -> dict[int, str]:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).fetchone()
    if row is None:
        return {}
    rows = conn.execute("SELECT version, checksum FROM schema_migrations").fetchall()
    return {int(r["version"]): str(r["checksum"]) for r in rows}


def pending(conn: sqlite3.Connection, migrations: list[Migration]) -> list[Migration]:
    done = applied(conn)
    if done and migrations and max(done) > max(m.version for m in migrations):
        raise MigratorError(
            "SCHEMA_TOO_NEW",
            f"database has version {max(done)}, code only has {max(m.version for m in migrations)}",
        )
    return [m for m in migrations if m.version not in done]


def _statements(sql: str) -> list[str]:
    out: list[str] = []
    buf = ""
    for line in _normalize(sql).splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            stmt = buf.strip()
            if stmt:
                out.append(stmt)
            buf = ""
    tail = buf.strip()
    if tail and not tail.startswith("--"):
        raise MigratorError("MIGRATION_SQL_INCOMPLETE", f"dangling SQL: {tail[:60]!r}")
    return out


def apply(
    conn: sqlite3.Connection,
    migrations: list[Migration],
    now: int | None = None,
) -> list[Migration]:
    """Apply pending migrations in order. Returns the ones applied."""
    ensure_bootstrap(conn)
    done = applied(conn)
    applied_now: list[Migration] = []

    for migration in migrations:
        if migration.version in done:
            if done[migration.version] != migration.checksum:
                raise MigratorError(
                    "MIGRATION_CHECKSUM_MISMATCH",
                    f"{migration.path.name} changed after being applied; "
                    "restore it or add a new migration",
                )
            continue

        try:
            conn.execute("BEGIN")
            for stmt in _statements(migration.sql):
                conn.execute(stmt)
            conn.execute(
                "INSERT INTO schema_migrations(version, applied_at, checksum) VALUES (?,?,?)",
                (migration.version, now or int(time.time()), migration.checksum),
            )
            conn.execute("COMMIT")
        except sqlite3.Error as exc:
            conn.execute("ROLLBACK")
            raise MigratorError(
                "MIGRATION_FAILED", f"{migration.path.name}: {exc}"
            ) from exc

        applied_now.append(migration)

    if migrations:
        conn.execute(f"PRAGMA user_version = {max(m.version for m in migrations)}")
    return applied_now


def render(migrations: list[Migration]) -> str:
    parts: list[str] = []
    for m in migrations:
        parts.append(f"-- {m.path.name} (sha256 {m.checksum[:12]})")
        parts.append(_normalize(m.sql).rstrip())
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"
