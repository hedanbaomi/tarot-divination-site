"""Logging setup.

We redact anything that looks like a bearer token or an authorization header so
that device tokens, codes and mail secrets can never leak into logs by accident.
"""

from __future__ import annotations

import logging
import re
from typing import Any

# Matches our URL-safe device tokens (long base64url strings) and typical API
# keys. Intentionally broad; better to over-redact than leak.
_TOKEN_RE = re.compile(r"(?i)(bearer\s+)?[A-Za-z0-9_-]{20,}")


class RedactingFilter(logging.Filter):
    """Replace suspiciously-long secret-like substrings with ``[REDACTED]``."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = _TOKEN_RE.sub("[REDACTED]", record.msg)
            if record.args:
                record.args = tuple(
                    _TOKEN_RE.sub("[REDACTED]", str(a)) if isinstance(a, str) else a
                    for a in (record.args if isinstance(record.args, tuple) else (record.args,))
                )
        except Exception:  # pragma: no cover - never let logging crash a request
            pass
        return True


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    handler.addFilter(RedactingFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # Quiet noisy libraries; SQL logging is off by default (also avoids ever
    # leaking token digests or codes in bound parameters).
    for noisy in ("uvicorn.access", "sqlalchemy.engine", "httpx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
