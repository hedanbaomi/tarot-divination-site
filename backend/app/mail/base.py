"""Mail provider interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class MailMessage:
    to: str
    subject: str
    body: str
    # Optional pre-rendered HTML body. Backend stays text-focused; HTML is only
    # used if the provider wants to render it.
    html: str | None = None


class MailDeliveryError(Exception):
    """Raised when a provider fails to deliver a message."""


class MailProvider(ABC):
    """Strategy interface for sending mail."""

    name: str = "base"

    @abstractmethod
    def send(self, message: MailMessage) -> None:
        """Send ``message`` or raise ``MailDeliveryError``."""
        raise NotImplementedError
