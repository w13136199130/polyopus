"""Agent workspace draft projection (phase 1 of docs/03 文件即配置)."""

# covers: T-EXP-04

from __future__ import annotations

from pathlib import Path

import pytest

from polyopus.domains.agents import workspace
from polyopus.platform.db import migrator as m
from polyopus.platform.errors import AppError

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


def test_write_and_delete_are_confined(tmp_path: Path) -> None:
    path = workspace.write_file(
        tmp_path, tenant_id="default", agent_id="ag_test",
        name="AGENTS.md", content="你是一名运维专家。",
    )
    assert path.read_text(encoding="utf-8") == "你是一名运维专家。"
    assert path.parent.parts[-2:] == ("ag_test", "draft")

    workspace.delete_file(
        tmp_path, tenant_id="default", agent_id="ag_test", name="AGENTS.md",
    )
    assert not path.exists()


def test_names_and_segments_reject_traversal(tmp_path: Path) -> None:
    with pytest.raises(AppError):
        workspace.write_file(
            tmp_path, tenant_id="default", agent_id="ag_test",
            name="../AGENTS.md", content="x",
        )
    with pytest.raises(AppError):
        workspace.write_file(
            tmp_path, tenant_id="../escape", agent_id="ag_test",
            name="AGENTS.md", content="x",
        )
    with pytest.raises(AppError):
        workspace.write_file(
            tmp_path, tenant_id="default", agent_id="ag_test",
            name="AGENTS.md", content="x" * (workspace.MAX_FILE_BYTES + 1),
        )


def test_sync_mirrors_rows_and_prunes_stale_files(tmp_path: Path) -> None:
    conn = m.connect(tmp_path / "ws.db")
    try:
        m.apply(conn, m.discover(MIGRATIONS))
        conn.execute(
            "INSERT INTO agent_files (tenant_id, agent_id, name, content, updated_at)"
            " VALUES ('default', 'ag_test', 'AGENTS.md', 'guide', 1)"
        )
        conn.execute(
            "INSERT INTO agent_files (tenant_id, agent_id, name, content, updated_at)"
            " VALUES ('default', 'ag_test', 'USER.md', 'profile', 1)"
        )
        workspace.write_file(
            tmp_path, tenant_id="default", agent_id="ag_test",
            name="OLD.md", content="stale",
        )

        assert workspace.sync_agent_files(
            conn, tenant_id="default", agent_id="ag_test",
            workspace_root=tmp_path,
        ) == 2
        draft = workspace.draft_dir(
            tmp_path, tenant_id="default", agent_id="ag_test",
        )
        assert sorted(path.name for path in draft.iterdir()) == ["AGENTS.md", "USER.md"]

        conn.execute(
            "DELETE FROM agent_files WHERE agent_id = 'ag_test' AND name = 'USER.md'"
        )
        workspace.sync_agent_files(
            conn, tenant_id="default", agent_id="ag_test",
            workspace_root=tmp_path,
        )
        assert sorted(path.name for path in draft.iterdir()) == ["AGENTS.md"]
    finally:
        conn.close()
