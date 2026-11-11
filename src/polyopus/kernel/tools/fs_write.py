"""fs.write: workspace-jailed file write (executed only after policy allows)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from polyopus.kernel.models.gateway import ToolSpec
from polyopus.kernel.tools.fs_read import ToolError, ToolResult, _resolve_jailed

FS_WRITE_MAX_BYTES = 64 * 1024

FS_WRITE_SPEC = ToolSpec(
    name="fs.write",
    description="向工作区写入一个文本文件（高危：需要审批）。",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对工作区根的文件路径"},
            "content": {"type": "string", "description": "要写入的完整内容"},
        },
        "required": ["path", "content"],
    },
)


def fs_write(root: Path, rel_path: str, content: str) -> ToolResult:
    if len(content.encode("utf-8")) > FS_WRITE_MAX_BYTES:
        raise ToolError(
            "TOOL_OUTPUT_TOO_LARGE",
            f"content is {len(content.encode())} bytes (max {FS_WRITE_MAX_BYTES})",
        )
    target = _resolve_jailed(root, rel_path) if (root / rel_path).exists() else (
        (root / rel_path).resolve()
    )
    # writes may create new files: jail-check without the is-file requirement
    root_resolved = root.resolve()
    if root_resolved != target and root_resolved not in target.parents:
        raise ToolError("TOOL_PATH_DENIED", f"path escapes workspace: {rel_path}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return ToolResult(
        ok=True, output={"path": rel_path, "bytes": len(content.encode("utf-8"))},
    )


def execute_fs_write(root: Path, arguments_json: str) -> ToolResult:
    try:
        args: dict[str, Any] = json.loads(arguments_json or "{}")
    except json.JSONDecodeError as exc:
        raise ToolError("TOOL_ARGS_INVALID", str(exc)) from exc
    rel_path = str(args.get("path", "")).strip()
    content = args.get("content", "")
    if not rel_path:
        raise ToolError("TOOL_ARGS_INVALID", "path is required")
    if not isinstance(content, str):
        raise ToolError("TOOL_ARGS_INVALID", "content must be a string")
    return fs_write(root, rel_path, content)
