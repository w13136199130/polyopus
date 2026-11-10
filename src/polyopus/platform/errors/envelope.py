"""Error envelope shared by API, workers and CLI.

Shape (docs/29 §1.3):
    {"error": {"code", "message", "details", "traceId"}}

Unknown codes fail closed to INTERNAL_ERROR: a typo must never reach the client
as a 200-ish custom code that the frontend cannot branch on.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from polyopus.platform.errors.codes import ERROR_CODES, HTTP_OVERRIDES
from polyopus.platform.i18n import error_message

FALLBACK_CODE = "INTERNAL_ERROR"


def status_for(code: str) -> int:
    return HTTP_OVERRIDES.get(code, ERROR_CODES.get(code, 500))


@dataclass
class AppError(Exception):
    code: str
    message: str | None = None
    details: Mapping[str, Any] = field(default_factory=dict)
    http_status: int | None = None
    retry_after: int | None = None

    def __post_init__(self) -> None:
        super().__init__(self.code)

    def normalized_code(self) -> str:
        return self.code if self.code in ERROR_CODES else FALLBACK_CODE

    def status(self) -> int:
        if self.http_status is not None:
            return self.http_status
        return status_for(self.normalized_code())

    def to_payload(self, trace_id: str | None = None, locale: str = "en") -> dict[str, Any]:
        code = self.normalized_code()
        details = dict(self.details)
        if code != self.code:
            details.setdefault("originalCode", self.code)
        payload: dict[str, Any] = {
            "error": {
                "code": code,
                "message": self.message or error_message(code, locale),
                "details": details,
            }
        }
        if trace_id:
            payload["error"]["traceId"] = trace_id
        return payload


def error_payload(
    code: str,
    message: str | None = None,
    details: Mapping[str, Any] | None = None,
    trace_id: str | None = None,
    locale: str = "en",
) -> dict[str, Any]:
    return AppError(code=code, message=message, details=details or {}).to_payload(
        trace_id=trace_id, locale=locale
    )
