"""Shared pytest fixtures for the backend tests.

Each test function gets a fresh in-memory SQLite database (shared across the
connection pool via StaticPool) and a fresh app instance with the devtest mail
provider. Captured mails and the rate limiter are reset between tests.
"""

from __future__ import annotations

import re
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Base, build_engine
from app.deps import configure_state
from app.mail import reset_captured_mails
from app.main import create_app
from app.ratelimit import reset_limiter


@pytest.fixture()
def settings() -> Settings:
    # In-memory DB, tables created on startup, devtest mail, notes enabled.
    return Settings()


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    reset_captured_mails()
    reset_limiter()
    app = create_app(settings)
    with TestClient(app) as c:
        yield c
    # Tear down engine.
    from app.deps import get_app_state

    state = get_app_state()
    if state.engine is not None:
        state.engine.dispose()


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
@pytest.fixture()
def auth_flow(client):
    """Return helpers to drive the email login flow end-to-end."""

    def _login(email: str, installation_id: str = "install-1", device_name: str | None = "Pixel 8", platform: str | None = "android", bypass_resend_throttle: bool = False) -> str:
        from app.mail import get_captured_mails

        if bypass_resend_throttle:
            # Re-using the same email within 60s is normally throttled. For
            # legitimate multi-device flows in tests we back-date the last
            # challenge so a new code can be issued.
            _backdate_last_challenge(email, seconds=120)

        r = client.post("/api/v1/auth/email/send-code", json={"email": email})
        assert r.status_code == 200, r.text
        mails = get_captured_mails()
        assert mails, "no mail captured"
        m = re.search(r"\b(\d{6})\b", mails[-1].body)
        assert m, f"no code in mail body: {mails[-1].body!r}"
        code = m.group(1)
        r = client.post(
            "/api/v1/auth/email/verify-code",
            json={
                "email": email,
                "code": code,
                "installation_id": installation_id,
                "device_name": device_name,
                "platform": platform,
            },
        )
        assert r.status_code == 200, r.text
        return r.json()["device_token"]

    def _backdate_last_challenge(email: str, seconds: int) -> None:
        from datetime import timedelta

        from app.deps import get_app_state
        from app.models import EmailChallenge
        from app.utc_now import utcnow

        db = get_app_state().session_factory()
        try:
            ch = (
                db.query(EmailChallenge)
                .filter(EmailChallenge.email == email)
                .order_by(EmailChallenge.created_at.desc())
                .first()
            )
            if ch is not None:
                ch.created_at = utcnow() - timedelta(seconds=seconds)
                db.commit()
        finally:
            db.close()

    return _login


@pytest.fixture()
def authed_client(client, auth_flow):
    """A (client, token, email) triple for an authenticated user."""

    email = "alice@example.com"
    token = auth_flow(email)
    return client, token, email
