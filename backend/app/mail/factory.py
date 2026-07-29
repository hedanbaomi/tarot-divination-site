"""Mail provider factory chosen by ``MAIL_PROVIDER``."""

from __future__ import annotations

from ..config import Settings
from .base import MailDeliveryError, MailProvider
from .devtest import DevTestMailProvider
from .resend import ResendMailProvider
from .smtp import SMTPMailProvider


def build_mail_provider(settings: Settings) -> MailProvider:
    name = (settings.mail_provider or "devtest").lower()
    if name == "devtest":
        return DevTestMailProvider()
    if name == "resend":
        return ResendMailProvider(settings)
    if name == "smtp":
        return SMTPMailProvider(settings)
    raise MailDeliveryError(f"unknown MAIL_PROVIDER: {name!r}")
