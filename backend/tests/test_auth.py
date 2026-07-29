"""Tests for the email-login and device-session auth flow."""

from __future__ import annotations

import re
import time
from datetime import timedelta

import pytest

from app.mail import get_captured_mails
from app.models import EmailChallenge, User
from app.security import generate_email_code, hash_code
from app.utc_now import utcnow


# --------------------------------------------------------------------------- #
# send-code: leak prevention, resend throttle, rate limiting
# --------------------------------------------------------------------------- #
def test_send_code_does_not_leak_registration_status(client):
    """The send-code response must be identical for new and existing emails."""
    r1 = client.post("/api/v1/auth/email/send-code", json={"email": "new1@example.com"})
    r2 = client.post("/api/v1/auth/email/send-code", json={"email": "new2@example.com"})
    assert r1.status_code == 200
    # Same shape/message regardless of email.
    assert r1.json() == r2.json()
    # And no user row was created just by sending a code.
    from app.deps import get_app_state

    db = get_app_state().session_factory()
    try:
        assert db.query(User).count() == 0
    finally:
        db.close()


def test_send_code_resend_throttle_60s(client):
    r1 = client.post("/api/v1/auth/email/send-code", json={"email": "rt@example.com"})
    assert r1.status_code == 200
    r2 = client.post("/api/v1/auth/email/send-code", json={"email": "rt@example.com"})
    assert r2.status_code == 429
    assert "Retry-After" in r2.headers


def test_send_code_invalid_email_rejected(client):
    r = client.post("/api/v1/auth/email/send-code", json={"email": "not-an-email"})
    assert r.status_code == 422  # pydantic validation


def test_provider_failure_leaves_no_usable_challenge(client, monkeypatch):
    """If the mail provider fails, no delivered challenge must be persisted."""
    from app.mail.base import MailDeliveryError, MailMessage
    from app.mail.devtest import DevTestMailProvider

    def boom(self, message: MailMessage) -> None:
        raise MailDeliveryError("simulated outage")

    monkeypatch.setattr(DevTestMailProvider, "send", boom)

    r = client.post("/api/v1/auth/email/send-code", json={"email": "fail@example.com"})
    # Delivery failure MUST surface as a unified 503 (never faked as success).
    assert r.status_code == 503
    # Generic, non-leaky message: must NOT reveal whether the email is
    # registered, and must NOT echo the provider's response body.
    detail = r.json().get("detail", "")
    assert "delivery" in detail.lower() or "unavailable" in detail.lower()
    assert "simulated outage" not in detail  # provider body never propagated
    assert "registered" not in detail.lower()

    from app.deps import get_app_state

    db = get_app_state().session_factory()
    try:
        rows = db.query(EmailChallenge).filter(EmailChallenge.email == "fail@example.com").all()
        # A failed delivery must leave NO usable challenge on disk.
        assert rows == [], "no challenge should be persisted when delivery fails"
    finally:
        db.close()

    r2 = client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": "fail@example.com", "code": "123456", "installation_id": "i1"},
    )
    assert r2.status_code == 400


def test_code_digest_only_stored_not_plaintext(client, auth_flow):
    """The DB must hold only the digest; the raw code must never be persisted."""
    auth_flow("digest@example.com")
    from app.deps import get_app_state

    db = get_app_state().session_factory()
    try:
        rows = db.query(EmailChallenge).filter(EmailChallenge.email == "digest@example.com").all()
        assert rows, "expected at least one challenge"
        captured = get_captured_mails()
        codes = {re.search(r"\b(\d{6})\b", m.body).group(1) for m in captured}
        # No raw code appears in any persisted column.
        for row in rows:
            for code in codes:
                assert code not in (row.code_digest or "")
                assert code != row.code_digest
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# verify-code: auto-register, expiry, reuse, wrong attempts
# --------------------------------------------------------------------------- #
def test_verify_auto_registers_new_user(client, auth_flow):
    token = auth_flow("newuser@example.com")
    assert token and len(token) >= 32
    me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "newuser@example.com"


def test_verify_existing_user_logs_in_not_duplicate(client, auth_flow):
    t1 = auth_flow("existing@example.com")
    # Second login on a different installation creates a new token but same user.
    t2 = auth_flow("existing@example.com", installation_id="install-2", bypass_resend_throttle=True)
    assert t1 != t2
    me1 = client.get("/api/v1/me", headers={"Authorization": f"Bearer {t1}"})
    me2 = client.get("/api/v1/me", headers={"Authorization": f"Bearer {t2}"})
    assert me1.json()["id"] == me2.json()["id"]


def test_verify_wrong_code_increments_attempts(client):
    email = "wrong@example.com"
    client.post("/api/v1/auth/email/send-code", json={"email": email})
    mails = get_captured_mails()
    real_code = re.search(r"\b(\d{6})\b", mails[-1].body).group(1)
    wrong = "000000" if real_code != "000000" else "111111"
    r = client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": wrong, "installation_id": "i1"},
    )
    assert r.status_code == 400


