"""Reply shaping: one Report, rendered per `source.reply_style` (V05-15).

The outbox envelope (kind/sourceId/ticketId/reportId/idemKey/sentAt) stays
in `service.build_payload`; this module owns only the channel-specific body.
`ReportView` is the whitelist: state, title, summary and link. Internal
trace, tool args, artifacts and free-form facts never enter the shaper.

v0.5 implements the two channels that exist (webhook `structured`, web
`full`). IM is a v1.1 channel: adding it means registering one renderer
under `"im"` in `RENDERERS` — the ≤100-word rule belongs to that entry.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

STRUCTURED = "structured"
FULL = "full"
DEFAULT_STYLE = STRUCTURED

TITLE_LIMIT = 120
STRUCTURED_SUMMARY_LIMIT = 600  # keep the V05-08 callback shape
FULL_SUMMARY_LIMIT = 8000  # web can be long, but never unbounded


@dataclass(frozen=True)
class ReportView:
    """The only Report fields allowed to leave the instance."""

    ticket_id: str
    report_id: str
    state: str
    title: str
    summary: str
    link: str


Renderer = Callable[[ReportView], dict[str, Any]]


def _clip(text: str, limit: int) -> str:
    """Cut from the end (the conclusion leads), preferring a sentence or
    line boundary near the limit; the ticket link is appended after this,
    so truncation can never drop it."""
    value = str(text)
    if len(value) <= limit:
        return value
    cut = value[: limit - 1]
    # Look for a natural break in the last fifth, otherwise cut hard.
    floor = int(len(cut) * 0.8)
    for separator in ("\n", "。", "！", "？", ". ", "; ", "；", " "):
        index = cut.rfind(separator, floor)
        if index > 0:
            return cut[: index + len(separator)].rstrip() + "…"
    return cut.rstrip() + "…"


def _title(report: ReportView) -> str:
    return _clip(report.title, TITLE_LIMIT)


def render_structured(report: ReportView) -> dict[str, Any]:
    """Webhook default: the same compact fields V05-08 shipped."""
    return {
        "title": _title(report),
        "summary": _clip(report.summary, STRUCTURED_SUMMARY_LIMIT),
        "link": report.link,
    }


def render_full(report: ReportView) -> dict[str, Any]:
    """Web: everything in the Report plus a ready-to-display markdown body."""
    title = _title(report)
    summary = _clip(report.summary, FULL_SUMMARY_LIMIT)
    text = "\n\n".join(
        [f"## {title}", summary, f"状态：{report.state}", f"链接：{report.link}"]
    )
    return {
        "title": title,
        "summary": summary,
        "text": text,
        "link": report.link,
    }


RENDERERS: dict[str, Renderer] = {
    STRUCTURED: render_structured,
    FULL: render_full,
}


def normalize_style(style: str | None) -> str:
    """Unknown/empty styles fall back to the V05-08 shape: a bad config must
    never stop a reply."""
    candidate = str(style or "").strip()
    return candidate if candidate in RENDERERS else DEFAULT_STYLE


def shape(style: str | None, report: ReportView) -> dict[str, Any]:
    """Render one Report for one channel style. Pure: no DB, no clock."""
    return RENDERERS[normalize_style(style)](report)


__all__ = [
    "DEFAULT_STYLE",
    "FULL",
    "FULL_SUMMARY_LIMIT",
    "RENDERERS",
    "ReportView",
    "STRUCTURED",
    "STRUCTURED_SUMMARY_LIMIT",
    "normalize_style",
    "render_full",
    "render_structured",
    "shape",
]
