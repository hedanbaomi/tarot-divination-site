"""Tests for the same installation_id switching accounts (#7).

Rule: ``installation_id`` is scoped per USER. The same client-generated
installation id MAY be reused across different accounts; each (user,
installation_id) pair gets its own device row, its own token, and its own
notes. Revoking a device under one account never affects another account's
device that happens to share the installation_id.
"""

from __future__ import annotations

import uuid

from app.deps import get_app_state
from app.models import Device


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_same_installation_id_usable_across_two_accounts(client, auth_flow):
    shared_install = "shared-install-uuid"
    t_a = auth_flow("acct-a@example.com", installation_id=shared_install)
    t_b = auth_flow(
        "acct-b@example.com",
        installation_id=shared_install,
        bypass_resend_throttle=True,
    )

    me_a = client.get("/api/v1/me", headers=_hdr(t_a)).json()
    me_b = client.get("/api/v1/me", headers=_hdr(t_b)).json()
    assert me_a["id"] != me_b["id"]
    assert me_a["email"] == "acct-a@example.com"
    assert me_b["email"] == "acct-b@example.com"

    # Two distinct device rows exist, one per (user, installation_id).
    db = get_app_state().session_factory()
    try:
        rows = db.query(Device).filter(Device.installation_id == shared_install).all()
        assert len(rows) == 2
        assert {r.user_id for r in rows} == {uuid.UUID(me_a["id"]), uuid.UUID(me_b["id"])}
    finally:
        db.close()


def test_revoking_device_under_one_account_does_not_touch_other(client, auth_flow):
    shared_install = "shared-install-2"
    t_a = auth_flow("acct-a2@example.com", installation_id=shared_install)
    t_b = auth_flow(
        "acct-b2@example.com",
        installation_id=shared_install,
        bypass_resend_throttle=True,
    )

    # Account A revokes its device.
    devs_a = client.get("/api/v1/me/devices", headers=_hdr(t_a)).json()
    dev_a_id = devs_a["devices"][0]["id"]
    assert client.delete(f"/api/v1/me/devices/{dev_a_id}", headers=_hdr(t_a)).status_code == 204

    # A's token is dead...
    assert client.get("/api/v1/me", headers=_hdr(t_a)).status_code == 401
    # ...but B (same installation_id, different account) is unaffected.
    assert client.get("/api/v1/me", headers=_hdr(t_b)).status_code == 200


def test_notes_isolated_when_sharing_installation_id(client, auth_flow):
    """Even with the same installation_id, each account only sees its notes."""
    shared_install = "shared-install-3"
    t_a = auth_flow("notes-a@example.com", installation_id=shared_install)
    t_b = auth_flow(
        "notes-b@example.com",
        installation_id=shared_install,
        bypass_resend_throttle=True,
    )
    nid = str(uuid.uuid4())
    r = client.post(
        "/api/v1/notes",
        json={"id": nid, "title": "a-only"},
        headers=_hdr(t_a),
    )
    assert r.status_code == 201
    # B cannot see A's note.
    assert client.get(f"/api/v1/notes/{nid}", headers=_hdr(t_b)).status_code == 404
    items_b = client.get("/api/v1/notes", headers=_hdr(t_b)).json()["items"]
    assert all(i["id"] != nid for i in items_b)
