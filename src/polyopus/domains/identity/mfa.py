"""TOTP + recovery codes (V1-03), stdlib only.

The secret is stored in `user_mfa.secret_enc` (no KMS in v1.0, local DB
threat model). Recovery codes are one-time and consumed on use.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import struct
import time
from typing import cast

from polyopus.domains.identity.service import User

METHOD = "totp"
STEP = 30


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _decode_secret(secret: str) -> bytes:
    return base64.b32decode(secret + "=" * (-len(secret) % 8))


def totp_at(secret: str, at: int, *, step: int = STEP) -> str:
    counter = int(at) // step
    digest = hmac.new(
        _decode_secret(secret), struct.pack(">Q", counter), hashlib.sha1
    ).digest()
    offset = digest[-1] & 0x0F
    code = (
        (digest[offset] & 0x7F) << 24
        | (digest[offset + 1] & 0xFF) << 16
        | (digest[offset + 2] & 0xFF) << 8
        | (digest[offset + 3] & 0xFF)
    ) % 1_000_000
    return f"{code:06d}"


def verify_totp(secret: str, code: str, *, at: int | None = None) -> bool:
    ts = int(at if at is not None else time.time())
    normalized = "".join(ch for ch in str(code) if ch.isdigit())
    if len(normalized) != 6:
        return False
    return any(
        hmac.compare_digest(totp_at(secret, ts + delta * STEP), normalized)
        for delta in (-1, 0, 1)
    )


def otpauth_url(secret: str, *, user: str, issuer: str = "PolyOpus") -> str:
    return (
        f"otpauth://totp/{issuer}:{user}?secret={secret}"
        f"&issuer={issuer}&digits=6&period={STEP}"
    )


def enroll(conn: sqlite3.Connection, user: User) -> dict[str, object]:
    secret = new_secret()
    conn.execute(
        """
        INSERT INTO user_mfa
          (user_id, method, credential_id, secret_enc, enabled, created_at)
        VALUES (?, ?, '', ?, 0, ?)
        ON CONFLICT(user_id, method, credential_id) DO UPDATE SET
          secret_enc = excluded.secret_enc,
          enabled = 0,
          recovery_codes_enc = NULL
        """,
        (user.user_id, METHOD, secret, int(time.time())),
    )
    conn.commit()
    return {
        "secret": secret,
        "otpauthUrl": otpauth_url(secret, user=user.username),
    }


def _row(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row | None:
    return cast(sqlite3.Row | None, conn.execute(
        "SELECT * FROM user_mfa WHERE user_id = ? AND method = ? "
        "AND credential_id = ''",
        (user_id, METHOD),
    ).fetchone())


def is_enabled(conn: sqlite3.Connection, user: User) -> bool:
    row = _row(conn, user.user_id)
    return row is not None and bool(row["enabled"])


def _new_recovery_codes() -> list[str]:
    return [secrets.token_hex(4) for _ in range(8)]


def confirm_enrollment(
    conn: sqlite3.Connection, user: User, code: str
) -> list[str]:
    row = _row(conn, user.user_id)
    if row is None or not row["secret_enc"]:
        raise ValueError("not enrolled")
    if not verify_totp(str(row["secret_enc"]), code):
        raise ValueError("bad code")
    recovery = _new_recovery_codes()
    conn.execute(
        "UPDATE user_mfa SET enabled = 1, recovery_codes_enc = ?, last_used_at = ? "
        "WHERE user_id = ? AND method = ? AND credential_id = ''",
        (json.dumps(recovery), int(time.time()), user.user_id, METHOD),
    )
    conn.commit()
    return recovery


def verify_code(conn: sqlite3.Connection, user: User, code: str) -> bool:
    row = _row(conn, user.user_id)
    if row is None or not row["enabled"] or not row["secret_enc"]:
        return True  # MFA not enabled: nothing to verify
    secret = str(row["secret_enc"])
    if verify_totp(secret, code):
        conn.execute(
            "UPDATE user_mfa SET last_used_at = ? WHERE user_id = ? "
            "AND method = ? AND credential_id = ''",
            (int(time.time()), user.user_id, METHOD),
        )
        conn.commit()
        return True
    try:
        codes = [str(c) for c in json.loads(row["recovery_codes_enc"] or "[]")]
    except ValueError:
        return False
    candidate = str(code).strip().lower()
    if candidate in codes:
        codes.remove(candidate)
        conn.execute(
            "UPDATE user_mfa SET recovery_codes_enc = ? WHERE user_id = ? "
            "AND method = ? AND credential_id = ''",
            (json.dumps(codes), user.user_id, METHOD),
        )
        conn.commit()
        return True
    return False


def disable(conn: sqlite3.Connection, user: User) -> None:
    conn.execute(
        "UPDATE user_mfa SET enabled = 0, recovery_codes_enc = NULL "
        "WHERE user_id = ? AND method = ? AND credential_id = ''",
        (user.user_id, METHOD),
    )
    conn.commit()


__all__ = [
    "confirm_enrollment",
    "disable",
    "enroll",
    "is_enabled",
    "new_secret",
    "otpauth_url",
    "totp_at",
    "verify_code",
    "verify_totp",
]
