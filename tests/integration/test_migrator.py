"""M0-07 / M0-08: migrator correctness on the generated core schema."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from polyopus.platform.db import migrator as m

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"

CORE = {
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
    "schema_migrations",
}


def _tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(r[0]) for r in rows}


def test_core_migration_creates_twelve_tables(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    try:
        applied = m.apply(conn, m.discover(MIGRATIONS))
        assert [x.version for x in applied] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        assert CORE <= _tables(conn)
        assert {"sources", "triggers", "evals", "mandates", "reports", "outbox", "sessions", "approvals", "providers", "models"} <= _tables(conn)
        count = conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0]
        assert count == 10
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 10
    finally:
        conn.close()


def test_second_apply_is_noop(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    try:
        migrations = m.discover(MIGRATIONS)
        m.apply(conn, migrations)
        assert m.apply(conn, migrations) == []
        assert m.pending(conn, migrations) == []
    finally:
        conn.close()


def test_pending_before_apply(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    try:
        migrations = m.discover(MIGRATIONS)
        assert [x.version for x in m.pending(conn, migrations)] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    finally:
        conn.close()


def test_checksum_mismatch_is_rejected(tmp_path: Path) -> None:
    mig_dir = tmp_path / "migrations"
    mig_dir.mkdir()
    shutil.copy(MIGRATIONS / "0001_core.sql", mig_dir / "0001_core.sql")
    db = tmp_path / "t.db"

    conn = m.connect(db)
    try:
        m.apply(conn, m.discover(mig_dir))
        (mig_dir / "0001_core.sql").write_text(
            (mig_dir / "0001_core.sql").read_text(encoding="utf-8") + "\n-- tampered\n",
            encoding="utf-8",
        )
        with pytest.raises(m.MigratorError) as exc:
            m.apply(conn, m.discover(mig_dir))
        assert exc.value.code == "MIGRATION_CHECKSUM_MISMATCH"
    finally:
        conn.close()


def test_render_contains_all_migrations() -> None:
    text = m.render(m.discover(MIGRATIONS))
    assert "CREATE TABLE tenants" in text
    assert "CREATE TABLE events" in text
    assert "sha256" in text


def test_invalid_migration_name_rejected(tmp_path: Path) -> None:
    mig_dir = tmp_path / "migrations"
    mig_dir.mkdir()
    (mig_dir / "core.sql").write_text("SELECT 1;", encoding="utf-8")
    with pytest.raises(m.MigratorError) as exc:
        m.discover(mig_dir)
    assert exc.value.code == "MIGRATION_NAME_INVALID"


def _copy(tmp_path: Path, *names: str) -> Path:
    mig_dir = tmp_path / "migrations"
    mig_dir.mkdir(exist_ok=True)
    for name in names:
        shutil.copy(MIGRATIONS / name, mig_dir / name)
    return mig_dir


def test_partial_upgrade_applies_only_new(tmp_path: Path) -> None:
    mig_dir = _copy(tmp_path, "0001_core.sql", "0002_seed.sql")
    conn = m.connect(tmp_path / "t.db")
    try:
        all_migrations = m.discover(mig_dir)
        assert [x.version for x in m.apply(conn, [all_migrations[0]])] == [1]
        assert [x.version for x in m.apply(conn, all_migrations)] == [2]
        assert m.pending(conn, all_migrations) == []
    finally:
        conn.close()


def test_failed_migration_rolls_back(tmp_path: Path) -> None:
    mig_dir = tmp_path / "migrations"
    mig_dir.mkdir()
    (mig_dir / "0001_ok.sql").write_text("CREATE TABLE ok (id INTEGER);", encoding="utf-8")
    (mig_dir / "0002_bad.sql").write_text(
        "CREATE TABLE bad (id INTEGER);\nINSERT INTO missing_table VALUES (1);",
        encoding="utf-8",
    )
    conn = m.connect(tmp_path / "t.db")
    try:
        with pytest.raises(m.MigratorError) as exc:
            m.apply(conn, m.discover(mig_dir))
        assert exc.value.code == "MIGRATION_FAILED"
        assert "ok" in _tables(conn)
        assert "bad" not in _tables(conn)
        versions = [r[0] for r in conn.execute("SELECT version FROM schema_migrations")]
        assert versions == [1]
    finally:
        conn.close()


def test_schema_too_new_is_rejected(tmp_path: Path) -> None:
    mig_dir = _copy(tmp_path, "0001_core.sql", "0002_seed.sql")
    conn = m.connect(tmp_path / "t.db")
    try:
        migrations = m.discover(mig_dir)
        m.apply(conn, migrations)
        with pytest.raises(m.MigratorError) as exc:
            m.pending(conn, [migrations[0]])
        assert exc.value.code == "SCHEMA_TOO_NEW"
    finally:
        conn.close()
