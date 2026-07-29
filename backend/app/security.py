"""Cryptographic helpers for codes and device tokens.

Design notes
------------
* Email verification codes are 6 decimal digits. We **never** store the plain
  code; we store ``hash_code(code)`` (SHA-256, optionally peppered). A code is
  single-use and short-lived, but hashing still limits the blast radius if the
  database is read.
* Device tokens are long-lived, high-entropy, opaque strings. The client holds
  the raw token; the server stores only ``hash_token(token)``. Even a full DB
  read cannot be turned into valid bearer tokens.
* Tokens and codes never enter logs: we only ever handle their digests on the
  server side, and logging config strips Authorization headers elsewhere.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from .config import Settings


def _digest(value: str, pepper: str) -> str:
    """Return a hex SHA-256 digest, optionally mixed with a server pepper."""
    h = hashlib.sha256()
    h.update(value.encode("utf-8"))
    if pepper:
        h.update(b"|")
        h.update(pepper.encode("utf-8"))
    return h.hexdigest()


def generate_email_code(length: int = 6) -> str:
    """Generate a cryptographically-random numeric code as a zero-padded str."""
    if length < 1:
        raise ValueError("code length must be >= 1")
    max_val = 10 ** length
    n = secrets.randbelow(max_val)
    return str(n).zfill(length)


def hash_code(code: str, settings: Settings) -> str:
    """One-way digest of a verification code for storage."""
    return _digest(code, settings.token_hash_pepper)


def verify_code_digest(code: str, stored_digest: str, settings: Settings) -> bool:
    """Constant-time comparison of a code against its stored digest."""
    return hmac.compare_digest(hash_code(code, settings), stored_digest)


def generate_device_token(num_bytes: int = 32) -> str:
    """Generate a long-lived, URL-safe opaque device token."""
    return secrets.token_urlsafe(num_bytes)


def hash_token(token: str, settings: Settings) -> str:
    """One-way digest of a device token for storage."""
    return _digest(token, settings.token_hash_pepper)


def verify_token_digest(token: str, stored_digest: str, settings: Settings) -> bool:
    """Constant-time comparison of a token against its stored digest."""
    return hmac.compare_digest(hash_token(token, settings), stored_digest)
