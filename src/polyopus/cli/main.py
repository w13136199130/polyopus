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


def _migrate_and_seed() -> int:
    """docs/16 §6: auto-migrate at startup; first boot seeds the owner."""
    import os

    from polyopus.platform.db.seed import ensure_admin

    if os.environ.get("POLY_E2E_RESET") == "1":
        # hermetic e2e backends: start from a pristine db+workspace every
        # run (playwright.config sets this) — shared-state leftovers have
        # poisoned runs before (memory atoms leaking between specs)
        import shutil

        settings_for_reset = load_settings()
        db = settings_for_reset.resolved_db_path()
        if db.exists():
            db.unlink()
        for suffix in ("-wal", "-shm"):
            side = db.with_name(db.name + suffix)
            if side.exists():
                side.unlink()
        ws = settings_for_reset.workspace_dir
        if ws.exists():
            shutil.rmtree(ws, ignore_errors=True)
        print(f"e2e reset: removed {db}")

    settings = load_settings()
    try:
        migrations = discover(MIGRATIONS_DIR)
        fresh = not settings.resolved_db_path().exists()
        conn = connect(settings.resolved_db_path())
        try:
            applied = apply(conn, migrations)
            if fresh and applied:
                created, password = ensure_admin(
                    conn, password=os.environ.get("POLY_ADMIN_PASSWORD")
                )
                if created:
                    print(f"admin created: username=admin password={password}")
                    print("store this password now; it will not be shown again")
        finally:
            conn.close()
    except MigratorError as exc:
        print(f"{exc.code}: {exc.message}", file=sys.stderr)
        print("server not started; fix the database above (docs/16 §6)", file=sys.stderr)
        return 1
    if applied:
        print("migrated: " + ", ".join(m.path.name for m in applied))
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    if _migrate_and_seed() != 0:
        return 1
    if args.no_worker:
        # queue is drained by a standalone `poly worker` process instead
        import os

        os.environ["POLY_EMBEDDED_WORKER"] = "false"
    uvicorn.run("polyopus.api.app:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def cmd_worker(args: argparse.Namespace) -> int:
    import threading

    from polyopus.platform.events.store import EventStore  # noqa: F401 (warm import)
    from polyopus.workers.data_jobs_loop import run_data_jobs_loop
    from polyopus.workers.outbox_loop import run_outbox_loop
    from polyopus.workers.ticket_loop import run_ticket_loop
    from polyopus.workers.worker_loop import run_worker_loop

    if _migrate_and_seed() != 0:
        return 1
    settings = load_settings()
    stop = threading.Event()
    db_path = settings.resolved_db_path
    print(f"worker: polling queued turns + tickets + outbox + data jobs on {db_path()}")

    turn_thread = threading.Thread(
        target=run_worker_loop, args=(db_path,),
        kwargs={"stop": stop, "max_turns": args.once or None},
        name="turn-worker", daemon=True,
    )
    ticket_thread = threading.Thread(
        target=run_ticket_loop, args=(db_path,),
        kwargs={"stop": stop, "max_tickets": args.once or None},
        name="ticket-worker", daemon=True,
    )
    outbox_thread = threading.Thread(
        target=run_outbox_loop, args=(db_path,),
        kwargs={"stop": stop},
        name="outbox-worker", daemon=True,
    )
    from polyopus.workers.scheduler_loop import run_scheduler_loop

    scheduler_thread = threading.Thread(
        target=run_scheduler_loop, args=(db_path,),
        kwargs={"stop": stop},
        name="scheduler-worker", daemon=True,
    )
    data_jobs_thread = threading.Thread(
        target=run_data_jobs_loop, args=(db_path,),
        kwargs={"stop": stop},
        name="data-jobs-worker", daemon=True,
    )
    crew = (
        turn_thread, ticket_thread, outbox_thread, scheduler_thread,
        data_jobs_thread,
    )
    for thread in crew:
        thread.start()
    try:
        while any(t.is_alive() for t in crew):
            for t in crew:
                t.join(0.5)
    except KeyboardInterrupt:
        stop.set()
        for t in crew:
            t.join(5)
    print("worker: stopped")
    return 0


def _policy_conn() -> sqlite3.Connection:
    from polyopus.platform.db import migrator as m

    settings = load_settings()
    conn = m.connect(settings.resolved_db_path())
    m.apply(conn, m.discover(MIGRATIONS_DIR))
    return conn


def cmd_policy(args: argparse.Namespace) -> int:
    """`poly policy show|publish|rollback|dry-run` (V05-12)."""
    import json as _json

    from polyopus.domains.policy import service as policy

    conn = _policy_conn()
    try:
        if args.action == "show":
            rules, version, source = policy.resolve_rules(conn)
            print(f"active: version={version} source={source} rules={len(rules)}")
            for rule in rules:
                print(f"  [{rule.priority:>3}] {rule.rid}: {rule.effect} {rule.when}")
        elif args.action == "publish":
            rows = _json.loads(Path(args.file).read_text(encoding="utf-8"))
            rules = [policy.rule_from_dict(row) for row in rows]
            out = policy.publish(conn, rules, by=os.environ.get("USERNAME") or "cli")
            print(f"published: version={out['version']} rules={out['rules']}")
        elif args.action == "rollback":
            out = policy.rollback(conn, int(args.to), by="cli")
            print(f"rolled back: version={out['version']}")
        elif args.action == "dry-run":
            samples = _json.loads(Path(args.file).read_text(encoding="utf-8"))
            version = int(args.version) if args.version else None
            out = policy.dry_run(conn, samples, version=version)
            print(f"dry-run: version={out['version']} counts={out['counts']}")
            for result in out["results"]:
                print(f"  {result['tool']}: {result['effect']} ({result['reason']})")
        return 0
    finally:
        conn.close()


def cmd_eval(args: argparse.Namespace) -> int:
    """`poly eval --gate` (V1-17) or the V05-13 dry-run."""
    if args.gate:
        from polyopus.eval import harness

        baseline = Path(args.baseline) if args.baseline else None
        return harness.run_gate(baseline)

    if not args.dry_run or not args.source:
        print("eval: pass --gate, or --dry-run with --source <id>")
        return 2
    from polyopus.domains.intake import assessment
    from polyopus.platform.events.store import EventStore

    conn = _policy_conn()
    try:
        counts = assessment.eval_dry_run(
            conn, EventStore(conn), args.source, hours=args.hours
        )
        total = sum(counts.values())
        print(f"dry-run: source={args.source} triggers={total} counts={counts}")
        print("no tickets were opened")
        return 0
    finally:
        conn.close()


def cmd_backup(args: argparse.Namespace) -> int:
    """`poly backup`: SQLite snapshot + workspace/artifacts manifest."""
    import json as _json

    from polyopus.domains.backup import service as backup
    from polyopus.platform.db import migrator as m

    settings = load_settings()
    conn = m.connect(settings.resolved_db_path())
    try:
        m.apply(conn, m.discover(MIGRATIONS_DIR))
        wanted = {item.strip() for item in args.include.split(",") if item.strip()}
        includes = {
            "db": True,
            "workspace": "workspace" in wanted,
            "artifacts": "artifacts" in wanted,
        }
        result = backup.create_backup(
            conn, db_path=settings.resolved_db_path(),
            data_dir=Path(settings.data_dir),
            workspace_dir=Path(settings.workspace_dir), includes=includes,
            auto=args.auto,
        )
        print(_json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    finally:
        conn.close()


def cmd_restore(args: argparse.Namespace) -> int:
    """`poly restore <backup_id>`: checksum + schema check, then DB restore."""
    import json as _json

    from polyopus.domains.backup import service as backup
    from polyopus.platform.db import migrator as m

    settings = load_settings()
    conn = m.connect(settings.resolved_db_path())
    try:
        result = backup.restore_backup(
            conn, args.backup_id, workspace_dir=Path(settings.workspace_dir),
            data_dir=Path(settings.data_dir),
        )
        print(_json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    finally:
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="poly", description="PolyOpus CLI")
    parser.add_argument("--version", action="version", version=f"poly {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    doctor = sub.add_parser("doctor", help="check local environment (5 checks)")
    doctor.set_defaults(func=cmd_doctor)

    ev = sub.add_parser("eval", help="deterministic eval gate / assessment dry-run")
    ev.add_argument("--gate", action="store_true",
                    help="run the four v1.0 eval suites and enforce the baseline")
    ev.add_argument("--baseline", default=None, help="baseline JSON path")
    ev.add_argument("--dry-run", action="store_true",
                    help="judge and write dispositions without opening tickets")
    ev.add_argument("--source", default=None, help="source id (src_...)")
    ev.add_argument("--hours", type=int, default=24, help="lookback window")
    ev.set_defaults(func=cmd_eval)

    migrate = sub.add_parser("migrate", help="apply database migrations")
    migrate.add_argument("--sql", action="store_true", help="print SQL instead of applying")
    migrate.add_argument("--check", action="store_true", help="report pending migrations only")
    migrate.set_defaults(func=cmd_migrate)

    policy = sub.add_parser("policy", help="policy bundles: show/publish/rollback/dry-run")
    policy_sub = policy.add_subparsers(dest="action", required=True)
    policy_show = policy_sub.add_parser("show", help="print the resolved active rules")
    policy_show.set_defaults(func=cmd_policy)
    policy_publish = policy_sub.add_parser("publish", help="publish a rules JSON as the next version")
    policy_publish.add_argument("--file", required=True, help="rules JSON file")
    policy_publish.set_defaults(func=cmd_policy)
    policy_rollback = policy_sub.add_parser("rollback", help="re-activate a previous version (LKG)")
    policy_rollback.add_argument("--to", required=True, help="target version")
    policy_rollback.set_defaults(func=cmd_policy)
    policy_dry = policy_sub.add_parser("dry-run", help="evaluate samples without touching the gate")
    policy_dry.add_argument("--file", required=True, help="samples JSON file")
    policy_dry.add_argument("--version", default=None, help="evaluate this version (default: resolved)")
    policy_dry.set_defaults(func=cmd_policy)

    recover = sub.add_parser("recover", help="resume runs whose lease expired")
    recover.add_argument("--owner", default="cli")
    recover.add_argument("--delay", type=float, default=0.0)
    recover.set_defaults(func=cmd_recover)

    serve = sub.add_parser("serve", help="run the HTTP API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")
    serve.add_argument("--no-worker", action="store_true",
                       help="do not embed the turn worker (run `poly worker` separately)")
    serve.set_defaults(func=cmd_serve)

    worker = sub.add_parser("worker", help="drain queued turns (standalone)")
    worker.add_argument("--once", type=int, default=None,
                        help="process at most N turns then exit")
    worker.set_defaults(func=cmd_worker)

    backup = sub.add_parser("backup", help="create a consistent backup")
    backup.add_argument("--include", default="db,workspace,artifacts",
                        help="comma list: db,workspace,artifacts")
    backup.add_argument("--auto", action="store_true", help="mark as auto backup")
    backup.set_defaults(func=cmd_backup)

    restore = sub.add_parser("restore", help="restore a backup by id")
    restore.add_argument("backup_id", help="bk_... id from `poly backup`")
    restore.set_defaults(func=cmd_restore)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result
