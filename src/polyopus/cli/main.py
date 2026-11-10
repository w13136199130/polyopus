"""CLI entrypoint. M0 scope: `doctor` (5 checks) and `migrate` (stub)."""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

from polyopus import __version__
from polyopus.config import load_settings

CHECK_OK = "OK"
CHECK_WARN = "WARN"
CHECK_FAIL = "FAIL"


def _check_python() -> tuple[str, str]:
    v = sys.version_info
    label = f"{v.major}.{v.minor}.{v.micro}"
    if (v.major, v.minor) == (3, 12):
        return CHECK_OK, f"Python {label}"
    return CHECK_FAIL, f"Python {label} (requires >=3.12,<3.13)"


def _check_data_dir(data_dir: Path) -> tuple[str, str]:
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        probe = data_dir / ".doctor-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return CHECK_OK, f"data dir writable: {data_dir}"
    except OSError as exc:
        return CHECK_FAIL, f"data dir not writable: {data_dir} ({exc})"


def _check_sqlite() -> tuple[str, str]:
    version = sqlite3.sqlite_version
    try:
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE VIRTUAL TABLE t USING fts5(x)")
        conn.close()
    except sqlite3.Error as exc:
        return CHECK_FAIL, f"SQLite {version} without FTS5 ({exc})"
    return CHECK_OK, f"SQLite {version} (FTS5 available)"


def _check_migrations(db_path: Path) -> tuple[str, str]:
    migrations = Path.cwd() / "migrations"
    if not migrations.is_dir():
        return CHECK_WARN, "migrations/ not found (M0-06..M0-10 pending)"
    scripts = sorted(migrations.glob("*.sql"))
    if not scripts:
        return CHECK_WARN, "migrations/ is empty (M0-08 pending)"
    if not db_path.exists():
        return CHECK_WARN, f"{len(scripts)} migration(s) pending; database not created"
    return CHECK_OK, f"{len(scripts)} migration file(s); db present: {db_path}"


def _check_clock() -> tuple[str, str]:
    now = datetime.now(UTC)
    return CHECK_OK, f"clock utc={now.isoformat(timespec='seconds')}"


def cmd_doctor(_: argparse.Namespace) -> int:
    settings = load_settings()
    db_path = settings.resolved_db_path()
    checks = [
        ("python", _check_python()),
        ("data-dir", _check_data_dir(settings.data_dir)),
        ("sqlite", _check_sqlite()),
        ("migrations", _check_migrations(db_path)),
        ("clock", _check_clock()),
    ]
    width = max(len(name) for name, _ in checks)
    failed = 0
    for name, (status, detail) in checks:
        print(f"{name:<{width}}  {status:<4}  {detail}")
        if status == CHECK_FAIL:
            failed += 1
    return 1 if failed else 0


def cmd_migrate(args: argparse.Namespace) -> int:
    print("poly migrate: not implemented yet (M0-06..M0-10)")
    if args.sql:
        print("--sql: pending")
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="poly", description="PolyOpus CLI")
    parser.add_argument("--version", action="version", version=f"poly {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    doctor = sub.add_parser("doctor", help="check local environment (5 checks)")
    doctor.set_defaults(func=cmd_doctor)

    migrate = sub.add_parser("migrate", help="apply database migrations")
    migrate.add_argument("--sql", action="store_true", help="print SQL instead of applying")
    migrate.add_argument("--check", action="store_true", help="report pending migrations only")
    migrate.set_defaults(func=cmd_migrate)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result
