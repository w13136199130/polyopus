"""Security gate report (V1-18): test count, risky patterns, matrix coverage.

Usage:
    uv run python tools/security_report.py [--json]

Exit 0 only when high-risk findings are zero and the security suite has at
least 70 tests. The report is intentionally conservative: anything that looks
like shell/eval/secret material is high risk until a human documents it.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "polyopus"
SECURITY = ROOT / "tests" / "security"
MIN_TESTS = 70

SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9]{16,}"),
    re.compile(r"(?i)password\s*=\s*['\"][^'\"]{4,}['\"]"),
    re.compile(r"(?i)secret\s*=\s*['\"][^'\"]{8,}['\"]"),
)


def _test_count() -> int:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", str(SECURITY)],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    for line in reversed(result.stdout.splitlines()):
        match = re.search(r"(\d+)\s+tests? collected", line)
        if match:
            return int(match.group(1))
    return 0


def _scan_source() -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for path in sorted(SRC.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT).as_posix()
        for pattern, label in (
            (re.compile(r"\bshell\s*=\s*True\b"), "shell_true"),
            (re.compile(r"\beval\s*\("), "eval"),
            (re.compile(r"\bexec\s*\("), "exec"),
        ):
            if pattern.search(text):
                findings.append({"risk": "high", "kind": label, "file": rel})
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                findings.append({"risk": "high", "kind": "hardcoded_secret",
                                 "file": rel})
        try:
            tree = ast.parse(text)
        except SyntaxError:
            findings.append({"risk": "high", "kind": "syntax", "file": rel})
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr in ("system", "popen"):
                    findings.append({
                        "risk": "high", "kind": f"subprocess_{node.func.attr}",
                        "file": rel, "line": node.lineno,
                    })
    return findings


def build_report() -> dict[str, Any]:
    tests = _test_count()
    findings = _scan_source()
    high = [item for item in findings if item["risk"] == "high"]
    return {
        "version": 1,
        "securityTests": tests,
        "minTests": MIN_TESTS,
        "highRisk": len(high),
        "findings": findings,
        "categories": {
            "authentication": "tests/security/test_auth_hardening.py",
            "authorization": "tests/security/test_permission_matrix.py",
            "tenant_isolation": "tests/security/test_tenant_isolation.py",
            "injection": "tests/eval/test_injection_eval.py",
            "plugin_signature": "tests/integration/test_plugins.py",
            "secret_leak": "audit redaction + connector secretbox",
            "ssrf": "sources/webhook/outbound allowlist tests",
            "dos": "rate limits / queue backpressure (v1.0 best effort)",
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="security gate report")
    parser.add_argument("--json", action="store_true", help="raw JSON")
    args = parser.parse_args(argv)
    report = build_report()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"security tests: {report['securityTests']} (min {MIN_TESTS})")
        print(f"high risk: {report['highRisk']}")
        for finding in report["findings"]:
            print(f"  {finding['risk']} {finding['kind']} {finding['file']}")
    ok = report["highRisk"] == 0 and report["securityTests"] >= MIN_TESTS
    print("SECURITY GATE: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
