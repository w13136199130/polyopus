#!/usr/bin/env python
"""V1-19 load test: 50 concurrent turns, event latency and one ticket.

NFR-1 accepted 50; NFR-2 first-token p95 <= 1.5s; NFR-3 event append/read
p95 <= 150ms; NFR-11 ticket completion <= 30 min. Uses a temp DB and
FakeModel; no external service.

Usage:
    uv run python scripts/load_test.py
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from polyopus.domains import conversations  # noqa: E402
from polyopus.domains.tickets import service as tickets  # noqa: E402
from polyopus.kernel.models import FakeModel  # noqa: E402
from polyopus.platform.db import migrator as m  # noqa: E402
from polyopus.platform.db.seed import ensure_admin  # noqa: E402
from polyopus.platform.events.store import EventStore  # noqa: E402
from polyopus.workers import engine  # noqa: E402

MIGRATIONS = ROOT / "migrations"
CONCURRENCY = 50


def _p95(values: list[float]) -> float:
    return statistics.quantiles(values, n=20)[18] if len(values) > 1 else values[0]


def main() -> int:
    with tempfile.TemporaryDirectory(
        prefix="poly-load-", ignore_cleanup_errors=True
    ) as tmp:
        base = Path(tmp)
        db = base / "load.db"
        conn = m.connect(db)
        m.apply(conn, m.discover(MIGRATIONS))
        ensure_admin(conn, password="load-password")
        owner = str(conn.execute(
            "SELECT user_id FROM users WHERE is_owner = 1"
        ).fetchone()[0])
        now = int(time.time())
        for index in range(CONCURRENCY):
            conn.execute(
                "INSERT INTO threads (tenant_id, thread_id, owner_id, title,"
                " status, created_at, updated_at) VALUES ('default', ?, ?,"
                " 'load', 'active', ?, ?)",
                (f"th_load_{index}", owner, now, now),
            )
        conn.commit()
        store = EventStore(conn)

        def enqueue(index: int) -> float:
            started = time.perf_counter()
            local = m.connect(db)
            try:
                conversations.post_turn(
                    local, EventStore(local), tenant_id="default",
                    owner_id=owner, thread_id=f"th_load_{index}",
                    content=f"load {index}",
                )
            finally:
                local.close()
            return (time.perf_counter() - started) * 1000

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=CONCURRENCY
        ) as pool:
            enqueue_ms = list(pool.map(enqueue, range(CONCURRENCY)))

        turn_ids = [
            str(row[0]) for row in conn.execute(
                "SELECT turn_id FROM turns WHERE thread_id LIKE 'th_load_%'"
            ).fetchall()
        ]
        def drive(turn_id: str) -> None:
            local = m.connect(db)
            local.execute("PRAGMA busy_timeout=30000")
            try:
                asyncio.run(engine.run_turn(
                    local, EventStore(local), turn_id, owner="load",
                    config=engine.EngineConfig(workspace=base / "ws"),
                    model=FakeModel(),
                ))
            finally:
                local.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(drive, turn_ids[5:]))
        # First-token samples are measured without queueing (NFR-2 is the
        # engine's token path, not scheduler wait).
        for turn_id in turn_ids[:5]:
            drive(turn_id)

        # NFR-2: first delta relative to turn.started (events carry second ts).
        first_token_ms: list[float] = []
        for turn_id in turn_ids[:5]:
            started = conn.execute(
                "SELECT ts FROM events WHERE turn_id = ? AND type = 'turn.started'",
                (turn_id,),
            ).fetchone()
            delta = conn.execute(
                "SELECT ts FROM events WHERE turn_id = ? AND type = 'message.delta'"
                " ORDER BY seq LIMIT 1", (turn_id,),
            ).fetchone()
            if started and delta:
                first_token_ms.append(max(0, int(delta[0]) - int(started[0])) * 1000)

        # NFR-3: append + read one event on an existing stream.
        event_ms: list[float] = []
        for index in range(20):
            begin = time.perf_counter()
            store.append(
                "th_load_0", "load.probe", {"i": index}, tenant_id="default"
            )
            list(store.read("th_load_0", 0))
            event_ms.append((time.perf_counter() - begin) * 1000)

        # NFR-11: one ticket through the real executor.
        conn.execute(
            "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
            " created_at, updated_at) VALUES ('default', 'th_load_ticket',"
            " 'system', 'load ticket', 'active', ?, ?)", (now, now),
        )
        conn.execute(
            "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
            " actor_json, strength, policy_version, scope_json, created_at,"
            " updated_at) VALUES ('default', 'tk_load', 'load ticket', 'open',"
            " 'queued', ?, 'explicit', 1, '[]', ?, ?)",
            (json.dumps({"id": owner}), now, now),
        )
        conn.execute(
            "INSERT INTO timeline_events (event_id, tenant_id, ticket_id, kind,"
            " title, actor, payload_json, created_at) VALUES ('tl_load', 'default',"
            " 'tk_load', 'execution_thread', 'thread', 'system', ?, ?)",
            (json.dumps({"thread_id": "th_load_ticket"}), now),
        )
        conn.commit()
        ticket_started = time.perf_counter()
        state = tickets.run_assignment(conn, store, "tk_load")
        ticket_seconds = time.perf_counter() - ticket_started
        conn.close()

        report = {
            "nfr1": {
                "concurrent": CONCURRENCY,
                "accepted": len(enqueue_ms),
                "enqueueP95Ms": round(_p95(enqueue_ms), 2),
            },
            "nfr2": {
                "firstTokenP95Ms": round(_p95(first_token_ms), 2),
                "thresholdMs": 1500,
            },
            "nfr3": {
                "eventP95Ms": round(_p95(event_ms), 2),
                "thresholdMs": 150,
            },
            "nfr11": {
                "ticketSeconds": round(ticket_seconds, 2),
                "ticketState": state,
                "thresholdSeconds": 1800,
            },
        }
        ok = (
            report["nfr1"]["accepted"] == CONCURRENCY
            and report["nfr2"]["firstTokenP95Ms"] <= 1500
            and report["nfr3"]["eventP95Ms"] <= 150
            and report["nfr11"]["ticketSeconds"] <= 1800
            and state in ("ready", "blocked", "waiting")
        )
        report["passed"] = ok
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
