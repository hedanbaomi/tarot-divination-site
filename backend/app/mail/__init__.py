"""Mail delivery abstraction.

A single ``MailProvider`` interface plus three adapters:

* ``DevTestMailProvider`` — captures the last message(s) in memory and is used by
  tests and local dev. It never sends anything to the network.
* ``ResendMailProvider`` — POSTs to the Resend HTTP API.
* ``SMTPMailProvider`` — sends via SMTP using ``smtplib``.

The provider is chosen by the ``MAIL_PROVIDER`` env var. If the configured
provider fails to send, ``send_verification_email`` raises ``MailDeliveryError``
so the caller never persists a usable challenge state for a code the user did
not receive.
"""

from .base import MailDeliveryError, MailMessage, MailProvider
from .devtest import DevTestMailProvider, get_captured_mails, reset_captured_mails
from .factory import build_mail_provider

__all__ = [
    "MailDeliveryError",
    "MailMessage",
    "MailProvider",
    "DevTestMailProvider",
    "build_mail_provider",
    "get_captured_mails",
    "reset_captured_mails",
]
