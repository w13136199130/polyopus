"""Deterministic eval harness (V1-17).

Four fixed suites: tool policy selection, RAG recall, memory screening and
injection/path-jail. Scores are 0..1; `--gate` compares them to a checked-in
baseline and blocks when any suite drops more than 3%.
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from polyopus.domains import knowledge as kb
from polyopus.domains import memory as mem
from polyopus.kernel.tools import POLICY_SPECS, PolicyEngine, ToolError, default_rules
from polyopus.kernel.tools.fs_read import fs_read
from polyopus.platform.db import migrator as m

DEFAULT_BASELINE = Path(__file__).resolve().parents[3] / "tests" / "eval" / "baseline.json"
MAX_REGRESSION = 0.03


def _tool_selection() -> float:
    engine = PolicyEngine(default_rules())
    cases: list[tuple[str, dict[str, Any], str]] = [
        ("fs.read", {"path": "a.txt"}, "allow"),
        ("fs.write", {"path": "a.txt", "content": "x"}, "ask"),
        ("demo.sleep", {"seconds": 1}, "allow"),
        ("shell.exec", {"cmd": "rm -rf /"}, "deny"),
    ]
    hits = 0
    for tool, args, expected in cases:
        spec = POLICY_SPECS.get(tool)
        if spec is None:
            from polyopus.kernel.tools.policy import ToolPolicySpec

            spec = ToolPolicySpec(tool, "critical", True)
        if engine.evaluate(spec, args).effect == expected:
            hits += 1
    return hits / len(cases)


def _rag_recall() -> float:
    docs = {
        "备份.md": "# 运维\n## 备份\n每天凌晨全量备份，保留最近七份，恢复前校验 sha256。\n",
        "升级.md": "# 运维\n## 升级\n升级前执行 poly migrate --check，失败用备份恢复。\n",
        "权限.md": "# 安全\n## 权限\n资源默认 private，授权走 resource_group_grants。\n",
        "审批.md": "# 安全\n## 审批\n审批默认三十分钟过期，过期自动拒绝。\n",
        "心跳.md": "# 集群\n## 心跳\n实例每十五秒上报心跳，超过六十秒判离线。\n",
    }
    queries = [
        ("备份保留几份", "七份"),
        ("升级前跑什么命令", "migrate"),
        ("资源默认可见性", "private"),
        ("审批多久过期", "三十分钟"),
        ("多久没心跳算离线", "六十秒"),
    ]
    with tempfile.TemporaryDirectory(prefix="poly-eval-") as tmp:
        conn = m.connect(Path(tmp) / "eval.db")
        try:
            m.apply(conn, m.discover(Path(__file__).resolve().parents[3] / "migrations"))
            kb_id = kb.create_kb(conn, "eval")
            for name, body in docs.items():
                kb.ingest_markdown(conn, kb_id, name, body)
            hits = 0
            for query, expected in queries:
                result = kb.search(conn, kb_id, query, top_k=3)
                if any(expected in hit["content"] for hit in result["hits"]):
                    hits += 1
            return hits / len(queries)
        finally:
            conn.close()


def _memory_screening() -> float:
    cases = [
        ("我的 key 是 sk-abcdefghijklmnop", True),
        ("邮箱是 ops@example.com", True),
        ("密码: hunter2", True),
        ("我喜欢用中文回答", False),
        ("今天天气怎么样", False),
        ("部署在华东机房", False),
    ]
    hits = 0
    for text, expected in cases:
        found = mem.screen_sensitive(text) is not None
        if expected == found:
            hits += 1
    return hits / len(cases)


def _injection_paths() -> float:
    with tempfile.TemporaryDirectory(prefix="poly-eval-path-") as tmp:
        root = Path(tmp)
        (root / "ok.txt").write_text("safe", encoding="utf-8")
        cases = [
            ("ok.txt", True),
            ("../../etc/passwd", False),
            ("/etc/passwd", False),
            ("a/../../b", False),
            ("..\\windows\\win.ini", False),
        ]
        hits = 0
        for path, should_read in cases:
            try:
                fs_read(root, path)
                opened = True
            except ToolError:
                opened = False
            if opened == should_read:
                hits += 1
        return hits / len(cases)


SUITES: dict[str, Callable[[], float]] = {
    "tool_selection": _tool_selection,
    "rag": _rag_recall,
    "memory": _memory_screening,
    "injection": _injection_paths,
}


def run_suites() -> dict[str, float]:
    return {name: round(func(), 4) for name, func in SUITES.items()}


def load_baseline(path: Path | None = None) -> dict[str, Any]:
    target = path or DEFAULT_BASELINE
    return cast(dict[str, Any], json.loads(target.read_text(encoding="utf-8")))


def gate(
    scores: dict[str, float] | None = None,
    baseline: dict[str, Any] | None = None,
) -> tuple[bool, list[str]]:
    """Return (passed, regressions); baseline floors are per suite."""
    measured = scores or run_suites()
    base = baseline or load_baseline()
    failures: list[str] = []
    for name, floor in base["suites"].items():
        actual = measured.get(name)
        if actual is None:
            failures.append(f"{name}: missing")
            continue
        if actual < float(floor) - MAX_REGRESSION:
            failures.append(
                f"{name}: {actual:.4f} < {float(floor):.4f} - {MAX_REGRESSION:.2f}"
            )
    return not failures, failures


def run_gate(baseline_path: Path | None = None) -> int:
    scores = run_suites()
    baseline = load_baseline(baseline_path)
    passed, failures = gate(scores, baseline)
    print(json.dumps({"scores": scores, "baseline": baseline, "passed": passed},
                     ensure_ascii=False, indent=2))
    if failures:
        print("REGRESSION: " + "; ".join(failures))
        return 1
    return 0
