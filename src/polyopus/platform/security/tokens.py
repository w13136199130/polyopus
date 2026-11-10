"""Opaque signed tokens (HMAC-SHA256), stdlib only.

Not JWT: we only need tamper-evident server-issued tokens, and the session row
is the source of truth for revocation.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, cast


class TokenError(ValueError):
    pass


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(secret: str, body: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return _b64(digest)


def issue(secret: str, claims: dict[str, Any], ttl_seconds: int) -> str:
    payload = dict(claims)
    payload["exp"] = int(time.time()) + ttl_seconds
    payload["jti"] = secrets.token_hex(8)
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{body}.{_sign(secret, body)}"


def verify(secret: str, token: str) -> dict[str, Any]:
    try:
        body, signature = token.split(".", 1)
    except ValueError as exc:
        raise TokenError("malformed token") from exc
    if not hmac.compare_digest(_sign(secret, body), signature):
        raise TokenError("bad signature")
    try:
        claims = cast(dict[str, Any], json.loads(_unb64(body)))
    except (ValueError, json.JSONDecodeError) as exc:
        raise TokenError("bad payload") from exc
    if int(claims.get("exp", 0)) < int(time.time()):
        raise TokenError("expired")
    return claims


def new_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
