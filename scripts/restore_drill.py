#!/usr/bin/env python
"""V1-07 restore drill: backup -> delete DB -> restore -> verify.

By default everything runs in a temporary directory; pass `--db` only when
you intentionally want to drill a copy of a real database.

Usage:
    uv run python scripts/restore_drill.py
    uv run python scripts/restore_drill.py --db data/drill.db --data-dir data

Exit code 0 only when event seq is continuous, ticket/report match, and the
local RTO is within 30 minutes (docs/50 V1-07).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from polyopus.domains.backup import service as backup  # noqa: E402
from polyopus.platform.db import migrator as m  # noqa: E402
from polyopus.platform.db.seed import ensure_admin  # noqa: E402

MIGRATIONS = ROOT / "migrations"
RTO_LIMIT_SECONDS = 30 * 60


def _seed(db: Path, workspace: Path) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "drill.txt").write_text("drill-workspace", encoding="utf-8")
    conn = m.connect(db)
    try:
        m.apply(conn, m.discover(MIGRATIONS))
        ensure_admin(conn, password="drill-password")
        now = int(time.time())
        conn.execute(
            "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
            " created_at, updated_at) VALUES ('default', 'th_drill', 'system',"
            " 'drill', 'active', ?, ?)", (now, now),
        )
        for seq in (1, 2, 3):
            conn.execute(
                "INSERT INTO events (tenant_id, thread_id, seq, type,"
                " payload_json, ts) VALUES ('default', 'th_drill', ?,"
                " 'turn.queued', '{}', ?)", (seq, now),
            )
        conn.execute(
            "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
            " strength, policy_version, scope_json, created_at, updated_at)"
            " VALUES ('default', 'tk_drill', 'drill ticket', 'open', 'queued',"
            " 'explicit', 1, '[]', ?, ?)", (now, now),
        )
        conn.execute(
            "INSERT INTO reports (report_id, tenant_id, ticket_id,"
            " assignment_id, state, summary, progress, facts_json, created_at)"
            " VALUES ('rp_drill', 'default', 'tk_drill', 'as_drill', 'ready',"
            " 'drill report', 1.0, '{}', ?)", (now,),
        )
        conn.commit()
    finally:
        conn.close()


def _verify(db: Path, workspace: Path) -> dict[str, object]:
    conn = m.connect(db)
    try:
        seqs = [
            int(row[0]) for row in conn.execute(
                "SELECT seq FROM events WHERE thread_id = 'th_drill' ORDER BY seq"
            ).fetchall()
        ]
        ticket = conn.execute(
            "SELECT state FROM tickets WHERE ticket_id = 'tk_drill'"
        ).fetchone()
        report = conn.execute(
            "SELECT state, summary FROM reports WHERE report_id = 'rp_drill'"
        ).fetchone()
    finally:
        conn.close()
    workspace_file = workspace / "drill.txt"
    return {
        "eventSeq": seqs,
        "ticketState": str(ticket[0]) if ticket else None,
        "reportState": str(report[0]) if report else None,
        "reportSummary": str(report[1]) if report else None,
        "workspaceRestored": (
            workspace_file.is_file()
            and workspace_file.read_text(encoding="utf-8") == "drill-workspace"
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="backup/restore drill")
    parser.add_argument("--db", default=None, help="drill DB path (default: temp)")
    parser.add_argument("--data-dir", default=None, help="backup output dir")
    args = parser.parse_args(argv)

    with tempfile.TemporaryDirectory(prefix="poly-drill-") as tmp:
        base = Path(tmp)
        db = Path(args.db) if args.db else base / "drill.db"
        data_dir = Path(args.data_dir) if args.data_dir else base / "data"
        workspace = base / "workspace"
        _seed(db, workspace)

        conn = m.connect(db)
        try:
            made = backup.create_backup(
                conn, db_path=db, data_dir=data_dir, workspace_dir=workspace,
            )
        finally:
            conn.close()
        backup_id = str(made["backupId"])

        for suffix in ("", "-wal", "-shm"):
            path = Path(str(db) + suffix)
            if path.exists():
                path.unlink()
        for path in (workspace / "drill.txt",):
            if path.exists():
                path.unlink()

        started = time.perf_counter()
        restored_conn = m.connect(db)
        try:
            restored = backup.restore_backup(
                restored_conn, backup_id, workspace_dir=workspace,
                data_dir=data_dir,
            )
        finally:
            restored_conn.close()
        rto = time.perf_counter() - started

        evidence = _verify(db, workspace)
        ok = (
            evidence["eventSeq"] == [1, 2, 3]
            and evidence["ticketState"] == "open"
            and evidence["reportState"] == "ready"
            and evidence["reportSummary"] == "drill report"
            and evidence["workspaceRestored"] is True
            and restored["status"] == "restored"
            and rto <= RTO_LIMIT_SECONDS
        )
        print(json.dumps({
            "ok": ok,
            "backupId": backup_id,
            "rtoSeconds": round(rto, 3),
            "rtoLimitSeconds": RTO_LIMIT_SECONDS,
            **evidence,
        }, ensure_ascii=False, indent=2))
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
