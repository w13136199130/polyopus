"""CLI entrypoint. M0 scope: `doctor` (5 checks) and `migrate` (forward-only)."""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

from polyopus import __version__
from polyopus.config import load_settings
from polyopus.platform.db.migrator import (
    Migration,
    MigratorError,
    apply,
    connect,
    discover,
    pending,
    render,
)
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = ROOT / "migrations"

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
    if not MIGRATIONS_DIR.is_dir():
        return CHECK_WARN, "migrations/ not found (M0-06..M0-10 pending)"
    try:
        migrations = discover(MIGRATIONS_DIR)
    except MigratorError as exc:
        return CHECK_FAIL, f"{exc.code}: {exc.message}"
    if not migrations:
        return CHECK_WARN, "migrations/ is empty (M0-08 pending)"
    if not db_path.exists():
        return CHECK_WARN, f"{len(migrations)} migration(s) pending; database not created"
    conn = connect(db_path)
    try:
        pend = pending(conn, migrations)
    except MigratorError as exc:
        return CHECK_FAIL, f"{exc.code}: {exc.message}"
    finally:
        conn.close()
    if pend:
        return CHECK_WARN, f"{len(pend)} pending of {len(migrations)}; run poly migrate"
    return CHECK_OK, f"{len(migrations)} migration(s) applied; db {db_path}"


def _check_clock() -> tuple[str, str]:
    now = datetime.now(UTC)
    return CHECK_OK, f"clock utc={now.isoformat(timespec='seconds')}"


def _check_model(settings: object) -> tuple[str, str]:
    from polyopus.domains.agents import Registry
    from polyopus.platform.db.migrator import connect

    db_path = settings.resolved_db_path()  # type: ignore[attr-defined]
    conn = connect(db_path) if db_path.exists() else None
    try:
        registry = Registry(
            conn,
            env_base_url=settings.model_base_url,  # type: ignore[attr-defined]
            env_api_key=settings.model_api_key,  # type: ignore[attr-defined]
            env_model=settings.model_name,  # type: ignore[attr-defined]
        )
        return registry.probe()
    finally:
        if conn is not None:
            conn.close()


def cmd_doctor(_: argparse.Namespace) -> int:
    settings = load_settings()
    db_path = settings.resolved_db_path()
    checks = [
        ("python", _check_python()),
        ("data-dir", _check_data_dir(settings.data_dir)),
        ("sqlite", _check_sqlite()),
        ("migrations", _check_migrations(db_path)),
        ("clock", _check_clock()),
        ("model", _check_model(settings)),
    ]
    width = max(len(name) for name, _ in checks)
    failed = 0
    for name, (status, detail) in checks:
        print(f"{name:<{width}}  {status:<4}  {detail}")
        if status == CHECK_FAIL:
            failed += 1
    return 1 if failed else 0


def _pending_migrations(db_path: Path) -> list[Migration]:
    migrations = discover(MIGRATIONS_DIR)
    if not db_path.exists():
        return migrations
    conn = connect(db_path)
    try:
        return pending(conn, migrations)
    finally:
        conn.close()


def cmd_migrate(args: argparse.Namespace) -> int:
    settings = load_settings()
    db_path = settings.resolved_db_path()
    fresh = not db_path.exists()
    created_admin = False
    one_time_password = ""

    try:
        migrations = discover(MIGRATIONS_DIR)
        if args.sql:
            print(render(_pending_migrations(db_path)), end="")
            return 0
        if args.check:
            pend = _pending_migrations(db_path)
            if pend:
                names = ", ".join(m.path.name for m in pend)
                print(f"{len(pend)} pending: {names}\nrun: poly migrate")
                return 1
            print("up to date")
            return 0

        conn = connect(db_path)
        try:
            applied = apply(conn, migrations)
            if fresh and applied:
                created_admin, one_time_password = ensure_admin(
                    conn, password=os.environ.get("POLY_ADMIN_PASSWORD")
                )
        finally:
            conn.close()
    except MigratorError as exc:
        print(f"{exc.code}: {exc.message}", file=sys.stderr)
        return 1

    if applied:
        print("applied: " + ", ".join(m.path.name for m in applied))
    else:
        print("up to date")

    if created_admin:
        print(f"admin created: username=admin password={one_time_password}")
        print("store this password now; it will not be shown again")
    return 0


def cmd_recover(args: argparse.Namespace) -> int:
    from polyopus.platform.events.store import EventStore
    from polyopus.platform.telemetry import log as tlog
    from polyopus.platform.telemetry import tracing
    from polyopus.workers.recovery import recover_and_resume

    tlog.configure()
    tlog.set_trace_id(tlog.new_trace_id())
    settings = load_settings()
    conn = connect(settings.resolved_db_path())
    try:
        with tracing.span("run.recover", owner=args.owner):
            recovered = recover_and_resume(
                conn, EventStore(conn), owner=args.owner, delay=args.delay
            )
    finally:
        conn.close()

    if not recovered:
        print("nothing to recover")
        return 0
    for item in recovered:
        print(
            f"recovered {item.turn_id}: attempt {item.attempt} "
            f"from step {item.from_step} (run {item.new_run_id})"
        )
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("polyopus.api.app:app", host=args.host, port=args.port, reload=args.reload)
    return 0


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

    recover = sub.add_parser("recover", help="resume runs whose lease expired")
    recover.add_argument("--owner", default="cli")
    recover.add_argument("--delay", type=float, default=0.0)
    recover.set_defaults(func=cmd_recover)

    serve = sub.add_parser("serve", help="run the HTTP API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(func=cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result
