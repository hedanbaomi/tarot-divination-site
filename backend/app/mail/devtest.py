"""Development/test mail provider.

Captures sent messages into a thread/process-safe in-memory store so tests can
read the generated code (via ``get_captured_mails``) WITHOUT any network and
WITHOUT printing the plaintext code anywhere.

Security contract
-----------------
* This provider **never** writes the verification code (or any message body) to
  stdout, stderr, or logs. Previously it printed a line to stdout; that is
  removed because a code in a log defeats the whole "digest only" design.
* It is **dev/test only**. ``build_mail_provider`` refuses to construct it when
  ``ENVIRONMENT`` is prod/production (see ``factory.py``), and the app startup
  also fails fast via ``Settings.validate_for_production``.
"""

from __future__ import annotations

import threading
from typing import List

from .base import MailDeliveryError, MailMessage, MailProvider

_LOCK = threading.Lock()
_CAPTURED: List[MailMessage] = []


def reset_captured_mails() -> None:
    """Clear captured messages (used by tests between cases)."""
    with _LOCK:
        _CAPTURED.clear()


def get_captured_mails() -> List[MailMessage]:
    """Return a snapshot copy of all captured messages, oldest first."""
    with _LOCK:
        return list(_CAPTURED)


def last_captured_mail_to(email: str) -> MailMessage | None:
    """Return the most recent captured message addressed to ``email``, or None."""
    with _LOCK:
        for m in reversed(_CAPTURED):
            if m.to == email:
                return m
    return None


class DevTestMailProvider(MailProvider):
    name = "devtest"

    def send(self, message: MailMessage) -> None:
        if not message.to:
            raise MailDeliveryError("missing recipient")
        # Capture in memory only. Do NOT print/log the body: the body contains
        # the plaintext verification code, which must never reach a log stream.
        with _LOCK:
            _CAPTURED.append(message)
