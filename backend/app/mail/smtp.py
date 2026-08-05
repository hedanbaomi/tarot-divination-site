"""SMTP adapter using the standard-library ``smtplib``."""

from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage

from ..config import Settings
from .base import MailDeliveryError, MailMessage, MailProvider


class SMTPMailProvider(MailProvider):
    name = "smtp"

    def __init__(self, settings: Settings):
        self._settings = settings
        if not settings.smtp_host:
            raise MailDeliveryError("SMTP_HOST is not configured")

    def send(self, message: MailMessage) -> None:
        msg = EmailMessage()
        sender = (
            f"{self._settings.mail_from_name} <{self._settings.mail_from_address}>"
            if self._settings.mail_from_name
            else self._settings.mail_from_address
        )
        msg["From"] = sender
        msg["To"] = message.to
        msg["Subject"] = message.subject
        msg.set_content(message.body)
        if message.html:
            msg.add_alternative(message.html, subtype="html")

        try:
            if self._settings.smtp_use_ssl:
                ctx = ssl.create_default_context()
                with smtplib.SMTP_SSL(  # pragma: no cover - network
                    self._settings.smtp_host, self._settings.smtp_port, context=ctx, timeout=15
                ) as server:
                    self._login(server)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(  # pragma: no cover - network
                    self._settings.smtp_host, self._settings.smtp_port, timeout=15
                ) as server:
                    if self._settings.smtp_use_tls:
                        server.starttls(context=ssl.create_default_context())
                    self._login(server)
                    server.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:  # pragma: no cover - network
            raise MailDeliveryError(f"smtp send failed: {exc}") from exc

    def _login(self, server: smtplib.SMTP) -> None:  # pragma: no cover - network
        if self._settings.smtp_username:
            server.login(self._settings.smtp_username, self._settings.smtp_password)
