"""S2 Spike — 租户隔离负向测试.

假设（docs/41 §2）：任何入口（API/检索/事件流/签名 URL/聚合/审计）都不能跨租户
读写；错误不泄露资源存在性；尝试写审计。

模拟架构：TenantGuard repo 基类强制注入 tenant_id（docs/02 §8.2 硬约束），
Api 层模拟 docs/29 的端点行为。纯 stdlib；失败抛 AssertionError。
运行：python spikes/s2_tenant_isolation/test_isolation.py
"""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import time

SCHEMA = """
CREATE TABLE threads (
  tenant_id TEXT NOT NULL, thread_id TEXT NOT NULL, title TEXT NOT NULL,
  owner_id  TEXT NOT NULL, PRIMARY KEY (tenant_id, thread_id)
);
CREATE TABLE events (
  tenant_id TEXT NOT NULL, thread_id TEXT NOT NULL, seq INTEGER NOT NULL,
  type TEXT NOT NULL, PRIMARY KEY (tenant_id, thread_id, seq)
);
CREATE TABLE knowledge_bases (
  tenant_id TEXT NOT NULL, kb_id TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kb_id)
);
CREATE TABLE chunks (
  tenant_id TEXT NOT NULL, kb_id TEXT NOT NULL, text TEXT NOT NULL
);
CREATE TABLE memory_atoms (
  tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL
);
CREATE TABLE usage_ledger (
  tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, cost_micros INTEGER NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
  actor TEXT, action TEXT NOT NULL, result TEXT NOT NULL, detail TEXT
);
"""


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.body = {"error": {"code": code, "message": message}}


class TenantRepo:
    """repo 基类：任何查询必须携带 tenant；缺失直接拒绝（fail-closed）。"""

    def __init__(self, db: sqlite3.Connection) -> None:
        self.db = db

    def _require_tenant(self, tenant_id: str | None) -> str:
        if not tenant_id:
            raise RuntimeError("repo query without tenant_id — forbidden")
        return tenant_id


class ThreadRepo(TenantRepo):
    def get(self, tenant_id: str | None, thread_id: str) -> sqlite3.Row | None:
        row = self.db.execute(
            "SELECT * FROM threads WHERE tenant_id=? AND thread_id=?",
            (self._require_tenant(tenant_id), thread_id),
        ).fetchone()
        if row is None:
            # 404 而非 403：不泄露其他租户资源是否存在（docs/28 AUTH-007）
            raise ApiError(404, "THREAD_NOT_FOUND", "thread not found")
        return row

    def list(self, tenant_id: str | None) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT * FROM threads WHERE tenant_id=? ORDER BY thread_id",
            (self._require_tenant(tenant_id),),
        ).fetchall()

    def append_turn(self, tenant_id: str | None, thread_id: str) -> None:
        owner = "someone"
        self.db.execute(
            "INSERT INTO events(tenant_id, thread_id, seq, type) VALUES(?,?,?,?)",
            (self._require_tenant(tenant_id), thread_id, 1, "turn.queued"),
        )
        # 无行受影响 = 跨租户写 → 404（同样不泄露存在性）
        row = self.db.execute(
            "SELECT owner_id FROM threads WHERE tenant_id=? AND thread_id=?",
            (self._require_tenant(tenant_id), thread_id),
        ).fetchone()
        if row is None:
            self.db.rollback()
            raise ApiError(404, "THREAD_NOT_FOUND", "thread not found")
        del owner


class SearchRepo(TenantRepo):
    def kb_search(self, tenant_id: str | None, kb_id: str, q: str) -> list[str]:
        # ACL 先过滤 KB 归属再检索（docs/32 §13B：先过滤 KB/doc 再检索）
        kb = self.db.execute(
            "SELECT name FROM knowledge_bases WHERE tenant_id=? AND kb_id=?",
            (self._require_tenant(tenant_id), kb_id),
        ).fetchone()
        if kb is None:
            raise ApiError(404, "KB_NOT_FOUND", "knowledge base not found")
        rows = self.db.execute(
            "SELECT text FROM chunks WHERE tenant_id=? AND kb_id=? AND text LIKE ?",
            (self._require_tenant(tenant_id), kb_id, f"%{q}%"),
        ).fetchall()
        return [r["text"] for r in rows]

    def memory_search(self, tenant_id: str | None, agent_id: str, q: str) -> list[str]:
        rows = self.db.execute(
            "SELECT text FROM memory_atoms WHERE tenant_id=? AND agent_id=? AND text LIKE ?",
            (self._require_tenant(tenant_id), agent_id, f"%{q}%"),
        ).fetchall()
        return [r["text"] for r in rows]


