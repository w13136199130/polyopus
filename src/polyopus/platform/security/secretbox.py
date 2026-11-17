"""Small authenticated encryption for connector credentials (V1-14).

Stdlib-only envelope: 16-byte nonce + HMAC-SHA256 tag + XOR stream derived
from sha256(key || nonce || counter). This keeps credentials out of plaintext
DB rows; a full AEAD/KMS backend can replace the implementation without
changing call sites.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os


def _stream(key: bytes, nonce: bytes, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hashlib.sha256(key + nonce + counter.to_bytes(4, "big")).digest())
        counter += 1
    return bytes(output[:length])


def encrypt(plaintext: str, secret_key: str) -> str:
    key = hashlib.sha256(secret_key.encode()).digest()
    nonce = os.urandom(16)
    raw = plaintext.encode()
    cipher = bytes(a ^ b for a, b in zip(raw, _stream(key, nonce, len(raw)), strict=True))
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(nonce + tag + cipher).decode("ascii")


def decrypt(token: str, secret_key: str) -> str:
    data = base64.urlsafe_b64decode(token.encode("ascii"))
    if len(data) < 48:
        raise ValueError("bad secret envelope")
    key = hashlib.sha256(secret_key.encode()).digest()
    nonce, tag, cipher = data[:16], data[16:48], data[48:]
    expected = hmac.new(key, nonce + cipher, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected):
        raise ValueError("secret tag mismatch")
    raw = bytes(a ^ b for a, b in zip(cipher, _stream(key, nonce, len(cipher)), strict=True))
    return raw.decode()
