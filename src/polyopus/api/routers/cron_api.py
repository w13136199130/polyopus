"""Cron jobs API (V05-20): list/create/toggle/delete + run history.

A cron job IS a kind='schedule' source plus one job row (V05-14); this router
keeps the v0.5 UI on the two supported kinds only (cron/interval/once).
"""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from polyopus.api.deps import get_db, get_store, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.intake import schedule as schedule_svc
from polyopus.platform.errors import AppError
from polyopus.platform.events.store import EventStore

router = APIRouter(tags=["cron"])


class CreateCronBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=100)
    schedule: str = Field(min_length=1, max_length=100)
    timezone: str = Field(default="UTC", max_length=64)
    text: str = Field(default="/polyopus 定时任务", max_length=500)


class PatchCronBody(BaseModel):
    enabled: bool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)
    schedule: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    text: str | None = Field(default=None, max_length=500)


@router.get("/cron-jobs")
def list_cron_jobs(
    user: User = Depends(require_permission("cron:read")), conn: Connection = Depends(get_db)
) -> dict[str, object]:
    return {"items": schedule_svc.list_jobs(conn, user.tenant_id)}


@router.post("/cron-jobs", status_code=201)
def create_cron_job(
    body: CreateCronBody,
    user: User = Depends(require_permission("cron:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    # Validate before creating the source so a bad schedule leaves no orphan.
    schedule_svc.parse_schedule(body.schedule)
    schedule_svc.timezone_of(body.timezone)
    source_id = schedule_svc.create_schedule_source(
        conn, name=body.name, timezone=body.timezone, tenant_id=user.tenant_id
    )
    try:
        job_id = schedule_svc.upsert_job(
            conn, source_id=source_id, name=body.name,
            schedule=body.schedule, timezone=body.timezone, text=body.text,
            tenant_id=user.tenant_id,
        )
    except Exception:
        conn.execute(
            "DELETE FROM sources WHERE tenant_id = ? AND source_id = ?",
            (user.tenant_id, source_id),
        )
        conn.commit()
        raise
    view = schedule_svc.job(conn, job_id, user.tenant_id)
    assert view is not None
    return view


@router.get("/cron-jobs/{job_id}")
def get_cron_job(
    job_id: str,
    user: User = Depends(require_permission("cron:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    view = schedule_svc.job(conn, job_id, user.tenant_id)
    if view is None:
        raise AppError("NOT_FOUND", details={"cronJobId": job_id})
    return view


@router.patch("/cron-jobs/{job_id}")
def patch_cron_job(
    job_id: str,
    body: PatchCronBody,
    user: User = Depends(require_permission("cron:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    view = schedule_svc.job(conn, job_id, user.tenant_id)
    if view is None:
        raise AppError("NOT_FOUND", details={"cronJobId": job_id})
    if (
        body.name is None and body.schedule is None and body.timezone is None
        and body.text is None
    ):
        if body.enabled is None:
            return view
        return schedule_svc.set_enabled(
            conn, job_id, body.enabled, tenant_id=user.tenant_id
        )
    updated = schedule_svc.update_job(
        conn, job_id, name=body.name, schedule=body.schedule,
        timezone=body.timezone, text=body.text, tenant_id=user.tenant_id,
    )
    if body.enabled is not None:
        updated = schedule_svc.set_enabled(
            conn, job_id, body.enabled, tenant_id=user.tenant_id
        )
    return updated


@router.post("/cron-jobs/{job_id}/run")
def run_cron_job(
    job_id: str,
    user: User = Depends(require_permission("cron:write")),
    conn: Connection = Depends(get_db),
    store: EventStore = Depends(get_store),
) -> dict[str, object]:
    return schedule_svc.run_now(
        conn, store, job_id, tenant_id=user.tenant_id
    )


@router.delete("/cron-jobs/{job_id}")
def delete_cron_job(
    job_id: str,
    user: User = Depends(require_permission("cron:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    schedule_svc.delete_job(conn, job_id, user.tenant_id)
    return {"cronJobId": job_id, "deleted": True}


@router.get("/cron-jobs/{job_id}/runs")
def cron_job_runs(
    job_id: str,
    user: User = Depends(require_permission("cron:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if schedule_svc.job(conn, job_id, user.tenant_id) is None:
        raise AppError("NOT_FOUND", details={"cronJobId": job_id})
    return {"items": schedule_svc.runs(conn, job_id, user.tenant_id)}
