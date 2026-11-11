"""Policy engine: allow/ask/deny with obligations, fail-closed (production port).

Ported from the S3 spike (docs/41 §3, promoted to tests) that verified the
semantics; this is the copy the engine actually runs. Kernel constraint:
stdlib only. Evaluation order per docs/02 §5.2: explicit rules by priority
desc, then defaults (critical -> deny, high/side-effects -> ask, else
allow). Any exception or deadline overrun denies — never allows.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

type Effect = str  # "allow" | "ask" | "deny"


@dataclass(frozen=True)
class ToolPolicySpec:
    tool_key: str
    risk: str  # low|medium|high|critical
    side_effects: bool
    source: str = "builtin"  # builtin|mcp|plugin|openapi|skill
    signed: bool = True


@dataclass(frozen=True)
class Decision:
    effect: Effect
    matched: tuple[str, ...] = ()
    reason: str = ""
    obligations: tuple[str, ...] = ()


POLICY_ERROR = Decision("deny", (), "policy_error", ())
POLICY_TIMEOUT = Decision("deny", (), "policy_timeout", ())


@dataclass
class Rule:
    rid: str
    priority: int
    when: dict[str, Any]  # {tool|tools, risk, args_prefix, source}
    effect: Effect

    def matches(self, tool: ToolPolicySpec, args: dict[str, Any]) -> bool:
        w = self.when
        if "tool" in w and w["tool"] != tool.tool_key:
            return False
        if "tools" in w and tool.tool_key not in w["tools"]:
            return False
        if "risk" in w and w["risk"] != tool.risk:
            return False
        if "source" in w and w["source"] != tool.source:
            return False
        if "args_prefix" in w:
            for key, prefix in w["args_prefix"].items():
                if not str(args.get(key, "")).startswith(prefix):
                    return False
        return True


class PolicyEngine:
    def __init__(self, rules: list[Rule], deadline_ms: int = 50) -> None:
        self.rules = sorted(rules, key=lambda r: -r.priority)
        self.deadline_ms = deadline_ms
        self.decisions: list[Decision] = []

    def evaluate(self, tool: ToolPolicySpec, args: dict[str, Any]) -> Decision:
        started = time.perf_counter()
        try:
            decision = self._evaluate(tool, args)
        except Exception:  # noqa: BLE001 — bad rule/DSL/timeout input: deny
            decision = POLICY_ERROR
        if (time.perf_counter() - started) * 1000 > self.deadline_ms:
            decision = POLICY_TIMEOUT
        self.decisions.append(decision)
        return decision

    def _evaluate(self, tool: ToolPolicySpec, args: dict[str, Any]) -> Decision:
        for rule in self.rules:
            if rule.matches(tool, args):
                return Decision(rule.effect, (rule.rid,), f"rule {rule.rid}")
        return self._default(tool)

    @staticmethod
    def _default(tool: ToolPolicySpec) -> Decision:
        if tool.risk == "critical":
            return Decision("deny", (), "critical by default")
        if tool.source == "plugin" and not tool.signed:
            return Decision("ask", (), "unsigned plugin")
        if tool.risk == "high" or tool.side_effects:
            return Decision("ask", (), "write/high risk needs approval")
        return Decision("allow", (), "read-only by default")


def default_rules() -> list[Rule]:
    return [
        Rule("r-deny-rm", 100, {"tool": "shell.exec",
                                "args_prefix": {"cmd": "rm -rf /"}}, "deny"),
        Rule("r-allow-read", 50, {"tools": ["fs.read", "http.get"]}, "allow"),
        Rule("r-ask-write", 40, {"risk": "high"}, "ask"),
    ]


@dataclass
class ToolRuntime:
    """Execution-time gate (ADR-011): invoke() re-evaluates regardless of
    where the call came from; approved claims still pass through policy."""

    engine: PolicyEngine
    executed: list[str] = field(default_factory=list)
    denied: list[str] = field(default_factory=list)
    asked: list[str] = field(default_factory=list)

    def check(self, tool: ToolPolicySpec, args: dict[str, Any]) -> Decision:
        decision = self.engine.evaluate(tool, args)
        if decision.effect == "allow":
            self.executed.append(tool.tool_key)
        elif decision.effect == "ask":
            self.asked.append(tool.tool_key)
        else:
            self.denied.append(tool.tool_key)
        return decision
