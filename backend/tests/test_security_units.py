"""Unit tests for low-level security helpers (no HTTP)."""

from __future__ import annotations

from app.config import Settings
from app.security import (
    generate_device_token,
    generate_email_code,
    hash_code,
    hash_token,
    verify_code_digest,
    verify_token_digest,
)


def test_email_code_is_six_digits():
    for _ in range(50):
        c = generate_email_code(6)
        assert len(c) == 6
        assert c.isdigit()


def test_code_digest_differs_from_plaintext():
    s = Settings()
    code = generate_email_code(6)
    d = hash_code(code, s)
    assert d != code
    assert code not in d


def test_code_digest_is_deterministic_with_pepper():
    s1 = Settings()  # default empty pepper
    code = "123456"
    d1 = hash_code(code, s1)
    assert verify_code_digest(code, d1, s1)
    assert not verify_code_digest("000000", d1, s1)


def test_device_token_high_entropy_and_unique():
    tokens = {generate_device_token(32) for _ in range(1000)}
    assert len(tokens) == 1000
    # URL-safe and reasonably long.
    for t in tokens:
        assert len(t) >= 32


def test_token_digest_roundtrip_and_constant_time():
    s = Settings()
    t = generate_device_token(32)
    d = hash_token(t, s)
    assert d != t
    assert verify_token_digest(t, d, s)
    assert not verify_token_digest(t + "x", d, s)
