"""Policy bundles: versioned rule snapshots, one active per tenant (V05-12).

publish() snapshots rules into `policy_bundles.rules_json` and mirrors them
into `policy_rules` (the flat eval view; rollback switches by bundle). A
mandate pins the version it was granted under and the engine evaluates its
tool calls against THAT snapshot, so publishing a stricter version never
yanks an in-flight mandate (docs/09 §5.2: 变更只影响未来，不追溯已授权).

resolve_rules() is the load chain for turns without a pinned version:
active bundle -> last-known-good (newest previously-activated bundle whose
snapshot parses) -> in-memory default_rules(). The engine itself stays
fail-closed; the final fallback equals today's hardcoded behaviour.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from collections.abc import Iterable, Sequence
from typing import Any

from polyopus.kernel.tools import POLICY_SPECS, ToolPolicySpec
from polyopus.kernel.tools.policy import Decision, PolicyEngine, Rule, default_rules

TENANT = "default"


# ---- Rule <-> JSON -------------------------------------------------------------


def rule_to_dict(rule: Rule) -> dict[str, Any]:
    return {"rid": rule.rid, "priority": rule.priority,
            "when": rule.when, "effect": rule.effect}


def rule_from_dict(data: dict[str, Any]) -> Rule:
    return Rule(str(data["rid"]), int(data["priority"]),
                dict(data.get("when") or {}), str(data["effect"]))


def _parse_rules(text: str | None) -> list[Rule] | None:
    if not text:
        return None
    try:
        rows = json.loads(text)
        rules = [rule_from_dict(row) for row in rows if isinstance(row, dict)]
        return rules if rules else None
    except Exception:  # noqa: BLE001 - corrupt snapshot: caller falls to LKG
        return None


# ---- bundle lifecycle ----------------------------------------------------------


def active_row(conn: sqlite3.Connection) -> sqlite3.Row | None:
    row = conn.execute(
        "SELECT * FROM policy_bundles WHERE tenant_id = ? AND status = 'active' "
        "ORDER BY version DESC LIMIT 1",
        (TENANT,),
    ).fetchone()
    return row  # type: ignore[no-any-return]


def active_version(conn: sqlite3.Connection) -> int | None:
    row = active_row(conn)
    return int(row["version"]) if row is not None else None


def rules_for(conn: sqlite3.Connection, version: int) -> list[Rule] | None:
    """The snapshot a mandate pinned; None when missing or corrupt."""
    row = conn.execute(
        "SELECT rules_json FROM policy_bundles WHERE tenant_id = ? AND version = ?",
        (TENANT, version),
    ).fetchone()
    return _parse_rules(row[0]) if row is not None else None


def resolve_rules(conn: sqlite3.Connection) -> tuple[list[Rule], int | None, str]:
    """(rules, version, source) with source in {active, lkg, default}."""
    row = active_row(conn)
    if row is not None:
        rules = _parse_rules(row["rules_json"])
        if rules is not None:
            return rules, int(row["version"]), "active"
    # last-known-good: newest bundle that was ever activated and still parses
    for candidate in conn.execute(
        "SELECT version, rules_json FROM policy_bundles WHERE tenant_id = ? "
        "AND activated_at IS NOT NULL ORDER BY version DESC",
        (TENANT,),
    ).fetchall():
        rules = _parse_rules(candidate["rules_json"])
        if rules is not None:
            return rules, int(candidate["version"]), "lkg"
    return list(default_rules()), None, "default"


def publish(
    conn: sqlite3.Connection, rules: Sequence[Rule], by: str
) -> dict[str, Any]:
    """Snapshot `rules` as the next version and make it the single active
    bundle. In-flight mandates keep their pinned snapshots (only future
    tickets see the new version)."""
    now = int(time.time())
    version = int(conn.execute(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM policy_bundles WHERE tenant_id = ?",
        (TENANT,),
    ).fetchone()[0])
    bundle_id = "pb_" + secrets.token_hex(8)
    conn.execute(
        "UPDATE policy_bundles SET status = 'rolled_back' "
        "WHERE tenant_id = ? AND status = 'active'",
        (TENANT,),
    )
    conn.execute(
        """
        INSERT INTO policy_bundles
          (bundle_id, tenant_id, version, status, rules_json, created_by,
           created_at, activated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
        """,
        (bundle_id, TENANT, version,
         json.dumps([rule_to_dict(r) for r in rules], ensure_ascii=False),
         by, now, now),
    )
    _sync_rule_rows(conn, bundle_id, version, rules)
    conn.commit()
    return {"version": version, "bundleId": bundle_id, "rules": len(rules)}


def rollback(conn: sqlite3.Connection, to_version: int, by: str) -> dict[str, Any]:
    """Re-activate a previously published bundle (LKG rollback). The current
    active bundle is retired; policy_rules is rebuilt from the target."""
    target = conn.execute(
        "SELECT * FROM policy_bundles WHERE tenant_id = ? AND version = ?",
        (TENANT, to_version),
    ).fetchone()
    if target is None:
        from polyopus.platform.errors import AppError

        raise AppError("NOT_FOUND", details={"version": to_version})
    rules = _parse_rules(target["rules_json"])
    if rules is None:
        from polyopus.platform.errors import AppError

        raise AppError("CONFLICT", details={"version": to_version,
                                            "reason": "bundle snapshot corrupt"})
    now = int(time.time())
    conn.execute(
        "UPDATE policy_bundles SET status = 'rolled_back' "
        "WHERE tenant_id = ? AND status = 'active'",
        (TENANT,),
    )
    conn.execute(
        "UPDATE policy_bundles SET status = 'active', activated_at = ? "
        "WHERE bundle_id = ?",
        (now, target["bundle_id"]),
    )
    _sync_rule_rows(conn, str(target["bundle_id"]), to_version, rules)
    conn.commit()
    return {"version": to_version, "bundleId": str(target["bundle_id"]),
            "by": by}


def _sync_rule_rows(
    conn: sqlite3.Connection, bundle_id: str, version: int, rules: Iterable[Rule]
) -> None:
    """policy_rules is the flat eval view of the active bundle (docs/31:
    回滚只切 active bundle，不改历史 bundle)."""
    conn.execute("DELETE FROM policy_rules WHERE tenant_id = ?", (TENANT,))
    now = int(time.time())
    for rule in rules:
        conn.execute(
            """
            INSERT INTO policy_rules
              (rule_id, tenant_id, bundle_id, priority, when_json, effect,
               obligations_json, version, enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, ?)
            """,
            (rule.rid, TENANT, bundle_id, rule.priority,
             json.dumps(rule.when, ensure_ascii=False), rule.effect,
             version, now),
        )


def active_version_or_bootstrap(conn: sqlite3.Connection) -> int:
    """open_ticket's entry point: the first ticket publishes the built-in
    defaults as v1 so every mandate pins a real, snapshot-backed version."""
    version = active_version(conn)
    if version is not None:
        return version
    return int(publish(conn, default_rules(), by="system:bootstrap")["version"])


# ---- dry-run ---------------------------------------------------------------------


def dry_run(
    conn: sqlite3.Connection, samples: Sequence[dict[str, Any]], *,
    rules: Sequence[Rule] | None = None, version: int | None = None,
) -> dict[str, Any]:
    """Evaluate samples without touching any live gate (docs/02 §5.2: 发布前
    必须看会拦多少). Rule source: explicit > pinned version > resolved."""
    if rules is None:
        if version is not None:
            rules = rules_for(conn, version)
        if rules is None:
            rules, resolved_version, _source = resolve_rules(conn)
            version = resolved_version
    engine = PolicyEngine(list(rules))
    results: list[dict[str, Any]] = []
    counts = {"allow": 0, "ask": 0, "deny": 0}
    for sample in samples:
        tool_key = str(sample.get("tool", ""))
        spec: ToolPolicySpec | None = POLICY_SPECS.get(tool_key)
        if spec is None:
            spec = ToolPolicySpec(tool_key, "critical", True)
        decision: Decision = engine.evaluate(spec, dict(sample.get("args") or {}))
        counts[decision.effect] = counts.get(decision.effect, 0) + 1
        results.append({"tool": tool_key, "effect": decision.effect,
                        "reason": decision.reason})
    return {"version": version, "counts": counts, "results": results}
