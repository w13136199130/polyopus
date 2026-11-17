"""V1-18 authorization matrix: every resource × role × read/write.

Unauthorized roles must get 403 before any resource lookup (no existence
leak); admin/member/auditor expectations come straight from rbac.py.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from polyopus.api.app import create_app
from polyopus.config import Settings
from polyopus.domains.identity import admin, rbac
from polyopus.platform.db import migrator as m
from polyopus.platform.db.seed import ensure_admin

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"
PASSWORD = "matrix-pw"

CASES: list[tuple[str, str, str | None, dict[str, object] | None]] = [
    ("GET", "/api/v1/threads", "chat:read", None),
    ("POST", "/api/v1/threads", "chat:write", {"title": "m"}),
    ("GET", "/api/v1/attentions", "attention:read", None),
    ("GET", "/api/v1/tickets", "ticket:read", None),
    ("GET", "/api/v1/sources", "source:read", None),
    ("DELETE", "/api/v1/sources/src_missing", "source:write", None),
    ("GET", "/api/v1/cron-jobs", "cron:read", None),
    ("GET", "/api/v1/usage/summary", "usage:read", None),
    ("GET", "/api/v1/admin/audit", "audit:read", None),
    ("GET", "/api/v1/admin/quotas", "usage:read", None),
    ("GET", "/api/v1/agents", "agent:read", None),
    ("POST", "/api/v1/agents", "agent:write", {"name": "matrix-agent"}),
    ("GET", "/api/v1/tools", "extension:read", None),
    ("PATCH", "/api/v1/tools/fs.read", "extension:write", {"enabledGlobal": True}),
    ("GET", "/api/v1/knowledge-bases", "knowledge:read", None),
    ("POST", "/api/v1/knowledge-bases", "knowledge:write", {"name": "matrix-kb"}),
    ("GET", "/api/v1/connectors/catalog", "connector:read", None),
    ("POST", "/api/v1/connectors/instances", "connector:write", {
        "kind": "webhook", "displayName": "matrix-connector", "config": {},
    }),
    ("GET", "/api/v1/plugins", "extension:read", None),
    ("DELETE", "/api/v1/plugins/example.none", "extension:write", None),
    ("GET", "/api/v1/admin/settings", "settings:read", None),
    ("GET", "/api/v1/admin/backup", "admin:write", None),
    ("GET", "/api/v1/admin/data-jobs/dj_missing", "admin:write", None),
    ("DELETE", "/api/v1/admin/tenants/tenant_missing", "admin:write", {
        "confirmName": "tenant_missing", "reason": "matrix",
    }),
    ("GET", "/api/v1/users", "user:read", None),
    ("GET", "/api/v1/roles", "role:read", None),
    ("GET", "/api/v1/invites", "invite:read", None),
]

ROLES = ("admin", "member", "auditor")


@pytest.fixture()
def clients(tmp_path: Path) -> Iterator[dict[str, TestClient]]:
    db = tmp_path / "matrix.db"
    conn = m.connect(db)
    m.apply(conn, m.discover(MIGRATIONS))
    ensure_admin(conn, password=PASSWORD)
    for role in ("member", "auditor"):
        admin.create_user(
            conn, tenant_id="default", username=role, display_name=role,
            password=PASSWORD, roles=[role],
        )
    conn.close()
    settings = Settings(
        db_path=db, secret_key="s", access_ttl_seconds=3600,
        session_ttl_seconds=86400, embedded_worker=False,
    )
    opened: list[TestClient] = []
    try:
        result: dict[str, TestClient] = {}
        for role in ROLES:
            client = TestClient(create_app(settings))
            client.__enter__()
            opened.append(client)
            login = client.post("/api/v1/auth/login", json={
                "username": "admin" if role == "admin" else role,
                "password": PASSWORD,
            })
            assert login.status_code == 200, login.text
            result[role] = client
        yield result
    finally:
        for client in opened:
            client.__exit__(None, None, None)


def _allowed(role: str, permission: str | None) -> bool:
    if role == "admin":
        return True
    if permission is None:
        return True
    permissions = (
        rbac.MEMBER_PERMISSIONS if role == "member" else rbac.AUDITOR_PERMISSIONS
    )
    return permission in permissions


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(
    "case", CASES,
    ids=[f"{method}-{path.split('/')[-1] or path}" for method, path, _, _ in CASES],
)
def test_permission_matrix(
    clients: dict[str, TestClient],
    role: str,
    case: tuple[str, str, str | None, dict[str, object] | None],
) -> None:
    method, path, permission, body = case
    if body is not None:
        payload = {
            key: (f"{value}-{uuid.uuid4().hex[:6]}" if key in ("name", "displayName") else value)
            for key, value in body.items()
        }
    else:
        payload = None
    response = clients[role].request(method, path, json=payload)
    if _allowed(role, permission):
        assert response.status_code not in (401, 403), (
            f"{role} should reach {method} {path}: {response.text}"
        )
    else:
        assert response.status_code == 403, (
            f"{role} must be forbidden from {method} {path}: {response.text}"
        )
