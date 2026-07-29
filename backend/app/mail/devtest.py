"""Development/test mail provider.

Captures sent messages into a module-level list so tests can assert on them
(e.g. read the generated code) without any network. Also writes the code to
stdout in a clearly-marked line, so a developer running locally can copy it.

This is deliberately a process-global store: fine for tests, never used in
production.
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


class DevTestMailProvider(MailProvider):
    name = "devtest"

    def send(self, message: MailMessage) -> None:
        if not message.to:
            raise MailDeliveryError("missing recipient")
        with _LOCK:
            _CAPTURED.append(message)
        # Print a safe dev line. We only surface the code here because this is
        # a local-only provider; production providers never log it.
        print(f"[devtest-mail] to={message.to} subject={message.subject}", flush=True)
