"""Memory: raw capture -> candidate -> atom, rule-first (W11 batch 1).

docs/13 §4: three logical tiers over two physical tables —
raw = memory_events(kind=raw), candidate = memory_atoms(status=candidate),
atom = memory_atoms(status=active). Promotion is rule-first (value →
evidence → duplicate → conflict); the LLM judge is a later tier, not a
dependency. No embeddings yet: dedupe uses normalized assertions plus a
deterministic similarity ratio.
"""

from __future__ import annotations

import difflib
import json
import re
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

RAW_MIN_CHARS = 12
DEDUPE_RATIO = 0.92
PROMOTE_CONFIDENCE = 0.8
RECALL_BUDGET_CHARS = 1500
RECALL_TOP_N = 8

DEFAULT_AGENT = "agent:default"

SENSITIVE_PATTERNS = (
    (re.compile(r"(sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})"), "api_key"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"), "email"),
    (re.compile(r"\b\d{17}[\dXx]\b"), "id_card"),
    (re.compile(r"(?i)(密码|口令|password|secret|token)\s*[:=]\s*\S+"), "credential"),
)
EPHEMERAL_PATTERNS = (
    re.compile(r"(?i)(今天|现在|当前)?(天气|temperature)\s"),
    re.compile(r"(?i)临时"),
)

KIND_HINTS = (
    (re.compile(r"(?i)(喜欢|偏好|希望|用中文|简洁|记住我喜欢|以后)"), "preference"),
    (re.compile(r"(?i)(在|位于|是|位于)\s*.+(区|区域|机房|库|集群)"), "fact"),
)


@dataclass(frozen=True)
class Candidate:
    kind: str
    text: str
    confidence: float
    source: str  # explicit_user_request | assistant_inferred
    evidence: dict[str, Any]


def _now() -> int:
    return int(time.time())


def _agent_of_thread(conn: sqlite3.Connection, thread_id: str) -> str:
    row = conn.execute(
        "SELECT COALESCE(agent_id, ?) FROM threads WHERE thread_id = ?",
        (DEFAULT_AGENT, thread_id),
    ).fetchone()
    return str(row[0]) if row else DEFAULT_AGENT


# ---- tier 1: raw capture -----------------------------------------------------


def capture_raw(
    conn: sqlite3.Connection, tenant_id: str, thread_id: str, turn_id: str
) -> int:
    """After a finished turn: keep user/assistant text (>=12 chars) as raw events."""
    rows = conn.execute(
        "SELECT role, content FROM messages WHERE thread_id = ? AND turn_id = ? "
        "AND role IN ('user', 'assistant') AND deleted_at IS NULL",
        (thread_id, turn_id),
    ).fetchall()
    written = 0
    for row in rows:
        text = str(row["content"] or "").strip()
        if len(text) < RAW_MIN_CHARS:
            continue
        conn.execute(
            """
            INSERT INTO memory_events
              (event_id, tenant_id, atom_id, kind, payload_json, created_at)
            VALUES (?, ?, ?, 'raw', ?, ?)
            """,
            (
                "me_" + secrets.token_hex(8),
                tenant_id,
                f"raw:{turn_id}:{row['role']}",
                json.dumps(
                    {"thread_id": thread_id, "turn_id": turn_id,
                     "role": row["role"], "text": text},
                    ensure_ascii=False,
                ),
                _now(),
            ),
        )
        written += 1
    conn.commit()
    return written


def load_raw(conn: sqlite3.Connection, tenant_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in conn.execute(
        "SELECT payload_json FROM memory_events WHERE tenant_id = ? AND kind = 'raw' "
        "ORDER BY id",
        (tenant_id,),
    ).fetchall():
        out.append(json.loads(row[0]))
    return out


# ---- tier 2: extraction (rule-based v1; LLM extractor is a later tier) -------


def screen_sensitive(text: str) -> str | None:
    for pattern, label in SENSITIVE_PATTERNS:
        if pattern.search(text):
            return label
    return None


def screen_ephemeral(text: str) -> bool:
    return any(p.search(text) for p in EPHEMERAL_PATTERNS)


def extract_candidates(raw_items: list[dict[str, Any]]) -> list[Candidate]:
    """Deterministic extraction: explicit user asks rank above inference."""
    out: list[Candidate] = []
    for item in raw_items:
        text = str(item.get("text", "")).strip()
        if not text or screen_ephemeral(text):
            continue
        if item.get("role") != "user":
            continue  # v1: only explicit user statements promote
        explicit = bool(
            re.search(r"(记住|以后|我喜欢|我希望|请用|偏好)", text)
        )
        kind = next(
            (k for pattern, k in KIND_HINTS if pattern.search(text)),
            "fact",
        )
        out.append(
            Candidate(
                kind=kind,
                text=text,
                confidence=0.95 if explicit else 0.6,
                source="explicit_user_request" if explicit else "assistant_inferred",
                evidence={
                    "thread_id": item.get("thread_id"),
                    "turn_id": item.get("turn_id"),
                    "rule": "explicit_marker" if explicit else "plain_statement",
                },
            )
        )
    return out


def stage_candidates(
    conn: sqlite3.Connection, tenant_id: str, agent_id: str,
    candidates: list[Candidate],
) -> list[str]:
    atom_ids: list[str] = []
    now = _now()
    for cand in candidates:
        atom_id = "ma_" + secrets.token_hex(8)
        conn.execute(
            """
            INSERT INTO memory_atoms
              (atom_id, tenant_id, agent_id, kind, text, confidence, status,
               valid_from, source, evidence_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?)
            """,
            (atom_id, tenant_id, agent_id, cand.kind, cand.text,
             cand.confidence, now, cand.source,
             json.dumps(cand.evidence, ensure_ascii=False), now, now),
        )
        atom_ids.append(atom_id)
    conn.commit()
    return atom_ids


# ---- tier 3: rule-first promotion --------------------------------------------


def _normalize(text: str) -> str:
    return re.sub(r"[\s，。,.!！？?：:；;、]+", "", text).lower()


def promote(
    conn: sqlite3.Connection, tenant_id: str, agent_id: str,
    *, now: int | None = None,
) -> dict[str, int]:
    """Apply the rule ladder to every candidate. Returns counters."""
    ts = now or _now()
    stats = {"promoted": 0, "merged": 0, "skipped_low_confidence": 0,
             "conflict_review": 0, "rejected_sensitive": 0}
    rows = conn.execute(
        "SELECT * FROM memory_atoms WHERE tenant_id = ? AND agent_id = ? "
        "AND status = 'candidate' ORDER BY id",
        (tenant_id, agent_id),
    ).fetchall()
    for row in rows:
        text = str(row["text"])
        sensitive = screen_sensitive(text)
        if sensitive:
            # docs/13 4.1: reject AND audit (never silently dropped)
            conn.execute(
                "UPDATE memory_atoms SET status = 'retired', valid_to = ? "
                "WHERE atom_id = ?",
                (ts, row["atom_id"]),
            )
            conn.execute(
                """
                INSERT INTO memory_events
                  (event_id, tenant_id, atom_id, kind, payload_json, created_at)
                VALUES (?, ?, ?, 'deleted', ?, ?)
                """,
                ("me_" + secrets.token_hex(8), tenant_id, row["atom_id"],
                 json.dumps({"reason": f"sensitive:{sensitive}"}, ensure_ascii=False), ts),
            )
            stats["rejected_sensitive"] += 1
            continue
        if float(row["confidence"]) < PROMOTE_CONFIDENCE:
            # write whitelist: inferred memory needs confidence >= 0.8
            conn.execute(
                "UPDATE memory_atoms SET status = 'retired', valid_to = ? "
                "WHERE atom_id = ?",
                (ts, row["atom_id"]),
            )
            stats["skipped_low_confidence"] += 1
            continue

        duplicate = _find_duplicate(conn, tenant_id, agent_id, text)
        if duplicate is not None:
            conn.execute(
                """
                UPDATE memory_atoms SET status = 'retired', valid_to = ?,
                       supersedes = ? WHERE atom_id = ?
                """,
                (ts, duplicate["atom_id"], row["atom_id"]),
            )
            conn.execute(
                """
                INSERT INTO memory_events
                  (event_id, tenant_id, atom_id, kind, payload_json, created_at)
                VALUES (?, ?, ?, 'merged', ?, ?)
                """,
                ("me_" + secrets.token_hex(8), tenant_id, row["atom_id"],
                 json.dumps({"into": duplicate["atom_id"]}, ensure_ascii=False), ts),
            )
            stats["merged"] += 1
            continue

        conflicting = _find_conflict(conn, tenant_id, agent_id, text)
        if conflicting is not None:
            # docs/13 §4.4: keep both, close the old window, flag for review
            conn.execute(
                "UPDATE memory_atoms SET valid_to = ?, status = 'pending_review' "
                "WHERE atom_id = ?",
                (ts, conflicting["atom_id"]),
            )
            conn.execute(
                """
                UPDATE memory_atoms SET status = 'pending_review', supersedes = ?
                WHERE atom_id = ?
                """,
                (conflicting["atom_id"], row["atom_id"]),
            )
            stats["conflict_review"] += 1
            continue

        conn.execute(
            "UPDATE memory_atoms SET status = 'active' WHERE atom_id = ?",
            (row["atom_id"],),
        )
        conn.execute(
            """
            INSERT INTO memory_events
              (event_id, tenant_id, atom_id, kind, payload_json, created_at)
            VALUES (?, ?, ?, 'promoted', ?, ?)
            """,
            ("me_" + secrets.token_hex(8), tenant_id, row["atom_id"],
             json.dumps({"text": text}, ensure_ascii=False), ts),
        )
        stats["promoted"] += 1
    conn.commit()
    return stats


def _active_atoms(conn: sqlite3.Connection, tenant_id: str, agent_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM memory_atoms WHERE tenant_id = ? AND agent_id = ? "
            "AND status IN ('active', 'pending_review')",
            (tenant_id, agent_id),
        ).fetchall()
    )


def _find_duplicate(
    conn: sqlite3.Connection, tenant_id: str, agent_id: str, text: str
) -> sqlite3.Row | None:
    target = _normalize(text)
    for row in _active_atoms(conn, tenant_id, agent_id):
        if _normalize(str(row["text"])) == target:
            return row
        ratio = difflib.SequenceMatcher(
            None, target, _normalize(str(row["text"]))
        ).ratio()
        if ratio > DEDUPE_RATIO:
            return row
    return None


def _find_conflict(
    conn: sqlite3.Connection, tenant_id: str, agent_id: str, text: str
) -> sqlite3.Row | None:
    """Same subject, different assertion: 'X 是 A' vs 'X 是 B'."""
    match = re.match(r"^(.{2,12}?)(是|在|为|改为)\s*(.+)$", text.strip())
    if not match:
        return None
    subject = _normalize(match.group(1))
    for row in _active_atoms(conn, tenant_id, agent_id):
        other = re.match(r"^(.{2,12}?)(是|在|为|改为)\s*(.+)$", str(row["text"]).strip())
        if not other:
            continue
        if _normalize(other.group(1)) == subject and _normalize(
            other.group(3)
        ) != _normalize(match.group(3)):
            return row
    return None


# ---- read path (keyword scoring; vectors arrive with the KB batch) -----------


# queries that name a concept map to the atom kinds that hold it (CJK lexical
# baseline until the embedding batch lands)
KIND_QUERY_HINTS = (
    (re.compile(r"(偏好|喜欢|风格|以后|尽量|习惯)"), "preference"),
    (re.compile(r"(位置|在哪|部署|技术栈|框架|约定|窗口|节奏)"), "fact"),
)


def _bigrams(text: str) -> set[str]:
    normalized = _normalize(text)
    return {normalized[i : i + 2] for i in range(len(normalized) - 1)}


def recall(
    conn: sqlite3.Connection, tenant_id: str, agent_id: str, query: str,
    *, top_n: int = RECALL_TOP_N,
) -> list[dict[str, str]]:
    """Budgeted top-N active atoms; CJK bigram overlap + kind hints + recency."""
    query_bigrams = _bigrams(query)
    query_chars = set(_normalize(query))
    if not query_chars:
        return []
    wanted_kinds = {
        kind for pattern, kind in KIND_QUERY_HINTS if pattern.search(query)
    }
    scored: list[tuple[float, int, sqlite3.Row]] = []
    for row in conn.execute(
        "SELECT * FROM memory_atoms WHERE tenant_id = ? AND agent_id = ? "
        "AND status = 'active' AND (valid_to IS NULL OR valid_to > ?)",
        (tenant_id, agent_id, _now()),
    ).fetchall():
        text = str(row["text"])
        chars = set(_normalize(text))
        char_overlap = len(query_chars & chars) / len(query_chars)
        bigram_overlap = (
            len(query_bigrams & _bigrams(text)) / len(query_bigrams)
            if query_bigrams else 0.0
        )
        relevance = max(char_overlap, bigram_overlap)
        kind_match = str(row["kind"]) in wanted_kinds
        if relevance <= 0 and not kind_match:
            continue
        # kind-only matches rank below any lexical hit (floor 0.1)
        score = relevance + (0.3 if kind_match else 0.0)
        if relevance <= 0:
            score = 0.1
        scored.append((score + float(row["confidence"]) * 0.2,
                       int(row["created_at"]), row))
    scored.sort(key=lambda item: (-item[0], -item[1]))
    out: list[dict[str, str]] = []
    used = 0
    for _score, _ts, row in scored[:top_n]:
        if used + len(str(row["text"])) > RECALL_BUDGET_CHARS:
            break
        out.append({"atomId": str(row["atom_id"]), "kind": str(row["kind"]),
                    "text": str(row["text"]), "source": str(row["source"])})
        used += len(str(row["text"]))
    return out
