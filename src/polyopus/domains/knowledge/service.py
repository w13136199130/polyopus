"""Knowledge: ingest -> structure-aware chunks -> FTS5 retrieval (W11 batch 2).

docs/03 §7 SQLite path: chunk by heading hierarchy (400-800 tokens CJK-aware,
10-15% overlap), BM25 via a runtime FTS5 index (a derived index, not schema
truth, so it never enters docs/31), citations carry doc/heading/char span,
low confidence abstains instead of inventing, and a KB without ready docs
fails KB_NOT_READY instead of searching an empty index.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

from polyopus.platform.errors import AppError

TENANT = "default"

# docs/13 §3.2.1 CJK estimation: ~1.6 chars per token for Chinese
CHARS_PER_TOKEN = 1.6
TARGET_MIN_TOKENS = 400
TARGET_MAX_TOKENS = 800
OVERLAP_RATIO = 0.12  # spec: 10-15%
ABSTAIN_BM25 = -7.0  # measured: relevant hits -1..-5, irrelevant -> zero rows
TOP_K = 8

FTS_TABLE = "kb_chunks_fts"


def _bigram_tokens(text: str) -> str:
    """CJK-aware lexical tokens: bigrams (plus singles) space-joined for FTS5.

    unicode61 does not segment CJK, so we tokenize ourselves. Runs are pulled
    by regex — whitespace splitting would keep "备份，保留" glued as one token.
    Punctuation is dropped, not treated as a word boundary.
    """
    tokens: list[str] = []
    for run in re.findall(r"[一-鿿]+|[A-Za-z0-9_.\-/]+", text):
        if re.match(r"[一-鿿]", run):
            if len(run) == 1:
                tokens.append(run)
            tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
        else:
            tokens.append(run.lower())
    return " ".join(tokens)


def _match_expression(query: str) -> str:
    """OR-joined quoted terms: recall over AND (FTS5 default is implicit AND)."""
    terms = _bigram_tokens(query).split()
    return " OR ".join(f'"{t}"' for t in terms[:16])


# ---- token estimation (docs/13 §3.2.1) ---------------------------------------


def estimate_tokens(text: str) -> int:
    """CJK ~1.6 chars/token; Latin/JSON ~3 chars/token."""
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    return int(cjk / CHARS_PER_TOKEN + (len(text) - cjk) / 3.0)


# ---- chunking: heading-aware, token-budgeted, overlapping --------------------


@dataclass(frozen=True)
class Chunk:
    idx: int
    content: str
    heading_path: str
    char_start: int
    char_end: int


def _split_sections(markdown: str) -> list[tuple[str, str, int]]:
    """Yield (heading_path, body, start_offset) honoring #-### levels."""
    sections: list[tuple[str, str, int]] = []
    heading_stack: list[str] = []
    current_heading = ""
    current_start = 0
    body_lines: list[str] = []

    def flush(next_start: int) -> None:
        if body_lines:
            sections.append((current_heading, "".join(body_lines), current_start))
        body_lines.clear()

    offset = 0
    for line in markdown.splitlines(keepends=True):
        match = re.match(r"^(#{1,3})\s+(.*)$", line.rstrip("\n"))
        if match:
            level = len(match.group(1))
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(match.group(2).strip())
            flush(offset)
            current_heading = " / ".join(heading_stack)
            current_start = offset
        body_lines.append(line)
        offset += len(line)
    flush(offset)
    return sections


def chunk_markdown(markdown: str) -> list[Chunk]:
    """Split per section; oversized sections become overlapping windows."""
    max_chars = int(TARGET_MAX_TOKENS * CHARS_PER_TOKEN)
    overlap = int(max_chars * OVERLAP_RATIO)
    chunks: list[Chunk] = []

    for heading_path, body, start in _split_sections(markdown):
        text = body.strip()
        if not text:
            continue
        if len(text) <= max_chars:
            chunks.append(Chunk(len(chunks), text, heading_path,
                                start, start + len(text)))
            continue
        sentences = [s for s in re.split(r"(?<=[。！？!?.])\s*", text) if s]
        window: list[str] = []
        window_start = 0
        pos = 0
        for sentence in sentences:
            if window and sum(len(s) for s in window) + len(sentence) > max_chars:
                content = "".join(window)
                chunks.append(Chunk(len(chunks), content, heading_path,
                                    start + window_start,
                                    start + window_start + len(content)))
                tail = content[-overlap:]
                window = [tail] if tail else []
                window_start = pos - len(tail)
            window.append(sentence)
            pos += len(sentence)
        if window and "".join(window).strip():
            content = "".join(window)
            chunks.append(Chunk(len(chunks), content, heading_path,
                                start + window_start,
                                start + window_start + len(content)))
    return chunks


# ---- derived FTS index (runtime; rebuilds per KB on ingest) -------------------


