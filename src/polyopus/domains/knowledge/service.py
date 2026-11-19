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

FTS_PREFIX = "kb_chunks_fts"


def fts_table(kb_id: str) -> str:
    """One FTS5 table PER KB: BM25's IDF is computed over the whole virtual
    table, so a shared index lets other KBs' chunks dilute this KB's scores
    (seen as false abstains once several KBs exist). kb ids are hex, safe
    as an identifier suffix."""
    return f"{FTS_PREFIX}_{kb_id}"


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


def ensure_index(conn: sqlite3.Connection, kb_id: str) -> str:
    table = fts_table(kb_id)
    conn.execute(
        f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS "{table}"
        USING fts5(content, kb_id UNINDEXED)
        """
    )
    conn.commit()
    return table


def _reindex_kb(conn: sqlite3.Connection, kb_id: str) -> None:
    table = ensure_index(conn, kb_id)
    conn.execute(f'DELETE FROM "{table}" WHERE kb_id = ?', (kb_id,))
    for row in conn.execute(
        "SELECT id, content FROM knowledge_chunks WHERE kb_id = ?", (kb_id,)
    ).fetchall():
        # explicit rowid = knowledge_chunks.id: the search JOINs on f.rowid,
        # so auto-assigned rowids would silently point at the wrong chunk
        conn.execute(
            f'INSERT INTO "{table}"(rowid, content, kb_id) VALUES (?, ?, ?)',
            (int(row["id"]), _bigram_tokens(str(row["content"])), kb_id),
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
    conn: sqlite3.Connection, name: str, *,
    tenant_id: str = TENANT,
    description: str | None = None,
    chunker_version: str = "md-headings-v1",
) -> str:
    kb_id = "kb_" + secrets.token_hex(8)
    now = int(time.time())
    try:
        conn.execute(
            """
            INSERT INTO knowledge_bases
              (tenant_id, kb_id, name, description, chunk_config_json,
               chunker_version, visibility, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'private', 'ready', ?, ?)
            """,
            (tenant_id, kb_id, name, description,
             json.dumps({"min_tokens": TARGET_MIN_TOKENS, "max_tokens": TARGET_MAX_TOKENS,
                         "overlap": OVERLAP_RATIO}, ensure_ascii=False),
             chunker_version, now, now),
        )
    except sqlite3.IntegrityError as exc:
        raise AppError("CONFLICT", details={"reason": "kb_name_taken"}) from exc
    conn.commit()
    return kb_id


def _kb(conn: sqlite3.Connection, kb_id: str, tenant_id: str = TENANT) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM knowledge_bases WHERE tenant_id = ? AND kb_id = ? "
        "AND deleted_at IS NULL",
        (tenant_id, kb_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND")
    return row  # type: ignore[no-any-return]


def _kb_view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["kb_id"],
        "kbId": row["kb_id"],
        "name": row["name"],
        "description": row["description"],
        "status": row["status"],
        "docCount": int(row["doc_count"]),
        "chunkCount": int(row["chunk_count"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_kbs(
    conn: sqlite3.Connection, *, tenant_id: str = TENANT,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM knowledge_bases WHERE tenant_id = ? AND deleted_at IS NULL"
        " ORDER BY updated_at DESC", (tenant_id,),
    ).fetchall()
    return [_kb_view(row) for row in rows]


def get_kb(
    conn: sqlite3.Connection, kb_id: str, *, tenant_id: str = TENANT,
) -> dict[str, Any]:
    return _kb_view(_kb(conn, kb_id, tenant_id))


def update_kb(
    conn: sqlite3.Connection, kb_id: str, *,
    tenant_id: str = TENANT,
    name: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    _kb(conn, kb_id, tenant_id)
    updates: list[str] = []
    params: list[object] = []
    if name is not None:
        updates.append("name = ?")
        params.append(name.strip())
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if updates:
        updates.append("updated_at = ?")
        params.append(int(time.time()))
        params.extend([tenant_id, kb_id])
        try:
            conn.execute(
                f"UPDATE knowledge_bases SET {', '.join(updates)}"
                " WHERE tenant_id = ? AND kb_id = ?", params,
            )
        except sqlite3.IntegrityError as exc:
            raise AppError("CONFLICT", details={"reason": "kb_name_taken"}) from exc
    conn.commit()
    return get_kb(conn, kb_id, tenant_id=tenant_id)


def delete_kb(
    conn: sqlite3.Connection, kb_id: str, *, tenant_id: str = TENANT,
) -> None:
    _kb(conn, kb_id, tenant_id)
    now = int(time.time())
    conn.execute(
        "UPDATE knowledge_bases SET deleted_at = ?, updated_at = ?"
        " WHERE tenant_id = ? AND kb_id = ?", (now, now, tenant_id, kb_id),
    )
    conn.execute(
        "UPDATE knowledge_docs SET deleted_at = ?, updated_at = ?"
        " WHERE tenant_id = ? AND kb_id = ?", (now, now, tenant_id, kb_id),
    )
    conn.commit()
    table = ensure_index(conn, kb_id)
    conn.execute(f'DROP TABLE IF EXISTS "{table}"')
    conn.commit()


def ingest_markdown(
    conn: sqlite3.Connection, kb_id: str, filename: str, markdown: str,
    *, tenant_id: str = TENANT,
) -> str:
    """Deterministic md pipeline: chunk -> rows -> reindex per KB."""
    _kb(conn, kb_id, tenant_id)
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
            (tenant_id, doc_id, kb_id, filename, len(markdown.encode()), sha,
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
            (tenant_id, "kc_" + secrets.token_hex(8), doc_id, kb_id, chunk.idx,
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


# ---- documents ---------------------------------------------------------------


def _doc_view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["doc_id"],
        "docId": row["doc_id"],
        "kbId": row["kb_id"],
        "filename": row["filename"],
        "mime": row["mime"],
        "size": int(row["size"]),
        "sha256": row["sha256"],
        "status": row["status"],
        "chunkCount": int(row["chunk_count"]),
        "createdAt": row["created_at"],
    }


def _doc(
    conn: sqlite3.Connection, doc_id: str, tenant_id: str = TENANT,
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM knowledge_docs WHERE tenant_id = ? AND doc_id = ?"
        " AND deleted_at IS NULL", (tenant_id, doc_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"docId": doc_id})
    return row  # type: ignore[no-any-return]


def list_docs(
    conn: sqlite3.Connection, kb_id: str, *,
    tenant_id: str = TENANT,
    q: str | None = None,
    folder: str | None = None,
) -> list[dict[str, Any]]:
    _kb(conn, kb_id, tenant_id)
    sql = ("SELECT * FROM knowledge_docs WHERE tenant_id = ? AND kb_id = ?"
           " AND deleted_at IS NULL")
    params: list[object] = [tenant_id, kb_id]
    if q:
        sql += " AND filename LIKE ?"
        params.append(f"%{q}%")
    if folder:
        sql += " AND folder = ?"
        params.append(folder)
    sql += " ORDER BY created_at DESC"
    return [_doc_view(row) for row in conn.execute(sql, params).fetchall()]


def get_doc(
    conn: sqlite3.Connection, doc_id: str, *, tenant_id: str = TENANT,
) -> dict[str, Any]:
    return _doc_view(_doc(conn, doc_id, tenant_id))


def preview_doc(
    conn: sqlite3.Connection, doc_id: str, *,
    tenant_id: str = TENANT, limit: int = 5,
) -> dict[str, Any]:
    row = _doc(conn, doc_id, tenant_id)
    chunks = conn.execute(
        "SELECT idx, heading_path, content, char_start, char_end"
        " FROM knowledge_chunks WHERE tenant_id = ? AND doc_id = ?"
        " ORDER BY idx LIMIT ?", (tenant_id, doc_id, max(1, min(limit, 50))),
    ).fetchall()
    return {
        "doc": _doc_view(row),
        "chunks": [
            {
                "idx": int(chunk["idx"]),
                "heading": chunk["heading_path"],
                "content": chunk["content"],
                "span": [chunk["char_start"], chunk["char_end"]],
            }
            for chunk in chunks
        ],
    }


def delete_doc(
    conn: sqlite3.Connection, doc_id: str, *, tenant_id: str = TENANT,
) -> None:
    row = _doc(conn, doc_id, tenant_id)
    now = int(time.time())
    conn.execute(
        "UPDATE knowledge_docs SET deleted_at = ?, updated_at = ?"
        " WHERE tenant_id = ? AND doc_id = ?", (now, now, tenant_id, doc_id),
    )
    conn.execute(
        "UPDATE knowledge_bases SET doc_count = ("
        " SELECT count(*) FROM knowledge_docs WHERE kb_id = ?"
        " AND deleted_at IS NULL AND status = 'ready'),"
        " chunk_count = (SELECT COALESCE(SUM(chunk_count), 0) FROM knowledge_docs"
        " WHERE kb_id = ? AND deleted_at IS NULL AND status = 'ready'),"
        " updated_at = ? WHERE tenant_id = ? AND kb_id = ?",
        (str(row["kb_id"]), str(row["kb_id"]), now, tenant_id, str(row["kb_id"])),
    )
    conn.commit()
    _reindex_kb(conn, str(row["kb_id"]))


def reindex_doc(
    conn: sqlite3.Connection, doc_id: str, *, tenant_id: str = TENANT,
) -> dict[str, Any]:
    row = _doc(conn, doc_id, tenant_id)
    _reindex_kb(conn, str(row["kb_id"]))
    return _doc_view(row)


def reindex_all(
    conn: sqlite3.Connection, kb_id: str, *, tenant_id: str = TENANT,
) -> dict[str, Any]:
    _kb(conn, kb_id, tenant_id)
    _reindex_kb(conn, kb_id)
    return get_kb(conn, kb_id, tenant_id=tenant_id)


# ---- retrieval ----------------------------------------------------------------


def search(
    conn: sqlite3.Connection, kb_id: str, query: str, *,
    tenant_id: str = TENANT,
    top_k: int = TOP_K,
) -> dict[str, Any]:
    """BM25 + citations; abstains below the confidence floor."""
    kb = _kb(conn, kb_id, tenant_id)
    ready = conn.execute(
        "SELECT count(*) FROM knowledge_docs WHERE kb_id = ? AND status = 'ready' "
        "AND deleted_at IS NULL",
        (kb_id,),
    ).fetchone()[0]
    if not int(ready):
        raise AppError(
            "KB_NOT_READY", details={"kbId": kb_id, "reason": "no processed documents"}
        )

    table = ensure_index(conn, kb_id)
    rows = conn.execute(
        f"""
        SELECT c.chunk_id, c.doc_id, c.idx, c.content, c.heading_path,
               c.char_start, c.char_end, d.filename,
               bm25("{table}") AS score
        FROM "{table}" f
        JOIN knowledge_chunks c ON c.id = f.rowid
        JOIN knowledge_docs d ON d.doc_id = c.doc_id AND d.deleted_at IS NULL
        WHERE "{table}" MATCH ?
        ORDER BY score LIMIT ?
        """,
        (_match_expression(query), top_k),
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
