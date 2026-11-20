"""Cooperative human stop: the engine aborts mid-stream and finishes cancelled."""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import AsyncIterator
from pathlib import Path

from polyopus.domains.conversations import service as conversations
from polyopus.kernel.models import gateway as gt
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


class SlowGateway:
    def capabilities(self, model: str) -> gt.ModelCaps:
        return gt.ModelCaps()

    async def stream(self, req: gt.ModelRequest) -> AsyncIterator[gt.ModelDelta]:
        for index in range(80):
            yield gt.TextDelta(text=f"块{index} ")
            await asyncio.sleep(0.01)
        yield gt.FinishDelta(reason="stop")


def test_cancel_requested_aborts_stream(tmp_path: Path) -> None:
    db = tmp_path / "cancel.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    thread = conversations.create_thread(
        conn, tenant_id="default", owner_id="u", title="停止测试"
    )
    turn_id, _ = conversations.post_turn(
        conn, EventStore(conn), tenant_id="default", owner_id="u",
        thread_id=thread.thread_id, content="写一段很长的内容",
    )

    result: list[str] = []

    def run() -> None:
        result.append(
            asyncio.run(
                engine.run_turn(
                    conn, EventStore(conn), turn_id, owner="test",
                    model=SlowGateway(),  # type: ignore[arg-type]
                )
            )
        )

    worker = threading.Thread(target=run)
    worker.start()
    time.sleep(0.07)

    other = m.connect(db)
    other.execute(
        "UPDATE turns SET status = 'cancel_requested' WHERE turn_id = ?",
        (turn_id,),
    )
    other.commit()
    other.close()
    worker.join(timeout=10)

    assert result == ["cancelled"]
    row = conn.execute(
        "SELECT status FROM turns WHERE turn_id = ?", (turn_id,)
    ).fetchone()
    assert row[0] == "cancelled"
    failed = conn.execute(
        "SELECT count(*) FROM messages WHERE turn_id = ? AND role = 'assistant' "
        "AND status = 'failed'",
        (turn_id,),
    ).fetchone()[0]
    assert failed >= 1
    conn.close()
