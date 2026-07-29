"""Unit tests for low-level security helpers (no HTTP).

These specifically assert that verification-code and device-token digests are
**HMAC-SHA256 keyed by the server secret**, not bare SHA-256: changing the
secret must invalidate digests, and the same plaintext under two different
secrets must yield different digests.
"""

from __future__ import annotations

import hashlib
import hmac

import pytest

from app.config import Settings
from app.security import (
    generate_device_token,
    generate_email_code,
    hash_code,
    hash_token,
    verify_code_digest,
    verify_token_digest,
)


def _settings_with_secret(secret: str) -> Settings:
    import os

    old = os.environ.get("SECRET_KEY")
    os.environ["SECRET_KEY"] = secret
    try:
        return Settings()
    finally:
        if old is None:
            os.environ.pop("SECRET_KEY", None)
        else:
            os.environ["SECRET_KEY"] = old


def test_email_code_is_six_digits():
    for _ in range(50):
        c = generate_email_code(6)
        assert len(c) == 6
        assert c.isdigit()


def test_code_digest_differs_from_plaintext_and_bare_sha256():
    """The stored digest must NOT equal a bare SHA-256 of the code.

    A bare SHA-256 would let an attacker with a DB read forge codes without the
    secret. HMAC keyed by the secret prevents that.
    """
    s = _settings_with_secret("server-secret-aaa")
    code = generate_email_code(6)
    d = hash_code(code, s)
    assert d != code
    assert code not in d
    bare = hashlib.sha256(code.encode("utf-8")).hexdigest()
    assert d != bare, "digest must be HMAC, not bare SHA-256"


def test_code_digest_is_hmac_keyed_by_secret():
    """Same code under two secrets yields two different digests (HMAC property)."""
    code = "123456"
    s1 = _settings_with_secret("secret-one")
    s2 = _settings_with_secret("secret-two")
    d1 = hash_code(code, s1)
    d2 = hash_code(code, s2)
    assert d1 != d2
    # And each matches the independent HMAC computation.
    assert d1 == hmac.new(b"secret-one", code.encode("utf-8"), hashlib.sha256).hexdigest()
    assert d2 == hmac.new(b"secret-two", code.encode("utf-8"), hashlib.sha256).hexdigest()


def test_code_digest_roundtrip_and_constant_time_mismatch():
    s = _settings_with_secret("roundtrip-secret")
    code = generate_email_code(6)
    d = hash_code(code, s)
    assert verify_code_digest(code, d, s)
    assert not verify_code_digest("000000", d, s)


def test_empty_secret_rejected():
    """An empty HMAC secret is a programming error and must surface."""
    s = Settings()  # default dev secret is non-empty
    s = _settings_with_secret("")  # force empty
    # effective_hmac_secret falls back to legacy pepper (also empty here).
    with pytest.raises(ValueError):
        hash_code("123456", s)


def test_device_token_high_entropy_and_unique():
    tokens = {generate_device_token(32) for _ in range(1000)}
    assert len(tokens) == 1000
    for t in tokens:
        assert len(t) >= 32


def test_token_digest_is_hmac_keyed_by_secret():
    """Device-token digests must also be HMAC, keyed by the server secret."""
    s1 = _settings_with_secret("tok-secret-one")
    s2 = _settings_with_secret("tok-secret-two")
    t = generate_device_token(32)
    d1 = hash_token(t, s1)
    bare = hashlib.sha256(t.encode("utf-8")).hexdigest()
    assert d1 != bare, "token digest must be HMAC, not bare SHA-256"
    assert d1 != hash_token(t, s2)
    assert d1 == hmac.new(b"tok-secret-one", t.encode("utf-8"), hashlib.sha256).hexdigest()


def test_token_digest_roundtrip_and_constant_time():
    s = _settings_with_secret("roundtrip-tok-secret")
    t = generate_device_token(32)
    d = hash_token(t, s)
    assert d != t
    assert verify_token_digest(t, d, s)
    assert not verify_token_digest(t + "x", d, s)


def test_production_validation_rejects_insecure_defaults():
    """A production environment must not start with weak/dev defaults."""
    import os

    keys = ["ENVIRONMENT", "SECRET_KEY", "MAIL_PROVIDER", "DATABASE_URL"]
    saved = {k: os.environ.get(k) for k in keys}
    try:
        os.environ["ENVIRONMENT"] = "production"
        # dev secret, devtest mail, sqlite -> must fail
        os.environ["SECRET_KEY"] = "dev-insecure-secret-key-do-not-use-in-prod"
        os.environ["MAIL_PROVIDER"] = "devtest"
        os.environ["DATABASE_URL"] = "sqlite:///./x.db"
        s = Settings()
        with pytest.raises(RuntimeError) as ei:
            s.validate_for_production()
        msg = str(ei.value)
        assert "SECRET_KEY" in msg
        assert "devtest" in msg
        assert "PostgreSQL" in msg
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
