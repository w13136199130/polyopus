"""Memory HTTP helpers: list/create/update/delete/search/export and pause state.

The rule-based capture/promote pipeline lives in `service.py`; this module adds
the read/write surface used by the personalization page without changing the
existing tables (pause state rides on users.preferences_json).
"""

from __future__ import annotations

import base64
import json
import secrets
import sqlite3
import time
from datetime import UTC, datetime
from typing import Any

from polyopus.platform.errors import AppError


def _now() -> int:
    return int(time.time())


def _iso(ts: int | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(int(ts), tz=UTC).isoformat()


def _row_to_atom(row: sqlite3.Row) -> dict[str, Any]:
    try:
        evidence = json.loads(str(row["evidence_json"] or "{}"))
    except (TypeError, ValueError):
        evidence = {}
    return {
        "id": str(row["atom_id"]),
        "kind": str(row["kind"]),
        "text": str(row["text"]),
        "confidence": float(row["confidence"]),
        "status": str(row["status"]),
        "source": str(row["source"]),
        "validFrom": _iso(row["valid_from"]),
        "validTo": _iso(row["valid_to"]),
        "supersedes": row["supersedes"],
        "evidence": evidence if isinstance(evidence, dict) else {},
        "createdAt": _iso(row["created_at"]),
        "updatedAt": _iso(row["updated_at"]),
    }


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        return max(0, int(base64.urlsafe_b64decode(cursor.encode()).decode()))
    except (ValueError, TypeError, UnicodeDecodeError):
        return 0


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode()


def list_atoms(
    conn: sqlite3.Connection,
    tenant_id: str,
    *,
    kind: str | None = None,
    status: str | None = None,
    source: str | None = None,
    cursor: str | None = None,
    limit: int = 30,
) -> tuple[list[dict[str, Any]], str | None]:
    offset = _decode_cursor(cursor)
    where = ["tenant_id = ?", "status != 'candidate'"]
    params: list[Any] = [tenant_id]
    if kind:
        where.append("kind = ?")
        params.append(kind)
    if status:
        where.append("status = ?")
        params.append(status)
    if source:
        where.append("source = ?")
        params.append(source)
    rows = conn.execute(
        "SELECT * FROM memory_atoms WHERE " + " AND ".join(where)
        + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        (*params, limit + 1, offset),
    ).fetchall()
    page = rows[:limit]
    next_cursor = _encode_cursor(offset + limit) if len(rows) > limit else None
    return [_row_to_atom(row) for row in page], next_cursor


def get_atom(conn: sqlite3.Connection, tenant_id: str, atom_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM memory_atoms WHERE tenant_id = ? AND atom_id = ?",
        (tenant_id, atom_id),
    ).fetchone()
    return _row_to_atom(row) if row else None


def create_atom(
    conn: sqlite3.Connection,
    tenant_id: str,
    *,
    kind: str,
    text: str,
    confidence: float = 1.0,
    evidence: dict[str, Any] | None = None,
    by: str = "system",
) -> dict[str, Any]:
    atom_id = "ma_" + secrets.token_hex(8)
    now = _now()
    conn.execute(
        """
        INSERT INTO memory_atoms
          (atom_id, tenant_id, agent_id, kind, text, confidence, status,
           valid_from, source, evidence_json, created_at, updated_at)
        VALUES (?, ?, '*', ?, ?, ?, 'active', ?, 'explicit_user', ?, ?, ?)
        """,
        (atom_id, tenant_id, kind, text, confidence, now,
         json.dumps({**(evidence or {}), "explicit": True, "by": by}, ensure_ascii=False),
         now, now),
    )
    conn.execute(
        """
        INSERT INTO memory_events
          (event_id, tenant_id, atom_id, kind, payload_json, created_at)
        VALUES (?, ?, ?, 'promoted', ?, ?)
        """,
        ("me_" + secrets.token_hex(8), tenant_id, atom_id,
         json.dumps({"text": text, "by": by}, ensure_ascii=False), now),
    )
    conn.commit()
    return get_atom(conn, tenant_id, atom_id) or {}


def update_atom(
    conn: sqlite3.Connection,
    tenant_id: str,
    atom_id: str,
    *,
    text: str | None = None,
    status: str | None = None,
    reason: str | None = None,
    by: str = "system",
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM memory_atoms WHERE tenant_id = ? AND atom_id = ?",
        (tenant_id, atom_id),
    ).fetchone()
    if row is None:
        return None
    now = _now()
    sets: list[str] = ["updated_at = ?"]
    params: list[Any] = [now]
    if text is not None:
        sets.append("text = ?")
        params.append(text)
    if status is not None:
        sets.append("status = ?")
        params.append(status)
        if status == "retired":
            sets.append("valid_to = ?")
            params.append(now)
    conn.execute(
        f"UPDATE memory_atoms SET {', '.join(sets)} WHERE tenant_id = ? AND atom_id = ?",
        (*params, tenant_id, atom_id),
    )
    conn.execute(
        """
        INSERT INTO memory_events
          (event_id, tenant_id, atom_id, kind, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("me_" + secrets.token_hex(8), tenant_id, atom_id,
         "deleted" if status == "retired" else "promoted",
         json.dumps({"reason": reason, "by": by, "status": status}, ensure_ascii=False),
         now),
    )
    conn.commit()
    return get_atom(conn, tenant_id, atom_id)


def delete_atom(
    conn: sqlite3.Connection, tenant_id: str, atom_id: str, *, by: str = "system"
) -> bool:
    row = conn.execute(
        "SELECT atom_id FROM memory_atoms WHERE tenant_id = ? AND atom_id = ?",
        (tenant_id, atom_id),
    ).fetchone()
    if row is None:
        return False
    now = _now()
    conn.execute(
        "UPDATE memory_atoms SET status = 'retired', valid_to = ?, updated_at = ? "
        "WHERE tenant_id = ? AND atom_id = ?",
        (now, now, tenant_id, atom_id),
    )
    conn.execute(
        """
        INSERT INTO memory_events
          (event_id, tenant_id, atom_id, kind, payload_json, created_at)
        VALUES (?, ?, ?, 'deleted', ?, ?)
        """,
        ("me_" + secrets.token_hex(8), tenant_id, atom_id,
         json.dumps({"by": by}, ensure_ascii=False), now),
    )
    conn.commit()
    return True


def search_atoms(
    conn: sqlite3.Connection, tenant_id: str, query: str, *, limit: int = 20
) -> list[dict[str, Any]]:
    needle = f"%{query.strip()}%"
    rows = conn.execute(
        "SELECT * FROM memory_atoms WHERE tenant_id = ? "
        "AND status IN ('active', 'pending_review') AND text LIKE ? "
        "ORDER BY updated_at DESC LIMIT ?",
        (tenant_id, needle, limit),
    ).fetchall()
    return [{"atom": _row_to_atom(row), "score": 1.0} for row in rows]


def export_atoms(conn: sqlite3.Connection, tenant_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM memory_atoms WHERE tenant_id = ? AND status != 'candidate' "
        "ORDER BY created_at",
        (tenant_id,),
    ).fetchall()
    return [_row_to_atom(row) for row in rows]


def pause_state(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT preferences_json FROM users WHERE user_id = ?", (user_id,)
    ).fetchone()
    prefs: dict[str, Any] = {}
    if row is not None:
        try:
            prefs = json.loads(str(row["preferences_json"] or "{}"))
        except (TypeError, ValueError):
            prefs = {}
    until = prefs.get("memoryPausedUntil")
    paused = bool(prefs.get("memoryPaused"))
    if paused and until:
        try:
            if datetime.fromisoformat(str(until).replace("Z", "+00:00")) <= datetime.now(UTC):
                paused = False
        except ValueError:
            pass
    return {"paused": paused, "until": until, "updatedAt": _iso(_now())}


def set_pause(
    conn: sqlite3.Connection, user_id: str, *, paused: bool, until: str | None = None
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT preferences_json FROM users WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise AppError("USER_NOT_FOUND")
    try:
        prefs = json.loads(str(row["preferences_json"] or "{}"))
    except (TypeError, ValueError):
        prefs = {}
    prefs["memoryPaused"] = bool(paused)
    if until:
        prefs["memoryPausedUntil"] = until
    else:
        prefs.pop("memoryPausedUntil", None)
    conn.execute(
        "UPDATE users SET preferences_json = ?, updated_at = ? WHERE user_id = ?",
        (json.dumps(prefs, ensure_ascii=False), _now(), user_id),
    )
    conn.commit()
    return {"paused": bool(paused), "until": until if paused else None,
            "updatedAt": _iso(_now())}


def writes_paused(conn: sqlite3.Connection, tenant_id: str, thread_id: str) -> bool:
    """True when the thread owner paused memory writes for their account."""
    row = conn.execute(
        "SELECT u.preferences_json FROM threads t "
        "JOIN users u ON u.user_id = t.owner_id AND u.tenant_id = t.tenant_id "
        "WHERE t.tenant_id = ? AND t.thread_id = ?",
        (tenant_id, thread_id),
    ).fetchone()
    if row is None:
        return False
    try:
        prefs = json.loads(str(row["preferences_json"] or "{}"))
    except (TypeError, ValueError):
        return False
    if not prefs.get("memoryPaused"):
        return False
    until = prefs.get("memoryPausedUntil")
    if not until:
        return True
    try:
        return datetime.fromisoformat(str(until).replace("Z", "+00:00")) > datetime.now(UTC)
    except ValueError:
        return True
