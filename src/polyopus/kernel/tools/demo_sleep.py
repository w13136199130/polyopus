"""demo.sleep: the first async built-in (V05-17).

A deliberately boring long-running tool: it sleeps N seconds and returns.
It exists so the async execution path (start -> handle -> tool.result) can be
exercised end-to-end without wiring a real CI/browser integration; production
models see it like any other low-risk tool.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from polyopus.kernel.models.gateway import ToolSpec
from polyopus.kernel.tools.fs_read import ToolError, ToolResult

DEMO_SLEEP_MAX_SECONDS = 30.0

DEMO_SLEEP_SPEC = ToolSpec(
    name="demo.sleep",
    description="异步演示工具：等待 N 秒后返回（用于验证长任务不阻塞 worker）。",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "seconds": {
                "type": "number",
                "description": f"等待秒数，0-{int(DEMO_SLEEP_MAX_SECONDS)}",
            },
        },
        "required": ["seconds"],
    },
    execution="async",
    timeout_seconds=DEMO_SLEEP_MAX_SECONDS + 30.0,
)


def execute_demo_sleep(_root: Path, arguments_json: str) -> ToolResult:
    try:
        args: dict[str, Any] = json.loads(arguments_json or "{}")
    except json.JSONDecodeError as exc:
        raise ToolError("TOOL_ARGS_INVALID", str(exc)) from exc
    try:
        seconds = float(args.get("seconds", 0))
    except (TypeError, ValueError) as exc:
        raise ToolError("TOOL_ARGS_INVALID", "seconds must be a number") from exc
    if seconds < 0 or seconds > DEMO_SLEEP_MAX_SECONDS:
        raise ToolError(
            "TOOL_ARGS_INVALID",
            f"seconds must be between 0 and {int(DEMO_SLEEP_MAX_SECONDS)}",
        )
    time.sleep(seconds)
    return ToolResult(ok=True, output={"slept_seconds": seconds})
