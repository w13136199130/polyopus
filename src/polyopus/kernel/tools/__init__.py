"""Kernel tool layer: specs, dispatch, policy gate."""

from pathlib import Path

from polyopus.kernel.tools.fs_read import (
    FS_READ_SPEC,
    ToolError,
    ToolResult,
    execute_fs_read,
    fs_read,
)
from polyopus.kernel.tools.fs_write import FS_WRITE_SPEC, execute_fs_write, fs_write
from polyopus.kernel.tools.policy import (
    Decision,
    PolicyEngine,
    Rule,
    ToolPolicySpec,
    ToolRuntime,
    default_rules,
)

WIRE_NAMES = {
    "fs_read": FS_READ_SPEC.name,
    "fs_write": FS_WRITE_SPEC.name,
}

# gateway specs (model-visible) keyed by internal name
GATEWAY_SPECS = {
    FS_READ_SPEC.name: FS_READ_SPEC,
    FS_WRITE_SPEC.name: FS_WRITE_SPEC,
}

# policy specs keyed by internal name (docs/09 §8.2 capability matrix)
POLICY_SPECS = {
    FS_READ_SPEC.name: ToolPolicySpec(FS_READ_SPEC.name, "low", False),
    FS_WRITE_SPEC.name: ToolPolicySpec(FS_WRITE_SPEC.name, "high", True),
}


def internal_name(wire_name: str) -> str:
    """Map a provider wire name back to the internal tool name."""
    return WIRE_NAMES.get(wire_name, wire_name)


def dispatch(internal: str, root: Path, arguments_json: str) -> ToolResult:
    """Execute one builtin tool by internal name (policy is checked by callers)."""
    if internal == FS_READ_SPEC.name:
        return execute_fs_read(root, arguments_json)
    if internal == FS_WRITE_SPEC.name:
        return execute_fs_write(root, arguments_json)
    raise ToolError("TOOL_NOT_FOUND", f"unknown builtin tool: {internal}")


__all__ = [
    "FS_READ_SPEC",
    "FS_WRITE_SPEC",
    "Decision",
    "GATEWAY_SPECS",
    "POLICY_SPECS",
    "PolicyEngine",
    "Rule",
    "ToolError",
    "ToolPolicySpec",
    "ToolResult",
    "ToolRuntime",
    "default_rules",
    "dispatch",
    "execute_fs_read",
    "execute_fs_write",
    "fs_read",
    "fs_write",
    "internal_name",
]
