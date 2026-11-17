"""Read-only instance settings for the settings page (V1-16)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from polyopus import __version__
from polyopus.api.deps import require_permission
from polyopus.domains.identity.service import User

router = APIRouter(prefix="/admin/settings", tags=["admin"])


@router.get("")
def get_settings(
    request: Request,
    _user: User = Depends(require_permission("settings:read")),
) -> dict[str, object]:
    settings = request.app.state.settings
    return {
        "environment": settings.env,
        "version": __version__,
        "modelName": settings.model_name or None,
        "modelConfigured": bool(settings.model_base_url and settings.model_api_key),
        "dataDir": str(settings.data_dir),
        "workspaceDir": str(settings.workspace_dir),
        "publicBaseUrl": settings.public_base_url,
        "auditRetentionDays": settings.audit_retention_days,
        "dailyCostBudgetMicros": settings.daily_cost_budget_micros,
        "readOnly": True,
    }
