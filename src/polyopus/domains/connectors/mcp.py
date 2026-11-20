"""Minimal MCP client + tool discovery (HTTP and stdio transports).

Only the JSON-RPC subset needed by the tool loop is implemented:
`initialize`, `notifications/initialized`, `tools/list` and `tools/call`.
Every call is best-effort and reports a typed error; the engine converts it
into a normal tool failure so one bad connector never kills a turn.

Security: servers/commands are admin-configured, and every discovered tool is
advertised with risk=high + side_effects=True, so the existing policy gate
asks before execution by default.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import shlex
import subprocess
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

PROTOCOL_VERSION = "2024-11-05"
CLIENT_INFO = {"name": "polyopus", "version": "1.0.1"}
TIMEOUT_SECONDS = 12.0


class McpError(RuntimeError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class McpServer:
    name: str
    transport: str
    url: str = ""
    command: str = ""
    args: tuple[str, ...] = ()
    env: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class McpTool:
    server: str
    name: str
    description: str
    input_schema: dict[str, Any]


def parse_servers(config: dict[str, Any]) -> list[McpServer]:
    root_headers = config.get("headers")
    shared_headers = (
        {str(k): str(v) for k, v in root_headers.items()}
        if isinstance(root_headers, dict) else {}
    )
    raw = config.get("servers", config)
    if not isinstance(raw, dict):
        return []
    servers: list[McpServer] = []
    for name, value in raw.items():
        if name in ("auth", "headers") or not isinstance(value, dict):
            continue
        transport = str(value.get("type") or value.get("transport") or "http")
        headers = dict(shared_headers)
        if isinstance(value.get("headers"), dict):
            headers.update({str(k): str(v) for k, v in value["headers"].items()})
        env = value.get("env")
        servers.append(McpServer(
            name=str(name),
            transport=transport,
            url=str(value.get("url") or ""),
            command=str(value.get("command") or ""),
            args=tuple(str(item) for item in (value.get("args") or [])),
            env={str(k): str(v) for k, v in env.items()}
            if isinstance(env, dict) else {},
            headers=headers,
        ))
    return servers


def _rpc_error(result: dict[str, Any]) -> None:
    error = result.get("error")
    if isinstance(error, dict):
        raise McpError(str(error.get("message") or error.get("code") or "MCP error"))


def _parse_body(content_type: str, body: str) -> dict[str, Any]:
    if "text/event-stream" in content_type:
        for line in body.splitlines():
            if line.startswith("data:"):
                try:
                    value = json.loads(line[5:].strip())
                except ValueError:
                    continue
                if isinstance(value, dict) and ("result" in value or "error" in value):
                    return value
        raise McpError("MCP SSE response contained no JSON-RPC result")
    try:
        value = json.loads(body)
    except ValueError as exc:
        raise McpError(f"MCP response is not JSON: {body[:160]}") from exc
    if not isinstance(value, dict):
        raise McpError("MCP response is not an object")
    return value


class _HttpSession:
    def __init__(self, server: McpServer) -> None:
        if not server.url.startswith(("http://", "https://")):
            raise McpError(f"{server.name}: http url required")
        self.server = server
        self.session_id: str | None = None
        self.next_id = 1

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **self.server.headers,
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        request = urllib.request.Request(
            self.server.url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                body = response.read().decode("utf-8", errors="replace")
                session = response.headers.get("Mcp-Session-Id")
                if session:
                    self.session_id = session
                content_type = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            raise McpError(f"{self.server.name}: HTTP {exc.code} {detail}") from exc
        except OSError as exc:
            raise McpError(f"{self.server.name}: {exc}") from exc
        result = _parse_body(content_type, body)
        _rpc_error(result)
        return result

    def initialize(self) -> None:
        self._post({
            "jsonrpc": "2.0", "id": self.next_id, "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": CLIENT_INFO,
            },
        })
        self.next_id += 1
        # notification: no id, no response expected
        try:
            self._post({
                "jsonrpc": "2.0", "method": "notifications/initialized",
                "params": {},
            })
        except McpError:
            pass  # some stateless servers answer 202/empty

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "jsonrpc": "2.0", "id": self.next_id, "method": method,
            "params": params,
        }
        self.next_id += 1
        return self._post(payload)

    def list_tools(self) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(20):
            params = {"cursor": cursor} if cursor else {}
            result = self.request("tools/list", params).get("result") or {}
            page = result.get("tools") if isinstance(result, dict) else None
            if isinstance(page, list):
                tools.extend(item for item in page if isinstance(item, dict))
            cursor = result.get("nextCursor") if isinstance(result, dict) else None
            if not cursor:
                break
        return tools

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = self.request(
            "tools/call", {"name": name, "arguments": arguments}
        ).get("result") or {}
        return result if isinstance(result, dict) else {"content": result}


class _StdioSession:
    def __init__(self, server: McpServer) -> None:
        if not server.command:
            raise McpError(f"{server.name}: stdio command required")
        args = shlex.split(server.command)
        if not args:
            raise McpError(f"{server.name}: empty command")
        env = {**os.environ, **server.env}
        try:
            self.process = subprocess.Popen(
                [*args, *server.args],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, bufsize=1, env=env,
            )
        except OSError as exc:
            raise McpError(f"{server.name}: {exc}") from exc
        self.server = server
        self.next_id = 1
        self.lines: queue.Queue[str | None] = queue.Queue()

        def reader() -> None:
            assert self.process.stdout is not None
            try:
                for line in self.process.stdout:
                    self.lines.put(line)
            finally:
                self.lines.put(None)

        threading.Thread(target=reader, daemon=True).start()

    def _send(self, payload: dict[str, Any]) -> None:
        if self.process.stdin is None or self.process.poll() is not None:
            raise McpError(f"{self.server.name}: server exited")
        self.process.stdin.write(json.dumps(payload) + "\n")
        self.process.stdin.flush()

    def _read(self) -> dict[str, Any]:
        try:
            line = self.lines.get(timeout=TIMEOUT_SECONDS)
        except queue.Empty as exc:
            raise McpError(f"{self.server.name}: response timeout") from exc
        if line is None:
            raise McpError(f"{self.server.name}: server closed stdout")
        try:
            value = json.loads(line)
        except ValueError:
            return self._read()  # log lines are allowed on stdout
        if not isinstance(value, dict):
            return self._read()
        return value

    def initialize(self) -> None:
        self._send({
            "jsonrpc": "2.0", "id": self.next_id, "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": CLIENT_INFO,
            },
        })
        result = self._read()
        _rpc_error(result)
        self.next_id += 1
        try:
            self._send({
                "jsonrpc": "2.0", "method": "notifications/initialized",
                "params": {},
            })
        except McpError:
            pass

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self.next_id
        self.next_id += 1
        self._send({
            "jsonrpc": "2.0", "id": request_id, "method": method,
            "params": params,
        })
        while True:
            value = self._read()
            if value.get("id") == request_id:
                _rpc_error(value)
                return value
            if "id" not in value:
                continue  # server notification

    def list_tools(self) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(20):
            params = {"cursor": cursor} if cursor else {}
            result = self.request("tools/list", params).get("result") or {}
            page = result.get("tools") if isinstance(result, dict) else None
            if isinstance(page, list):
                tools.extend(item for item in page if isinstance(item, dict))
            cursor = result.get("nextCursor") if isinstance(result, dict) else None
            if not cursor:
                break
        return tools

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = self.request(
            "tools/call", {"name": name, "arguments": arguments}
        ).get("result") or {}
        return result if isinstance(result, dict) else {"content": result}

    def close(self) -> None:
        try:
            if self.process.stdin:
                self.process.stdin.close()
        except OSError:
            pass
        try:
            self.process.terminate()
        except OSError:
            pass


def _session(server: McpServer) -> _HttpSession | _StdioSession:
    if server.transport == "stdio":
        return _StdioSession(server)
    if server.transport == "http":
        return _HttpSession(server)
    raise McpError(f"{server.name}: unsupported transport {server.transport}")


def discover(server: McpServer) -> list[McpTool]:
    session = _session(server)
    try:
        session.initialize()
        tools = session.list_tools()
    finally:
        close = getattr(session, "close", None)
        if close:
            close()
    out: list[McpTool] = []
    for item in tools:
        name = str(item.get("name") or "")
        if not name:
            continue
        schema = item.get("inputSchema")
        out.append(McpTool(
            server=server.name, name=name,
            description=str(item.get("description") or ""),
            input_schema=schema if isinstance(schema, dict) else {},
        ))
    return out


def call(server: McpServer, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    session = _session(server)
    try:
        session.initialize()
        result: dict[str, Any] = session.call_tool(tool_name, arguments)
    finally:
        close = getattr(session, "close", None)
        if close:
            close()
    return result


def wire_name(tool_key: str, server: str, tool: str) -> str:
    """OpenAI function names: [a-zA-Z0-9_-], max 64, deterministic + unique."""
    base = re.sub(r"[^a-zA-Z0-9_-]", "_", f"mcp_{server}_{tool}")[:48]
    digest = hashlib.sha256(tool_key.encode("utf-8")).hexdigest()[:8]
    return f"{base}_{digest}"