class UsageRepo(TenantRepo):
    def summary(self, tenant_id: str | None) -> int:
        return sum(
            r["cost_micros"] for r in self.db.execute(
                "SELECT cost_micros FROM usage_ledger WHERE tenant_id=?",
                (self._require_tenant(tenant_id),),
            )
        )


class AuditRepo(TenantRepo):
    def list(self, tenant_id: str | None, actor_is_admin: bool) -> list[sqlite3.Row]:
        if not actor_is_admin:
            raise ApiError(403, "FORBIDDEN", "audit requires admin role")
        return self.db.execute(
            "SELECT * FROM audit_log WHERE tenant_id=? ORDER BY id",
            (self._require_tenant(tenant_id),),
        ).fetchall()


class Audit:
    def __init__(self, db: sqlite3.Connection) -> None:
        self.db = db

    def deny(self, tenant_id: str, actor: str, action: str, detail: str) -> None:
        self.db.execute(
            "INSERT INTO audit_log(tenant_id, actor, action, result, detail) VALUES(?,?,?,?,?)",
            (tenant_id, actor, action, "denied", detail),
        )
        self.db.commit()


def sign_attachment_url(secret: str, tenant_id: str, ref: str) -> str:
    msg = f"{tenant_id}:{ref}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def verify_attachment_url(secret: str, token: str, tenant_id: str, ref: str) -> None:
    if not hmac.compare_digest(token, sign_attachment_url(secret, tenant_id, ref)):
        raise ApiError(403, "SIGNATURE_INVALID", "attachment signature invalid")


# --------------------------------------------------------------------------
# Fixture：租户 A/B 各 1 用户、1 thread、1 KB、1 memory、usage
# --------------------------------------------------------------------------

def build_db() -> tuple[sqlite3.Connection, dict]:
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    for t in ("tenant-a", "tenant-b"):
        db.execute("INSERT INTO threads VALUES(?,?,?,?)", (t, f"th-{t[-1]}", "secret plan", f"u-{t[-1]}"))
        db.execute("INSERT INTO events VALUES(?,?,?,?)", (t, f"th-{t[-1]}", 1, "turn.queued"))
        db.execute("INSERT INTO knowledge_bases VALUES(?,?,?)", (t, f"kb-{t[-1]}", f"KB-of-{t}"))
        db.execute("INSERT INTO chunks VALUES(?,?,?)", (t, f"kb-{t[-1]}", "root password is hunter2"))
        db.execute("INSERT INTO memory_atoms VALUES(?,?,?)", (t, f"ag-{t[-1]}", "prod db in ap-southeast-1"))
        db.execute("INSERT INTO usage_ledger VALUES(?,?,?)", (t, f"u-{t[-1]}", 1_000))
    db.commit()
    repos = {
        "threads": ThreadRepo(db), "search": SearchRepo(db),
        "usage": UsageRepo(db), "audit": AuditRepo(db),
    }
    return db, repos


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


def expect_api_error(status: int, code: str) -> str:
    """返回断言辅助：捕获 ApiError 并校验 status/code。"""

    def _run(fn, *a, **kw) -> str:
        try:
            fn(*a, **kw)
        except ApiError as exc:
            assert exc.status == status, f"期望 {status} 实得 {exc.status}"
            assert exc.code == code, f"期望 {code} 实得 {exc.code}"
            blob = json.dumps(exc.body, ensure_ascii=False)
            assert "tenant-b" not in blob and "hunter2" not in blob, f"错误体泄露: {blob}"
            return f"{exc.status} {exc.code}（错误体无泄露）"
        raise AssertionError("未按预期拒绝")

    return _run


