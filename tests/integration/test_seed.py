"""M0-09: seed tenant + first admin (idempotent, hashed password)."""

# covers: T-AUTH-04

from __future__ import annotations

from pathlib import Path

from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin, hash_password, verify_password

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


def test_migrate_seeds_tenant_and_admin(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    try:
        m.apply(conn, m.discover(MIGRATIONS))
        tenants = conn.execute("SELECT tenant_id FROM tenants").fetchall()
        assert [r[0] for r in tenants] == ["default"]

        created, password = ensure_admin(conn)
        assert created is True
        assert password
        stored = conn.execute(
            "SELECT password_hash FROM users WHERE is_owner = 1"
        ).fetchone()[0]
        assert verify_password(stored, password)
        assert not verify_password(stored, "wrong-password")
    finally:
        conn.close()


def test_ensure_admin_is_idempotent(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    try:
        m.apply(conn, m.discover(MIGRATIONS))
        first, pw = ensure_admin(conn)
        second, pw2 = ensure_admin(conn)
        assert (first, second, pw2) == (True, False, "")
        count = conn.execute("SELECT count(*) FROM users WHERE is_owner = 1").fetchone()[0]
        assert count == 1
        assert verify_password(
            conn.execute("SELECT password_hash FROM users").fetchone()[0], pw
        )
    finally:
        conn.close()


def test_explicit_admin_password(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    try:
        m.apply(conn, m.discover(MIGRATIONS))
        created, pw = ensure_admin(conn, password="s3cret-for-test")
        assert created and pw == "s3cret-for-test"
    finally:
        conn.close()


def test_password_hash_roundtrip() -> None:
    stored = hash_password("hunter2")
    assert stored.startswith("scrypt$")
    assert verify_password(stored, "hunter2")
    assert not verify_password(stored, "hunter3")
    assert not verify_password("garbage", "hunter2")


def test_seed_sql_is_idempotent(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "t.db")
    try:
        migrations = m.discover(MIGRATIONS)
        m.apply(conn, migrations)
        # re-running the same migrations must not duplicate the tenant
        assert m.apply(conn, migrations) == []
        assert conn.execute("SELECT count(*) FROM tenants").fetchone()[0] == 1
    finally:
        conn.close()

