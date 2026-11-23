"""MCP connector tools: discovery, policy pause, approval and execution."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from polyopus.config import load_settings
from polyopus.domains.attention import service as attention
from polyopus.domains.connectors import service as connectors
from polyopus.domains.connectors import tool_catalog
from polyopus.kernel.models.gateway import (
    FinishDelta,
    ModelCaps,
    ModelDelta,
    ModelRequest,
    TextDelta,
    ToolCallDelta,
)
from polyopus.platform.db import migrator as m
from polyopus.platform.events.store import EventStore
from polyopus.workers import engine

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
SECRET = load_settings().secret_key


class FakeMcpHandler(BaseHTTPRequestHandler):
    calls: list[dict[str, Any]] = []

    def log_message(self, *args: object) -> None:  # silence test output
        pass

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        method = payload.get("method")
        request_id = payload.get("id")
        if request_id is None:  # notifications/initialized
            self._json({"jsonrpc": "2.0", "result": {}})
            return
        if method == "initialize":
            self._json({
                "jsonrpc": "2.0", "id": request_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "fake", "version": "1"},
                },
            })
        elif method == "tools/list":
            self._json({
                "jsonrpc": "2.0", "id": request_id,
                "result": {"tools": [{
                    "name": "weather",
                    "description": "查询天气",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"city": {"type": "string"}},
                        "required": ["city"],
                    },
                }]},
            })
        elif method == "tools/call":
            params = payload.get("params") or {}
            FakeMcpHandler.calls.append(dict(params))
            self._json({
                "jsonrpc": "2.0", "id": request_id,
                "result": {
                    "content": [{
                        "type": "text",
                        "text": f"sunny in {params.get('arguments', {}).get('city')}",
                    }],
                    "isError": False,
                },
            })
        else:
            self._json({
                "jsonrpc": "2.0", "id": request_id,
                "error": {"code": -32601, "message": "method not found"},
            })

    def _json(self, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture()
def mcp_server() -> Iterator[str]:
    FakeMcpHandler.calls = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeMcpHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/mcp"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture()
def env(tmp_path: Path, mcp_server: str) -> Iterator[tuple[sqlite3.Connection, str, Path]]:
    conn = m.connect(tmp_path / "pol.db")
    m.apply(conn, m.discover(MIGRATIONS))
    instance = connectors.create_instance(
        conn, tenant_id="default", owner_id="us_1", kind="mcp",
        display_name="Fake MCP", secret_key=SECRET,
        config={"servers": {"fake": {"type": "http", "url": mcp_server}}},
        default_open=False,
    )
    workspace = tmp_path / "ws"
    workspace.mkdir()
    yield conn, str(instance["instanceId"]), workspace
    conn.close()


def _thread(conn: sqlite3.Connection, settings: str | None = None) -> None:
    conn.execute(
        "INSERT INTO threads (tenant_id, thread_id, owner_id, title, status,"
        " settings_json, created_at, updated_at)"
        " VALUES ('default','th_1','us_1','t','active',?,1,1)",
        (settings or "{}",),
    )
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
        " content, status, seq, created_at, updated_at)"
        " VALUES ('default','m_1','th_1','tu_1','user','今天天气','completed',1,1,1)"
    )
    conn.execute(
        "INSERT INTO turns (tenant_id, turn_id, thread_id, user_message_id, status,"
        " mode, seq, created_at, updated_at)"
        " VALUES ('default','tu_1','th_1','m_1','queued','act',1,1,1)"
    )
    conn.commit()


def _registry(conn: sqlite3.Connection):
    from polyopus.domains.agents.models import Registry

    return Registry(conn, env_base_url="", env_api_key="", env_model="")


class WantsWeather:
    def __init__(self, wire_name: str) -> None:
        self.wire_name = wire_name
        self.rounds = 0

    def capabilities(self, model: str) -> ModelCaps:
        return ModelCaps()

    async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
        self.rounds += 1
        if self.rounds == 1:
            assert any(tool.name == self.wire_name for tool in req.tools)
            yield ToolCallDelta(
                id="tc_mcp", name=self.wire_name,
                arguments_json='{"city": "Hangzhou"}',
            )
            yield FinishDelta(reason="tool_calls")
            return
        tool_messages = [msg for msg in req.messages if msg.role == "tool"]
        assert tool_messages and "sunny" in tool_messages[-1].content
        yield TextDelta(text="杭州今天晴。")
        yield FinishDelta(reason="stop")


def test_discover_registers_tenant_scoped_tools(
    env: tuple[sqlite3.Connection, str, Path],
) -> None:
    conn, instance_id, _ws = env
    result = tool_catalog.discover_instance(
        conn, tenant_id="default", instance_id=instance_id, secret_key=SECRET,
    )
    assert result["errors"] == []
    assert len(result["items"]) == 1
    tool = result["items"][0]
    assert tool["toolName"] == "weather"
    assert tool["server"] == "fake"
    assert tool["wireName"].startswith("mcp_fake_weather_")

    listed = tool_catalog.list_instance_tools(
        conn, tenant_id="default", instance_id=instance_id,
    )
    assert [item["toolKey"] for item in listed] == [tool["toolKey"]]
    count = conn.execute(
        "SELECT tools_count FROM connector_instances WHERE instance_id = ?",
        (instance_id,),
    ).fetchone()[0]
    assert count == 1
    # another tenant sees no bindings and no instance
    assert tool_catalog.bindings(conn, tenant_id="other") == []
    from polyopus.platform.errors import AppError

    with pytest.raises(AppError):
        tool_catalog.list_instance_tools(
            conn, tenant_id="other", instance_id=instance_id,
        )


def test_tool_switch_hides_binding_and_blocks_direct_call(
    env: tuple[sqlite3.Connection, str, Path],
) -> None:
    conn, instance_id, _ws = env
    discovered = tool_catalog.discover_instance(
        conn, tenant_id="default", instance_id=instance_id, secret_key=SECRET,
    )
    tool = discovered["items"][0]
    assert len(tool_catalog.bindings(conn, tenant_id="default")) == 1

    toggled = tool_catalog.set_tool_enabled(
        conn, tenant_id="default", instance_id=instance_id,
        tool_key=tool["toolKey"], enabled=False,
    )
    assert toggled["enabled"] is False
    assert tool_catalog.bindings(conn, tenant_id="default") == []
    listed = tool_catalog.list_instance_tools(
        conn, tenant_id="default", instance_id=instance_id,
    )
    assert listed[0]["enabled"] is False

    from polyopus.platform.errors import AppError

    with pytest.raises(AppError) as exc:
        tool_catalog.call_tool(
            conn, tenant_id="default", instance_id=instance_id,
            server="fake", tool_name="weather", arguments={"city": "Hangzhou"},
            secret_key=SECRET,
        )
    assert exc.value.code == "TOOL_DISABLED"

    # rediscovery keeps the user's choice instead of silently re-enabling it
    tool_catalog.discover_instance(
        conn, tenant_id="default", instance_id=instance_id, secret_key=SECRET,
    )
    listed = tool_catalog.list_instance_tools(
        conn, tenant_id="default", instance_id=instance_id,
    )
    assert listed[0]["enabled"] is False
    assert FakeMcpHandler.calls == []


def test_engine_executes_mcp_tool_after_approval(
    env: tuple[sqlite3.Connection, str, Path],
) -> None:
    conn, instance_id, workspace = env
    discovered = tool_catalog.discover_instance(
        conn, tenant_id="default", instance_id=instance_id, secret_key=SECRET,
    )
    wire_name = discovered["items"][0]["wireName"]
    _thread(conn)
    gateway = WantsWeather(wire_name)

    status = asyncio.run(engine.run_turn(
        conn, EventStore(conn), "tu_1",
        model=gateway,  # type: ignore[arg-type]
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=workspace),
    ))
    assert status == "waiting_approval"
    assert FakeMcpHandler.calls == []

    action = json.loads(conn.execute(
        "SELECT request_json FROM approvals ORDER BY id DESC LIMIT 1"
    ).fetchone()[0])["actions"][0]
    assert action["tool"].startswith("mcp.")
    assert action["tool_label"] == "weather · Fake MCP"
    assert action["source"] == "mcp"
    approval_id = conn.execute(
        "SELECT approval_id FROM approvals ORDER BY id DESC LIMIT 1"
    ).fetchone()[0]
    attention.resolve(
        conn, EventStore(conn), tenant_id="default", thread_id="th_1",
        approval_id=str(approval_id), decision="approved", by="us_test",
    )
    resumed = engine.resume_after_approval(
        conn, EventStore(conn), "tu_1", decision="approved",
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=workspace),
    )
    assert resumed == "completed"
    assert FakeMcpHandler.calls == [
        {"name": "weather", "arguments": {"city": "Hangzhou"}}
    ]

    payloads = [
        json.loads(row[0]) for row in conn.execute(
            "SELECT payload_json FROM events WHERE type IN"
            " ('tool.started','tool.completed') ORDER BY seq"
        ).fetchall()
    ]
    assert any(payload.get("source") == "mcp" for payload in payloads)
    assert any(
        "sunny" in json.dumps(payload, ensure_ascii=False) for payload in payloads
    )


def test_session_auto_policy_runs_mcp_without_pause(
    env: tuple[sqlite3.Connection, str, Path],
) -> None:
    conn, instance_id, workspace = env
    discovered = tool_catalog.discover_instance(
        conn, tenant_id="default", instance_id=instance_id, secret_key=SECRET,
    )
    wire_name = discovered["items"][0]["wireName"]
    _thread(conn, '{"approvalPolicy": "auto"}')
    result = asyncio.run(engine.run_turn(
        conn, EventStore(conn), "tu_1",
        model=WantsWeather(wire_name),  # type: ignore[arg-type]
        registry=_registry(conn),
        config=engine.EngineConfig(workspace=workspace),
    ))
    assert result == "completed"
    assert len(FakeMcpHandler.calls) == 1
    assert conn.execute("SELECT count(*) FROM approvals").fetchone()[0] == 0
