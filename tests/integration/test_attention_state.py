"""Inbox question/read/snooze state (no full turn required)."""

# covers: T-TASK-07

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from polyopus.domains.attention import service
from polyopus.platform.db import migrator as m
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
TENANT = "default"


@pytest.fixture()
def conn(tmp_path: Path) -> sqlite3.Connection:
    connection = m.connect(tmp_path / "inbox.db")
    m.apply(connection, m.discover(MIGRATIONS))
    yield connection
    connection.close()


def test_question_read_and_snooze(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    attention_id = service.request_question(
        conn, store,
        tenant_id=TENANT, thread_id="th_test", turn_id="tu_test",
        questions=[{"id": "q1", "question": "发布窗口选哪个？",
                    "options": ["今晚", "明天"]}],
    )
    row = conn.execute(
        "SELECT * FROM attentions WHERE attention_id = ?", (attention_id,)
    ).fetchone()
    assert row is not None
    assert row["kind"] == "question"
    assert row["read_at"] is None
    assert row["snoozed_until"] is None

    assert service.mark_read(conn, tenant_id=TENANT, attention_id=attention_id)
    assert conn.execute(
        "SELECT read_at FROM attentions WHERE attention_id = ?", (attention_id,)
    ).fetchone()[0] is not None

    until = int(time.time()) + 3600
    assert service.snooze(
        conn, tenant_id=TENANT, attention_id=attention_id, until=until,
    )
    assert conn.execute(
        "SELECT snoozed_until FROM attentions WHERE attention_id = ?", (attention_id,)
    ).fetchone()[0] == until

    updated = service.mark_all_read(conn, tenant_id=TENANT)
    assert updated == 0  # already read


def test_snooze_rejects_past_time(conn: sqlite3.Connection) -> None:
    store = EventStore(conn)
    attention_id = service.request_question(
        conn, store,
        tenant_id=TENANT, thread_id="th_test", turn_id="tu_test",
        questions=[{"id": "q1", "question": "继续？"}],
    )
    with pytest.raises(AppError) as exc:
        service.snooze(
            conn, tenant_id=TENANT, attention_id=attention_id, until=1,
        )
    assert exc.value.code == "VALIDATION_FAILED"
