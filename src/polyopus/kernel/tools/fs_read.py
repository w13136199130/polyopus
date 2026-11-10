"""Built-in read-only tools (M2 first batch: fs.read).

Jail rules: paths resolve inside the workspace root only; traversal,
absolute paths and symlink escapes are rejected. No writes, no network.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from polyopus.kernel.models.gateway import ToolSpec

FS_READ_MAX_BYTES = 64 * 1024

FS_READ_SPEC = ToolSpec(
    name="fs.read",
    description="读取工作区内一个文本文件的内容（只读）。路径相对工作区根目录。",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对工作区根的文件路径"},
        },
        "required": ["path"],
    },
)


class ToolError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ToolResult:
    ok: bool
    output: dict[str, Any]


def _resolve_jailed(root: Path, rel_path: str) -> Path:
    root = root.resolve()
    candidate = (root / rel_path).resolve()
    if candidate == root or root not in candidate.parents:
        raise ToolError("TOOL_PATH_DENIED", f"path escapes workspace: {rel_path}")
    if not candidate.is_file():
        raise ToolError("TOOL_NOT_FOUND", f"not a file in workspace: {rel_path}")
    return candidate


def fs_read(root: Path, rel_path: str) -> ToolResult:
    """Read one workspace file, numbered lines, byte-capped."""
    target = _resolve_jailed(root, rel_path)
    data = target.read_bytes()
    if len(data) > FS_READ_MAX_BYTES:
        raise ToolError("TOOL_OUTPUT_TOO_LARGE",
                        f"{rel_path} is {len(data)} bytes (max {FS_READ_MAX_BYTES})")
    text = data.decode("utf-8", errors="replace")
    numbered = "\n".join(
        f"{i}|\t{line}" for i, line in enumerate(text.splitlines(), start=1)
    )
    return ToolResult(ok=True, output={"path": rel_path, "content": numbered})


def execute_fs_read(root: Path, arguments_json: str) -> ToolResult:
    try:
        args: dict[str, Any] = json.loads(arguments_json or "{}")
    except json.JSONDecodeError as exc:
        raise ToolError("TOOL_ARGS_INVALID", str(exc)) from exc
    rel_path = str(args.get("path", "")).strip()
    if not rel_path:
        raise ToolError("TOOL_ARGS_INVALID", "path is required")
    return fs_read(root, rel_path)
