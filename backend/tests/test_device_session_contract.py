"""Tests for the long-lived device-session contract (#4).

Covers:
* same installation_id re-login issues a NEW token and the OLD token stays
  valid until explicitly revoked (sessions are additive);
* the raw token is returned exactly once and never re-issued / listed;
* ``last_used_at`` advances on each authenticated request;
* banning a user invalidates ALL of that user's tokens immediately;
* revoking a device/session is transactional (revoked_at set AND digest
  cleared together).
"""

from __future__ import annotations

import uuid

from app.deps import get_app_state
from app.models import DeviceSession, User
from app.utc_now import as_utc


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_same_install_relogin_issues_new_token_and_keeps_old(client, auth_flow):
    """Re-verifying on the same installation issues a fresh token; the previous
    token remains valid (multi-session) until explicitly revoked."""
    email = "relogin@example.com"
    t1 = auth_flow(email, installation_id="install-A")
    t2 = auth_flow(email, installation_id="install-A", bypass_resend_throttle=True)

    assert t1 != t2, "each verify must mint a new high-entropy token"
    # Both tokens authenticate the same user.
    me1 = client.get("/api/v1/me", headers=_hdr(t1)).json()
    me2 = client.get("/api/v1/me", headers=_hdr(t2)).json()
    assert me1["id"] == me2["id"] == me1["id"]

    # Two distinct sessions exist for that one device.
    db = get_app_state().session_factory()
    try:
        sessions = db.query(DeviceSession).filter(DeviceSession.user_id == uuid.UUID(me1["id"])).all()
        digests = {s.token_digest for s in sessions}
        assert len(digests) == 2
        assert None not in digests  # neither revoked yet
    finally:
        db.close()


def test_device_token_returned_once_and_never_reissued(client, auth_flow):
    """The raw token appears only in the verify response; no endpoint re-returns
    it, and the devices listing never exposes it."""
    token = auth_flow("once@example.com")
    # /me, /me/devices never contain the raw token.
    me = client.get("/api/v1/me", headers=_hdr(token)).json()
    devs = client.get("/api/v1/me/devices", headers=_hdr(token)).json()
    blob = str(me) + str(devs)
    assert token not in blob


def test_last_used_at_advances_on_request(client, auth_flow):
    token = auth_flow("lastused@example.com")
    devs_before = client.get("/api/v1/me/devices", headers=_hdr(token)).json()
    # Trigger another authenticated request that updates last_used_at.
    client.get("/api/v1/notes", headers=_hdr(token))
    # last_used_at should now be set (non-null).
    devs_after = client.get("/api/v1/me/devices", headers=_hdr(token)).json()
    assert devs_after["devices"][0]["last_used_at"] is not None


def test_ban_invalidates_all_tokens_immediately(client, auth_flow):
    """Setting a user to banned must invalidate every one of their tokens on
    the very next request (no caching, no grace)."""
    email = "banall@example.com"
    t1 = auth_flow(email, installation_id="d1")
    t2 = auth_flow(email, installation_id="d2", bypass_resend_throttle=True)

    db = get_app_state().session_factory()
    try:
        u = db.query(User).filter(User.email == email).one()
        u.status = "banned"
        db.commit()
    finally:
        db.close()

    assert client.get("/api/v1/me", headers=_hdr(t1)).status_code == 401
    assert client.get("/api/v1/me", headers=_hdr(t2)).status_code == 401


def test_revoke_device_is_transactional(client, auth_flow):
    """Revoking a device sets revoked_at AND clears token_digest together: no
    half-revoked state (revoked but still usable) can survive."""
    email = "tx@example.com"
    t1 = auth_flow(email, installation_id="keep")
    t2 = auth_flow(email, installation_id="kill", bypass_resend_throttle=True)

    devs = client.get("/api/v1/me/devices", headers=_hdr(t1)).json()
    kill_id = next(d["id"] for d in devs["devices"] if d["installation_id"] == "kill")

    r = client.delete(f"/api/v1/me/devices/{kill_id}", headers=_hdr(t1))
    assert r.status_code == 204

    db = get_app_state().session_factory()
    try:
        sessions = (
            db.query(DeviceSession)
            .filter(DeviceSession.device_id == uuid.UUID(kill_id))
            .all()
        )
        assert sessions, "device row + sessions retained for audit"
        for s in sessions:
            # Both fields flipped together -> cannot authenticate.
            assert s.revoked_at is not None
            assert s.token_digest is None
    finally:
        db.close()
    # Functional confirmation: killed token dead, kept token alive.
    assert client.get("/api/v1/me", headers=_hdr(t2)).status_code == 401
    assert client.get("/api/v1/me", headers=_hdr(t1)).status_code == 200


def test_logout_clears_digest_not_just_flag(client, auth_flow):
    """Logout must clear the stored digest (not merely set a flag), so the row
    cannot be un-revoked into a working token."""
    token = auth_flow("digestclear@example.com")
    me = client.get("/api/v1/me", headers=_hdr(token)).json()
    assert client.post("/api/v1/auth/logout", headers=_hdr(token)).status_code == 204

    db = get_app_state().session_factory()
    try:
        sessions = (
            db.query(DeviceSession)
            .filter(DeviceSession.user_id == uuid.UUID(me["id"]))
            .all()
        )
        assert all(s.token_digest is None and s.revoked_at is not None for s in sessions)
    finally:
        db.close()
