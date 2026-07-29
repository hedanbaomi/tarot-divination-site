"""Mail provider factory chosen by ``MAIL_PROVIDER``.

``devtest`` is refused in production: it cannot deliver real mail and only
captures messages in memory. This is a second line of defence alongside
``Settings.validate_for_production`` (checked at startup), so a provider built
later (e.g. in a background task) cannot bypass the startup gate.
"""

from __future__ import annotations

from ..config import Settings
from .base import MailDeliveryError, MailProvider
from .devtest import DevTestMailProvider
from .resend import ResendMailProvider
from .smtp import SMTPMailProvider


class UnsafeProviderError(MailDeliveryError):
    """Raised when a provider is requested in an environment where it is unsafe."""


def build_mail_provider(settings: Settings) -> MailProvider:
    name = (settings.mail_provider or "devtest").lower()
    if name == "devtest":
        if settings.is_production:
            raise UnsafeProviderError(
                "MAIL_PROVIDER=devtest is not allowed in production"
            )
        return DevTestMailProvider()
    if name == "resend":
        return ResendMailProvider(settings)
    if name == "smtp":
        return SMTPMailProvider(settings)
    raise MailDeliveryError(f"unknown MAIL_PROVIDER: {name!r}")
