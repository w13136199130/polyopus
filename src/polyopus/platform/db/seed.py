"""Bootstrap data (M0-09).

SQL seeds static rows (default tenant); this module seeds the first admin
because the password must be hashed at runtime, never hardcoded.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import sqlite3
import time

SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
DKLEN = 32


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=DKLEN,
    )
    return "$".join(
        [
            "scrypt",
            str(SCRYPT_N),
            str(SCRYPT_R),
            str(SCRYPT_P),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(stored: str, password: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, hash_b64 = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    salt = base64.b64decode(salt_b64)
    expected = base64.b64decode(hash_b64)
    actual = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=int(n),
        r=int(r),
        p=int(p),
        dklen=len(expected),
    )
    return hmac.compare_digest(actual, expected)


def has_owner(conn: sqlite3.Connection, tenant_id: str = "default") -> bool:
    row = conn.execute(
        "SELECT 1 FROM users WHERE tenant_id = ? AND is_owner = 1 AND deleted_at IS NULL LIMIT 1",
        (tenant_id,),
    ).fetchone()
    return row is not None


def ensure_admin(
    conn: sqlite3.Connection,
    tenant_id: str = "default",
    username: str = "admin",
    password: str | None = None,
) -> tuple[bool, str]:
    """Create the first owner if none exists.

    Returns (created, password). `password` is only non-empty when created.
    """
    if has_owner(conn, tenant_id):
        return False, ""

    plain = password or secrets.token_urlsafe(12)
    now = int(time.time())
    user_id = "us_" + secrets.token_hex(8)

    conn.execute(
        """
        INSERT INTO users (
          tenant_id, user_id, username, display_name, password_hash,
          status, is_owner, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)
        """,
        (tenant_id, user_id, username, username, hash_password(plain), now, now),
    )
    return True, plain
