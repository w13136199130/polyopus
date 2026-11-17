"""Knowledge base/document API (V1-13, docs/29 §knowledge)."""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.knowledge import service

router = APIRouter(tags=["knowledge"])


class KbCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


class KbPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None


class DocCreateBody(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1)


class SearchBody(BaseModel):
    query: str = Field(min_length=1)
    topK: int = Field(default=8, ge=1, le=50)


@router.get("/knowledge-bases")
def list_kbs(
    user: User = Depends(require_permission("knowledge:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": service.list_kbs(conn, tenant_id=user.tenant_id)}


@router.post("/knowledge-bases", status_code=201)
def create_kb(
    body: KbCreateBody,
    user: User = Depends(require_permission("knowledge:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    kb_id = service.create_kb(
        conn, body.name, tenant_id=user.tenant_id,
        description=body.description,
    )
    return service.get_kb(conn, kb_id, tenant_id=user.tenant_id)


@router.patch("/knowledge-bases/{kb_id}")
def update_kb(
    kb_id: str,
    body: KbPatchBody,
    user: User = Depends(require_permission("knowledge:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.update_kb(
        conn, kb_id, tenant_id=user.tenant_id, name=body.name,
        description=body.description,
    )


@router.delete("/knowledge-bases/{kb_id}")
def delete_kb(
    kb_id: str,
    user: User = Depends(require_permission("knowledge:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_kb(conn, kb_id, tenant_id=user.tenant_id)
    return {"ok": True, "kbId": kb_id}


@router.get("/knowledge-bases/{kb_id}/docs")
def list_docs(
    kb_id: str,
    q: str | None = Query(default=None),
    folder: str | None = Query(default=None),
    user: User = Depends(require_permission("knowledge:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {
        "items": service.list_docs(
            conn, kb_id, tenant_id=user.tenant_id, q=q, folder=folder
        )
    }


@router.post("/knowledge-bases/{kb_id}/docs", status_code=201)
def upload_doc(
    kb_id: str,
    body: DocCreateBody,
    user: User = Depends(require_permission("knowledge:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    doc_id = service.ingest_markdown(
        conn, kb_id, body.filename, body.content, tenant_id=user.tenant_id
    )
    return service.get_doc(conn, doc_id, tenant_id=user.tenant_id)


@router.post("/knowledge-bases/{kb_id}/reindex-all")
def reindex_all(
    kb_id: str,
    user: User = Depends(require_permission("knowledge:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.reindex_all(
        conn, kb_id, tenant_id=user.tenant_id
    )


@router.post("/knowledge-bases/{kb_id}/search")
def search(
    kb_id: str,
    body: SearchBody,
    user: User = Depends(require_permission("knowledge:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.search(
        conn, kb_id, body.query, tenant_id=user.tenant_id, top_k=body.topK
    )


@router.get("/knowledge-docs/{doc_id}")
def get_doc(
    doc_id: str,
    user: User = Depends(require_permission("knowledge:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.get_doc(conn, doc_id, tenant_id=user.tenant_id)


@router.get("/knowledge-docs/{doc_id}/preview")
def preview_doc(
    doc_id: str,
    user: User = Depends(require_permission("knowledge:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.preview_doc(conn, doc_id, tenant_id=user.tenant_id)


@router.post("/knowledge-docs/{doc_id}/reindex")
def reindex_doc(
    doc_id: str,
    user: User = Depends(require_permission("knowledge:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return service.reindex_doc(conn, doc_id, tenant_id=user.tenant_id)


@router.delete("/knowledge-docs/{doc_id}")
def delete_doc(
    doc_id: str,
    user: User = Depends(require_permission("knowledge:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    service.delete_doc(conn, doc_id, tenant_id=user.tenant_id)
    return {"ok": True, "docId": doc_id}
