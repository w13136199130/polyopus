"""Outbound reply transport port (v0.5 card V05-08).

The outbox loop owns WHEN a reply is delivered; this port owns HOW. The
default adapter is stdlib urllib — same choice as the engine's
openai_compat client and the e2e API client: no new runtime dependency,
and ProxyHandler({}) keeps loopback callbacks off any ambient HTTP_PROXY.
"""

from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class DeliveryResult:
    """One POST attempt. `status_code` None means the request never got a
    response (DNS/refused/timeout) — treated as retryable."""

    status_code: int | None
    ok: bool
    error: str | None = None
    retry_after: float | None = None  # seconds, from a 429 Retry-After


class ReplyTransport(Protocol):
    def post(
        self, url: str, body: bytes, headers: Mapping[str, str], *, timeout: float
    ) -> DeliveryResult: ...


class UrllibTransport:
    """Default ReplyTransport over urllib."""

    def post(
        self, url: str, body: bytes, headers: Mapping[str, str], *, timeout: float
    ) -> DeliveryResult:
        request = urllib.request.Request(url, data=body, method="POST")
        for key, value in headers.items():
            request.add_header(key, value)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=timeout) as response:
                code = int(response.status)
                return DeliveryResult(status_code=code, ok=200 <= code < 300)
        except urllib.error.HTTPError as exc:
            retry_after: float | None = None
            raw = exc.headers.get("Retry-After") if exc.headers is not None else None
            if raw:
                try:
                    retry_after = float(raw)
                except ValueError:
                    retry_after = None  # HTTP-date form: fall back to ladder
            return DeliveryResult(
                status_code=int(exc.code), ok=False, error=f"HTTP {exc.code}",
                retry_after=retry_after,
            )
        except Exception as exc:  # noqa: BLE001 - URLError/timeout/refused
            return DeliveryResult(status_code=None, ok=False, error=str(exc))
