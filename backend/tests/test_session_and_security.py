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


def test_notes_can_be_disabled_via_entitlement(client, auth_flow, monkeypatch):
    """When NOTES_ENABLED_FOR_ALL is off, notes endpoints refuse."""
    import os

    token = auth_flow("ent@example.com")
    # Flip the flag off via a fresh Settings and reconfigure the running app.
    os.environ["NOTES_ENABLED_FOR_ALL"] = "false"
    state = get_app_state()
    state.settings = Settings()
    try:
        import uuid as _uuid

        r = client.post(
            "/api/v1/notes",
            json={"id": str(_uuid.uuid4()), "title": "x"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400
    finally:
        os.environ["NOTES_ENABLED_FOR_ALL"] = "true"
        state.settings = Settings()
