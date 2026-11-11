"""Knowledge domain (SQLite lexical path; embeddings arrive in a later batch)."""

from polyopus.domains.knowledge.service import (
    chunk_markdown,
    create_kb,
    estimate_tokens,
    ingest_markdown,
    resume_pending_jobs,
    search,
)

__all__ = [
    "chunk_markdown",
    "create_kb",
    "estimate_tokens",
    "ingest_markdown",
    "resume_pending_jobs",
    "search",
]
