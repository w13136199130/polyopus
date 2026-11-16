"""Tenant context (V1-01).

Session-scoped code passes a `TenantContext` (or its id) into domain services;
background workers derive the tenant from the row they are processing instead
of reading a process-global default. Kept deliberately tiny so it can be used
by API dependencies and workers without importing a domain.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_TENANT = "default"


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str

    @classmethod
    def of(cls, tenant_id: str | None) -> TenantContext:
        return cls(tenant_id or DEFAULT_TENANT)


def tenant_of(tenant_id: str | None) -> str:
    return tenant_id or DEFAULT_TENANT


__all__ = ["DEFAULT_TENANT", "TenantContext", "tenant_of"]
