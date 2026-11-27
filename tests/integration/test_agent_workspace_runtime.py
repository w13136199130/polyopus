"""Published expert files feed the pinned thread prompt (phase 2)."""

# covers: T-EXP-04

from __future__ import annotations

from pathlib import Path

import pytest

from polyopus.domains.agents import files as agent_files
from polyopus.domains.agents import service as agents
from polyopus.domains.conversations import context
from polyopus.domains.conversations import service as conversations
from polyopus.platform.db import migrator as m

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
TENANT = "default"


@pytest.fixture()
def conn(tmp_path: Path):
    connection = m.connect(tmp_path / "app.db")
    m.apply(connection, m.discover(MIGRATIONS))
    yield connection
    connection.close()


def test_draft_files_and_published_versions_shape_the_prompt(
    conn, tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    agent = agents.create_agent(
        conn, tenant_id=TENANT, created_by="u1", name="运维专家",
        system_prompt="你是运维专家。", workspace_root=workspace,
    )
    agent_id = agent["agentId"]
    agent_files.put_file(
        conn, tenant_id=TENANT, agent_id=agent_id, name="AGENTS.md",
        content="先读日志再改配置。", by="u1", workspace_root=workspace,
    )

    draft_thread = conversations.create_thread(
        conn, tenant_id=TENANT, owner_id="u1", title="草稿会话", agent_id=agent_id,
    )
    draft_ctx = context.agent_context(
        conn, tenant_id=TENANT, thread_id=draft_thread.thread_id,
        workspace_root=workspace,
    )
    assert "你是运维专家。" in draft_ctx.system_prompt
    assert "先读日志再改配置。" in draft_ctx.system_prompt

    published = agents.publish_agent(
        conn, tenant_id=TENANT, agent_id=agent_id, by="u1",
        workspace_root=workspace,
    )
    assert published["version"] == 1
    version_file = (
        workspace / ".polyopus" / "tenants" / TENANT / "agents" / agent_id
        / "versions" / "v1" / "AGENTS.md"
    )
    assert version_file.read_text(encoding="utf-8") == "先读日志再改配置。"

    first_thread = conversations.create_thread(
        conn, tenant_id=TENANT, owner_id="u1", title="v1 会话", agent_id=agent_id,
    )
    agent_files.put_file(
        conn, tenant_id=TENANT, agent_id=agent_id, name="AGENTS.md",
        content="第二版：先备份。", by="u1", workspace_root=workspace,
    )
    old_ctx = context.agent_context(
        conn, tenant_id=TENANT, thread_id=first_thread.thread_id,
        workspace_root=workspace,
    )
    assert "先读日志再改配置。" in old_ctx.system_prompt
    assert "第二版" not in old_ctx.system_prompt

    agents.publish_agent(
        conn, tenant_id=TENANT, agent_id=agent_id, by="u1",
        workspace_root=workspace,
    )
    second_thread = conversations.create_thread(
        conn, tenant_id=TENANT, owner_id="u1", title="v2 会话", agent_id=agent_id,
    )
    new_ctx = context.agent_context(
        conn, tenant_id=TENANT, thread_id=second_thread.thread_id,
        workspace_root=workspace,
    )
    assert "第二版：先备份。" in new_ctx.system_prompt
    assert "先读日志再改配置。" not in new_ctx.system_prompt
