"""Spike promotion: S2 tenant isolation + S3 policy fail-closed (W11 batch 4).

docs/41 designed these as throwaway spikes; both went GO, so they now run
as regression tests through the standard gate. Loaded from their spike
modules (kept verbatim) instead of being rewritten and drifting.
"""

# covers: T-TEN-02 T-CAP-04

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _run_spike(module_dir: str, module_file: str) -> None:
    spec = importlib.util.spec_from_file_location(
        module_file, ROOT / "spikes" / module_dir / module_file
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_file] = module
    spec.loader.exec_module(module)  # defines; main() not yet run
    code = module.main()
    assert code == 0, f"{module_dir} spike reported failures"


def test_tenant_isolation_spike() -> None:
    """covers: T-TEN-02 — 跨租户读写全部被拒，404 不泄露存在性。"""
    _run_spike("s2_tenant_isolation", "test_isolation.py")


def test_policy_fail_closed_spike() -> None:
    """covers: T-CAP-04 — 求值异常 fail-closed，异常路径 0 次 allow。"""
    _run_spike("s3_policy", "test_policy.py")
