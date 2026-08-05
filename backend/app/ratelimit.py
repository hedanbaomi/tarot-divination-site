"""Simple in-memory rate limiting for send-code.

We count sends per key (email normalised, or client IP) inside a sliding window.
Counts live in a process-local dict — sufficient for a single-instance dev/test
server and for the test suite. For multi-instance production you would back
this with Redis; the interface here (``RateLimiter``) is the seam to swap in.

This module never logs request bodies, codes or tokens.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass


@dataclass
class _Entry:
    timestamp: float


class RateLimiter:
    """Sliding-window counter, keyed by an opaque string."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: dict[str, deque[_Entry]] = defaultdict(deque)

    def _prune(self, key: str, now: float, window: int) -> None:
        q = self._buckets[key]
        cutoff = now - window
        while q and q[0].timestamp < cutoff:
            q.popleft()
        if not q:
            self._buckets.pop(key, None)

    def count(self, key: str, window_seconds: int) -> int:
        now = time.time()
        with self._lock:
            self._prune(key, now, window_seconds)
            return len(self._buckets.get(key, deque()))

    def record(self, key: str) -> None:
        now = time.time()
        with self._lock:
            self._buckets[key].append(_Entry(now))

    def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        if self.count(key, window_seconds) >= limit:
            return False
        return True


# Process-global limiter used by the app. Tests can reset via ``reset()``.
_LIMITER = RateLimiter()


def get_limiter() -> RateLimiter:
    return _LIMITER


def reset_limiter() -> None:
    """Clear all buckets (tests only)."""
    with _LIMITER._lock:
        _LIMITER._buckets.clear()
