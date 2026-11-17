"""Embedded data-job worker: run export/purge jobs + audit retention (V1-06)."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from pathlib import Path

from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.data_jobs")
POLL_SECONDS = 0.5
RETENTION_INTERVAL = 86400


def _data_dir() -> Path:
    from polyopus.config import load_settings

    path = Path(load_settings().data_dir).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def run_data_jobs_loop(
    db_path_factory: Callable[[], Path],
    *,
    stop: threading.Event,
    poll_seconds: float = POLL_SECONDS,
    data_dir_factory: Callable[[], Path] | None = None,
) -> int:
    from polyopus.domains.audit import service as audit
    from polyopus.domains.data_jobs import service as data_jobs
    from polyopus.platform.db.migrator import connect

    completed = 0
    last_purge = 0.0
    conn = None
    while not stop.is_set():
        try:
            if conn is None:
                conn = connect(db_path_factory())
            now = time.time()
            if now - last_purge >= RETENTION_INTERVAL:
                from polyopus.config import load_settings

                audit.purge_expired(
                    conn,
                    retention_days=int(load_settings().audit_retention_days),
                )
                last_purge = now
            data_dir = (data_dir_factory or _data_dir)()
            done = data_jobs.run_pending(conn, data_dir)
            completed += done
            if not done:
                stop.wait(poll_seconds)
        except Exception as exc:  # noqa: BLE001 - the loop must survive
            tlog.log(logger, 40, "data_jobs_worker_error", error=str(exc))
            conn = None
            stop.wait(poll_seconds)
    if conn is not None:
        conn.close()
    return completed


def start_embedded(db_path_factory: Callable[[], Path]) -> threading.Event:
    stop = threading.Event()
    thread = threading.Thread(
        target=run_data_jobs_loop,
        args=(db_path_factory,),
        kwargs={"stop": stop},
        name="data-jobs-worker",
        daemon=True,
    )
    thread.start()
    return stop
