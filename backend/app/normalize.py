"""Small domain helpers shared across services."""

from __future__ import annotations

import re

# Pragmatic email normalisation: lowercase and strip whitespace. We do not try
# to rewrite the full RFC grammar; uniqueness is enforced by the DB constraint
# on the normalised value, which is what matters for account identity.
_WS_RE = re.compile(r"\s+")


def normalize_email(email: str) -> str:
    """Return a canonical form of ``email`` for storage and comparison."""
    if email is None:
        raise ValueError("email is required")
    cleaned = _WS_RE.sub("", email.strip()).lower()
    if not cleaned or "@" not in cleaned:
        raise ValueError("invalid email")
    return cleaned


def client_ip(request) -> str:
    """Best-effort client IP for rate limiting, behind a proxy or not."""
    # Prefer the left-most value of X-Forwarded-For when present (common when
    # behind a trusted reverse proxy). Falls back to the direct client.
    xff = request.headers.get("x-forwarded-for") if request else None
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    if request is None or request.client is None:
        return "unknown"
    return request.client.host or "unknown"
