"""Resend (https://resend.com) HTTP API adapter.

Uses the standard library ``urllib`` to avoid adding an HTTP dependency just
for mail. The Resend API key is read from settings (env ``RESEND_API_KEY``).
"""

from __future__ import annotations

import json
from urllib import error, request

from ..config import Settings
from .base import MailDeliveryError, MailMessage, MailProvider


class ResendMailProvider(MailProvider):
    name = "resend"

    def __init__(self, settings: Settings):
        self._settings = settings
        if not settings.resend_api_key:
            raise MailDeliveryError("RESEND_API_KEY is not configured")

    def send(self, message: MailMessage) -> None:
        payload = {
            "from": (
                f"{self._settings.mail_from_name} <{self._settings.mail_from_address}>"
                if self._settings.mail_from_name
                else self._settings.mail_from_address
            ),
            "to": [message.to],
            "subject": message.subject,
            "text": message.body,
        }
        if message.html:
            payload["html"] = message.html

        data = json.dumps(payload).encode("utf-8")
        req = request.Request(
            self._settings.resend_api_url,
            data=data,
            headers={
                "Authorization": f"Bearer {self._settings.resend_api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=15) as resp:  # pragma: no cover - network
                if resp.status >= 400:
                    raise MailDeliveryError(f"resend HTTP {resp.status}")
        except error.URLError as exc:  # pragma: no cover - network
            raise MailDeliveryError(f"resend request failed: {exc}") from exc
