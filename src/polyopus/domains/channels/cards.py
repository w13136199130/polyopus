"""Feishu interactive card payloads (card 1.0, broad client support).

Buttons carry the decision and attention id; Feishu posts them back to the
event callback as `card.action.trigger`. The plain-text command remains a
fallback, so a channel with no card callback configured still works.
"""

from __future__ import annotations

from typing import Any

_RESULT = {
    "ready": ("任务完成", "green"),
    "denied": ("任务已拒绝", "red"),
    "failed": ("任务失败", "red"),
    "blocked": ("任务待处理", "orange"),
    "cancelled": ("任务已取消", "grey"),
}


def approval_card(
    *,
    ticket_title: str,
    tool_label: str,
    args_preview: str,
    attention_id: str,
    ticket_id: str,
) -> dict[str, Any]:
    lines = [f"**任务**：{ticket_title}", f"**工具**：`{tool_label}`"]
    if args_preview:
        preview = args_preview.replace("\n", " ").strip()[:300]
        lines.append(f"**参数**：{preview}")
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "orange",
            "title": {"tag": "plain_text", "content": "需要你确认"},
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": "\n".join(lines)}},
            {
                "tag": "action",
                "actions": [
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "拒绝"},
                        "type": "danger",
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
                    "content": "按钮不可用时，回复 /approve 或 /reject。",
                }],
            },
        ],
    }


def result_card(*, state: str, summary: str) -> dict[str, Any]:
    title, template = _RESULT.get(state, (f"任务{state}", "grey"))
    body = (summary or "").strip()[:2000] or title
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": template,
            "title": {"tag": "plain_text", "content": title},
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": body}},
        ],
    }
