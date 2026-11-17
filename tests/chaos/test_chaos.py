"""V1-19 chaos: concurrency, DB lock, clock jumps and failed backups."""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from polyopus.domains import conversations
from polyopus.domains.backup import service as backup
from polyopus.domains.intake import schedule
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "p"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[Path, str]]:
    db = tmp_path / "chaos.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    owner = str(conn.execute(
        "SELECT user_id FROM users WHERE is_owner = 1"
    ).fetchone()[0])
    now = int(time.time())
    for index in range(20):
        conn.execute(
            "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
            " created_at, updated_at) VALUES ('default', ?, ?, 'chaos', 'active',"
            " ?, ?)", (f"th_ch_{index}", owner, now, now),
        )
    conn.commit()
    conn.close()
    yield db, owner


def test_twenty_concurrent_turns_no_loss_or_duplicate(
    env: tuple[Path, str], tmp_path: Path,
) -> None:
    db, owner = env

    def post(index: int) -> bool:
        conn = m.connect(db)
        try:
            conversations.post_turn(
                conn, EventStore(conn), tenant_id="default", owner_id=owner,
                thread_id=f"th_ch_{index}", content=f"chaos {index}",
            )
            return True
        finally:
            conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        assert all(pool.map(post, range(20)))

    conn = m.connect(db)
    try:
        queued = [
            str(row[0]) for row in conn.execute(
                "SELECT turn_id FROM turns WHERE status = 'queued' ORDER BY id"
            ).fetchall()
        ]
        assert len(queued) == 20
        for turn_id in queued:
            result = asyncio.run(engine.run_turn(
                conn, EventStore(conn), turn_id, owner="chaos",
                config=engine.EngineConfig(workspace=tmp_path / "ws"),
            ))
            assert result == "completed"
        statuses = conn.execute(
            "SELECT status, count(*) FROM turns GROUP BY status"
        ).fetchall()
        finished = conn.execute(
            "SELECT turn_id, count(*) FROM events WHERE type = 'turn.finished'"
            " GROUP BY turn_id"
        ).fetchall()
    finally:
        conn.close()
    assert dict(statuses)["completed"] == 20
    assert len(finished) == 20
    assert all(int(row[1]) == 1 for row in finished)


def test_db_lock_waits_instead_of_losing_a_turn(env: tuple[Path, str]) -> None:
    db, owner = env
    blocker = m.connect(db)
    blocker.execute("BEGIN IMMEDIATE")
    timer = threading.Timer(0.3, blocker.commit)
    timer.start()
    conn = m.connect(db)
    try:
        turn_id, _ = conversations.post_turn(
            conn, EventStore(conn), tenant_id="default", owner_id=owner,
            thread_id="th_ch_0", content="under lock",
        )
        assert turn_id
    finally:
        conn.close()
        timer.cancel()
        blocker.close()


def test_clock_jump_does_not_double_fire(env: tuple[Path, str]) -> None:
    db, _owner = env
    conn = m.connect(db)
    try:
        store = EventStore(conn)
        source_id = schedule.create_schedule_source(
            conn, name="chaos-src", timezone="Asia/Shanghai"
        )
        schedule.upsert_job(
            conn, source_id=source_id, name="chaos", schedule="interval:300",
            timezone="Asia/Shanghai", text="[chaos] tick",
        )
        base = int(time.time())
        first = schedule.run_due(conn, store, now=base + 301)
        backwards = schedule.run_due(conn, store, now=base - 10000)
        later = schedule.run_due(conn, store, now=base + 1300)
        tickets = conn.execute("SELECT count(*) FROM tickets").fetchone()[0]
    finally:
        conn.close()
    assert first == 1
    assert backwards == 0
    assert later == 1
    assert tickets == 2


def test_failed_backup_leaves_data_intact(
    env: tuple[Path, str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    db, _owner = env
    conn = m.connect(db)
    try:
        def explode(_: Path) -> str:
            raise OSError("disk full")

        monkeypatch.setattr(backup, "_sha256", explode)
        with pytest.raises(OSError):
            backup.create_backup(
                conn, db_path=db, data_dir=tmp_path / "data",
                workspace_dir=None,
            )
        row = conn.execute(
            "SELECT status FROM backups ORDER BY id DESC LIMIT 1"
        ).fetchone()
        still = conn.execute("SELECT count(*) FROM threads").fetchone()[0]
    finally:
        conn.close()
    assert row is not None and row[0] == "failed"
    assert still == 20
