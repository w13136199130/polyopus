"""Read-only workspace browser for the chat Dock (prototype 文件/工作区).

Everything is confined to `settings.workspace_dir`: `_resolve` rejects any
path that escapes the root (including symlinks), and the tree walk has hard
caps so a huge workspace cannot stall a request. This is a viewer, not a
file manager — writes go through the policy-gated `fs.write` tool.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, Query, Request

from polyopus.api.deps import require_permission
from polyopus.domains.identity.service import User
from polyopus.platform.errors import AppError

router = APIRouter(prefix="/workspace", tags=["workspace"])

MAX_ENTRIES = 500
MAX_DEPTH = 3
MAX_SYSTEM_DEPTH = 6
MAX_PREVIEW_BYTES = 200_000
SYSTEM_DIR = ".polyopus"


def _root(request: Request) -> Path:
    return Path(request.app.state.settings.workspace_dir).resolve()


def _resolve(request: Request, rel: str) -> Path:
    root = _root(request)
    target = (root / rel).resolve() if rel else root
    if target != root and not target.is_relative_to(root):
        raise AppError("FORBIDDEN", details={"reason": "outside_workspace"})
    return target


def _entry(root: Path, path: Path) -> dict[str, object]:
    stat = path.stat()
    return {
        "name": path.name,
        "path": path.relative_to(root).as_posix(),
        "type": "dir" if path.is_dir() else "file",
        "size": 0 if path.is_dir() else int(stat.st_size),
        "modified": int(stat.st_mtime),
    }


def _walk(
    root: Path, current: Path, depth: int, budget: list[int],
    *, max_depth: int = MAX_DEPTH,
) -> list[dict[str, object]]:
    if depth > max_depth or budget[0] <= 0:
        return []
    try:
        children = sorted(
            current.iterdir(), key=lambda p: (p.is_file(), p.name.lower())
        )
    except OSError:
        return []
    out: list[dict[str, object]] = []
    for child in children:
        if budget[0] <= 0:
            break
        if child.name.startswith("."):
            continue
        try:
            # Never follow a link outside the root or into a loop.
            if child.is_symlink():
                resolved = child.resolve()
                if not resolved.is_relative_to(root):
                    continue
            item = _entry(root, child)
        except OSError:
            continue
        budget[0] -= 1
        if item["type"] == "dir":
            item["children"] = _walk(
                root, child, depth + 1, budget, max_depth=max_depth,
            )
        out.append(item)
    return out


def _system_tree(
    root: Path, *, tenant_id: str, budget: list[int],
) -> list[dict[str, object]]:
    """Expose only the current tenant's expert workspace under `.polyopus`."""
    base = root / SYSTEM_DIR
    tenant_root = base / "tenants" / tenant_id
    agents_dir = tenant_root / "agents"
    if not agents_dir.is_dir():
        return []
    agents = _entry(root, agents_dir)
    agents["children"] = _walk(
        root, agents_dir, 1, budget, max_depth=MAX_SYSTEM_DEPTH,
    )
    tenant = _entry(root, tenant_root)
    tenant["children"] = [agents]
    tenants = _entry(root, base / "tenants")
    tenants["children"] = [tenant]
    system = _entry(root, base)
    system["children"] = [tenants]
    return [system]


def _check_system_preview(rel: str, *, tenant_id: str, root: Path) -> None:
    normalized = rel.replace("\\", "/")
    parts = PurePosixPath(normalized).parts
    if not parts or parts[0] != SYSTEM_DIR:
        return
    if ".." in parts or len(parts) < 4 or parts[1] != "tenants" or parts[2] != tenant_id:
        raise AppError("FORBIDDEN", details={"reason": "outside_tenant_workspace"})
    allowed = (root / SYSTEM_DIR / "tenants" / tenant_id).resolve()
    target = (root / normalized).resolve()
    if target != allowed and allowed not in target.parents:
        raise AppError("FORBIDDEN", details={"reason": "outside_tenant_workspace"})


@router.get("/tree")
def workspace_tree(
    request: Request,
    path: str = Query(default="", max_length=500),
    _user: User = Depends(require_permission("chat:read")),
) -> dict[str, object]:
    root = _root(request)
    root.mkdir(parents=True, exist_ok=True)
    if path.replace("\\", "/").startswith(SYSTEM_DIR):
        raise AppError("FORBIDDEN", details={"reason": "system_tree_not_browsable"})
    start = _resolve(request, path)
    if not start.is_dir():
        raise AppError("NOT_FOUND", details={"reason": "not_a_directory"})
    budget = [MAX_ENTRIES]
    items = _walk(root, start, 1, budget)
    if start == root:
        items.extend(_system_tree(root, tenant_id=_user.tenant_id, budget=budget))
    return {
        "root": str(root),
        "path": start.relative_to(root).as_posix() if start != root else "",
        "items": items,
        "truncated": budget[0] <= 0,
    }


@router.get("/file")
def workspace_file(
    request: Request,
    path: str = Query(min_length=1, max_length=500),
    _user: User = Depends(require_permission("chat:read")),
) -> dict[str, object]:
    root = _root(request)
    _check_system_preview(path, tenant_id=_user.tenant_id, root=root)
    target = _resolve(request, path)
    if not target.is_file():
        raise AppError("NOT_FOUND", details={"reason": "not_a_file"})
    if target.stat().st_size > MAX_PREVIEW_BYTES:
        raise AppError(
            "PAYLOAD_TOO_LARGE",
            details={"limit": MAX_PREVIEW_BYTES, "path": path},
        )
    raw = target.read_bytes()
    if b"\x00" in raw:
        raise AppError("UNSUPPORTED", details={"reason": "binary", "path": path})
    return {
        "path": target.relative_to(root).as_posix(),
        "content": raw.decode("utf-8", errors="replace"),
        "size": len(raw),
    }
