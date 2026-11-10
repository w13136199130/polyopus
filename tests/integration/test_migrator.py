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
        assert [x.version for x in applied] == [1]
        assert CORE <= _tables(conn)
        count = conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0]
        assert count == 1
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
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
        assert [x.version for x in m.pending(conn, migrations)] == [1]
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
