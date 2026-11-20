"""Model catalog for the composer's model picker (prototype `模型` chip).

The engine resolves models settings-first (env provider wins over the DB),
so this endpoint mirrors that order instead of listing rows the runtime
would ignore. It never leaks provider credentials.
"""

from __future__ import annotations

from sqlite3 import Connection

from fastapi import APIRouter, Depends, Request

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User

router = APIRouter(tags=["models"])


@router.get("/models")
def list_models(
    request: Request,
    _user: User = Depends(require_permission("chat:read")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    settings = request.app.state.settings
    env_model = (settings.model_name or "").strip()
    if settings.model_base_url:
        # Registry.resolve() always uses the env provider when it exists;
        # showing DB models here would offer choices that silently fall back.
        return {
            "source": "env",
            "defaultModel": env_model or "default",
            "items": [{
                "modelId": env_model or "default",
                "name": env_model or "环境默认模型",
                "provider": "env",
                "configured": bool(settings.model_api_key),
            }],
        }

    rows = conn.execute(
        """
        SELECT m.model_id, m.name, p.name AS provider, p.status
        FROM models m JOIN providers p ON p.provider_id = m.provider_id
        WHERE m.enabled = 1 AND p.status != 'error'
        ORDER BY p.name, m.name
        """
    ).fetchall()
    items = [
        {
            "modelId": str(row["model_id"]),
            "name": str(row["name"]),
            "provider": str(row["provider"]),
            # `status != error` is what Registry accepts; unconfigured
            # providers still resolve, so mark them rather than hiding them.
            "configured": str(row["status"]) != "error",
        }
        for row in rows
    ]
    return {
        "source": "registry" if items else "fake",
        "defaultModel": items[0]["name"] if items else "fake",
        "items": items,
    }
