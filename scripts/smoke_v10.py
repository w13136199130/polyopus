#!/usr/bin/env python
"""v1.0 live smoke checklist against a running `poly serve`.

Usage (cmd):
    set POLY_ADMIN_PASSWORD=your-admin-password
    uv run python scripts/smoke_v10.py

Or:
    uv run python scripts/smoke_v10.py --base-url http://127.0.0.1:8000 \
        --username admin --password your-password

It exercises health, login, chat + fs.write approval, experts, knowledge,
extensions/plugins, settings/API key, admin user/invite and /metrics.
Exit 0 only when every numbered check passes.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid

import httpx

TIMEOUT = 30.0


def _failures_text(response: httpx.Response) -> str:
    return f"{response.status_code} {response.text[:300]}"


class Checklist:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, number: int, name: str, ok: bool, detail: object = "") -> None:
        print(f"{number:>2}. [{'PASS' if ok else 'FAIL'}] {name}" +
              (f" — {detail}" if detail else ""))
        if not ok:
            self.failures.append(name)


def _wait_for(fn, *, timeout: float = 20.0, interval: float = 0.25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(interval)
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="v1.0 live smoke test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default=os.environ.get("POLY_ADMIN_PASSWORD"))
    args = parser.parse_args(argv)
    if not args.password:
        print("missing --password or POLY_ADMIN_PASSWORD", file=sys.stderr)
        return 2

    run = uuid.uuid4().hex[:6]
    checks = Checklist()
    with httpx.Client(base_url=args.base_url.rstrip("/"), timeout=TIMEOUT) as c:
        health = c.get("/healthz")
        checks.check(1, "healthz", health.status_code == 200 and
                     health.json().get("version") == "1.0.1", health.text[:80])

        login = c.post("/api/v1/auth/login", json={
            "username": args.username, "password": args.password,
        })
        checks.check(2, "login", login.status_code == 200,
                     _failures_text(login) if login.status_code != 200 else "")

        me = c.get("/api/v1/auth/me")
        checks.check(3, "auth/me", me.status_code == 200
                     and me.json().get("user", {}).get("username") == args.username,
                     _failures_text(me) if me.status_code != 200 else "")

        # --- 4. chat + fs.write approval ---
        thread = c.post("/api/v1/threads", json={"title": f"smoke-{run}"})
        thread_id = thread.json().get("threadId") if thread.status_code == 201 else None
        turn = c.post(f"/api/v1/threads/{thread_id}/turns", json={
            "content": "请用 fs.write 工具把内容 'smoke-ok' 写入 smoke.txt",
        }) if thread_id else None

        def pending_approval():
            rows = c.get("/api/v1/attentions").json().get("items", [])
            return next((row for row in rows
                         if row.get("turnId") == turn.json().get("turnId")
                         and row.get("kind") == "approval"), None)

        approval = _wait_for(pending_approval) if turn and turn.status_code == 202 else None
        answered = None
        if approval:
            answered = c.post(
                f"/api/v1/attentions/{approval['attentionId']}/answer",
                json={"decision": "approve"},
            )
        checks.check(4, "chat + fs.write approval",
                     bool(approval) and answered is not None
                     and answered.status_code == 200,
                     f"thread={thread_id} attention={approval and approval.get('attentionId')}")

        # --- 5. tasks endpoints ---
        counts = c.get("/api/v1/tickets/counts")
        tickets = c.get("/api/v1/tickets")
        checks.check(5, "tasks buckets", counts.status_code == 200
                     and tickets.status_code == 200,
                     _failures_text(counts) if counts.status_code != 200 else "")

        # --- 6. expert create/publish/thread pin ---
        agent = c.post("/api/v1/agents", json={
            "name": f"Smoke Expert {run}", "systemPrompt": "smoke",
        })
        agent_id = agent.json().get("agentId") if agent.status_code == 201 else None
        published = c.post(f"/api/v1/agents/{agent_id}/publish") if agent_id else None
        expert_thread = c.post("/api/v1/threads", json={
            "title": "smoke expert", "agentId": agent_id,
        }) if agent_id else None
        checks.check(6, "expert publish + thread pin",
                     bool(agent_id) and published is not None
                     and published.status_code == 200
                     and expert_thread is not None
                     and expert_thread.status_code == 201
                     and bool(expert_thread.json().get("agentVersionId")),
                     f"agent={agent_id}")

        # --- 7. knowledge upload + search ---
        kb = c.post("/api/v1/knowledge-bases", json={"name": f"Smoke KB {run}"})
        kb_id = kb.json().get("kbId") if kb.status_code == 201 else None
        doc = c.post(f"/api/v1/knowledge-bases/{kb_id}/docs", json={
            "filename": "smoke.md",
            "content": "# 运维\n## 备份\n每天备份，保留七份。\n",
        }) if kb_id else None
        found = c.post(f"/api/v1/knowledge-bases/{kb_id}/search", json={
            "query": "备份保留几份",
        }) if kb_id else None
        checks.check(7, "knowledge upload + search",
                     doc is not None and doc.status_code == 201
                     and found is not None and found.status_code == 200
                     and found.json().get("status") == "ok",
                     f"kb={kb_id}")

        # --- 8. extensions: tools + 3 example plugins ---
        tools = c.get("/api/v1/tools")
        examples = c.post("/api/v1/plugins/examples/install")
        plugins = c.get("/api/v1/plugins")
        checks.check(8, "extensions tools + plugins",
                     tools.status_code == 200
                     and len(tools.json().get("items", [])) >= 3
                     and examples.status_code == 200
                     and plugins.status_code == 200
                     and len(plugins.json().get("items", [])) >= 3,
                     f"tools={len(tools.json().get('items', []))} "
                     f"plugins={len(plugins.json().get('items', []))}")

        # --- 9. settings + step-up API key ---
        settings = c.get("/api/v1/admin/settings")
        reauth = c.post("/api/v1/auth/reauth", json={"password": args.password})
        key = c.post("/api/v1/me/api-keys", json={
            "name": f"smoke-{run}", "scopes": ["chat:read"],
        }) if reauth.status_code == 200 else None
        key_id = key.json().get("key", {}).get("id") if key and key.status_code == 201 else None
        revoked = c.delete(f"/api/v1/me/api-keys/{key_id}") if key_id else None
        checks.check(9, "settings + step-up API key",
                     settings.status_code == 200
                     and key is not None and key.status_code == 201
                     and revoked is not None and revoked.status_code == 200,
                     f"key={key_id}")

        # --- 10. admin user + invite ---
        user = c.post("/api/v1/users", json={
            "username": f"smoke-{run}", "password": "smoke-pass-1",
            "roles": ["member"],
        })
        invite = c.post("/api/v1/invites", json={
            "email": f"smoke-{run}@example.com", "role": "member",
        })
        checks.check(10, "admin user + invite",
                     user.status_code == 201 and invite.status_code == 201,
                     f"user={user.status_code} invite={invite.status_code}")

        # --- 12. admin config: overview + storage + security + provider ---
        overview = c.get("/api/v1/admin/overview")
        storage = c.get("/api/v1/admin/storage")
        security = c.get("/api/v1/admin/security")
        provider = c.post("/api/v1/admin/providers", json={
            "name": f"Smoke Provider {run}",
            "baseUrl": "http://127.0.0.1:9/v1",
            "apiKey": "sk-smoke",
            "models": ["smoke-model"],
        })
        provider_id = provider.json().get("providerId") if provider.status_code == 201 else None
        probed = c.post(f"/api/v1/admin/providers/{provider_id}/probe") if provider_id else None
        removed = c.delete(f"/api/v1/admin/providers/{provider_id}") if provider_id else None
        checks.check(11, "admin overview + storage + security + provider",
                     overview.status_code == 200
                     and "health" in overview.json()
                     and storage.status_code == 200
                     and storage.json().get("backend") == "local"
                     and security.status_code == 200
                     and "policy" in security.json()
                     and provider is not None and provider.status_code == 201
                     and probed is not None and probed.status_code == 200
                     and probed.json().get("ok") is False
                     and removed is not None and removed.status_code == 200,
                     f"provider={provider_id}")

        # --- 13. automation: create -> run now -> delete ---
        cron = c.post("/api/v1/cron-jobs", json={
            "name": f"Smoke Cron {run}",
            "schedule": "interval:3600",
            "timezone": "UTC",
            "text": "/polyopus smoke cron",
        })
        job_id = cron.json().get("cronJobId") if cron.status_code == 201 else None
        ran = c.post(f"/api/v1/cron-jobs/{job_id}/run") if job_id else None
        runs = c.get(f"/api/v1/cron-jobs/{job_id}/runs") if job_id else None
        deleted_job = c.delete(f"/api/v1/cron-jobs/{job_id}") if job_id else None
        checks.check(12, "automation create + run now + delete",
                     cron.status_code == 201
                     and ran is not None and ran.status_code == 200
                     and ran.json().get("status") == "succeeded"
                     and runs is not None and runs.status_code == 200
                     and any(row["runId"] == ran.json().get("runId")
                             for row in runs.json().get("items", []))
                     and deleted_job is not None and deleted_job.status_code == 200,
                     f"job={job_id}")

        # --- 14. notifications: list + mark all read ---
        notes = c.get("/api/v1/notifications")
        read_all = c.post("/api/v1/notifications/read-all")
        checks.check(13, "notifications list + read-all",
                     notes.status_code == 200
                     and read_all.status_code == 200
                     and read_all.json().get("ok") is True,
                     f"unread={notes.json().get('unreadCount')}")

        # --- 11. metrics groups ---
        metrics = c.get("/metrics")
        text = metrics.text
        groups = {
            "turn": "poly_turn_finished_total" in text,
            "tool": "poly_tool_calls_total" in text,
            "queue": "poly_queue_depth" in text,
            "usage": "poly_usage_tokens_total" in text,
            "slo": "poly_slo_target_ratio" in text,
        }
        checks.check(14, "/metrics four groups + SLO",
                     metrics.status_code == 200 and all(groups.values()),
                     groups)

    print()
    if checks.failures:
        print(f"SMOKE FAILED: {len(checks.failures)}/{14} — {checks.failures}")
        return 1
    print("SMOKE PASSED: 14/14")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
