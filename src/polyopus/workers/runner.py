"""Launch the engine for a queued turn from the API process.

Single-process demo runner: the engine runs in a worker thread with its own
SQLite connection (WAL allows one writer + readers). Replaced by a real
turn_worker process in M2.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Callable
from pathlib import Path

from polyopus.platform.events.store import EventStore
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.runner")

# Demo-level policy gate (docs/03 §5 step 6 placeholder): high-risk verbs in
# the user message route the turn through approval. The real policy engine
# evaluates tool calls, not text; this stands in until tools land.
HIGH_RISK = re.compile(r"写|删除|write|delete|rm\s", re.IGNORECASE)


def requires_approval(content: str) -> bool:
    return bool(HIGH_RISK.search(content))


def launch_turn(
    db_path_factory: Callable[[], Path],
    turn_id: str,
    content: str,
) -> None:
    def _run() -> None:
        import asyncio

        from polyopus.platform.db.migrator import connect
        from polyopus.workers import engine

        conn = connect(db_path_factory())
        try:
            asyncio.run(
                engine.run_turn(
                    conn,
                    EventStore(conn),
                    turn_id,
                    config=engine.EngineConfig(
                        require_approval=requires_approval(content),
                        chunk_words=2,
                    ),
                )
            )
        except Exception as exc:  # noqa: BLE001 - background thread must not die silently
            tlog.log(logger, 40, "engine_failed", turn_id=turn_id, error=str(exc))
        finally:
            conn.close()

    threading.Thread(target=_run, name=f"turn-{turn_id}", daemon=True).start()
