"""Error handling: stable codes + localized envelope (M1 pre-work)."""

from polyopus.platform.errors.codes import ERROR_CODES, HTTP_OVERRIDES
from polyopus.platform.errors.envelope import AppError, error_payload, status_for

__all__ = ["ERROR_CODES", "HTTP_OVERRIDES", "AppError", "error_payload", "status_for"]