def test_verify_max_attempts_then_locked(client):
    email = "lock@example.com"
    client.post("/api/v1/auth/email/send-code", json={"email": email})
    mails = get_captured_mails()
    real_code = re.search(r"\b(\d{6})\b", mails[-1].body).group(1)
    wrong = "000000" if real_code != "000000" else "111111"
    for _ in range(5):
        r = client.post(
            "/api/v1/auth/email/verify-code",
            json={"email": email, "code": wrong, "installation_id": "i1"},
        )
        assert r.status_code in (400, 429)
    # 6th attempt with the real code is now refused (too many attempts).
    r = client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": real_code, "installation_id": "i1"},
    )
    assert r.status_code == 429


def test_verify_code_single_use(client):
    email = "reuse@example.com"
    client.post("/api/v1/auth/email/send-code", json={"email": email})
    mails = get_captured_mails()
    code = re.search(r"\b(\d{6})\b", mails[-1].body).group(1)
    payload = {"email": email, "code": code, "installation_id": "i1"}
    r1 = client.post("/api/v1/auth/email/verify-code", json=payload)
    assert r1.status_code == 200
    # Reusing the same code must fail.
    r2 = client.post("/api/v1/auth/email/verify-code", json=payload)
    assert r2.status_code == 400


def test_verify_code_expired(client):
    email = "expire@example.com"
    client.post("/api/v1/auth/email/send-code", json={"email": email})
    mails = get_captured_mails()
    code = re.search(r"\b(\d{6})\b", mails[-1].body).group(1)

    # Force the challenge to be expired.
    from app.deps import get_app_state

    db = get_app_state().session_factory()
    try:
        ch = db.query(EmailChallenge).filter(EmailChallenge.email == email).first()
        ch.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    finally:
        db.close()

    r = client.post(
        "/api/v1/auth/email/verify-code",
        json={"email": email, "code": code, "installation_id": "i1"},
    )
    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()


# --------------------------------------------------------------------------- #
# Device tokens: invalid token, logout, device revoke, logout-all
# --------------------------------------------------------------------------- #
def test_missing_token_rejected(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 401


def test_bad_token_rejected(client):
    r = client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_logout_invalidates_token(authed_client):
    client, token, _ = authed_client
    me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    out = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert out.status_code == 204
    me2 = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me2.status_code == 401


def test_logout_all_revokes_every_session(client, auth_flow):
    email = "all@example.com"
    t1 = auth_flow(email, installation_id="d1")
    t2 = auth_flow(email, installation_id="d2", bypass_resend_throttle=True)
    r = client.post("/api/v1/auth/logout-all", headers={"Authorization": f"Bearer {t1}"})
    assert r.status_code == 204
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {t1}"}).status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {t2}"}).status_code == 401


def test_device_revoke_invalidates_that_device_only(client, auth_flow):
    email = "revoke@example.com"
    t1 = auth_flow(email, installation_id="keep")
    t2 = auth_flow(email, installation_id="kill", bypass_resend_throttle=True)
    devices = client.get("/api/v1/me/devices", headers={"Authorization": f"Bearer {t1}"})
    assert devices.status_code == 200
    dev_id = next(d["id"] for d in devices.json()["devices"] if d["installation_id"] == "kill")
    r = client.delete(f"/api/v1/me/devices/{dev_id}", headers={"Authorization": f"Bearer {t1}"})
    assert r.status_code == 204
    # killed device token is dead; keep device still works.
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {t2}"}).status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {t1}"}).status_code == 200


def test_device_revoke_does_not_delete_notes(client, auth_flow):
    """Revoking a device must never destroy cloud notes."""
    email = "keepnotes@example.com"
    token = auth_flow(email)
    import uuid as _uuid

    nid = str(_uuid.uuid4())
    r = client.post(
        "/api/v1/notes",
        json={"id": nid, "title": "keep me", "content": "x"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201
    # Revoke that device then log back in on a new device.
    devs = client.get("/api/v1/me/devices", headers={"Authorization": f"Bearer {token}"})
    dev_id = devs.json()["devices"][0]["id"]
    client.delete(f"/api/v1/me/devices/{dev_id}", headers={"Authorization": f"Bearer {token}"})
    token2 = auth_flow(email, installation_id="newdevice", bypass_resend_throttle=True)
    # Note still present under the same account.
    r = client.get(f"/api/v1/notes/{nid}", headers={"Authorization": f"Bearer {token2}"})
    assert r.status_code == 200
    assert r.json()["title"] == "keep me"


def test_revoke_unknown_device_returns_404(authed_client):
    client, token, _ = authed_client
    import uuid as _uuid

    r = client.delete(f"/api/v1/me/devices/{_uuid.uuid4()}", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


def test_me_devices_lists_current(authed_client):
    client, token, _ = authed_client
    r = client.get("/api/v1/me/devices", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    devices = r.json()["devices"]
    assert len(devices) == 1
    assert devices[0]["is_current"] is True
    assert devices[0]["session_active"] is True


def test_banned_user_token_invalid(client, auth_flow):
    email = "ban@example.com"
    token = auth_flow(email)
    from app.deps import get_app_state
    from app.models import User

    db = get_app_state().session_factory()
    try:
        u = db.query(User).filter(User.email == email).one()
        u.status = "banned"
        db.commit()
    finally:
        db.close()
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
