"""Launch the engine for a queued turn from the API process.

Single-process demo runner: the engine runs in a worker thread with its own
SQLite connection (WAL allows one writer + readers). Replaced by a real
turn_worker process in M2 (v0.1 card 2).

The policy gate moved into the engine (kernel pipeline step 6): this runner
no longer guesses intent from message text.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path

from polyopus.platform.events.store import EventStore
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.runner")


def _workspace() -> Path:
    from polyopus.config import load_settings

    path = load_settings().workspace_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def launch_turn(
    db_path_factory: Callable[[], Path],
    turn_id: str,
    content: str,
) -> None:
    _ = content  # policy decides from tool calls, not text

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
                        chunk_words=2,
                        workspace=_workspace(),
                    ),
                )
            )
        except Exception as exc:  # noqa: BLE001 - background thread must not die silently
            tlog.log(logger, 40, "engine_failed", turn_id=turn_id, error=str(exc))
        finally:
            conn.close()

    threading.Thread(target=_run, name=f"turn-{turn_id}", daemon=True).start()
