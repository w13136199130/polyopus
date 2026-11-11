"""Turn worker: queue drain, race safety (v0.1 card 2, retires L-3)."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin
from polyopus.platform.errors import AppError
from polyopus.workers import engine
from polyopus.workers.worker_loop import claim_next, run_worker_loop

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


@pytest.fixture()
def queued_env(tmp_path: Path) -> Iterator[tuple[Path, Path]]:
    """App WITHOUT the embedded worker: turns stay queued until we drain."""
    db = tmp_path / "wk.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password="p")
    conn.close()
    settings = Settings(db_path=db, secret_key="s", access_ttl_seconds=3600,
                        session_ttl_seconds=86400, embedded_worker=False)
    with TestClient(create_app(settings)) as client:
        client.post("/api/v1/auth/login",
                    json={"username": "admin", "password": "p"})
        yield db, client.app.state.settings.resolved_db_path()


def _post_turns(client: TestClient, thread_id: str, count: int) -> list[str]:
    ids = []
    for i in range(count):
        body = {"content": f"第 {i} 条消息，纯聊天不触发工具"}
        response = client.post(
            f"/api/v1/threads/{thread_id}/turns", json=body,
            headers={"Idempotency-Key": f"wk-{i}"},
        )
        assert response.status_code == 202, response.text
        ids.append(response.json()["turnId"])
    return ids


def test_worker_drains_ten_queued_turns(
    queued_env: tuple[Path, Path],
) -> None:
    db, _ = queued_env
    with TestClient(
        create_app(Settings(
            db_path=db, secret_key="s",
            access_ttl_seconds=3600, session_ttl_seconds=86400,
            embedded_worker=False,
        ))
    ) as client:
        client.post("/api/v1/auth/login",
                    json={"username": "admin", "password": "p"})
        thread_id = client.post("/api/v1/threads", json={}).json()["threadId"]
        turn_ids = _post_turns(client, thread_id, 10)

    import sqlite3

    conn = sqlite3.connect(str(db))
    queued = conn.execute(
        "SELECT count(*) FROM turns WHERE status = 'queued'"
    ).fetchone()[0]
    conn.close()
    assert queued == 10  # nothing ran without a worker

    stop = threading.Event()
    processed = run_worker_loop(lambda: db, stop=stop, max_turns=10)
    assert processed == 10

    conn = sqlite3.connect(str(db))
    statuses = [
        r[0] for r in conn.execute(
            "SELECT status FROM turns WHERE turn_id IN "
            f"({','.join('?' * len(turn_ids))})", turn_ids,
        ).fetchall()
    ]
    finished = conn.execute(
        "SELECT count(*) FROM events WHERE type = 'turn.finished'"
    ).fetchone()[0]
    conn.close()
    assert statuses == ["completed"] * 10
    assert finished == 10


def test_two_workers_never_double_run_a_turn(
    queued_env: tuple[Path, Path],
) -> None:
    db, _ = queued_env
    with TestClient(
        create_app(Settings(
            db_path=db, secret_key="s",
            access_ttl_seconds=3600, session_ttl_seconds=86400,
            embedded_worker=False,
        ))
    ) as client:
        client.post("/api/v1/auth/login",
                    json={"username": "admin", "password": "p"})
        thread_id = client.post("/api/v1/threads", json={}).json()["threadId"]
        _post_turns(client, thread_id, 4)

    results: list[int] = []
    stops = [threading.Event() for _ in range(2)]

    def run(stop: threading.Event) -> None:
        results.append(run_worker_loop(lambda: db, stop=stop, max_turns=4))

    threads = [threading.Thread(target=run, args=(s,)) for s in stops]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)
    for s in stops:
        s.set()

    import sqlite3

    conn = sqlite3.connect(str(db))
    runs_per_turn = conn.execute(
        "SELECT turn_id, count(*) FROM runs WHERE status = 'completed'"
        " GROUP BY turn_id HAVING count(*) > 1"
    ).fetchall()
    conn.close()
    assert sum(results) == 4  # every turn processed exactly once, total
    assert runs_per_turn == []  # no turn ran twice


def test_engine_race_on_same_turn_raises_turn_active(tmp_path: Path) -> None:
    """Two concurrent run_turn calls: UNIQUE(turn_id, attempt) decides."""
    import asyncio

    db = tmp_path / "race.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default','th_r','us_1','t','active',1,1)"
    )
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
        " content, status, seq, created_at, updated_at)"
        " VALUES ('default','m_r','th_r','tu_r','user','你好呀','completed',1,1,1)"
    )
    conn.execute(
        "INSERT INTO turns (tenant_id, turn_id, thread_id, user_message_id, status,"
        " mode, seq, created_at, updated_at)"
        " VALUES ('default','tu_r','th_r','m_r','queued','act',1,1,1)"
    )
    conn.commit()

    errors: list[str] = []

    def run(worker: str) -> None:
        # real workers own their connections; sqlite forbids sharing one
        from polyopus.platform.events.store import EventStore

        own = m.connect(db)
        try:
            asyncio.run(engine.run_turn(own, EventStore(own), "tu_r",
                                        owner=worker))
        except AppError as exc:
            errors.append(exc.normalized_code())
        except Exception as exc:  # noqa: BLE001 - record, don't kill the thread
            errors.append(f"unexpected:{type(exc).__name__}:{exc}")
        finally:
            own.close()

    a = threading.Thread(target=run, args=("w1",))
    b = threading.Thread(target=run, args=("w2",))
    a.start()
    b.start()
    a.join(timeout=60)
    b.join(timeout=60)
    conn = m.connect(db)  # reopen for assertions

    finished = conn.execute(
        "SELECT count(*) FROM events WHERE type='turn.finished'"
    ).fetchone()[0]
    attempts = conn.execute(
        "SELECT count(*) FROM runs WHERE turn_id='tu_r'"
    ).fetchone()[0]
    conn.close()
    assert finished == 1, f"errors: {errors}"
    assert attempts == 1, f"errors: {errors}"
    # the loser must lose gracefully - never an unexpected crash
    assert all(code == "THREAD_TURN_ACTIVE" for code in errors), errors


def test_claim_next_returns_none_when_empty(tmp_path: Path) -> None:
    db = tmp_path / "empty.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    assert claim_next(conn) is None
    conn.close()
