"""Teams, rosters and delegation runs (v1.1 orchestration).

A team is a tenant-scoped roster of existing experts (`agent_id`) with a
coordinator role (`lead`) and zero or more `member`s. Slice 1 persists the
roster; slice 2 adds `delegations`: a team run fans a task out to members,
each member works in their own child thread, and the room thread receives
`delegation.started/ended` events plus a deterministic summary.

Delegation execution is split across two workers: this module claims pending
rows and posts one child turn per member; the existing turn worker runs the
turn, and `observe_running` finalizes the row when the turn is terminal.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import time
from typing import Any, cast

from polyopus.domains.audit import service as audit
from polyopus.platform.errors import AppError

DELEGATION_MAX_ATTEMPTS = 3
DELEGATION_LEASE_SECONDS = 120

ROLES = ("lead", "member")
_NAME_MAX = 100
_DESCRIPTION_MAX = 500


def _now() -> int:
    return int(time.time())


def _team_row(
    conn: sqlite3.Connection, tenant_id: str, team_id: str,
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM teams WHERE tenant_id = ? AND team_id = ?"
        " AND deleted_at IS NULL", (tenant_id, team_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"teamId": team_id})
    return cast(sqlite3.Row, row)


def _agent_row(
    conn: sqlite3.Connection, tenant_id: str, agent_id: str,
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT agent_id, name, status, published_version FROM agents"
        " WHERE tenant_id = ? AND agent_id = ? AND deleted_at IS NULL",
        (tenant_id, agent_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"agentId": agent_id})
    return cast(sqlite3.Row, row)


def _members(
    conn: sqlite3.Connection, tenant_id: str, team_id: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT m.agent_id, m.role, a.name, a.status, a.published_version"
        " FROM team_members m"
        " LEFT JOIN agents a ON a.agent_id = m.agent_id AND a.tenant_id = m.tenant_id"
        " WHERE m.tenant_id = ? AND m.team_id = ?"
        " ORDER BY CASE m.role WHEN 'lead' THEN 0 ELSE 1 END, m.id",
        (tenant_id, team_id),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        published = row["published_version"] is not None
        out.append({
            "agentId": str(row["agent_id"]),
            "name": str(row["name"] or row["agent_id"]),
            "role": str(row["role"]),
            "status": (
                "disabled" if str(row["status"] or "") == "disabled"
                else "published" if published else "draft"
            ),
            "version": int(row["published_version"] or 0),
        })
    return out


def _view(
    conn: sqlite3.Connection, row: sqlite3.Row, *,
    with_members: bool = True,
) -> dict[str, Any]:
    team_id = str(row["team_id"])
    members = (
        _members(conn, str(row["tenant_id"]), team_id) if with_members else []
    )
    try:
        routing = json.loads(str(row["routing_json"] or "{}"))
    except ValueError:
        routing = {}
    return {
        "id": team_id,
        "teamId": team_id,
        "name": row["name"],
        "description": row["description"],
        "routing": routing if isinstance(routing, dict) else {},
        "memberCount": len(members),
        "members": members,
        "createdBy": row["created_by"],
        "createdAt": int(row["created_at"]),
        "updatedAt": int(row["updated_at"]),
        "version": int(row["version"]),
    }


def get_team(
    conn: sqlite3.Connection, *, tenant_id: str, team_id: str,
) -> dict[str, Any]:
    return _view(conn, _team_row(conn, tenant_id, team_id))


def list_teams(
    conn: sqlite3.Connection, *, tenant_id: str,
    q: str | None = None, limit: int = 100,
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM teams WHERE tenant_id = ? AND deleted_at IS NULL"
    params: list[object] = [tenant_id]
    if q:
        sql += " AND (name LIKE ? OR COALESCE(description, '') LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
    sql += " ORDER BY updated_at DESC, id DESC LIMIT ?"
    params.append(max(1, min(limit, 200)))
    return [_view(conn, row) for row in conn.execute(sql, params).fetchall()]


def _clean_name(name: str) -> str:
    clean = name.strip()
    if not clean:
        raise AppError("VALIDATION_FAILED", details={"field": "name"})
    if len(clean) > _NAME_MAX:
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "name", "reason": "too_long"},
        )
    return clean


def _clean_description(description: str | None) -> str | None:
    if description is None:
        return None
    clean = description.strip()
    if len(clean) > _DESCRIPTION_MAX:
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "description", "reason": "too_long"},
        )
    return clean or None


def create_team(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    created_by: str,
    name: str,
    description: str | None = None,
    lead_id: str | None = None,
    member_ids: list[str] | None = None,
) -> dict[str, Any]:
    clean = _clean_name(name)
    roster: list[tuple[str, str]] = []
    seen: set[str] = set()
    if lead_id:
        _agent_row(conn, tenant_id, lead_id)
        roster.append((lead_id, "lead"))
        seen.add(lead_id)
    for agent_id in member_ids or []:
        clean_id = str(agent_id).strip()
        if not clean_id or clean_id in seen:
            continue
        _agent_row(conn, tenant_id, clean_id)
        roster.append((clean_id, "member"))
        seen.add(clean_id)

    team_id = "tm_" + secrets.token_hex(8)
    now = _now()
    try:
        conn.execute(
            "INSERT INTO teams (tenant_id, team_id, name, description,"
            " routing_json, created_by, created_at, updated_at, version)"
            " VALUES (?, ?, ?, ?, '{}', ?, ?, ?, 1)",
            (tenant_id, team_id, clean, _clean_description(description),
             created_by, now, now),
        )
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        raise AppError(
            "CONFLICT", details={"reason": "team_name_taken"},
        ) from exc
    for agent_id, role in roster:
        conn.execute(
            "INSERT INTO team_members (tenant_id, team_id, agent_id, role,"
            " created_at) VALUES (?, ?, ?, ?, ?)",
            (tenant_id, team_id, agent_id, role, now),
        )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="team.create", result="ok",
        actor_id=created_by, resource_type="team", resource_id=team_id,
        detail={"name": clean, "members": len(roster)},
    )
    return get_team(conn, tenant_id=tenant_id, team_id=team_id)


def update_team(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    team_id: str,
    name: str | None = None,
    description: str | None = None,
    by: str = "system",
) -> dict[str, Any]:
    row = _team_row(conn, tenant_id, team_id)
    updates: list[str] = []
    params: list[object] = []
    details: dict[str, Any] = {}
    if name is not None:
        clean = _clean_name(name)
        updates.append("name = ?")
        params.append(clean)
        details["name"] = clean
    if description is not None:
        updates.append("description = ?")
        params.append(_clean_description(description))
        details["descriptionChanged"] = True
    if not updates:
        return _view(conn, row)
    updates.extend(["updated_at = ?", "version = version + 1"])
    params.extend([_now(), tenant_id, team_id])
    try:
        conn.execute(
            f"UPDATE teams SET {', '.join(updates)}"
            " WHERE tenant_id = ? AND team_id = ? AND deleted_at IS NULL",
            params,
        )
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        raise AppError(
            "CONFLICT", details={"reason": "team_name_taken"},
        ) from exc
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="team.update", result="ok",
        actor_id=by, resource_type="team", resource_id=team_id, detail=details,
    )
    return get_team(conn, tenant_id=tenant_id, team_id=team_id)


def delete_team(
    conn: sqlite3.Connection, *, tenant_id: str, team_id: str,
    by: str = "system",
) -> None:
    _team_row(conn, tenant_id, team_id)
    conn.execute(
        "UPDATE teams SET deleted_at = ?, updated_at = ?,"
        " version = version + 1 WHERE tenant_id = ? AND team_id = ?",
        (_now(), _now(), tenant_id, team_id),
    )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="team.delete", result="ok",
        actor_id=by, resource_type="team", resource_id=team_id,
    )


def add_member(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    team_id: str,
    agent_id: str,
    role: str = "member",
    by: str = "system",
) -> dict[str, Any]:
    _team_row(conn, tenant_id, team_id)
    if role not in ROLES:
        raise AppError("VALIDATION_FAILED", details={"field": "role"})
    clean_id = str(agent_id).strip()
    agent = _agent_row(conn, tenant_id, clean_id)
    try:
        conn.execute(
            "INSERT INTO team_members (tenant_id, team_id, agent_id, role,"
            " created_at) VALUES (?, ?, ?, ?, ?)",
            (tenant_id, team_id, clean_id, role, _now()),
        )
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        raise AppError(
            "CONFLICT", details={"reason": "member_exists"},
        ) from exc
    conn.execute(
        "UPDATE teams SET updated_at = ?, version = version + 1"
        " WHERE tenant_id = ? AND team_id = ?",
        (_now(), tenant_id, team_id),
    )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="team.member_add", result="ok",
        actor_id=by, resource_type="team", resource_id=team_id,
        detail={"agentId": clean_id, "role": role,
                "name": str(agent["name"] or clean_id)},
    )
    return get_team(conn, tenant_id=tenant_id, team_id=team_id)


def remove_member(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    team_id: str,
    agent_id: str,
    by: str = "system",
) -> dict[str, Any]:
    _team_row(conn, tenant_id, team_id)
    clean_id = str(agent_id).strip()
    deleted = conn.execute(
        "DELETE FROM team_members WHERE tenant_id = ? AND team_id = ?"
        " AND agent_id = ?", (tenant_id, team_id, clean_id),
    ).rowcount
    if not deleted:
        conn.rollback()
        raise AppError(
            "NOT_FOUND", details={"agentId": clean_id, "reason": "member_missing"},
        )
    conn.execute(
        "UPDATE teams SET updated_at = ?, version = version + 1"
        " WHERE tenant_id = ? AND team_id = ?",
        (_now(), tenant_id, team_id),
    )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="team.member_remove", result="ok",
        actor_id=by, resource_type="team", resource_id=team_id,
        detail={"agentId": clean_id},
    )
    return get_team(conn, tenant_id=tenant_id, team_id=team_id)


# ---- delegations (team runs) ------------------------------------------------


def _delegation_payload(row: sqlite3.Row) -> dict[str, Any]:
    try:
        value = json.loads(str(row["payload_json"] or "{}"))
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _save_payload(
    conn: sqlite3.Connection, delegation_id: str, payload: dict[str, Any],
) -> None:
    conn.execute(
        "UPDATE delegations SET payload_json = ? WHERE delegation_id = ?",
        (json.dumps(payload, ensure_ascii=False), delegation_id),
    )


def _delegation_view(
    conn: sqlite3.Connection, row: sqlite3.Row,
) -> dict[str, Any]:
    payload = _delegation_payload(row)
    agent = conn.execute(
        "SELECT name FROM agents WHERE tenant_id = ? AND agent_id = ?",
        (row["tenant_id"], row["member_agent_id"]),
    ).fetchone()
    speaker = str(
        payload.get("speaker")
        or (agent["name"] if agent is not None else row["member_agent_id"])
    )
    return {
        "id": row["delegation_id"],
        "delegationId": row["delegation_id"],
        "teamId": row["team_id"],
        "parentRunId": row["parent_run_id"],
        "parentTicketId": row["parent_ticket_id"],
        "memberAgentId": row["member_agent_id"],
        "speaker": speaker,
        "childThreadId": row["child_thread_id"],
        "state": row["state"],
        "task": str(payload.get("task") or ""),
        "summary": payload.get("summary"),
        "reason": payload.get("reason"),
        "roomThreadId": payload.get("room_thread_id"),
        "attempts": int(row["attempts"] or 0),
        "maxAttempts": int(row["max_attempts"] or DELEGATION_MAX_ATTEMPTS),
        "leaseUntil": row["lease_until"],
        "lastHeartbeatAt": row["last_heartbeat_at"],
        "nextRetryAt": row["next_retry_at"],
        "createdAt": int(row["created_at"]),
        "endedAt": row["ended_at"],
    }


def _delegation_row(
    conn: sqlite3.Connection, tenant_id: str, delegation_id: str,
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM delegations WHERE tenant_id = ? AND delegation_id = ?",
        (tenant_id, delegation_id),
    ).fetchone()
    if row is None:
        raise AppError("NOT_FOUND", details={"delegationId": delegation_id})
    return cast(sqlite3.Row, row)


def _require_member(
    conn: sqlite3.Connection, tenant_id: str, team_id: str, agent_id: str,
) -> str:
    members = {item["agentId"]: item for item in _members(conn, tenant_id, team_id)}
    member = members.get(agent_id)
    if member is None:
        raise AppError(
            "VALIDATION_FAILED",
            details={"field": "memberAgentId", "reason": "not_in_team"},
        )
    return str(member["name"])


def create_delegation(
    conn: sqlite3.Connection, *,
    tenant_id: str,
    team_id: str,
    parent_run_id: str,
    member_agent_id: str,
    task: str,
    dedupe_key: str | None = None,
    parent_ticket_id: str | None = None,
    room_thread_id: str = "",
    by: str = "system",
) -> dict[str, Any]:
    """Persist one dispatch; `(tenant, dedupe_key)` makes retries idempotent."""
    _team_row(conn, tenant_id, team_id)
    clean_task = task.strip()
    if not clean_task:
        raise AppError("VALIDATION_FAILED", details={"field": "task"})
    speaker = _require_member(conn, tenant_id, team_id, member_agent_id)
    key = dedupe_key or hashlib.sha256(
        f"{parent_run_id}:{member_agent_id}:{clean_task}".encode()
    ).hexdigest()
    existing = conn.execute(
        "SELECT * FROM delegations WHERE tenant_id = ? AND dedupe_key = ?",
        (tenant_id, key),
    ).fetchone()
    if existing is not None:
        return _delegation_view(conn, existing)

    delegation_id = "dg_" + secrets.token_hex(8)
    now = _now()
    payload = {
        "task": clean_task,
        "speaker": speaker,
        "by": by,
        "room_thread_id": room_thread_id,
    }
    conn.execute(
        "INSERT INTO delegations (delegation_id, tenant_id, team_id,"
        " parent_ticket_id, parent_run_id, member_agent_id, dedupe_key, state,"
        " payload_json, attempts, max_attempts, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)",
        (delegation_id, tenant_id, team_id, parent_ticket_id, parent_run_id,
         member_agent_id, key, json.dumps(payload, ensure_ascii=False),
         DELEGATION_MAX_ATTEMPTS, now),
    )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="delegation.create", result="ok",
        actor_id=by, resource_type="delegation", resource_id=delegation_id,
        detail={"teamId": team_id, "memberAgentId": member_agent_id},
    )
    return _delegation_view(
        conn, _delegation_row(conn, tenant_id, delegation_id),
    )


def start_team_run(
    conn: sqlite3.Connection, store: Any, *,
    tenant_id: str,
    team_id: str,
    task: str,
    by: str,
    member_ids: list[str] | None = None,
    plan: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Create a room thread and one pending delegation per member.

    `plan` is the coordinator's explicit split (`memberAgentId` + `task`);
    without it every selected member receives the same task (deterministic
    fallback until the model-driven planner lands).
    """
    from polyopus.domains.conversations import service as conversations

    team = _team_row(conn, tenant_id, team_id)
    clean_task = task.strip()
    if not clean_task:
        raise AppError("VALIDATION_FAILED", details={"field": "task"})
    members = _members(conn, tenant_id, team_id)
    workers = [item for item in members if item["role"] == "member"]
    lead_id = next(
        (item["agentId"] for item in members if item["role"] == "lead"), None,
    )
    if plan:
        items: list[tuple[str, str]] = []
        for entry in plan:
            agent_id = str(entry.get("memberAgentId") or entry.get("agentId") or "")
            sub_task = str(entry.get("task") or clean_task).strip()
            if not agent_id:
                raise AppError(
                    "VALIDATION_FAILED", details={"field": "plan.memberAgentId"},
                )
            _require_member(conn, tenant_id, team_id, agent_id)
            items.append((agent_id, sub_task))
    else:
        selected = member_ids or [item["agentId"] for item in workers]
        if not selected:
            raise AppError(
                "VALIDATION_FAILED",
                details={"field": "memberIds", "reason": "team_has_no_members"},
            )
        for agent_id in selected:
            _require_member(conn, tenant_id, team_id, str(agent_id))
        items = [(str(agent_id), clean_task) for agent_id in selected]
    if not items:
        raise AppError("VALIDATION_FAILED", details={"field": "plan"})

    room_title = clean_task.replace("\n", " ")[:40]
    room = conversations.create_thread(
        conn, tenant_id=tenant_id, owner_id=by, title=f"团队 · {room_title}",
        agent_id=lead_id,
    )
    parent_run_id = "rn_" + secrets.token_hex(8)
    delegations = [
        create_delegation(
            conn, tenant_id=tenant_id, team_id=team_id,
            parent_run_id=parent_run_id, member_agent_id=agent_id,
            task=sub_task, by=by, room_thread_id=room.thread_id,
        )
        for agent_id, sub_task in items
    ]
    audit.record(
        conn, tenant_id=tenant_id, action="team.run", result="ok",
        actor_id=by, resource_type="team", resource_id=str(team["team_id"]),
        detail={
            "parentRunId": parent_run_id,
            "members": len(delegations),
            "roomThreadId": room.thread_id,
        },
    )
    return {
        "parentRunId": parent_run_id,
        "roomThreadId": room.thread_id,
        "task": clean_task,
        "delegations": delegations,
    }


