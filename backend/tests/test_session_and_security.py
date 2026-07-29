"""Tests for session persistence across restarts and security invariants."""

from __future__ import annotations

import re

from app.config import Settings
from app.db import Base, build_engine
from app.deps import configure_state, get_app_state
from app.mail import reset_captured_mails
from app.main import create_app
from app.ratelimit import reset_limiter


def _file_settings(path: str) -> Settings:
    """Settings pointing at a file-based SQLite so data survives re-creating
    the engine (simulating a server restart)."""
    import os

    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    os.environ["CREATE_TABLES_ON_STARTUP"] = "true"
    os.environ["MAIL_PROVIDER"] = "devtest"
    s = Settings()
    return s


def test_session_survives_simulated_restart(tmp_path):
    """A device token minted in one app instance must still work after we tear
    the engine down and rebuild it (i.e. a process restart with the same DB)."""
    db_file = str(tmp_path / "restart.db")
    reset_captured_mails()
    reset_limiter()

    # First "instance": log in and get a token.
    from fastapi.testclient import TestClient

    app1 = create_app(_file_settings(db_file))
    with TestClient(app1) as c:
        r = c.post("/api/v1/auth/email/send-code", json={"email": "persist@example.com"})
        assert r.status_code == 200
        from app.mail import get_captured_mails

        code = re.search(r"\b(\d{6})\b", get_captured_mails()[-1].body).group(1)
        r = c.post(
            "/api/v1/auth/email/verify-code",
            json={"email": "persist@example.com", "code": code, "installation_id": "i1"},
        )
        token = r.json()["device_token"]
    app1_state = get_app_state()
    if app1_state.engine is not None:
        app1_state.engine.dispose()

    # Second "instance": same DB file, fresh engine/app. Token must still auth.
    reset_captured_mails()
    reset_limiter()
    app2 = create_app(_file_settings(db_file))
    with TestClient(app2) as c:
        r = c.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == "persist@example.com"
    app2_state = get_app_state()
    if app2_state.engine is not None:
        app2_state.engine.dispose()


def test_token_not_logged(client, auth_flow, capsys):
    """Raw device tokens must never appear in stdout/stderr logs."""
    token = auth_flow("nolog@example.com")
    captured = capsys.readouterr()
    assert token not in captured.out
    assert token not in captured.err


def test_authorization_header_not_logged(client, auth_flow, capsys):
    token = auth_flow("nologhdr@example.com")
    # Hit an endpoint to exercise logging paths.
    client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    client.get("/api/v1/notes", headers={"Authorization": f"Bearer {token}"})
    captured = capsys.readouterr()
    assert token not in captured.out
    assert token not in captured.err


def test_verification_code_not_printed_or_logged(client, capsys):
    """The devtest provider must NEVER write the plaintext code to stdout,
    stderr, or any log handler. The code is only reachable via the in-memory
    capture (which tests use), never a log stream."""
    import logging
    import re as _re

    records: list[str] = []

    class _Sink(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    sink = _Sink()
    sink.setLevel(logging.DEBUG)
    root = logging.getLogger()
    root.addHandler(sink)
    try:
        r = client.post("/api/v1/auth/email/send-code", json={"email": "nocode@example.com"})
        assert r.status_code == 200
        captured = capsys.readouterr()
        # Pull the real code from the in-memory capture only.
        from app.mail import get_captured_mails

        code = _re.search(r"\b(\d{6})\b", get_captured_mails()[-1].body).group(1)
        # Not in stdout/stderr...
        assert code not in captured.out
        assert code not in captured.err
        # ...and not in any log record.
        for msg in records:
            assert code not in msg
    finally:
        root.removeHandler(sink)


def test_mail_secrets_not_logged(client, capsys, monkeypatch):
    """A mail provider secret must never appear in logs. We simulate a Resend
    key in the environment and assert it never leaks to stdout/stderr/log."""
    import logging

    secret = "re_SUPERSECRET_LEAK_CHECK_12345"
    monkeypatch.setenv("RESEND_API_KEY", secret)
    # The dev app uses devtest provider; the point is the secret is in env but
    # never logged anywhere by our code.
    records: list[str] = []

    class _Sink(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    sink = _Sink()
    sink.setLevel(logging.DEBUG)
    root = logging.getLogger()
    root.addHandler(sink)
    try:
        client.get("/health")
        captured = capsys.readouterr()
        assert secret not in captured.out
        assert secret not in captured.err
        for msg in records:
            assert secret not in msg
    finally:
        root.removeHandler(sink)


def test_notes_can_be_disabled_via_entitlement(client, auth_flow):
    """When the per-user entitlement denies access, notes endpoints return 403.

    The entitlement is a replaceable service; injecting a deny-all impl proves
    business code consults it (rather than a hard-coded flag).
    """
    token = auth_flow("ent@example.com")
    from app.deps import set_entitlement_service
    from app.services.notes import DenyAllEntitlementService

    set_entitlement_service(DenyAllEntitlementService())
    try:
        import uuid as _uuid

        r = client.post(
            "/api/v1/notes",
            json={"id": str(_uuid.uuid4()), "title": "x"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403
        # Every notes endpoint is gated, not just create.
        r2 = client.get("/api/v1/notes", headers={"Authorization": f"Bearer {token}"})
        assert r2.status_code == 403
    finally:
        # Restore the default (allow-all in tests).
        from app.services.notes import build_default_entitlement_service

        set_entitlement_service(build_default_entitlement_service(get_app_state().settings))


def test_entitlement_is_per_user_replaceable(client, auth_flow):
    """A custom per-user entitlement service can grant access selectively.

    This pins the contract: business code asks the injected service per user,
    so a future payments integration only needs to implement EntitlementService
    without touching NotesService. No payments are wired here.
    """
    token = auth_flow("vip@example.com")
    from app.deps import get_app_state, set_entitlement_service
    from app.models import User
    from app.services.notes import EntitlementService

    class VipOnly(EntitlementService):
        def is_notes_allowed(self, user: User, db) -> bool:
            # Grant only if the user's email is allow-listed.
            return user.email == "vip@example.com"

    set_entitlement_service(VipOnly())
    try:
        import uuid as _uuid

        # VIP can create.
        r = client.post(
            "/api/v1/notes",
            json={"id": str(_uuid.uuid4()), "title": "vip note"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 201
        # A non-VIP is denied.
        other = auth_flow("plain@example.com", installation_id="ip2", bypass_resend_throttle=True)
        r2 = client.post(
            "/api/v1/notes",
            json={"id": str(_uuid.uuid4()), "title": "nope"},
            headers={"Authorization": f"Bearer {other}"},
        )
        assert r2.status_code == 403
    finally:
        from app.services.notes import build_default_entitlement_service

        set_entitlement_service(build_default_entitlement_service(get_app_state().settings))
