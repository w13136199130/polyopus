"""V05-10 subscription fan-out (G7): same-thread triggers reach the open
ticket instead of opening new ones; ended tickets release the thread.

covers: docs/48 V05-10 验收 — 同一 webhook thread 连发 5 条 → 1 ticket +
4 条 fan_out，不新建 ticket。Direct service calls, no workers (the ticket
stays open, so every subsequent trigger fans out deterministically).
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from polyopus.domains.intake import service as intake
from polyopus.domains.tickets import service as tickets
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[tuple[sqlite3.Connection, EventStore, sqlite3.Row]]:
    conn = m.connect(tmp_path / "subs.db")
    m.apply(conn, m.discover(MIGRATIONS))
    now = int(time.time())
    conn.execute(
        "INSERT INTO sources (tenant_id, source_id, kind, name, config_json,"
        " status, created_at, updated_at) VALUES ('default', 'src_ci', 'webhook',"
        " 'ci', ?, 'active', ?, ?)",
        ('{"secret": "", "allow_actors": ["alice"], '
         '"explicit_patterns": ["/polyopus"]}', now, now),
    )
    conn.commit()
    source = conn.execute(
        "SELECT * FROM sources WHERE source_id = 'src_ci'"
    ).fetchone()
    yield conn, EventStore(conn), source
    conn.close()


def _fire(
    conn: sqlite3.Connection, store: EventStore, source: sqlite3.Row, *,
    external: str, thread_key: str = "ci-thread", actor: str = "alice",
    text: str = "/polyopus 请继续处理",
) -> tuple[str, str | None]:
    """receive + process: the full routing path minus HTTP."""
    trigger_id, _, _ = intake.receive(
        conn, store, source,
        {"external_id": external, "thread_key": thread_key,
         "actor": {"id": actor}, "text": text},
        None,
    )
    return trigger_id, intake.process(conn, store, source, trigger_id)


def _disposition(conn: sqlite3.Connection, trigger_id: str) -> str:
    return str(conn.execute(
        "SELECT disposition FROM triggers WHERE trigger_id = ?", (trigger_id,)
    ).fetchone()[0])


def _count(conn: sqlite3.Connection, sql: str, *params: object) -> int:
    return int(conn.execute(sql, params).fetchone()[0])


# ---- G7: 同 thread 5 条 → 1 ticket + 4 fan_out --------------------------------


def test_five_same_thread_triggers_one_ticket_four_fan_outs(
    env: tuple[sqlite3.Connection, EventStore, sqlite3.Row]
) -> None:
    conn, store, source = env
    _, first = _fire(conn, store, source, external="e1")
    assert first

    for i in range(2, 6):
        _, ticket = _fire(conn, store, source, external=f"e{i}")
        assert ticket == first  # fan out to the SAME open ticket

    rows = {
        str(r[0]): int(r[1])
        for r in conn.execute(
            "SELECT disposition, count(*) FROM triggers GROUP BY disposition"
        ).fetchall()
    }
    assert rows == {"accepted": 1, "fanned_out": 4}
    assert _count(conn, "SELECT count(*) FROM tickets") == 1
    assert _count(conn, "SELECT count(*) FROM subscriptions") == 1
    assert _count(
        conn, "SELECT count(*) FROM timeline_events WHERE kind = 'trigger_fanned_out'"
    ) == 4
    assert _count(
        conn, "SELECT count(*) FROM events WHERE type = 'trigger.fanned_out'"
    ) == 4


def test_fanout_bypasses_gate(
    env: tuple[sqlite3.Connection, EventStore, sqlite3.Row]
) -> None:
    """A trigger the Gate would reject (stranger actor, no explicit pattern)
    still reaches the subscribed open ticket (docs/09 §2.5 直通)."""
    conn, store, source = env
    _, first = _fire(conn, store, source, external="e1")
    assert first

    trigger_id, ticket = _fire(
        conn, store, source, external="e2", actor="stranger",
        text="plain text without the pattern",
    )
    assert ticket == first
    assert _disposition(conn, trigger_id) == "fanned_out"


# ---- message delivery on the execution thread ---------------------------------


def test_fanout_posts_turn_only_when_thread_is_idle(
    env: tuple[sqlite3.Connection, EventStore, sqlite3.Row]
) -> None:
    conn, store, source = env
    _, first = _fire(conn, store, source, external="e1")
    thread_id = tickets.thread_of_ticket(conn, str(first))

    _fire(conn, store, source, external="e2", text="/polyopus 补充甲")
    assert _count(
        conn, "SELECT count(*) FROM turns WHERE thread_id = ?", thread_id
    ) == 1

    # terminal latest turn -> idle again, next fan-out delivers
    conn.execute(
        "UPDATE turns SET status = 'completed' WHERE thread_id = ?", (thread_id,)
    )
    conn.commit()
    _fire(conn, store, source, external="e3", text="/polyopus 补充乙")
    assert _count(
        conn, "SELECT count(*) FROM turns WHERE thread_id = ?", thread_id
    ) == 2

    # busy thread (turn mid-flight) -> recorded only, no second concurrent turn
    conn.execute(
        "UPDATE turns SET status = 'running' WHERE thread_id = ?", (thread_id,)
    )
    conn.commit()
    _fire(conn, store, source, external="e4", text="/polyopus 补充丙")
    assert _count(
        conn, "SELECT count(*) FROM turns WHERE thread_id = ?", thread_id
    ) == 2
    assert _disposition(conn, conn.execute(
        "SELECT trigger_id FROM triggers WHERE json_extract(payload_json,"
        " '$.external_id') = 'e4'"
    ).fetchone()[0]) == "fanned_out"


# ---- release + the anti-leak invariant -----------------------------------------


def test_stop_releases_subscription_next_trigger_opens_new_ticket(
    env: tuple[sqlite3.Connection, EventStore, sqlite3.Row]
) -> None:
    conn, store, source = env
    _, first = _fire(conn, store, source, external="e1")

    tickets.stop(conn, store, str(first), by="admin")
    assert _count(conn, "SELECT count(*) FROM subscriptions") == 0

    trigger_id, second = _fire(conn, store, source, external="e2")
    assert second is not None and second != first
    assert _disposition(conn, trigger_id) == "accepted"
    assert _count(conn, "SELECT count(*) FROM tickets") == 2


def test_stale_subscription_row_cannot_swallow_new_tickets(
    env: tuple[sqlite3.Connection, EventStore, sqlite3.Row]
) -> None:
    """Leak drill: the ticket ends through a path that missed the release
    hook (raw SQL, like a crash window) — the state-joined lookup must still
    let the thread open a new ticket and lazily drop the stale row."""
    conn, store, source = env
    _, first = _fire(conn, store, source, external="e1")
    conn.execute("UPDATE tickets SET state = 'ended' WHERE ticket_id = ?", (first,))
    conn.commit()
    assert _count(conn, "SELECT count(*) FROM subscriptions") == 1  # stale

    _, second = _fire(conn, store, source, external="e2")
    assert second is not None and second != first
    assert _count(conn, "SELECT count(*) FROM subscriptions") == 1  # only the new


def test_different_thread_keys_open_separate_tickets(
    env: tuple[sqlite3.Connection, EventStore, sqlite3.Row]
) -> None:
    conn, store, source = env
    _, a = _fire(conn, store, source, external="a1", thread_key="thread-a")
    _, b = _fire(conn, store, source, external="b1", thread_key="thread-b")
    assert a and b and a != b
    assert _count(conn, "SELECT count(*) FROM subscriptions") == 2
