"""Local CI: the Windows equivalent of `make check` (no make required).

Usage:
    uv run python scripts/check.py
    uv run python scripts/check.py --skip coverage
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable


def _imports_cmd() -> list[str] | None:
    exe = shutil.which("lint-imports")
    if exe:
        return [exe]
    return None


def _pnpm_cmd() -> list[str] | None:
    exe = shutil.which("pnpm")
    return [exe] if exe else None


def build_steps() -> list[tuple[str, list[str] | None, str | None]]:
    """(name, command, skip_reason)."""
    imports = _imports_cmd()
    pnpm = _pnpm_cmd()
    return [
        ("lint", [PY, "-m", "ruff", "check", "src", "tests"], None),
        ("type", [PY, "-m", "mypy", "src"], None),
        ("imports", imports, None if imports else "lint-imports not installed"),
        ("test", [PY, "-m", "pytest"], None),
        ("schema", [PY, "tools/extract_ddl.py", "--check"], None),
        ("errors", [PY, "tools/extract_errors.py", "--check"], None),
        ("implemented", [PY, "tools/export_implemented.py", "--check"], None),
        ("contracts", [PY, "-m", "contracts.check"], None),
        ("coverage", [PY, "contracts/coverage_check.py"], None),
        # frontend: build to src/polyopus/web, then require the committed
        # dist to be in sync (same drift model as contracts/generated)
        ("web-build", [*pnpm, "--dir", "web", "build"] if pnpm else None,
         "pnpm not installed"),
        ("web-dist",
         ["git", "diff", "--exit-code", "--", "src/polyopus/web"] if pnpm else None,
         "pnpm not installed"),
        ("web-test", [*pnpm, "--dir", "web", "test"] if pnpm else None,
         "pnpm not installed"),
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="run the local CI gate")
    parser.add_argument("--skip", action="append", default=[], help="step name to skip")
    args = parser.parse_args(argv)

    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT / "src")
    failed: list[str] = []

    for name, cmd, skip_reason in build_steps():
        if name in args.skip:
            print(f"[skip] {name}")
            continue
        if cmd is None:
            print(f"[skip] {name}: {skip_reason}")
            continue
        print(f"[run ] {name}: {' '.join(cmd)}")
        result = subprocess.run(cmd, cwd=ROOT, env=env, check=False)
        if result.returncode != 0:
            failed.append(name)

    if failed:
        print(f"\nFAILED: {', '.join(failed)}")
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
