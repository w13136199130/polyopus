"""Memory endpoints (MEM-004..008): personalization list, correction, export."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.memory import api as service
from polyopus.platform.errors import AppError

router = APIRouter(prefix="/memories", tags=["memory"])

MemoryKind = Literal["fact", "preference", "episode", "profile", "skill"]
MemoryStatus = Literal["active", "retired", "pending_review"]


class MemoryCreateBody(BaseModel):
    kind: MemoryKind
    text: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(default=1.0, ge=0, le=1)
    evidence: dict[str, object] | None = None


class MemoryPatchBody(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    status: MemoryStatus | None = None
    reason: str | None = None


class MemoryPauseBody(BaseModel):
    paused: bool
    until: str | None = None


@router.get("")
def list_memories(
    kind: MemoryKind | None = Query(default=None),
    status: MemoryStatus | None = Query(default=None),
    source: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user: User = Depends(require_permission("memory:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    items, next_cursor = service.list_atoms(
        conn, user.tenant_id, kind=kind, status=status, source=source,
        cursor=cursor, limit=limit,
    )
    return {"items": items, "nextCursor": next_cursor}


@router.post("", status_code=201)
def create_memory(
    body: MemoryCreateBody,
    user: User = Depends(require_permission("memory:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.create_atom(
        conn, user.tenant_id, kind=body.kind, text=body.text,
        confidence=body.confidence, evidence=body.evidence, by=user.user_id,
    )


@router.get("/search")
def search_memories(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(require_permission("memory:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"query": q, "items": service.search_atoms(
        conn, user.tenant_id, q, limit=limit,
    )}


@router.get("/export")
def export_memories(
    format: Literal["jsonl", "json"] = Query(default="json"),
    user: User = Depends(require_permission("memory:export")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"format": format, "items": service.export_atoms(conn, user.tenant_id)}


@router.get("/pause")
def get_pause(
    user: User = Depends(require_permission("memory:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.pause_state(conn, user.user_id)


@router.post("/pause")
def pause_memory(
    body: MemoryPauseBody,
    user: User = Depends(require_permission("memory:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.set_pause(
        conn, user.user_id, paused=body.paused, until=body.until,
    )


@router.get("/{memory_id}")
def get_memory(
    memory_id: str,
    user: User = Depends(require_permission("memory:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    atom = service.get_atom(conn, user.tenant_id, memory_id)
    if atom is None:
        raise AppError("MEMORY_NOT_FOUND", details={"memoryId": memory_id})
    return atom


@router.patch("/{memory_id}")
def update_memory(
    memory_id: str,
    body: MemoryPatchBody,
    user: User = Depends(require_permission("memory:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    atom = service.update_atom(
        conn, user.tenant_id, memory_id,
        text=body.text, status=body.status, reason=body.reason, by=user.user_id,
    )
    if atom is None:
        raise AppError("MEMORY_NOT_FOUND", details={"memoryId": memory_id})
    return atom


@router.delete("/{memory_id}")
def delete_memory(
    memory_id: str,
    user: User = Depends(require_permission("memory:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if not service.delete_atom(conn, user.tenant_id, memory_id, by=user.user_id):
        raise AppError("MEMORY_NOT_FOUND", details={"memoryId": memory_id})
    return {"ok": True, "memoryId": memory_id}
