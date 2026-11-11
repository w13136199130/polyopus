"""Intake domain (slice ②)."""

from polyopus.domains.intake.service import (
    config_of,
    dedupe_key,
    evaluate_gate,
    get_source,
    open_ticket,
    process,
    receive,
    verify_signature,
)

__all__ = [
    "config_of",
    "dedupe_key",
    "evaluate_gate",
    "get_source",
    "open_ticket",
    "process",
    "receive",
    "verify_signature",
]
