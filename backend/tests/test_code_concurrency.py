"""Tests for verification-code concurrency semantics (#5).

* a newly delivered code invalidates all earlier challenges for that email;
* only the latest, unconsumed, unexpired challenge is verifiable;
* an old code (from a superseded challenge) cannot verify even if still within
  its original TTL;
* these hold under a re-send race equivalent (back-dated to bypass the 60s
  throttle, mimicking concurrent requests).
"""

from __future__ import annotations

import re
from datetime import timedelta

from app.deps import get_app_state
from app.mail import get_captured_mails
from app.models import EmailChallenge
from app.utc_now import utcnow


def _send_and_get_code(client, email: str) -> str:
    r = client.post("/api/v1/auth/email/send-code", json={"email": email})
    assert r.status_code == 200, r.text
    mails = get_captured_mails()
    return re.search(r"\b(\d{6})\b", mails[-1].body).group(1)


def _backdate_latest_challenge(email: str, seconds: int) -> None:
    """Back-date the most recent challenge so a new send clears the 60s throttle
    (equivalent to two requests arriving ~2 minutes apart, or a re-send race)."""
    db = get_app_state().session_factory()
    try:
        ch = (
            db.query(EmailChallenge)
            .filter(EmailChallenge.email == email)
            .order_by(EmailChallenge.created_at.desc())
            .first()
        )
        ch.created_at = utcnow() - timedelta(seconds=seconds)
        db.commit()
    finally:
        db.close()


def test_new_code_invalidates_old_challenges(client):
    email = "supersede@example.com"
    old_code = _send_and_get_code(client, email)
    # Back-date so the 60s resend throttle lets us issue a new one.
    _backdate_latest_challenge(email, 120)
    new_code = _send_and_get_code(client, email)
    assert old_code != new_code

    # The OLD code must no longer verify (its challenge was consumed/invalidated).
    r_old = client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": old_code, "installation_id": "i1"},
    )
    assert r_old.status_code == 400, "superseded code must not verify"

    # The NEW code verifies.
    r_new = client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": new_code, "installation_id": "i1"},
    )
    assert r_new.status_code == 200


def test_only_latest_challenge_is_verifiable(client):
    """Even with several outstanding challenges, only the newest one verifies."""
    email = "latest@example.com"
    codes = []
    for i in range(3):
        if i > 0:
            _backdate_latest_challenge(email, 120)
        codes.append(_send_and_get_code(client, email))

    # All but the last must fail.
    for stale in codes[:-1]:
        r = client.post(
            "/api/v1/auth/email/verify-code",
            json={"email": email, "code": stale, "installation_id": "i1"},
        )
        assert r.status_code == 400
    # The latest succeeds.
    r = client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": codes[-1], "installation_id": "i1"},
    )
    assert r.status_code == 200


def test_in_flight_concurrent_send_only_one_latest_wins(client):
    """Simulate two near-simultaneous sends (back-dated to clear throttle).

    After both land, only the chronologically-last code verifies; the earlier
    one is invalidated even though it was never used and had not expired.
    """
    email = "race@example.com"
    c1 = _send_and_get_code(client, email)
    _backdate_latest_challenge(email, 120)
    c2 = _send_and_get_code(client, email)
    # c1 is now superseded.
    assert client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": c1, "installation_id": "i1"},
    ).status_code == 400
    assert client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": c2, "installation_id": "i1"},
    ).status_code == 200


def test_old_challenge_marked_consumed_after_supersede(client):
    """The supersede path marks earlier unconsumed challenges as consumed."""
    email = "marked@example.com"
    _send_and_get_code(client, email)
    _backdate_latest_challenge(email, 120)
    _send_and_get_code(client, email)

    db = get_app_state().session_factory()
    try:
        rows = (
            db.query(EmailChallenge)
            .filter(EmailChallenge.email == email)
            .order_by(EmailChallenge.created_at.asc())
            .all()
        )
        # The oldest must be consumed; the newest must NOT be consumed yet.
        assert rows[0].consumed_at is not None
        assert rows[-1].consumed_at is None
    finally:
        db.close()
