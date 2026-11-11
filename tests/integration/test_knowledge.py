"""Knowledge SQLite path: chunking, retrieval, gates, golden set (W11 batch 2)."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from polyopus.domains import knowledge as kb
from polyopus.platform.db import migrator as m
from polyopus.platform.errors import AppError

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


@pytest.fixture()
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    c = m.connect(tmp_path / "kb.db")
    m.apply(c, m.discover(MIGRATIONS))
    yield c
    c.close()


# ---- chunking ----------------------------------------------------------------


def test_chunking_carries_heading_paths_and_budget() -> None:
    section = "部署说明。" * 360  # ~1800 chars, above the 1280-char window
    markdown = f"# 运维手册\n## 部署\n{section}\n## 备份\n每晚自动备份。\n"
    chunks = kb.chunk_markdown(markdown)
    headings = {c.heading_path for c in chunks}
    assert any("运维手册 / 部署" == h for h in headings)
    assert any("运维手册 / 备份" == h for h in headings)
    biggest = max(len(c.content) for c in chunks)
    limit = int(800 * 1.6) + int(800 * 1.6) * 0.15  # budget + overlap slack
    assert biggest <= limit
    long_chunks = [c for c in chunks if "部署说明" in c.content]
    assert len(long_chunks) >= 2  # oversized section split into windows
    assert "部署说明" in long_chunks[1].content[:40] or "部署说明" in (
        long_chunks[1].content[: int(len(long_chunks[1].content) * 0.2)]
    )  # overlap keeps continuity


def test_estimate_tokens_cjk_aware() -> None:
    zh = "中文文本" * 10  # 40 CJK chars -> 40/1.6 = 25
    assert kb.estimate_tokens(zh) == 25
    latin = "word " * 10  # 50 chars -> ~16
    assert 10 <= kb.estimate_tokens(latin) <= 20


# ---- lifecycle gates -----------------------------------------------------------


def test_kb_not_ready_without_documents(conn: sqlite3.Connection) -> None:
    kb_id = kb.create_kb(conn, "空库")
    with pytest.raises(AppError) as exc:
        kb.search(conn, kb_id, "任何问题")
    assert exc.value.normalized_code() == "KB_NOT_READY"


def test_duplicate_document_rejected(conn: sqlite3.Connection) -> None:
    kb_id = kb.create_kb(conn, "配置库")
    body = "# 指南\n## 安装\n运行 make install 完成安装。\n"
    kb.ingest_markdown(conn, kb_id, "guide.md", body)
    with pytest.raises(AppError) as exc:
        kb.ingest_markdown(conn, kb_id, "guide-copy.md", body)
    assert exc.value.normalized_code() == "CONFLICT"
    docs = conn.execute(
        "SELECT count(*) FROM knowledge_docs WHERE kb_id = ?", (kb_id,)
    ).fetchone()[0]
    assert docs == 1


def test_resume_pending_jobs(conn: sqlite3.Connection) -> None:
    kb_id = kb.create_kb(conn, "恢复库")
    kb.ingest_markdown(conn, kb_id, "a.md", "# A\n## 甲\n内容甲。\n")
    conn.execute("UPDATE knowledge_docs SET status = 'processing'")
    conn.commit()
    assert kb.resume_pending_jobs(conn) == 1
    status = conn.execute("SELECT status FROM knowledge_docs").fetchone()[0]
    assert status == "ready"


# ---- retrieval ------------------------------------------------------------------


def test_search_returns_citations_with_span(conn: sqlite3.Connection) -> None:
    kb_id = kb.create_kb(conn, "运维库")
    markdown = (
        "# 运维手册\n"
        "## 备份策略\n"
        "每天凌晨两点执行全量备份，保留最近七天，备份校验和使用 sha256。\n"
        "## 升级流程\n"
        "升级前必须执行 poly migrate，失败时回滚使用备份。\n"
    )
    kb.ingest_markdown(conn, kb_id, "ops.md", markdown)

    result = kb.search(conn, kb_id, "备份 保留 多少 天")
    assert result["status"] == "ok"
    top = result["hits"][0]
    assert top["doc"] == "ops.md"
    assert "备份策略" in (top["heading"] or "")
    assert top["span"][0] <= top["span"][1]
    assert "七天" in top["content"]


def test_search_abstains_on_nothing_relevant(conn: sqlite3.Connection) -> None:
    kb_id = kb.create_kb(conn, "窄库")
    kb.ingest_markdown(conn, kb_id, "only.md", "# 主题\n## 范围\n只谈备案流程细节。\n")
    result = kb.search(conn, kb_id, "量子物理 波函数")
    assert result["status"] == "abstain"
    assert result["hits"] == []


# ---- golden set (W11 exit: recall@5 >= 0.8) --------------------------------------


GOLDEN_DOC = """# PolyOpus 运维手册

## 备份策略
每天凌晨两点执行全量备份，保留最近七份。备份包含 manifest 与 sha256 校验和，
恢复前必须先校验并检查 schema 版本。每季度进行一次恢复演练并留档。

## 升级流程
升级前先执行 poly migrate --check 查看待应用迁移，确认无 SCHEMA_TOO_NEW 错误。
迁移失败时用备份恢复，禁止手工改库。升级后运行 poly doctor 确认六项检查全绿。

## 权限模型
资源默认 private，无授权不可见。授权走 resource_group_grants，effect 支持
allow 与 deny，expires_at 到期自动失效。跨租户共享 v1 不开放。

## 审批与注意力
attention 只能由结构化字段创建，禁止从报告自由文本推断。审批默认三十分钟过期，
过期自动拒绝并记录 expired。人的消息唤醒优先于后台任务。

## 多实例
实例每十五秒上报心跳，超过六十秒判离线。配置、权限、策略与 ACL 的变更递增
config_versions 并让各实例缓存失效。定时任务由租约保证单飞。

## 用量与预算
每个工单可配置 max_total_tokens 预算，超限后执行器报告 blocked 并进入收件箱。
模型用量按 tokens 与 cost_micros 双口径记账，价格表带版本。
"""

GOLDEN: list[tuple[str, str]] = [
    ("备份保留多少份", "七份"),
    ("恢复前要做什么检查", "校验"),
    ("多久演练一次恢复", "季度"),
    ("升级前先跑什么命令", "migrate"),
    ("迁移失败怎么办", "备份恢复"),
    ("升级后用什么确认健康", "doctor"),
    ("资源默认可见性是什么", "private"),
    ("授权过期后怎样", "失效"),
    ("审批默认多久过期", "三十分钟"),
    ("实例多久没心跳算离线", "六十秒"),
    ("定时任务怎么保证不重复", "租约"),
    ("工单预算超限会怎样", "blocked"),
]


def test_golden_set_recall_at_5(conn: sqlite3.Connection) -> None:
    kb_id = kb.create_kb(conn, "黄金集库")
    kb.ingest_markdown(conn, kb_id, "manual.md", GOLDEN_DOC)

    hits = 0
    misses: list[str] = []
    for query, expected in GOLDEN:
        result = kb.search(conn, kb_id, query, top_k=5)
        top5 = result.get("hits", [])
        if any(expected in h["content"] for h in top5):
            hits += 1
        else:
            misses.append(f"{query} -> expected {expected}")
    recall = hits / len(GOLDEN)
    assert recall >= 0.8, f"recall@5 {recall:.2f} < 0.80; misses: {misses}"
