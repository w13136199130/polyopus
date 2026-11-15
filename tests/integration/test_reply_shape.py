"""V05-15 reply shaping: one Report, rendered per source.reply_style.

covers: docs/48 V05-15 验收 — 同一 ticket 两种 style 输出不同且都含 ticket
链接；截断保留关键结论与链接；回复不含内部 trace（只走 ReportView 白名单）。
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest

from polyopus.api.routers.webhooks import CreateSourceBody
from polyopus.domains.intake import service as intake
from polyopus.domains.outbound import service as outbound
from polyopus.domains.outbound import shaper
from polyopus.platform.db import migrator as m

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
BASE_URL = "http://127.0.0.1:8000"
TICKET = "tk_shape"
REPORT = "rp_shape"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    connection = m.connect(tmp_path / "shape.db")
    m.apply(connection, m.discover(MIGRATIONS))
    yield connection
    connection.close()


def _seed_source(
    conn: sqlite3.Connection,
    source_id: str,
    *,
    style: str | None = None,
    callback_url: str = "http://127.0.0.1:9/hook",
) -> None:
    config: dict[str, object] = {"secret": "", "callback_url": callback_url}
    if style is not None:
        config["reply_style"] = style
    now = int(time.time())
    conn.execute(
        "INSERT INTO sources (tenant_id, source_id, kind, name, config_json,"
        " status, created_at, updated_at) VALUES ('default', ?, 'webhook',"
        " ?, ?, 'active', ?, ?)",
        (source_id, source_id, json.dumps(config), now, now),
    )
    conn.commit()


def _seed_ticket(
    conn: sqlite3.Connection,
    *,
    ticket_id: str = TICKET,
    source_id: str = "src_shape",
    title: str = "修复登录",
) -> None:
    now = int(time.time())
    conn.execute(
        "INSERT INTO tickets (tenant_id, ticket_id, title, state, bucket,"
        " source_id, strength, policy_version, scope_json, created_at, updated_at)"
        " VALUES ('default', ?, ?, 'open', 'done', ?, 'explicit', 1,"
        " '[\"workspace:default\"]', ?, ?)",
        (ticket_id, title, source_id, now, now),
    )


def _seed_report(
    conn: sqlite3.Connection,
    *,
    report_id: str = REPORT,
    ticket_id: str = TICKET,
    state: str = "ready",
    summary: str = "结论：登录已修复。",
) -> None:
    conn.execute(
        "INSERT INTO reports (report_id, tenant_id, ticket_id, assignment_id,"
        " state, summary, progress, facts_json, artifacts_json, created_at)"
        " VALUES (?, 'default', ?, 'as_1', ?, ?, 1.0, '{}', '[]', ?)",
        (report_id, ticket_id, state, summary, int(time.time())),
    )
    conn.commit()


def _report_view(summary: str = "结论：登录已修复。") -> shaper.ReportView:
    return shaper.ReportView(
        ticket_id=TICKET,
        report_id=REPORT,
        state="ready",
        title="修复登录",
        summary=summary,
        link=f"{BASE_URL}/tasks?ticketId={TICKET}",
    )


# ---- the acceptance case: same Report, two styles ---------------------------


def test_two_styles_differ_and_both_keep_ticket_link() -> None:
    view = _report_view()
    common = {
        "source_id": "src_shape",
        "ticket_id": TICKET,
        "report_id": REPORT,
        "state": "ready",
        "title": view.title,
        "summary": view.summary,
        "base_url": BASE_URL,
    }
    structured = outbound.build_payload(**common, reply_style="structured")
    full = outbound.build_payload(**common, reply_style="full")

    assert structured != full
    link = f"{BASE_URL}/tasks?ticketId={TICKET}"
    assert structured["link"] == link
    assert full["link"] == link
    assert full["text"].endswith(link)  # the link survives truncation
    assert "text" not in structured and "text" in full

    # V05-08's webhook contract is unchanged for the default style.
    assert set(structured) == {
        "kind", "sourceId", "ticketId", "reportId", "state",
        "title", "summary", "link", "idemKey", "sentAt",
    }
    assert structured["idemKey"] == full["idemKey"] == f"reply:{TICKET}:{REPORT}"


def test_unknown_style_falls_back_to_structured() -> None:
    view = _report_view()
    assert shaper.normalize_style("im") == shaper.STRUCTURED
    assert shaper.shape("im", view) == shaper.render_structured(view)
    assert shaper.shape("", view) == shaper.render_structured(view)


# ---- truncation keeps the conclusion first and the link last ----------------


def test_truncation_keeps_conclusion_and_link() -> None:
    conclusion = "关键结论：登录已修复。"
    view = _report_view(summary=conclusion + "细节" * 5000)

    structured = shaper.render_structured(view)
    full = shaper.render_full(view)

    assert structured["summary"].startswith(conclusion)
    assert len(structured["summary"]) <= shaper.STRUCTURED_SUMMARY_LIMIT
    assert full["summary"].startswith(conclusion)
    assert len(full["summary"]) <= shaper.FULL_SUMMARY_LIMIT
    assert structured["summary"].endswith("…")
    assert full["text"].endswith(view.link)
    assert view.link in full["text"]


# ---- no secrets/paths/internal trace leaves the instance --------------------


def test_redaction_applies_to_both_styles() -> None:
    view = _report_view(
        summary="日志写在 E:\\repo\\build\\out.log 和 /home/alice/secret.log"
    )
    view = replace(view, title="看 E:\\repo\\bug.py")

    for style in ("structured", "full"):
        body = outbound.build_payload(
            source_id="src_shape",
            ticket_id=TICKET,
            report_id=REPORT,
            state="ready",
            title=view.title,
            summary=view.summary,
            base_url=BASE_URL,
            reply_style=style,
        )
        assert "E:" not in body["title"]
        assert "/home/" not in body["summary"]
        assert "[path]" in body["title"] and "[path]" in body["summary"]


def test_payload_only_carries_whitelisted_report_fields() -> None:
    body = outbound.build_payload(
        source_id="src_shape",
        ticket_id=TICKET,
        report_id=REPORT,
        state="ready",
        title="修复登录",
        summary="内部 trace: tool_call args={...}",
        base_url=BASE_URL,
        reply_style="full",
    )
    # The shaper never sees tool args/facts/artifacts; only these keys exist.
    assert set(body) == {
        "kind", "sourceId", "ticketId", "reportId", "state",
        "title", "summary", "text", "link", "idemKey", "sentAt",
    }
    assert "facts" not in body and "artifacts" not in body


# ---- on_report reads the Report row and the source style --------------------


def test_on_report_renders_report_row_in_source_style(
    conn: sqlite3.Connection,
) -> None:
    _seed_source(conn, "src_shape", style="full")
    _seed_ticket(conn)
    _seed_report(conn, summary="报告正文：登录已修复。")

    outbox_id = outbound.on_report(
        conn, TICKET, REPORT, "ready", "caller copy must not win"
    )
    assert outbox_id is not None
    row = conn.execute(
        "SELECT payload_json FROM outbox WHERE id = ?", (outbox_id,)
    ).fetchone()
    payload = json.loads(row["payload_json"])

    assert payload["summary"] == "报告正文：登录已修复。"
    assert "caller copy" not in payload["summary"]
    assert payload["text"].endswith(payload["link"])
    assert payload["link"].endswith(f"/tasks?ticketId={TICKET}")


def test_on_report_defaults_to_structured(conn: sqlite3.Connection) -> None:
    _seed_source(conn, "src_shape")  # no reply_style in config_json
    _seed_ticket(conn)
    _seed_report(conn)

    outbox_id = outbound.on_report(conn, TICKET, REPORT, "ready", "x")
    assert outbox_id is not None
    payload = json.loads(conn.execute(
        "SELECT payload_json FROM outbox WHERE id = ?", (outbox_id,)
    ).fetchone()["payload_json"])
    assert "text" not in payload
    assert payload["link"].endswith(f"/tasks?ticketId={TICKET}")


# ---- config plumbing --------------------------------------------------------


def test_source_create_accepts_camel_and_snake_reply_style() -> None:
    camel = CreateSourceBody.model_validate(
        {"name": "cb", "replyStyle": "full"}
    )
    snake = CreateSourceBody.model_validate(
        {"name": "cb", "reply_style": "full"}
    )
    assert camel.reply_style == snake.reply_style == "full"
    assert CreateSourceBody.model_validate({"name": "cb"}).reply_style == "structured"


def test_config_of_reads_reply_style(conn: sqlite3.Connection) -> None:
    _seed_source(conn, "src_snake", style="full")
    _seed_source(conn, "src_camel")
    _seed_source(conn, "src_default")
    conn.execute(
        "UPDATE sources SET config_json = ? WHERE source_id = 'src_camel'",
        (json.dumps({"replyStyle": "full"}),),
    )
    conn.commit()

    styles = {}
    for source_id in ("src_snake", "src_camel", "src_default"):
        row = conn.execute(
            "SELECT * FROM sources WHERE source_id = ?", (source_id,)
        ).fetchone()
        styles[source_id] = intake.config_of(row).reply_style
    assert styles == {
        "src_snake": "full",
        "src_camel": "full",
        "src_default": "structured",
    }