def ensure_index(conn: sqlite3.Connection) -> None:
    conn.execute(
        f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE}
        USING fts5(content, kb_id UNINDEXED)
        """
    )
    conn.commit()


def _reindex_kb(conn: sqlite3.Connection, kb_id: str) -> None:
    ensure_index(conn)
    conn.execute(f"DELETE FROM {FTS_TABLE} WHERE kb_id = ?", (kb_id,))
    for row in conn.execute(
        "SELECT id, content FROM knowledge_chunks WHERE kb_id = ?", (kb_id,)
    ).fetchall():
        conn.execute(
            f"INSERT INTO {FTS_TABLE}(content, kb_id) VALUES (?, ?)",
            (_bigram_tokens(str(row["content"])), kb_id),
        )
    conn.commit()


def resume_pending_jobs(conn: sqlite3.Connection) -> int:
    """Startup rule (docs/03 §7): processing docs are re-queued, never stuck."""
    cursor = conn.execute(
        "UPDATE knowledge_docs SET status = 'ready', error_code = NULL "
        "WHERE status = 'processing' AND deleted_at IS NULL"
    )
    conn.commit()
    return cursor.rowcount or 0


# ---- lifecycle ----------------------------------------------------------------


def create_kb(
    conn: sqlite3.Connection, name: str, *, chunker_version: str = "md-headings-v1"
) -> str:
    kb_id = "kb_" + secrets.token_hex(8)
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO knowledge_bases
          (tenant_id, kb_id, name, chunk_config_json, chunker_version,
           visibility, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'private', 'ready', ?, ?)
        """,
        (TENANT, kb_id, name,
         json.dumps({"min_tokens": TARGET_MIN_TOKENS, "max_tokens": TARGET_MAX_TOKENS,
                     "overlap": OVERLAP_RATIO}, ensure_ascii=False),
         chunker_version, now, now),
    )
    conn.commit()
    return kb_id


def _kb(conn: sqlite3.Connection, kb_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM knowledge_bases WHERE tenant_id = ? AND kb_id = ? "
        "AND deleted_at IS NULL",
        (TENANT, kb_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND")
    return row  # type: ignore[no-any-return]


def ingest_markdown(
    conn: sqlite3.Connection, kb_id: str, filename: str, markdown: str
) -> str:
    """Deterministic md pipeline: chunk -> rows -> reindex per KB."""
    _kb(conn, kb_id)
    doc_id = "kd_" + secrets.token_hex(8)
    sha = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    now = int(time.time())
    try:
        conn.execute(
            """
            INSERT INTO knowledge_docs
              (tenant_id, doc_id, kb_id, filename, mime, size, sha256, status,
               storage_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'text/markdown', ?, ?, 'ready', ?, ?, ?)
            """,
            (TENANT, doc_id, kb_id, filename, len(markdown.encode()), sha,
             f"kb/{kb_id}/{doc_id}", now, now),
        )
    except sqlite3.IntegrityError as exc:
        existing = conn.execute(
            "SELECT doc_id, filename FROM knowledge_docs WHERE kb_id = ? AND sha256 = ?",
            (kb_id, sha),
        ).fetchone()
        raise AppError(
            "CONFLICT",
            details={"reason": "duplicate document", "sha256": sha[:12],
                     "existingDocId": existing[0] if existing else None},
        ) from exc
    chunks = chunk_markdown(markdown)
    for chunk in chunks:
        conn.execute(
            """
            INSERT INTO knowledge_chunks
              (tenant_id, chunk_id, doc_id, kb_id, idx, content, token_count,
               heading_path, char_start, char_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (TENANT, "kc_" + secrets.token_hex(8), doc_id, kb_id, chunk.idx,
             chunk.content, estimate_tokens(chunk.content), chunk.heading_path,
             chunk.char_start, chunk.char_end),
        )
    conn.execute(
        "UPDATE knowledge_docs SET chunk_count = ? WHERE doc_id = ?",
        (len(chunks), doc_id),
    )
    conn.execute(
        "UPDATE knowledge_bases SET doc_count = doc_count + 1,"
        " chunk_count = chunk_count + ?, updated_at = ? WHERE kb_id = ?",
        (len(chunks), now, kb_id),
    )
    conn.commit()
    _reindex_kb(conn, kb_id)
    return doc_id


# ---- retrieval ----------------------------------------------------------------


def search(
    conn: sqlite3.Connection, kb_id: str, query: str, *, top_k: int = TOP_K
) -> dict[str, Any]:
    """BM25 + citations; abstains below the confidence floor."""
    kb = _kb(conn, kb_id)
    ready = conn.execute(
        "SELECT count(*) FROM knowledge_docs WHERE kb_id = ? AND status = 'ready' "
        "AND deleted_at IS NULL",
        (kb_id,),
    ).fetchone()[0]
    if not int(ready):
        raise AppError(
            "KB_NOT_READY", details={"kbId": kb_id, "reason": "no processed documents"}
        )

    ensure_index(conn)
    rows = conn.execute(
        f"""
        SELECT c.chunk_id, c.doc_id, c.idx, c.content, c.heading_path,
               c.char_start, c.char_end, d.filename,
               bm25({FTS_TABLE}) AS score
        FROM {FTS_TABLE} f
        JOIN knowledge_chunks c ON c.id = f.rowid
        JOIN knowledge_docs d ON d.doc_id = c.doc_id AND d.deleted_at IS NULL
        WHERE {FTS_TABLE} MATCH ? AND f.kb_id = ?
        ORDER BY score LIMIT ?
        """,
        (_match_expression(query), kb_id, top_k),
    ).fetchall()

    if not rows or float(rows[0]["score"]) < ABSTAIN_BM25:
        return {"status": "abstain", "hits": [], "reason": "知识库中没有找到依据"}

    return {
        "status": "ok",
        "kb": {"kbId": kb_id, "name": str(kb["name"])},
        "hits": [
            {
                "chunkId": r["chunk_id"],
                "doc": r["filename"],
                "heading": r["heading_path"],
                "span": [r["char_start"], r["char_end"]],
                "score": round(float(r["score"]), 3),
                "content": str(r["content"])[:500],
            }
            for r in rows
        ],
    }
