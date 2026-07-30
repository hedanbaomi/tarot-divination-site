"""Cryptographic helpers for codes and device tokens.

Design notes
------------
* Email verification codes are 6 decimal digits. We **never** store the plain
  code; we store an **HMAC-SHA256** of the code keyed by the server-wide
  ``SECRET_KEY``. HMAC (not bare SHA-256) is used so that a leaked digest
  cannot be turned into a valid code without the secret, and so two servers
  with different secrets cannot validate each other's codes/tokens. A code is
  single-use and short-lived regardless, but HMAC bounds the blast radius of a
  DB read far better than an unsalted hash.
* Device tokens are long-lived, high-entropy, opaque strings. The client holds
  the raw token; the server stores only ``hash_token(token)``. Even a full DB
  read cannot be turned into valid bearer tokens because the secret never lives
  in the DB.
* Tokens and codes never enter logs: we only ever handle their digests on the
  server side, and logging config strips Authorization headers elsewhere.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from .config import Settings


def _hmac_digest(message: str, secret: str) -> str:
    """Return a hex HMAC-SHA256 of ``message`` keyed by ``secret``.

    ``secret`` must be non-empty (enforced by callers via
    ``Settings.effective_hmac_secret()``). A missing secret is a programming
    error and surfaces immediately rather than producing a weak digest.
    """
    if not secret:
        raise ValueError("HMAC secret must not be empty")
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def generate_email_code(length: int = 6) -> str:
    """Generate a cryptographically-random numeric code as a zero-padded str."""
    if length < 1:
        raise ValueError("code length must be >= 1")
    max_val = 10 ** length
    n = secrets.randbelow(max_val)
    return str(n).zfill(length)


def hash_code(code: str, settings: Settings) -> str:
    """One-way HMAC of a verification code for storage."""
    return _hmac_digest(code, settings.effective_hmac_secret())


def verify_code_digest(code: str, stored_digest: str, settings: Settings) -> bool:
    """Constant-time comparison of a code against its stored HMAC digest."""
    return hmac.compare_digest(hash_code(code, settings), stored_digest)


def generate_device_token(num_bytes: int = 32) -> str:
    """Generate a long-lived, URL-safe opaque device token."""
    return secrets.token_urlsafe(num_bytes)


def hash_token(token: str, settings: Settings) -> str:
    """One-way HMAC of a device token for storage."""
    return _hmac_digest(token, settings.effective_hmac_secret())


def verify_token_digest(token: str, stored_digest: str, settings: Settings) -> bool:
    """Constant-time comparison of a token against its stored HMAC digest."""
    return hmac.compare_digest(hash_token(token, settings), stored_digest)
