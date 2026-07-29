"""Mail delivery abstraction.

A single ``MailProvider`` interface plus three adapters:

* ``DevTestMailProvider`` — captures messages in memory for tests/dev. Never
  prints or logs the code, and is refused in production.
* ``ResendMailProvider`` — POSTs to the Resend HTTP API.
* ``SMTPMailProvider`` — sends via SMTP using ``smtplib``.

The provider is chosen by the ``MAIL_PROVIDER`` env var. If the configured
provider fails to deliver, the auth service returns a unified 503 (see
``AuthService.send_code``) and never persists a usable challenge for a code the
user did not receive.
"""

from .base import MailDeliveryError, MailMessage, MailProvider
from .devtest import (
    DevTestMailProvider,
    get_captured_mails,
    last_captured_mail_to,
    reset_captured_mails,
)
from .factory import UnsafeProviderError, build_mail_provider

__all__ = [
    "MailDeliveryError",
    "MailMessage",
    "MailProvider",
    "DevTestMailProvider",
    "UnsafeProviderError",
    "build_mail_provider",
    "get_captured_mails",
    "last_captured_mail_to",
    "reset_captured_mails",
]
