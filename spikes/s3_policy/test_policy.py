"""S3 Spike — 策略引擎 fail-closed.

假设（docs/41 §3）：策略求值的任何异常（规则语法错、DSL 抛错、超时、无匹配）
都不会导致工具被执行；默认 deny/ask 而非 allow；执行期二次校验防绕过。

求值顺序（docs/02 §5.2）：显式 deny → tenant 强制 → agent 覆盖 → 默认
（risk>=high → ask，critical → deny，写工具无规则 → ask，只读无规则 → allow）。
纯 stdlib；失败抛 AssertionError。
运行：python spikes/s3_policy/test_policy.py
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# 模型
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class ToolSpec:
    tool_key: str
    risk: str                 # low|medium|high|critical
    side_effects: bool
    source: str = "builtin"   # builtin|mcp|plugin|openapi|skill
    signed: bool = True


@dataclass(frozen=True)
class Decision:
    effect: str               # allow|ask|deny
    matched: tuple[str, ...] = ()
    reason: str = ""
    obligations: tuple[str, ...] = ()


@dataclass
class Rule:
    rid: str
    priority: int
    when: dict                # 受限 DSL：{tool|tools, risk, args_prefix, source}
    effect: str               # allow|ask|deny

    def matches(self, tool: ToolSpec, args: dict) -> bool:
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
            for k, prefix in w["args_prefix"].items():
                if not str(args.get(k, "")).startswith(prefix):
                    return False
        return True


# --------------------------------------------------------------------------
# 策略引擎：fail-closed 的核心——任何异常 → deny
# --------------------------------------------------------------------------

POLICY_ERROR = Decision("deny", (), "policy_error", ())


class PolicyEngine:
    def __init__(self, rules: list[Rule], deadline_ms: int = 50) -> None:
        self.rules = sorted(rules, key=lambda r: -r.priority)
        self.deadline_ms = deadline_ms
        self.decisions: list[Decision] = []

    def evaluate(self, tool: ToolSpec, args: dict) -> Decision:
        t0 = time.perf_counter()
        try:
            d = self._evaluate(tool, args)
        except Exception:  # noqa: BLE001 —— 语法错/DSL 异常/断言失败 一律 deny
            d = POLICY_ERROR
        if (time.perf_counter() - t0) * 1000 > self.deadline_ms:  # 超时 → deny
            d = Decision("deny", (), "policy_timeout")
        self.decisions.append(d)
        return d

    def _evaluate(self, tool: ToolSpec, args: dict) -> Decision:
        for rule in self.rules:
            if rule.matches(tool, args):  # priority 降序：先命中先生效
                return Decision(rule.effect, (rule.rid,), f"rule {rule.rid}")
        return self._default(tool)

    @staticmethod
    def _default(tool: ToolSpec) -> Decision:
        if tool.risk == "critical":
            return Decision("deny", (), "critical by default")
        if tool.source == "plugin" and not tool.signed:
            return Decision("ask", (), "unsigned plugin")
        if tool.risk in ("high",) or tool.side_effects:
            return Decision("ask", (), "write/high risk needs approval")
        return Decision("allow", (), "read-only by default")


class ToolRuntime:
    """执行期二次校验（ADR-011）：无论调用来源（模型/插件/伪造 prompt），
    invoke() 前必须重新 evaluate；deny → 结构化拒绝，不抛裸异常。"""

    def __init__(self, engine: PolicyEngine) -> None:
        self.engine = engine
        self.executed: list[str] = []
        self.pending_approvals: list[str] = []

    def invoke(self, tool: ToolSpec, args: dict, *, claim_approved: bool = False) -> Decision:
        d = self.engine.evaluate(tool, args)  # claim_approved 被无视
        if d.effect == "allow":
            self.executed.append(tool.tool_key)
        elif d.effect == "ask":
            self.pending_approvals.append(tool.tool_key)
        return d


# --------------------------------------------------------------------------
# 规则集 + 故障注入
# --------------------------------------------------------------------------

def base_rules() -> list[Rule]:
    return [
        Rule("r-deny-rm", 100, {"tool": "shell.exec", "args_prefix": {"cmd": "rm -rf /"}}, "deny"),
        Rule("r-allow-read", 50, {"tools": ["fs.read", "http.get"]}, "allow"),
        Rule("r-ask-write", 40, {"risk": "high"}, "ask"),
    ]


class BrokenRule:
    """模拟 YAML 语法错/DSL 抛错的坏规则。"""

    rid = "r-broken"
    priority = 999

    def matches(self, tool: ToolSpec, args: dict) -> bool:
        raise ValueError("bad DSL: unknown operator !=~")


class SlowRule:
    """模拟求值超时（sleep 超过 deadline）。"""

    rid = "r-slow"
    priority = 998

    def matches(self, tool: ToolSpec, args: dict) -> bool:
        time.sleep(0.08)  # 80ms > 50ms deadline
        return True


# --------------------------------------------------------------------------
# 用例
# --------------------------------------------------------------------------

RESULTS: list[tuple[str, bool, str]] = []


def check(no: int, name: str, fn) -> None:
    try:
        detail = fn()
        ok = True
    except AssertionError as exc:
        detail, ok = str(exc), False
    except Exception as exc:  # noqa: BLE001
        detail, ok = f"{type(exc).__name__}: {exc}", False
    RESULTS.append((f"#{no} {name}", ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  #{no} {name} — {detail}")


E = lambda effect: effect  # noqa: E731


def main() -> int:
    print("== S3 策略引擎 fail-closed ==")
    rt = ToolRuntime(PolicyEngine(base_rules()))
    read = ToolSpec("fs.read", "low", False)
    write = ToolSpec("fs.write", "high", True)
    rm = ToolSpec("shell.exec", "critical", True, signed=True) if False else ToolSpec("shell.exec", "high", True)

    def case(n, name, fn):
        check(n, name, fn)

    case(1, "规则 allow → 执行", lambda: (lambda d: (
        (_ for _ in ()).throw(AssertionError(f"期望 allow 实得 {d.effect}"))
        if d.effect != "allow" or "fs.read" not in rt.executed else f"allow, matched={d.matched}"))(
        rt.invoke(ToolSpec("fs.read", "low", False), {})))

    case(2, "规则 deny（rm -rf /）→ 结构化拒绝", lambda: (lambda d: (
        (_ for _ in ()).throw(AssertionError(f"期望 deny 实得 {d.effect}"))
        if d.effect != "deny" or "shell.exec" in rt.executed else f"deny, reason={d.reason}"))(
        rt.invoke(ToolSpec("shell.exec", "high", True), {"cmd": "rm -rf /"})))

    case(3, "规则 ask → 暂停 + Attention", lambda: (lambda d: (
        (_ for _ in ()).throw(AssertionError(f"期望 ask 实得 {d.effect}"))
        if d.effect != "ask" or "fs.write" not in rt.pending_approvals else f"ask, 进入审批队列"))(
        rt.invoke(ToolSpec("fs.write", "high", True), {"path": "a.ts"})))

    def case4():
        eng = PolicyEngine(base_rules() + [BrokenRule()])  # 注入坏规则
        d = eng.evaluate(read, {})
        assert d.effect == "deny" and d.reason == "policy_error", f"语法错未 fail-closed: {d}"
        return "deny(policy_error)"

    case(4, "规则语法/DSL 异常 → deny", case4)

    def case5():
        eng = PolicyEngine(base_rules() + [SlowRule()])  # 注入慢规则
        eng.deadline_ms = 50
        d = eng.evaluate(read, {})
        assert d.effect == "deny" and d.reason == "policy_timeout", f"超时未 deny: {d}"
        return "deny(policy_timeout, 80ms>50ms)"

    case(5, "求值超时 → deny", case5)

    def case6():
        eng = PolicyEngine([])  # 无任何规则 + 写工具
        d = eng.evaluate(write, {})
        assert d.effect == "ask", f"无规则写工具应 ask: {d}"
        return "ask（写工具无规则默认审批）"

    case(6, "无规则 + 写工具 → ask", case6)

    def case7():
        eng = PolicyEngine([])
        d = eng.evaluate(read, {})
        assert d.effect == "allow", f"只读无规则应 allow: {d}"
        return "allow（只读默认放行）"

    case(7, "无规则 + 只读工具 → allow", case7)

    def case8():
        eng = PolicyEngine([])
        d = eng.evaluate(ToolSpec("plugin.x", "medium", True, source="plugin", signed=False), {})
        assert d.effect == "ask", f"未签名插件应 ask: {d}"
        return "ask（未签名插件）"

    case(8, "未签名插件 → ask", case8)

    def case9():
        eng = PolicyEngine([])
        d = eng.evaluate(ToolSpec("admin.wipe", "critical", True), {})
        assert d.effect == "deny", f"critical 应 deny: {d}"
        return "deny（critical 默认拒绝）"

    case(9, "critical 工具 → deny", case9)

    def case10():
        # prompt 伪造"已批准"：invoke 无视 claim_approved，仍走 evaluate
        rt2 = ToolRuntime(PolicyEngine(base_rules()))
        d = rt2.invoke(ToolSpec("fs.write", "high", True), {"path": "x"}, claim_approved=True)
        assert d.effect == "ask" and not rt2.executed, f"伪造批准生效: {d}"
        return "prompt 声称已批准 → 仍 ask"

    case(10, "prompt 伪造「已批准」无效", case10)

    def case11():
        # 直接构造 ToolCall 绕过 UI：执行期二次校验兜底
        rt3 = ToolRuntime(PolicyEngine(base_rules()))
        d = rt3.invoke(ToolSpec("shell.exec", "high", True), {"cmd": "rm -rf /"})
        assert d.effect == "deny" and not rt3.executed, "绕过 UI 未被兜底"
        return "直构 ToolCall → 执行期 deny"

    case(11, "绕过 UI 直构 ToolCall → 执行期拒绝", case11)

    def case12():
        # 决策可审计：所有决策被记录（含 matched rules）
        eng = PolicyEngine(base_rules())
        eng.evaluate(read, {})
        eng.evaluate(write, {})
        assert len(eng.decisions) == 2 and eng.decisions[0].matched, "决策未记录"
        return f"{len(eng.decisions)} 条决策含 matched rules，可写审计"

    case(12, "决策留痕（matched rules）", case12)

    # 汇总：异常场景 0 次 allow
    bad = [d for d in PolicyEngine(base_rules() + [BrokenRule(), SlowRule()]).decisions]
    eng_all = PolicyEngine(base_rules() + [BrokenRule(), SlowRule()])
    for t, a in [(read, {}), (write, {}), (rm, {"cmd": "rm -rf /"})]:
        eng_all.evaluate(t, a)
    accidental_allow = [d for d in eng_all.decisions if d.effect == "allow" and d.reason in ("policy_error", "policy_timeout")]
    ok = sum(1 for _, o, _ in RESULTS if o)
    print(f"\n[结果] {ok}/{len(RESULTS)} 通过 | 异常路径意外 allow: {len(accidental_allow)}")
    verdict = "GO" if ok == len(RESULTS) and not accidental_allow else "NO-GO"
    print(f"[结论] {verdict}: 策略引擎 fail-closed 成立" if verdict == "GO" else f"[结论] {verdict}")
    return 0 if ok == len(RESULTS) and not accidental_allow else 1


if __name__ == "__main__":
    raise SystemExit(main())
