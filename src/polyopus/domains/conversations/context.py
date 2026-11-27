"""Turn context assembly (docs/28 MEM-001).

The engine used to send only the newest user message. This module is the
single place that decides what the model actually sees:

1. the pinned expert's system prompt (stable prefix, cache-friendly),
2. recalled memory (volatile),
3. knowledge-base evidence (volatile),
4. recent conversation history ending with the current user message.

When the estimate exceeds the model input budget, trimming follows MEM-001:
knowledge evidence first, then the oldest conversation messages, then memory.
The newest user message is always retained (truncated only as a last resort).

`estimate_tokens` is deliberately a cheap character heuristic, not a real
tokenizer: it is used for a budget guard rail, not billing.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from polyopus.domains.agents import workspace as agent_workspace
from polyopus.kernel.models.gateway import ChatMessage

DEFAULT_HISTORY_LIMIT = 60
MIN_KEEP_MESSAGES = 2
OUTPUT_RESERVE_TOKENS = 2_048


def estimate_tokens(text: str) -> int:
    """Conservative mixed Chinese/English estimate (~1 token per 2 chars)."""
    return max(1, (len(text) + 1) // 2)


@dataclass(frozen=True)
class AgentContext:
    system_prompt: str = ""
    model: str | None = None
    name: str | None = None


PROMPT_FILES = ("SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md")
MAX_FILE_PROMPT_CHARS = 32_000


def _compose_prompt(base: str, files: dict[str, str]) -> str:
    """Legacy systemPrompt first, then the expert's prompt files.

    Only agent-scoped files are injected: USER.md / MEMORY.md belong to the
    user and are handled by the memory pipeline, not by a shared agent dir."""
    parts = [base.strip()] if base.strip() else []
    for name in PROMPT_FILES:
        content = str(files.get(name) or "").strip()
        if content:
            parts.append(f"## {name}\n\n{content}")
    return "\n\n".join(parts)[:MAX_FILE_PROMPT_CHARS]


def _draft_files(
    conn: sqlite3.Connection, *, tenant_id: str, agent_id: str,
) -> dict[str, str]:
    rows = conn.execute(
        "SELECT name, content FROM agent_files WHERE tenant_id = ? AND agent_id = ?",
        (tenant_id, agent_id),
    ).fetchall()
    return {str(row["name"]): str(row["content"]) for row in rows}


def agent_context(
    conn: sqlite3.Connection, *, tenant_id: str, thread_id: str,
    workspace_root: Path | None = None,
) -> AgentContext:
    """The expert config pinned at thread creation (never the live draft)."""
    row = conn.execute(
        """
        SELECT t.agent_id, t.agent_version_id, a.name
        FROM threads t
        LEFT JOIN agents a ON a.agent_id = t.agent_id AND a.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? AND t.thread_id = ?
        """,
        (tenant_id, thread_id),
    ).fetchone()
    if row is None or not row["agent_id"]:
        return AgentContext()
    agent_id = str(row["agent_id"])
    version = conn.execute(
        """
        SELECT config_json, files_json, version FROM agent_versions
        WHERE tenant_id = ? AND agent_id = ?
          AND (? IS NULL OR CAST(id AS TEXT) = ?)
        ORDER BY is_current DESC, version DESC LIMIT 1
        """,
        (tenant_id, agent_id, row["agent_version_id"], row["agent_version_id"]),
    ).fetchone()
    config: dict[str, object] = {}
    files: dict[str, str] = {}
    version_no = 0
    if version is not None:
        version_no = int(version["version"] or 0)
        if version["config_json"]:
            try:
                parsed = json.loads(str(version["config_json"]))
            except ValueError:
                parsed = {}
            if isinstance(parsed, dict):
                config = parsed
        if version["files_json"]:
            try:
                parsed_files = json.loads(str(version["files_json"]))
            except ValueError:
                parsed_files = {}
            if isinstance(parsed_files, dict):
                files = {str(key): str(value) for key, value in parsed_files.items()}

    # Draft threads (version 0) read the live expert files; published threads
    # read the immutable version snapshot (workspace dir, DB fallback).
    if version_no == 0:
        files = _draft_files(conn, tenant_id=tenant_id, agent_id=agent_id)
    elif workspace_root is not None:
        on_disk = agent_workspace.read_version_files(
            workspace_root, tenant_id=tenant_id, agent_id=agent_id,
            version=version_no,
        )
        if on_disk:
            files = on_disk

    base_prompt = str(config.get("systemPrompt") or "")
    return AgentContext(
        system_prompt=_compose_prompt(base_prompt, files),
        model=str(config.get("model") or "").strip() or None,
        name=str(row["name"]) if row["name"] else None,
    )


def message_history(
    conn: sqlite3.Connection,
    *,
    tenant_id: str,
    thread_id: str,
    limit: int = DEFAULT_HISTORY_LIMIT,
) -> list[ChatMessage]:
    """Completed user/assistant rows, oldest first. Tool rows are not replayed
    (their outcome is already folded into the assistant text)."""
    rows = conn.execute(
        """
        SELECT role, content FROM messages
        WHERE tenant_id = ? AND thread_id = ? AND deleted_at IS NULL
          AND status = 'completed' AND role IN ('user', 'assistant')
          AND content <> ''
        ORDER BY seq DESC LIMIT ?
        """,
        (tenant_id, thread_id, max(2, min(limit, 200))),
    ).fetchall()
    messages = [
        ChatMessage(
            role="assistant" if str(row["role"]) == "assistant" else "user",
            content=str(row["content"]),
        )
        for row in reversed(rows)
    ]
    return messages


@dataclass(frozen=True)
class ContextStats:
    budget_tokens: int
    estimated_tokens: int
    history_messages: int
    dropped_history: int = 0
    dropped_knowledge: bool = False
    dropped_memory: bool = False
    truncated: bool = False


def _tokens(messages: list[ChatMessage]) -> int:
    return sum(estimate_tokens(message.content) + 8 for message in messages)


def assemble(
    *,
    system_prompt: str,
    agent_name: str | None,
    memory: str,
    knowledge: str,
    history: list[ChatMessage],
    current_user_content: str,
    max_input_tokens: int,
    output_reserve: int = OUTPUT_RESERVE_TOKENS,
) -> tuple[list[ChatMessage], ContextStats]:
    """Build the model message list under a token budget.

    `history` should already be oldest-first and include the current user
    message; if it does not (projection lag), it is appended here."""
    budget = max(512, max_input_tokens - output_reserve)
    prompt = system_prompt.strip()
    if not prompt and agent_name:
        prompt = f"你是{agent_name}。"
    # A runaway prompt must not crowd out the conversation.
    if estimate_tokens(prompt) > budget // 2:
        prompt = prompt[: max(200, budget)]

    hist = list(history)
    if (
        not hist
        or hist[-1].role != "user"
        or hist[-1].content.strip() != current_user_content.strip()
    ):
        hist.append(ChatMessage(role="user", content=current_user_content))

    memory_block = memory.strip()
    knowledge_block = knowledge.strip()
    dropped_knowledge = False
    dropped_memory = False
    dropped_history = 0
    truncated = False

    def build() -> list[ChatMessage]:
        messages: list[ChatMessage] = []
        if prompt:
            messages.append(ChatMessage(role="system", content=prompt))
        if memory_block:
            messages.append(ChatMessage(role="system", content=memory_block))
        if knowledge_block:
            messages.append(ChatMessage(role="system", content=knowledge_block))
        messages.extend(hist)
        return messages

    if _tokens(build()) > budget and knowledge_block:
        knowledge_block = ""
        dropped_knowledge = True
    while _tokens(build()) > budget and len(hist) > MIN_KEEP_MESSAGES:
        hist.pop(0)
        dropped_history += 1
    if _tokens(build()) > budget and memory_block:
        memory_block = ""
        dropped_memory = True

    # Still over: trim the oldest remaining messages from the front, then the
    # newest user message's tail as the very last resort.
    while _tokens(build()) > budget and len(hist) > 1:
        over = _tokens(build()) - budget
        first = hist[0]
        cut = max(1, over * 2)
        if len(first.content) <= cut:
            hist.pop(0)
            dropped_history += 1
        else:
            hist[0] = ChatMessage(
                role=first.role, content=first.content[: max(1, len(first.content) - cut)]
            )
            truncated = True
    if _tokens(build()) > budget and hist:
        last = hist[-1]
        keep = max(64, len(last.content) - (_tokens(build()) - budget) * 2)
        hist[-1] = ChatMessage(
            role=last.role,
            content=last.content[:keep],
        )
        truncated = True

    messages = build()
    return messages, ContextStats(
        budget_tokens=budget,
        estimated_tokens=_tokens(messages),
        history_messages=len(hist),
        dropped_history=dropped_history,
        dropped_knowledge=dropped_knowledge,
        dropped_memory=dropped_memory,
        truncated=truncated,
    )


__all__ = [
    "AgentContext",
    "ContextStats",
    "assemble",
    "agent_context",
    "estimate_tokens",
    "message_history",
]
