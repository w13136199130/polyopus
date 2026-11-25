"""Feishu interactive card payloads (card 1.0, broad client support).

Cards speak human: builtin tools get Chinese labels, tool arguments are
rendered as a short "what will happen" line instead of raw JSON, and the
approval card is replaced in place once someone decides.
"""

from __future__ import annotations

import json
from typing import Any

_TOOL_LABELS = {
    "fs.read": "读取文件",
    "fs.write": "写入文件",
    "fs.list": "列出目录",
    "fs.delete": "删除文件",
    "demo.sleep": "等待",
    "subagent.delegate": "委派子智能体",
}

_RESULT = {
    "ready": ("任务完成", "green"),
    "denied": ("任务已拒绝", "red"),
    "expired": ("审批已过期", "grey"),
    "failed": ("任务失败", "red"),
    "blocked": ("任务待处理", "orange"),
    "cancelled": ("任务已取消", "grey"),
}


def _clip(value: str, limit: int) -> str:
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _clip_block(value: str, limit: int) -> str:
    """Trim a multi-line answer without flattening its structure."""
    lines: list[str] = []
    for raw in str(value or "").splitlines():
        line = " ".join(raw.split())
        if line.startswith(("- ", "* ")):
            line = "• " + line[2:]
        if not line and (not lines or lines[-1] == ""):
            continue
        lines.append(line)
    text = "\n".join(lines).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _parse_args(preview: str) -> dict[str, Any] | None:
    raw = (preview or "").strip()
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def tool_name(tool_label: str, tool_key: str = "") -> str:
    for key in (tool_key, tool_label):
        if key in _TOOL_LABELS:
            return _TOOL_LABELS[key]
    if tool_label and any("\u4e00" <= ch <= "\u9fff" for ch in tool_label):
        return tool_label
    return tool_label or tool_key or "工具操作"


def describe_action(tool_key: str, preview: str) -> tuple[str, str]:
    """Return (what happens, extra detail) for the approval card."""
    data = _parse_args(preview)
    if data is None:
        return (_clip(preview, 80), "") if preview else ("执行一次工具调用", "")

    if tool_key in ("fs.write", "fs.read", "fs.delete"):
        path = str(data.get("path") or data.get("file") or "")
        label = f"`{path or '工作区文件'}`"
        if tool_key == "fs.write":
            content = str(data.get("content") or "")
            detail = f"内容：{_clip(content, 60)}" if content else ""
            size = f"（{len(content)} 字符）" if content else ""
            return (label + size, detail)
        return (label, "")

    parts: list[str] = []
    for key, value in list(data.items())[:3]:
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        parts.append(f"{key}：{_clip(text, 36)}")
    return ("；".join(parts) or "执行一次工具调用", "")


def _approval_body(
    ticket_title: str, tool_label: str, tool_key: str, args_preview: str,
) -> str:
    action_line, detail = describe_action(tool_key or tool_label, args_preview)
    name = tool_name(tool_label, tool_key)
    body = f"**{_clip(ticket_title, 40)}**\n\n{name}：{action_line}"
    if detail:
        body += f"\n\n{detail}"
    return body


def approval_card(
    *,
    ticket_title: str,
    tool_label: str,
    tool_key: str,
    args_preview: str,
    attention_id: str,
    ticket_id: str,
) -> dict[str, Any]:
    body = _approval_body(ticket_title, tool_label, tool_key, args_preview)
    return {
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "template": "orange",
            "title": {"tag": "plain_text", "content": "需要你确认"},
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": body}},
            {"tag": "hr"},
            {
                "tag": "action",
                "actions": [
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "拒绝"},
                        "type": "default",
                        "value": {
                            "decision": "denied",
                            "attentionId": attention_id,
                            "ticketId": ticket_id,
                        },
                    },
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "批准"},
                        "type": "primary",
                        "value": {
                            "decision": "approved",
                            "attentionId": attention_id,
                            "ticketId": ticket_id,
                        },
                    },
                ],
            },
            {
                "tag": "note",
                "elements": [{
                    "tag": "plain_text",
                    "content": "处理后会直接继续任务；也可以回复 /approve 或 /reject。",
                }],
            },
        ],
    }


_CLOSED = {
    "approved": {
        "template": "green",
        "title": "已批准，正在执行",
        "status": "✅ **已批准** · 正在继续执行",
        "note": "审批已完成，任务结果随后返回。",
    },
    "denied": {
        "template": "grey",
        "title": "已拒绝",
        "status": "🚫 **已拒绝** · 这次操作不会执行",
        "note": "任务已结束，这次操作没有执行。",
    },
    "expired": {
        "template": "grey",
        "title": "审批已过期",
        "status": "⌛ **已过期** · 这次操作没有执行",
        "note": "审批超时后按拒绝处理；可以在 PolyOpus 任务页重新运行。",
    },
    "closed": {
        "template": "grey",
        "title": "审批已处理",
        "status": "ℹ️ **已处理** · 无需再次操作",
        "note": "任务结果见后续消息或 PolyOpus 任务页。",
    },
}


def closed_card(
    *,
    ticket_title: str,
    state: str,
    tool_label: str = "",
    tool_key: str = "",
    args_preview: str = "",
) -> dict[str, Any]:
    """Turn the approval card into a terminal state: approved/denied/expired."""
    spec = _CLOSED.get(state, _CLOSED["closed"])
    body = _approval_body(ticket_title, tool_label, tool_key, args_preview)
    return {
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "template": spec["template"],
            "title": {"tag": "plain_text", "content": spec["title"]},
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": body}},
            {"tag": "hr"},
            {"tag": "div", "text": {"tag": "lark_md", "content": spec["status"]}},
            {
                "tag": "note",
                "elements": [{
                    "tag": "plain_text",
                    "content": spec["note"],
                }],
            },
        ],
    }


def result_card(
    *, state: str, summary: str, ticket_title: str = "",
) -> dict[str, Any]:
    title, template = _RESULT.get(state, (f"任务{state}", "grey"))
    if state == "denied":
        lead = "已按你的选择终止，没有执行任何写入。"
    elif state == "expired":
        lead = "审批超时，已按拒绝处理，没有执行任何操作。"
    elif state == "cancelled":
        lead = "任务已停止；已经产生的内容会保留。"
    elif state == "failed":
        lead = "执行没有成功，请查看任务详情或重新运行。"
    else:
        lead = ""
    body = "\n\n".join(part for part in (lead, _clip_block(summary, 600)) if part)
    elements: list[dict[str, Any]] = []
    if ticket_title:
        elements.append({
            "tag": "div",
            "text": {
                "tag": "lark_md",
                "content": f"**{_clip(ticket_title, 40)}**\n\n{body or title}",
            },
        })
    else:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": body or title},
        })
    elements.append({
        "tag": "note",
        "elements": [{
            "tag": "plain_text",
            "content": "在 PolyOpus 任务页可以查看完整报告与产物。",
        }],
    })
    return {
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "template": template,
            "title": {"tag": "plain_text", "content": title},
        },
        "elements": elements,
    }
