"""V05-12 policy versioning: bundles, pinned mandates, scope, LKG, dry-run.

covers: docs/48 V05-12 验收 — 改策略后旧 Mandate 仍按旧版本执行；越 scope 被拒。
Drives the real engine gate (no cfg.policy_rules injection): the rule source
chain is mandate-pinned snapshot -> resolved active bundle -> defaults.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest

from polyopus.kernel.models.gateway import (
    FinishDelta,
    ModelCaps,
    ModelDelta,
    ModelRequest,
    TextDelta,
    ToolCallDelta,
)
from polyopus.kernel.tools.policy import Rule
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
WRITE_ARGS = json.dumps({"path": "out.txt", "content": "hello policy"})

DENY_WRITE = (Rule("r-deny-write", 200, {"tool": "fs.write"}, "deny"),)


class WantsWrite:
    """Gateway script: round 1 asks to write, later rounds answer."""

    def __init__(self) -> None:
        self.rounds = 0

    def capabilities(self, model: str) -> ModelCaps:
        return ModelCaps()

    async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
        self.rounds += 1
        if self.rounds == 1:
            yield ToolCallDelta(id="tc_1", name="fs_write",
                                arguments_json=WRITE_ARGS)
            yield FinishDelta(reason="tool_calls")
            return
        yield TextDelta(text="已处理")
        yield FinishDelta(reason="stop")


@pytest.fixture()
def env(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    conn = m.connect(tmp_path / "pol.db")
    m.apply(conn, m.discover(MIGRATIONS))
    workspace = tmp_path / "ws"
    workspace.mkdir()
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " created_at, updated_at) VALUES ('default','th_1','us_1','t','active',1,1)"
    )
    conn.commit()
    conn.execute(  # expose the workspace through the fixture db path
        "UPDATE threads SET title = ? WHERE thread_id = 'th_1'",
        (str(workspace),),
    )
    conn.commit()
    yield conn
    conn.close()


def _workspace(conn: sqlite3.Connection) -> Path:
    return Path(str(conn.execute(
        "SELECT title FROM threads WHERE thread_id = 'th_1'"
    ).fetchone()[0]))


def _ticket(conn: sqlite3.Connection, ticket_id: str, version: int,
            scope: list[str]) -> None:
    conn.execute(
        "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
        " policy_version, strength, scope_json, created_at, updated_at)"
        " VALUES ('default', ?, ?, 'open', 'queued', ?, 'explicit', ?, 1, 1)",
        (ticket_id, ticket_id, version, json.dumps(scope)),
    )
    conn.execute(
        "INSERT INTO mandates (tenant_id, mandate_id, ticket_id, policy_version,"
        " scope_json, strength, matched_rules_json, created_at)"
        " VALUES ('default', ?, ?, ?, ?, 'explicit', '[]', 1)",
        ("md_" + ticket_id, ticket_id, version, json.dumps(scope)),
    )
    conn.commit()


def _turn(conn: sqlite3.Connection, turn_id: str,
          ticket_id: str | None) -> None:
    msg_seq = 1 + int(conn.execute(
        "SELECT COALESCE(MAX(seq), 0) FROM messages WHERE thread_id = 'th_1'"
    ).fetchone()[0])
    turn_seq = 1 + int(conn.execute(
        "SELECT COALESCE(MAX(seq), 0) FROM turns WHERE thread_id = 'th_1'"
    ).fetchone()[0])
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
        " content, status, seq, created_at, updated_at)"
        " VALUES ('default', ?, 'th_1', ?, 'user', '请写入文件', 'completed', ?, 1, 1)",
        ("msg_" + turn_id, turn_id, msg_seq),
    )
    conn.execute(
        "INSERT INTO turns (tenant_id, turn_id, thread_id, user_message_id, status,"
        " mode, seq, ticket_id, created_at, updated_at)"
        " VALUES ('default', ?, 'th_1', ?, 'queued', 'act', ?, ?, 1, 1)",
        (turn_id, "msg_" + turn_id, turn_seq, ticket_id),
    )
    conn.commit()


def _run(conn: sqlite3.Connection, turn_id: str) -> str:
    from polyopus.domains.agents.models import Registry

    return asyncio.run(engine.run_turn(
        conn, EventStore(conn), turn_id,
        model=WantsWrite(),  # type: ignore[arg-type]
        registry=Registry(conn, env_base_url="", env_api_key="", env_model=""),
        config=engine.EngineConfig(workspace=_workspace(conn)),
    ))


def _approvals(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT count(*) FROM approvals").fetchone()[0])


# ---- bootstrap ------------------------------------------------------------------


def test_first_ticket_bootstraps_default_bundle_as_v1(
    env: sqlite3.Connection,
) -> None:
    from polyopus.domains.policy import service as policy

    assert policy.active_version(env) is None
    version = policy.active_version_or_bootstrap(env)
    assert version == 1
    rules = policy.rules_for(env, 1)
    assert rules is not None and len(rules) == 3  # default_rules snapshot
    assert policy.active_version(env) == 1


# ---- 验收 1: 旧 Mandate 仍按旧版本执行 ------------------------------------------


def test_inflight_mandate_keeps_its_version_across_publish(
    env: sqlite3.Connection,
) -> None:
    from polyopus.domains.policy import service as policy

    v1 = policy.active_version_or_bootstrap(env)  # fs.write -> ask
    _ticket(env, "tk_old", v1, scope=["fs:write"])
    policy.publish(env, DENY_WRITE, by="admin")  # v2: fs.write -> deny
    _ticket(env, "tk_new", policy.active_version(env), scope=["fs:write"])

    _turn(env, "tu_old", "tk_old")
    assert _run(env, "tu_old") == "waiting_approval"  # v1 snapshot: ask wins

    _turn(env, "tu_new", "tk_new")
    assert _run(env, "tu_new") == "completed"  # v2: denied, no pause
    assert not (_workspace(env) / "out.txt").exists()
    # exactly one approval — for the OLD mandate only
    assert _approvals(env) == 1


def test_publish_never_invalidates_inflight_mandates(
    env: sqlite3.Connection,
) -> None:
    from polyopus.domains.policy import service as policy

    v1 = policy.active_version_or_bootstrap(env)
    _ticket(env, "tk_a", v1, scope=["fs:write"])
    policy.publish(env, DENY_WRITE, by="admin")
    row = env.execute(
        "SELECT invalidated_at FROM mandates WHERE ticket_id = 'tk_a'"
    ).fetchone()
    assert row[0] is None  # 变更只影响未来 (docs/09 §5.2)


# ---- 验收 2: 越 scope 被拒（仅 ticket turn） -------------------------------------


def test_scope_violation_denies_write_on_ticket_turns(
    env: sqlite3.Connection,
) -> None:
    from polyopus.domains.policy import service as policy

    v1 = policy.active_version_or_bootstrap(env)  # fs.write policy = ask
    # mandate scope WITHOUT fs:write -> the ask never happens: denied
    _ticket(env, "tk_noscope", v1, scope=["workspace:default"])
    _turn(env, "tu_scope", "tk_noscope")
    assert _run(env, "tu_scope") == "completed"  # denied, not paused
    assert _approvals(env) == 0
    assert not (_workspace(env) / "out.txt").exists()

    # chat turn (no ticket) is NOT scope-gated: same call stays ask
    _turn(env, "tu_chat", None)
    assert _run(env, "tu_chat") == "waiting_approval"
    assert _approvals(env) == 1


# ---- LKG / rollback / dry-run -----------------------------------------------------


def test_corrupt_active_snapshot_falls_back_to_lkg(
    env: sqlite3.Connection,
) -> None:
    from polyopus.domains.policy import service as policy

    policy.active_version_or_bootstrap(env)  # v1 (good)
    policy.publish(env, DENY_WRITE, by="admin")  # v2 (active)
    env.execute(
        "UPDATE policy_bundles SET rules_json = '{not json' WHERE version = 2"
    )
    env.commit()

    rules, version, source = policy.resolve_rules(env)
    assert source == "lkg" and version == 1
    assert rules is not None and any(r.rid == "r-ask-write" for r in rules)


def test_rollback_reactivates_previous_version(
    env: sqlite3.Connection,
) -> None:
    from polyopus.domains.policy import service as policy

    policy.active_version_or_bootstrap(env)  # v1
    policy.publish(env, DENY_WRITE, by="admin")  # v2 active
    out = policy.rollback(env, 1, by="admin")

    assert out["version"] == 1
    assert policy.active_version(env) == 1
    # the flat eval view is rebuilt from the target bundle
    rows = env.execute(
        "SELECT rule_id FROM policy_rules ORDER BY priority DESC"
    ).fetchall()
    assert [r[0] for r in rows] == ["r-deny-rm", "r-allow-read", "r-ask-write"]
    # a NEW ticket pins v1 again and the gate asks (not denies)
    _ticket(env, "tk_after", policy.active_version(env), scope=["fs:write"])
    _turn(env, "tu_after", "tk_after")
    assert _run(env, "tu_after") == "waiting_approval"


def test_dry_run_counts_effects_without_touching_the_gate(
    env: sqlite3.Connection,
) -> None:
    from polyopus.domains.policy import service as policy

    policy.active_version_or_bootstrap(env)
    out = policy.dry_run(env, [
        {"tool": "fs.write", "args": {"path": "x", "content": "y"}},
        {"tool": "fs.read", "args": {"path": "x"}},
        {"tool": "shell.exec", "args": {"cmd": "rm -rf /"}},
        {"tool": "totally.unknown", "args": {}},
    ])
    assert out["counts"] == {"allow": 1, "ask": 1, "deny": 2}
    assert out["version"] == 1
    assert _approvals(env) == 0  # dry-run never pauses anything
