"""Extract canonical DDL from docs/31 into a machine-readable manifest.

M0-06. The design doc is the single source of truth for schema; this tool
proves it is machine-usable and keeps generated SQL in sync.

Usage:
    python tools/extract_ddl.py --check     # validate inventory + checksums
    python tools/extract_ddl.py --emit      # rewrite manifest + 0001_core.sql
    python tools/extract_ddl.py --print tenants
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "31-全量数据模型与DDL.md"
MIGRATIONS = ROOT / "migrations"
MANIFEST = MIGRATIONS / "_manifest.json"
CORE_SQL = MIGRATIONS / "0001_core.sql"
INTAKE_SQL = MIGRATIONS / "0003_intake.sql"
QUEUE_SQL = MIGRATIONS / "0004_queue.sql"
AUTH_SQL = MIGRATIONS / "0005_auth.sql"

# 8 names listed in docs/31 as deferred/merged: they must have no DDL.
DEFERRED = [
    "workflows",
    "workflow_runs",
    "bridge_connections",
    "acp_runners",
    "thread_participants",
    "source_cursors",
    "agent_storage_bindings",
    "feature_flags",
]

# M1 auth subset (sessions are not in the M0 core).
AUTH_TABLES = ["sessions"]

# M1 queue subset (platform-level, used by Outbox).
QUEUE_TABLES = ["outbox"]

# M1 intake subset (tickets/assignments already ship in 0001).
INTAKE_TABLES = [
    "sources",
    "triggers",
    "evals",
    "mandates",
    "reports",
    "timeline_events",
    "cron_jobs",
    "cron_runs",
    "watchdog_alerts",
]

# M0 core subset, in dependency order. `schema_migrations` is bootstrapped by
# the migrator (same shape as docs/31 §2.7), so it is not emitted here.
CORE_TABLES = [
    "tenants",
    "users",
    "threads",
    "messages",
    "turns",
    "runs",
    "steps",
    "events",
    "tickets",
    "attentions",
    "usage_ledger",
]

DIALECT_PATTERNS = {
    "pg": r"\b(JSONB|BIGSERIAL|timestamptz|uuid_generate_v4|gen_random_uuid)\b|::",
    "vector": r"\bvector\s*\(",
}

TABLE_RE = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)", re.I)
INDEX_RE = re.compile(
    r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)", re.I
)


class ExtractError(RuntimeError):
    pass


def _blocks(text: str) -> list[str]:
    return re.findall(r"```sql\n(.*?)```", text, re.S)


def _statements(sql: str) -> list[str]:
    """Split a block into complete SQL statements (SQLite-aware)."""
    out: list[str] = []
    buf = ""
    for line in sql.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            stmt = buf.strip()
            if stmt:
                out.append(stmt)
            buf = ""
    tail = buf.strip()
    if tail and not tail.startswith("--"):
        raise ExtractError(f"incomplete SQL statement at end of block: {tail[:60]!r}")
    return out


def _strip_leading_comments(stmt: str) -> str:
    lines = [ln for ln in stmt.splitlines() if not ln.strip().startswith("--")]
    return "\n".join(lines).strip()


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def extract() -> dict[str, Any]:
    if not DOC.is_file():
        raise ExtractError(f"missing {DOC}")
    text = DOC.read_text(encoding="utf-8")
    tables: dict[str, dict[str, Any]] = {}
    indexes: dict[str, dict[str, Any]] = {}
    notes: dict[str, list[str]] = {}

    for block in _blocks(text):
        for stmt in _statements(block):
            body = _strip_leading_comments(stmt)
            m = TABLE_RE.match(body)
            if m:
                name = m.group(1)
                if name in tables:
                    raise ExtractError(f"duplicate CREATE TABLE {name}")
                tables[name] = {"ddl": stmt, "sha256": _sha(stmt), "indexes": []}
                for kind, pat in DIALECT_PATTERNS.items():
                    if re.search(pat, stmt, re.I):
                        notes.setdefault(name, []).append(kind)
                continue
            m = INDEX_RE.match(body)
            if m:
                idx, table = m.group(1), m.group(2)
                indexes[idx] = {"table": table, "ddl": stmt, "sha256": _sha(stmt)}
                continue
            # Other DDL (views/triggers) is out of scope for M0.

    for idx, meta in indexes.items():
        if meta["table"] not in tables:
            raise ExtractError(f"index {idx} references unknown table {meta['table']}")
        tables[meta["table"]]["indexes"].append(idx)

    return {
        "source": str(DOC.relative_to(ROOT)).replace("\\", "/"),
        "generated_by": "tools/extract_ddl.py",
        "counts": {"first": len(tables), "candidate": len(tables) + len(DEFERRED),
                   "indexes": len(indexes)},
        "deferred": DEFERRED,
        "core": CORE_TABLES,
        "dialect_notes": notes,
        "tables": tables,
        "indexes": indexes,
    }


def validate(manifest: dict[str, Any]) -> None:
    tables = manifest["tables"]
    if len(tables) != 94:
        raise ExtractError(f"expected 94 tables, got {len(tables)}")
    leaked = sorted(set(DEFERRED) & set(tables))
    if leaked:
        raise ExtractError(f"deferred tables must have no DDL: {leaked}")
    missing = [t for t in CORE_TABLES if t not in tables]
    if missing:
        raise ExtractError(f"core tables missing DDL: {missing}")


def render_subset(manifest: dict[str, Any], tables: list[str], header: list[str]) -> str:
    lines = [
        "-- GENERATED by tools/extract_ddl.py --emit. DO NOT EDIT.",
        "-- Source: docs/31-全量数据模型与DDL.md (first version: 94 tables).",
        *[f"-- {line}" for line in header],
        "",
    ]
    for name in tables:
        lines.append(manifest["tables"][name]["ddl"])
        lines.append("")
        for idx in manifest["tables"][name]["indexes"]:
            lines.append(manifest["indexes"][idx]["ddl"])
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_core(manifest: dict[str, Any]) -> str:
    return render_subset(
        manifest,
        CORE_TABLES,
        ["M0 core subset (11 tables); schema_migrations is bootstrapped by the migrator."],
    )


def render_intake(manifest: dict[str, Any]) -> str:
    return render_subset(
        manifest,
        INTAKE_TABLES,
        ["M1 intake subset (9 tables); tickets/assignments ship in 0001_core.sql."],
    )


def render_queue(manifest: dict[str, Any]) -> str:
    return render_subset(
        manifest,
        QUEUE_TABLES,
        ["M1 queue subset: transactional outbox (docs/31 §2.7)."],
    )


def render_auth(manifest: dict[str, Any]) -> str:
    return render_subset(
        manifest,
        AUTH_TABLES,
        ["M1 auth subset: sessions (docs/31 §2.1)."],
    )


def _previous_manifest() -> dict[str, Any] | None:
    if not MANIFEST.is_file():
        return None
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def check(manifest: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    try:
        validate(manifest)
    except ExtractError as exc:
        problems.append(str(exc))

    prev = _previous_manifest()
    if prev is None:
        problems.append("migrations/_manifest.json missing; run --emit")
        return problems
    if prev.get("tables") != manifest["tables"]:
        problems.append("manifest tables out of sync; run --emit")
    if prev.get("indexes") != manifest["indexes"]:
        problems.append("manifest indexes out of sync; run --emit")

    for path, render in (
        (CORE_SQL, render_core),
        (INTAKE_SQL, render_intake),
        (QUEUE_SQL, render_queue),
        (AUTH_SQL, render_auth),
    ):
        expected = render(manifest)
        if not path.is_file():
            problems.append(f"migrations/{path.name} missing; run --emit")
        elif path.read_text(encoding="utf-8").replace("\r\n", "\n") != expected:
            problems.append(f"{path.name} out of sync; run --emit")
    return problems


def emit(manifest: dict[str, Any]) -> None:
    validate(manifest)
    MIGRATIONS.mkdir(exist_ok=True)
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    CORE_SQL.write_text(render_core(manifest), encoding="utf-8", newline="\n")
    INTAKE_SQL.write_text(render_intake(manifest), encoding="utf-8", newline="\n")
    QUEUE_SQL.write_text(render_queue(manifest), encoding="utf-8", newline="\n")
    AUTH_SQL.write_text(render_auth(manifest), encoding="utf-8", newline="\n")
    print(f"wrote {MANIFEST.relative_to(ROOT)} ({len(manifest['tables'])} tables)")
    print(f"wrote {CORE_SQL.relative_to(ROOT)} ({len(CORE_TABLES)} tables)")
    print(f"wrote {INTAKE_SQL.relative_to(ROOT)} ({len(INTAKE_TABLES)} tables)")
    print(f"wrote {QUEUE_SQL.relative_to(ROOT)} ({len(QUEUE_TABLES)} tables)")
    print(f"wrote {AUTH_SQL.relative_to(ROOT)} ({len(AUTH_TABLES)} tables)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="extract DDL from docs/31")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="validate inventory and sync")
    group.add_argument("--emit", action="store_true", help="rewrite manifest and 0001_core.sql")
    group.add_argument("--print", metavar="TABLE", help="print one table's DDL")
    args = parser.parse_args(argv)

    try:
        manifest = extract()
    except ExtractError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if args.print:
        meta = manifest["tables"].get(args.print)
        if not meta:
            print(f"unknown table: {args.print}", file=sys.stderr)
            return 1
        print(meta["ddl"])
        return 0

    if args.emit:
        emit(manifest)
        return 0

    problems = check(manifest)
    if problems:
        for p in problems:
            print(f"- {p}", file=sys.stderr)
        return 1
    counts = manifest["counts"]
    print(
        f"OK: {counts['first']} tables / {counts['indexes']} indexes "
        f"(candidate {counts['candidate']}, deferred {len(DEFERRED)})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