def list_delegations(
    conn: sqlite3.Connection, *, tenant_id: str,
    team_id: str | None = None,
    state: str | None = None,
    parent_run_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM delegations WHERE tenant_id = ?"
    params: list[object] = [tenant_id]
    if team_id:
        sql += " AND team_id = ?"
        params.append(team_id)
    if state:
        sql += " AND state = ?"
        params.append(state)
    if parent_run_id:
        sql += " AND parent_run_id = ?"
        params.append(parent_run_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(max(1, min(limit, 200)))
    return [
        _delegation_view(conn, row)
        for row in conn.execute(sql, params).fetchall()
    ]


def retry_delegation(
    conn: sqlite3.Connection, *, tenant_id: str, delegation_id: str,
    by: str = "system",
) -> dict[str, Any]:
    row = _delegation_row(conn, tenant_id, delegation_id)
    if str(row["state"]) != "dead":
        raise AppError("CONFLICT", details={"reason": "delegation_not_dead"})
    if int(row["attempts"] or 0) >= int(row["max_attempts"] or 0):
        raise AppError("CONFLICT", details={"reason": "attempts_exhausted"})
    payload = _delegation_payload(row)
    for key in ("child_turn_id", "summary", "reason"):
        payload.pop(key, None)
    conn.execute(
        "UPDATE delegations SET state = 'pending', next_retry_at = NULL,"
        " lease_until = NULL, last_heartbeat_at = NULL, payload_json = ?"
        " WHERE delegation_id = ?",
        (json.dumps(payload, ensure_ascii=False), delegation_id),
    )
    conn.commit()
    audit.record(
        conn, tenant_id=tenant_id, action="delegation.retry", result="ok",
        actor_id=by, resource_type="delegation", resource_id=delegation_id,
        detail={"attempts": int(row["attempts"] or 0)},
    )
    return _delegation_view(conn, _delegation_row(conn, tenant_id, delegation_id))


def stop_team(
    conn: sqlite3.Connection, store: Any, *,
    tenant_id: str, team_id: str, scope: str, by: str = "system",
) -> dict[str, Any]:
    """Stop the coordinator (pending only) or the whole room (pending+running)."""
    if scope not in ("coordinator", "room"):
        raise AppError("VALIDATION_FAILED", details={"field": "scope"})
    _team_row(conn, tenant_id, team_id)
    states = ("pending",) if scope == "coordinator" else ("pending", "running")
    placeholders = ",".join("?" for _ in states)
    rows = conn.execute(
        "SELECT * FROM delegations WHERE tenant_id = ? AND team_id = ?"
        f" AND state IN ({placeholders}) ORDER BY id",
        (tenant_id, team_id, *states),
    ).fetchall()
    for row in rows:
        _stop_delegation(conn, store, row, scope=scope, by=by)
    audit.record(
        conn, tenant_id=tenant_id, action="team.stop", result="ok",
        actor_id=by, resource_type="team", resource_id=team_id,
        detail={"scope": scope, "stopped": len(rows)},
    )
    return {"scope": scope, "stopped": len(rows)}


def _stop_delegation(
    conn: sqlite3.Connection, store: Any, row: sqlite3.Row, *,
    scope: str, by: str,
) -> None:
    payload = _delegation_payload(row)
    if str(row["state"]) == "running":
        turn_id = str(payload.get("child_turn_id") or "")
        thread_id = str(row["child_thread_id"] or payload.get("child_thread_id") or "")
        if turn_id and thread_id:
            from polyopus.domains.conversations import service as conversations

            try:
                conversations.stop_turn(
                    conn, store, tenant_id=str(row["tenant_id"]),
                    owner_id=str(payload.get("by") or by),
                    thread_id=thread_id, turn_id=turn_id,
                )
            except Exception:  # noqa: BLE001 - stopping is best effort
                pass
    _finish_delegation(
        conn, store, row, state="ended", reason=f"stopped_{scope}", summary="",
    )


def claim_pending(
    conn: sqlite3.Connection, *, limit: int = 5,
) -> list[sqlite3.Row]:
    """CAS pending -> running with a lease; returns freshly claimed rows."""
    now = _now()
    rows = conn.execute(
        "SELECT * FROM delegations WHERE state = 'pending'"
        " AND (next_retry_at IS NULL OR next_retry_at <= ?)"
        " ORDER BY id LIMIT ?", (now, max(1, limit)),
    ).fetchall()
    claimed: list[sqlite3.Row] = []
    for row in rows:
        changed = conn.execute(
            "UPDATE delegations SET state = 'running', attempts = attempts + 1,"
            " lease_until = ?, last_heartbeat_at = ?"
            " WHERE delegation_id = ? AND state = 'pending'",
            (now + DELEGATION_LEASE_SECONDS, now, row["delegation_id"]),
        ).rowcount
        if changed:
            claimed.append(_delegation_row(
                conn, str(row["tenant_id"]), str(row["delegation_id"]),
            ))
    conn.commit()
    return claimed


def start_claimed(
    conn: sqlite3.Connection, store: Any, row: sqlite3.Row,
) -> None:
    """Create the member's child thread/turn (the turn worker executes it)."""
    from polyopus.domains.conversations import service as conversations

    tenant_id = str(row["tenant_id"])
    payload = _delegation_payload(row)
    task = str(payload.get("task") or "")
    speaker = str(payload.get("speaker") or row["member_agent_id"])
    by = str(payload.get("by") or "system")
    room = str(payload.get("room_thread_id") or "")
    try:
        child = str(row["child_thread_id"] or payload.get("child_thread_id") or "")
        if not child:
            thread = conversations.create_thread(
                conn, tenant_id=tenant_id, owner_id=by,
                title=f"成员 · {speaker}"[:60],
                agent_id=str(row["member_agent_id"]),
            )
            child = thread.thread_id
            payload["child_thread_id"] = child
            _save_payload(conn, str(row["delegation_id"]), payload)
            conn.execute(
                "UPDATE delegations SET child_thread_id = ? WHERE delegation_id = ?",
                (child, row["delegation_id"]),
            )
            conn.commit()
        turn_id = str(payload.get("child_turn_id") or "")
        if not turn_id:
            turn_id, _ = conversations.post_turn(
                conn, store, tenant_id=tenant_id, owner_id=by,
                thread_id=child, content=task, mode="act",
            )
            payload["child_turn_id"] = turn_id
            _save_payload(conn, str(row["delegation_id"]), payload)
            conn.commit()
    except Exception as exc:  # noqa: BLE001 - one bad dispatch must not wedge
        _finish_delegation(
            conn, store, row, state="dead", reason=f"start_failed: {exc}",
            summary="",
        )
        return
    if room:
        store.append(
            room,
            "delegation.started",
            {
                "delegation_id": str(row["delegation_id"]),
                "team_id": str(row["team_id"]),
                "parent_run_id": str(row["parent_run_id"]),
                "member_agent_id": str(row["member_agent_id"]),
                "child_thread_id": child,
                "dedupe_key": str(row["dedupe_key"]),
                "speaker": speaker,
            },
            tenant_id=tenant_id,
        )


def observe_running(
    conn: sqlite3.Connection, store: Any, *, limit: int = 20,
) -> int:
    """Finalize running delegations whose child turn reached a terminal state."""
    now = _now()
    rows = conn.execute(
        "SELECT * FROM delegations WHERE state = 'running'"
        " ORDER BY id LIMIT ?", (max(1, limit),),
    ).fetchall()
    finished = 0
    for row in rows:
        payload = _delegation_payload(row)
        turn_id = str(payload.get("child_turn_id") or "")
        if not turn_id:
            conn.execute(
                "UPDATE delegations SET lease_until = ?, last_heartbeat_at = ?"
                " WHERE delegation_id = ?",
                (now + DELEGATION_LEASE_SECONDS, now, row["delegation_id"]),
            )
            conn.commit()
            continue
        turn = conn.execute(
            "SELECT status FROM turns WHERE tenant_id = ? AND turn_id = ?",
            (row["tenant_id"], turn_id),
        ).fetchone()
        if turn is None:
            _finish_delegation(
                conn, store, row, state="dead", reason="missing_turn", summary="",
            )
            finished += 1
            continue
        status = str(turn["status"])
        if status == "completed":
            _finish_delegation(
                conn, store, row, state="ended", reason="",
                summary=_latest_answer(conn, str(row["child_thread_id"] or "")),
            )
            finished += 1
        elif status in ("failed", "cancelled"):
            _finish_delegation(
                conn, store, row, state="dead", reason=f"turn_{status}",
                summary=_latest_answer(conn, str(row["child_thread_id"] or "")),
            )
            finished += 1
        else:  # queued|running|waiting_approval|cancel_requested
            conn.execute(
                "UPDATE delegations SET lease_until = ?, last_heartbeat_at = ?"
                " WHERE delegation_id = ?",
                (now + DELEGATION_LEASE_SECONDS, now, row["delegation_id"]),
            )
            conn.commit()
    return finished


def _latest_answer(conn: sqlite3.Connection, thread_id: str) -> str:
    if not thread_id:
        return ""
    row = conn.execute(
        "SELECT content FROM messages WHERE thread_id = ? AND role = 'assistant'"
        " AND content <> '' ORDER BY seq DESC LIMIT 1", (thread_id,),
    ).fetchone()
    return str(row[0] or "").strip() if row is not None else ""


def _finish_delegation(
    conn: sqlite3.Connection, store: Any, row: sqlite3.Row, *,
    state: str, reason: str, summary: str,
) -> None:
    now = _now()
    payload = _delegation_payload(row)
    if summary:
        payload["summary"] = summary
    if reason:
        payload["reason"] = reason
    changed = conn.execute(
        "UPDATE delegations SET state = ?, ended_at = ?, payload_json = ?,"
        " lease_until = NULL, last_heartbeat_at = NULL"
        " WHERE delegation_id = ? AND state IN ('pending', 'running')",
        (state, now, json.dumps(payload, ensure_ascii=False),
         row["delegation_id"]),
    ).rowcount
    conn.commit()
    if not changed:
        return
    speaker = str(payload.get("speaker") or row["member_agent_id"])
    room = str(payload.get("room_thread_id") or "")
    if room:
        store.append(
            room,
            "delegation.ended",
            {
                "delegation_id": str(row["delegation_id"]),
                "state": state,
                "reason": reason or state,
                "speaker": speaker,
            },
            tenant_id=str(row["tenant_id"]),
        )
        _maybe_summarize(
            conn, str(row["tenant_id"]), str(row["parent_run_id"]), room,
        )


def _maybe_summarize(
    conn: sqlite3.Connection, tenant_id: str, parent_run_id: str, room: str,
) -> None:
    """Write the room's closing message once every delegation is terminal."""
    rows = conn.execute(
        "SELECT * FROM delegations WHERE tenant_id = ? AND parent_run_id = ?"
        " ORDER BY id", (tenant_id, parent_run_id),
    ).fetchall()
    if not rows:
        return
    if any(str(row["state"]) in ("pending", "running") for row in rows):
        return
    exists = conn.execute(
        "SELECT 1 FROM messages WHERE thread_id = ? AND role = 'assistant'"
        " AND turn_id IS NULL AND content LIKE '【总结】%' LIMIT 1", (room,),
    ).fetchone()
    if exists is not None:
        return
    first = _delegation_payload(rows[0])
    task = str(first.get("task") or "")[:80]
    lines = [f"【总结】{task}" if task else "【总结】"]
    for row in rows:
        payload = _delegation_payload(row)
        speaker = str(payload.get("speaker") or row["member_agent_id"])
        state = str(row["state"])
        summary = str(payload.get("summary") or "")
        if state == "ended":
            lines.append(f"- {speaker}：{summary or '已完成'}")
        else:
            reason = str(payload.get("reason") or "失败")
            lines.append(f"- {speaker}：未完成（{reason}）")
    content = "\n".join(lines)[:4000]
    now = _now()
    seq = int(conn.execute(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = ?",
        (room,),
    ).fetchone()[0])
    conn.execute(
        "INSERT INTO messages (tenant_id, message_id, thread_id, turn_id, role,"
        " content, status, seq, created_at, updated_at)"
        " VALUES (?, ?, ?, NULL, 'assistant', ?, 'completed', ?, ?, ?)",
        (tenant_id, "msg_" + secrets.token_hex(8), room, content, seq, now, now),
    )
    conn.execute(
        "UPDATE threads SET last_message_at = ?, updated_at = ? WHERE thread_id = ?",
        (now, now, room),
    )
    conn.commit()
