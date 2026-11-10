"""Kernel tool layer (builtin first; policy gate lands with ToolRuntime)."""

from polyopus.kernel.tools.fs_read import (
    FS_READ_SPEC,
    ToolError,
    ToolResult,
    execute_fs_read,
    fs_read,
)

WIRE_NAMES = {"fs_read": FS_READ_SPEC.name}


def internal_name(wire_name: str) -> str:
    """Map a provider wire name back to the internal tool name."""
    return WIRE_NAMES.get(wire_name, wire_name)


__all__ = [
    "FS_READ_SPEC",
    "internal_name",
    "ToolError",
    "ToolResult",
    "execute_fs_read",
    "fs_read",
]
