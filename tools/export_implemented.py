"""Export the endpoints the backend actually implements (docs/49 §7.2).

The contract (188 ops) is a type promise, not an implementation promise.
This tool introspects create_app().routes and writes the implemented set to
schemas/api/implemented.json; the frontend endpoint layer is only allowed to
wrap what is in that file, and CI fails when the file drifts from the app.

Usage:
    python tools/export_implemented.py            # write implemented.json
    python tools/export_implemented.py --check    # exit 1 on drift
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "generated/py"))

OUT = ROOT / "schemas" / "api" / "implemented.json"


def implemented_ops() -> list[dict[str, str]]:
    """(method, path) for every API route the app registers right now.

    Newer FastAPI wraps include_router() in lazy _IncludedRouter nodes that
    keep the original router (unprefixed paths) plus the include context
    (prefix) — walk both shapes.
    """
    from fastapi.routing import APIRoute

    from polyopus.api.app import create_app

    app = create_app()
    ops: set[tuple[str, str]] = set()

    def add(method: str, path: str) -> None:
        if not (path.startswith("/api/") or path == "/healthz"):
            return  # static/SPA fallback are not API ops
        if method in ("HEAD", "OPTIONS"):
            return
        ops.add((method, path))

    def walk(routes: list, prefix: str) -> None:
        for route in routes:
            original = getattr(route, "original_router", None)
            if original is not None:  # _IncludedRouter
                ctx = getattr(route, "include_context", None)
                sub_prefix = getattr(ctx, "prefix", "") or ""
                walk(original.routes, f"{prefix}{sub_prefix}")
                continue
            nested = getattr(route, "routes", None)  # plain APIRouter/mounts
            if isinstance(nested, list):
                walk(nested, prefix)
                continue
            if isinstance(route, APIRoute):
                for method in route.methods:
                    add(method, f"{prefix}{route.path}")

    walk(app.routes, "")
    return [{"method": m, "path": p} for m, p in sorted(ops)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="export implemented API ops")
    parser.add_argument("--check", action="store_true",
                        help="fail if implemented.json is out of sync")
    args = parser.parse_args(argv)

    ops = implemented_ops()
    payload = {"count": len(ops), "ops": ops}

    if args.check:
        current = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
        if current != payload:
            print("implemented.json out of sync; run: python tools/export_implemented.py")
            return 1
        print(f"implemented.json in sync ({len(ops)} ops)")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    print(f"wrote {len(ops)} ops -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
