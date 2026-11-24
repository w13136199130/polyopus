"""Outbound channel worker: deliver queued Feishu texts without blocking turns."""

from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path

from polyopus.domains.channels import service as channels
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.channels")

POLL_SECONDS = 1.0


def run_channels_loop(
    db_path_factory: Callable[[], Path],
    *,
    stop: threading.Event,
    poll_seconds: float = POLL_SECONDS,
    max_batches: int | None = None,
) -> int:
    from polyopus.platform.db.migrator import connect

    batches = 0
    conn = None
    try:
        while not stop.is_set() and (max_batches is None or batches < max_batches):
            try:
                if conn is None:
                    conn = connect(db_path_factory())
                channels.deliver_queued(conn)
                batches += 1
            except Exception as exc:  # noqa: BLE001 - one bad row must not stop the loop
                tlog.log(logger, 40, "channel.deliver_failed", error=str(exc))
            stop.wait(poll_seconds)
    finally:
        if conn is not None:
            conn.close()
    return batches


def start_embedded(db_path_factory: Callable[[], Path]) -> threading.Event:
    stop = threading.Event()
    thread = threading.Thread(
        target=run_channels_loop,
        args=(db_path_factory,),
        kwargs={"stop": stop},
        name="channels-worker",
        daemon=True,
    )
    thread.start()
    return stop
