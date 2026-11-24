"""Subagent delegation tool spec (exposed only when the session selected one).

Execution lives in the engine: it needs the workspace, model registry and the
child agent's published prompt, none of which belong in the tool dispatcher.
"""

from __future__ import annotations

from polyopus.kernel.models.gateway import ToolSpec

SUBAGENT_TOOL = "subagent.delegate"
SUBAGENT_WIRE = "subagent_delegate"

SUBAGENT_SPEC = ToolSpec(
    name=SUBAGENT_TOOL,
    description="把子任务委派给会话中已选的子智能体（只读调查）。",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "agent_id": {"type": "string", "description": "已选子智能体的 ID"},
            "task": {"type": "string", "description": "要子智能体完成的子任务"},
        },
        "required": ["agent_id", "task"],
    },
)
