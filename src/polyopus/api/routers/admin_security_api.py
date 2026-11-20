"""Admin security posture + policy bundle editing."""

from __future__ import annotations

from sqlite3 import Connection
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from polyopus.api.deps import get_db, require_permission
from polyopus.domains.identity.service import User
from polyopus.domains.policy import service as policy
from polyopus.domains.tools import service as tools
from polyopus.kernel.tools import POLICY_SPECS
from polyopus.kernel.tools.policy import Rule
from polyopus.platform.errors import AppError

router = APIRouter(prefix="/admin/security", tags=["admin"])

MAX_RULES = 200


class PolicyBody(BaseModel):
    rules: list[dict[str, Any]] = Field(min_length=1, max_length=MAX_RULES)


class RollbackBody(BaseModel):
    version: int = Field(ge=1)


def _rules_payload(rules: list[Rule]) -> list[dict[str, Any]]:
    return [policy.rule_to_dict(rule) for rule in rules]


def _history(conn: Connection, tenant_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT version, status, created_by, created_at, activated_at "
        "FROM policy_bundles WHERE tenant_id = ? ORDER BY version DESC LIMIT 20",
        (tenant_id,),
    ).fetchall()
    return [
        {
            "version": int(row["version"]),
            "status": str(row["status"]),
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "activatedAt": row["activated_at"],
        }
        for row in rows
    ]


def _snapshot(conn: Connection, request: Request, user: User) -> dict[str, Any]:
    rules, version, source = policy.resolve_rules(conn, user.tenant_id)
    settings = request.app.state.settings
    tool_rows = tools.list_tools(conn, limit=200)
    return {
        "policy": {
            "version": version,
            "source": source,
            "rules": _rules_payload(rules),
            "history": _history(conn, user.tenant_id),
        },
        "tools": [
            {
                "toolKey": row["toolKey"],
                "risk": row["risk"],
                "sideEffects": row["sideEffects"],
                "scopes": row["scopes"],
                "enabledGlobal": row["enabledGlobal"],
                "requiredScope": POLICY_SPECS.get(str(row["toolKey"]), None)
                and POLICY_SPECS[str(row["toolKey"])].required_scope,
            }
            for row in tool_rows
        ],
        "posture": {
            "workspaceDir": str(settings.workspace_dir),
            "workspaceJail": True,
            "fileWriteApproval": "ask",
            "auditRetentionDays": settings.audit_retention_days,
            "pluginSignature": "required",
            "mfa": "optional",
            "commandGuard": "no shell tool",
            "sensitiveInfoScan": "v1.1",
            "skillScan": "v1.1",
        },
    }


@router.get("")
def security_snapshot(
    request: Request,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return _snapshot(conn, request, user)


@router.put("/policy")
def publish_policy(
    body: PolicyBody,
    request: Request,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    rules: list[Rule] = []
    for index, raw in enumerate(body.rules):
        try:
            rule = policy.rule_from_dict(raw)
        except (KeyError, TypeError, ValueError) as exc:
            raise AppError(
                "VALIDATION_FAILED",
                details={"field": f"rules[{index}]", "reason": str(exc)},
            ) from exc
        if rule.effect not in ("allow", "ask", "deny"):
            raise AppError(
                "VALIDATION_FAILED",
                details={"field": f"rules[{index}].effect", "reason": "allow|ask|deny"},
            )
        if not isinstance(rule.when, dict):
            raise AppError(
                "VALIDATION_FAILED",
                details={"field": f"rules[{index}].when", "reason": "object"},
            )
        rules.append(rule)
    result = policy.publish(conn, rules, by=user.user_id, tenant_id=user.tenant_id)
    from polyopus.domains.audit import service as audit

    audit.record(
        conn, tenant_id=user.tenant_id, action="security.policy.publish",
        result="ok", actor_id=user.user_id, resource_type="policy",
        resource_id=str(result["bundleId"]),
        detail={"version": result["version"], "rules": result["rules"]},
    )
    return {**_snapshot(conn, request, user), "published": result}


@router.post("/policy/rollback")
def rollback_policy(
    body: RollbackBody,
    request: Request,
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    result = policy.rollback(
        conn, body.version, by=user.user_id, tenant_id=user.tenant_id
    )
    from polyopus.domains.audit import service as audit

    audit.record(
        conn, tenant_id=user.tenant_id, action="security.policy.rollback",
        result="ok", actor_id=user.user_id, resource_type="policy",
        resource_id=str(result["bundleId"]),
        detail={"version": body.version},
    )
    return {**_snapshot(conn, request, user), "rolledBack": result}


@router.get("/policy/raw")
def raw_policy(
    user: User = Depends(require_permission("admin:write")),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    rules, version, source = policy.resolve_rules(conn, user.tenant_id)
    return {"version": version, "source": source, "rules": _rules_payload(rules)}
