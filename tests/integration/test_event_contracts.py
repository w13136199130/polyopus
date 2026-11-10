"""Guard: every event the fake runner emits must parse against contracts (L0)."""

from __future__ import annotations

import json
from pathlib import Path

from poly_contracts import parse_event

from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import turn_worker

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


def test_fake_turn_events_parse_against_contracts(tmp_path: Path) -> None:
    db = tmp_path / "t.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    store = EventStore(conn)
    run_id = turn_worker.start_run(
        conn, store, "t1", "tu1", steps=2, owner="w1", lease_ttl=30
    )
    turn_worker.execute(conn, store, "t1", "tu1", run_id, 2, 0, 0.0, "w1", 30)

    rows = conn.execute("SELECT * FROM events WHERE thread_id='t1' ORDER BY seq").fetchall()
    assert rows, "no events emitted"
    for row in rows:
        envelope = {
            "v": 1,
            "event_id": f"ev_{row['seq']}",
            "stream_id": row["thread_id"],
            "seq": row["seq"],
            "type": row["type"],
            "ts": row["ts"],
            "tenant_id": row["tenant_id"],
            "actor": {"kind": "system", "id": "fake-worker"},
            "refs": {"thread_id": row["thread_id"], "turn_id": row["turn_id"]},
            "payload": json.loads(row["payload_json"]),
        }
        parse_event(envelope)  # raises on drift
    conn.close()


def test_steps_are_rows_not_events(tmp_path: Path) -> None:
    db = tmp_path / "t.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    store = EventStore(conn)
    run_id = turn_worker.start_run(
        conn, store, "t1", "tu1", steps=3, owner="w1", lease_ttl=30
    )
    turn_worker.execute(conn, store, "t1", "tu1", run_id, 3, 0, 0.0, "w1", 30)

    types = {r[0] for r in conn.execute("SELECT DISTINCT type FROM events")}
    assert "step.completed" not in types
    assert "turn.finished" in types
    count = conn.execute("SELECT count(*) FROM steps WHERE run_id = ?", (run_id,)).fetchone()[0]
    assert count == 3
    conn.close()
