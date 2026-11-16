"""Outbound reply surface (v0.5 card V05-08): outbox status + test callback."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from polyopus.api.deps import current_user, get_db
from polyopus.domains.identity.service import User
from polyopus.domains.outbound import service

router = APIRouter(tags=["outbound"])


class TestReplyBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    callback_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("callback_url", "callbackUrl"),
    )


@router.get("/outbox")
def list_outbox(
    status: Literal["pending", "sent", "failed"] | None = None,
    topic: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"items": service.list_outbox(
        conn, status=status, topic=topic, limit=limit, tenant_id=user.tenant_id,
    )}


@router.post("/sources/{source_id}/test-reply")
def test_reply(
    source_id: str,
    body: TestReplyBody | None = None,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    """Synchronous single-shot probe of the callback: same HMAC headers as
    a real reply, `kind:"test"` payload, never enqueued."""
    return service.test_reply(
        conn, source_id, override_url=body.callback_url if body else None,
        tenant_id=user.tenant_id,
    )