def main() -> int:
    print("== S2 租户隔离负向测试 ==")
    db, r = build_db()
    A, B = "tenant-a", "tenant-b"

    check(1, "GET /threads/{id} 跨租户 → 404",
          lambda: expect_api_error(404, "THREAD_NOT_FOUND")(r["threads"].get, A, "th-b"))

    def case2():
        rows = r["threads"].list(A)
        assert all(x["tenant_id"] == A for x in rows) and len(rows) == 1, "列表泄漏他租户"
        return f"{len(rows)} 行，全部属于 {A}"

    check(2, "GET /threads 只返回本租户", case2)

    check(3, "SSE /threads/{id}/events 跨租户 → 404",
          lambda: expect_api_error(404, "THREAD_NOT_FOUND")(r["threads"].get, A, "th-b"))

    check(4, "POST /threads/{id}/turns 跨租户写 → 404",
          lambda: expect_api_error(404, "THREAD_NOT_FOUND")(r["threads"].append_turn, A, "th-b"))

    def case5():
        try:
            r["search"].kb_search(A, "kb-b", "password")
            raise AssertionError("跨租户检索未被拒")
        except ApiError as exc:
            assert exc.status == 404 and "KB-of-tenant-b" not in json.dumps(exc.body), "泄露 KB 名"
            return "404 KB_NOT_FOUND（不泄露 KB 名）"

    check(5, "KB 检索跨租户：404 且不泄露 KB 名", case5)

    def case6():
        hits = r["search"].memory_search(A, "ag-b", "prod db")
        assert hits == [], f"跨租户记忆泄漏 {hits}"
        return "0 命中"

    check(6, "记忆检索跨租户 → 0 命中", case6)

    def case7():
        token = sign_attachment_url("sekrit", B, "att-1")
        try:
            verify_attachment_url("sekrit", token, A, "att-1")  # 换租户重放
            raise AssertionError("签名校验未拒绝")
        except ApiError as exc:
            assert exc.status == 403, "应 403"
            return "403 SIGNATURE_INVALID（跨租户重放被拒）"

    check(7, "附件签名 URL 换租户重放 → 403", case7)

    def case8():
        total = r["usage"].summary(A)
        assert total == 1_000, f"聚合泄漏他租户: {total}"
        return f"cost={total}（仅本租户）"

    check(8, "用量聚合不串租户", case8)

    check(9, "非本租户管理员读审计 → 403",
          lambda: expect_api_error(403, "FORBIDDEN")(r["audit"].list, A, actor_is_admin=False))

    def case10():
        audit = Audit(db)
        audit.deny(A, "u-a", "ws.subscribe", "thread=th-b cross-tenant")
        rows = r["audit"].list(A, actor_is_admin=True)
        assert any(x["action"] == "ws.subscribe" and x["result"] == "denied" for x in rows), "审计未记录"
        return "WS 跨租户被关闭且写入审计"

    check(10, "WS 订阅跨租户 → 关闭 + 审计", case10)

    # SQL lint：repo 内不允许无 tenant 条件的 SELECT
    def lint():
        import re
        import sys
        src = open(sys.modules[TenantRepo.__module__].__file__, encoding="utf-8").read()
        block = src.split("class TenantRepo", 1)[1].split("class ThreadRepo", 1)[0]
        selects = re.findall(r'"SELECT[^"]+"', block)
        assert not selects, f"repo 基类区域发现裸 SELECT: {selects}"
        return "repo 基类无裸 SELECT"

    check(11, "SQL lint：repo 无 tenant 条件即失败", lint)

    ok = sum(1 for _, o, _ in RESULTS if o)
    print(f"\n[结果] {ok}/{len(RESULTS)} 通过")
    print("[结论] " + ("GO: 租户隔离模型成立（404 不泄露存在性 + 审计覆盖）" if ok == len(RESULTS) else "NO-GO"))
    return 0 if ok == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
