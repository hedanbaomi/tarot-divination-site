"""Tests for the cloud-notes API."""

from __future__ import annotations

import uuid

import pytest


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create(client, token, **overrides):
    payload = {
        "id": str(uuid.uuid4()),
        "title": "t",
        "content": "c",
        "tags": ["a", "b"],
    }
    payload.update(overrides)
    if "id" not in overrides:
        payload["id"] = str(uuid.uuid4())
    r = client.post("/api/v1/notes", json=payload, headers=_hdr(token))
    assert r.status_code == 201, r.text
    return r.json()


# --------------------------------------------------------------------------- #
# CRUD
# --------------------------------------------------------------------------- #
def test_create_get_update_delete(authed_client):
    client, token, _ = authed_client
    note = _create(client, token, title="hello", content="world", tags=["x"])
    nid = note["id"]

    g = client.get(f"/api/v1/notes/{nid}", headers=_hdr(token))
    assert g.status_code == 200
    assert g.json()["title"] == "hello"
    assert g.json()["version"] == 1

    p = client.patch(
        f"/api/v1/notes/{nid}",
        json={"content": "updated", "expected_version": 1},
        headers=_hdr(token),
    )
    assert p.status_code == 200
    assert p.json()["content"] == "updated"
    assert p.json()["version"] == 2

    d = client.delete(f"/api/v1/notes/{nid}", headers=_hdr(token))
    assert d.status_code == 204
    # Soft-deleted note is not retrievable via GET.
    assert client.get(f"/api/v1/notes/{nid}", headers=_hdr(token)).status_code == 404


def test_get_missing_returns_404(authed_client):
    client, token, _ = authed_client
    r = client.get(f"/api/v1/notes/{uuid.uuid4()}", headers=_hdr(token))
    assert r.status_code == 404


def test_notes_require_token(client):
    r = client.get("/api/v1/notes")
    assert r.status_code == 401
    r = client.post("/api/v1/notes", json={"id": str(uuid.uuid4()), "title": "x"})
    assert r.status_code == 401


# --------------------------------------------------------------------------- #
# Idempotent create
# --------------------------------------------------------------------------- #
def test_create_is_idempotent_on_id(authed_client):
    client, token, _ = authed_client
    nid = str(uuid.uuid4())
    body = {"id": nid, "title": "once", "content": "c", "tags": []}
    r1 = client.post("/api/v1/notes", json=body, headers=_hdr(token))
    r2 = client.post("/api/v1/notes", json=body, headers=_hdr(token))
    assert r1.status_code == 201
    assert r2.status_code == 200  # idempotent re-create returns existing
    # Only one note exists.
    lst = client.get("/api/v1/notes", headers=_hdr(token))
    items = lst.json()["items"]
    assert len([i for i in items if i["id"] == nid]) == 1
    # Version never bumped by idempotent re-create.
    assert items[0]["version"] == 1


# --------------------------------------------------------------------------- #
# Pagination
# --------------------------------------------------------------------------- #
def test_pagination(authed_client):
    client, token, _ = authed_client
    for _ in range(5):
        _create(client, token)
    seen = []
    cursor = None
    pages = 0
    while True:
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        r = client.get("/api/v1/notes", params=params, headers=_hdr(token))
        assert r.status_code == 200
        body = r.json()
        seen.extend(i["id"] for i in body["items"])
        pages += 1
        if not body["has_more"]:
            break
        cursor = body["next_cursor"]
        assert pages <= 10  # safety
    assert len(seen) == 5
    assert len(set(seen)) == 5  # no duplicates across pages


# --------------------------------------------------------------------------- #
# Delta sync: updated_after + tombstones
# --------------------------------------------------------------------------- #
def test_updated_after_delta_and_tombstones(authed_client):
    client, token, _ = authed_client
    old = _create(client, token, title="old")
    # Capture server time after first note.
    import time

    base = client.get("/api/v1/notes", params={"limit": 1}, headers=_hdr(token)).json()["server_time"]
    time.sleep(0.01)
    new = _create(client, token, title="new")
    client.delete(f"/api/v1/notes/{new['id']}", headers=_hdr(token))

    # Delta since base: should include the new (now deleted) note as a tombstone.
    r = client.get(
        "/api/v1/notes",
        params={"updated_after": base, "deleted": "include"},
        headers=_hdr(token),
    )
    assert r.status_code == 200
    ids = {i["id"] for i in r.json()["items"]}
    assert new["id"] in ids
    assert old["id"] not in ids  # unchanged since base

    # Tombstone-only view.
    r2 = client.get(
        "/api/v1/notes",
        params={"deleted": "only"},
        headers=_hdr(token),
    )
    assert r2.status_code == 200
    assert all(i["deleted_at"] for i in r2.json()["items"])


# --------------------------------------------------------------------------- #
# Version conflict
# --------------------------------------------------------------------------- #
def test_version_conflict_returns_409(authed_client):
    client, token, _ = authed_client
    note = _create(client, token)
    nid = note["id"]
    # Stale expected_version (current is 1) -> 409.
    r = client.patch(
        f"/api/v1/notes/{nid}",
        json={"content": "v2", "expected_version": 999},
        headers=_hdr(token),
    )
    assert r.status_code == 409
    assert "conflict" in r.json()["detail"].lower()


def test_version_optimistic_lock_success(authed_client):
    client, token, _ = authed_client
    note = _create(client, token)
    nid = note["id"]
    r = client.patch(
        f"/api/v1/notes/{nid}",
        json={"content": "ok", "expected_version": 1},
        headers=_hdr(token),
    )
    assert r.status_code == 200
    assert r.json()["version"] == 2


# --------------------------------------------------------------------------- #
# Limits
# --------------------------------------------------------------------------- #
def test_reject_oversized_content(authed_client):
    client, token, _ = authed_client
    r = client.post(
        "/api/v1/notes",
        json={"id": str(uuid.uuid4()), "title": "t", "content": "x" * (100_000 + 1)},
        headers=_hdr(token),
    )
    assert r.status_code == 422  # pydantic max_length


def test_reject_too_many_tags(authed_client):
    client, token, _ = authed_client
    r = client.post(
        "/api/v1/notes",
        json={"id": str(uuid.uuid4()), "title": "t", "tags": [f"t{i}" for i in range(33)]},
        headers=_hdr(token),
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Cross-user isolation
# --------------------------------------------------------------------------- #
def test_cross_user_isolation(client, auth_flow):
    a = auth_flow("user-a@example.com", installation_id="ia")
    b = auth_flow("user-b@example.com", installation_id="ib", bypass_resend_throttle=True)
    note = _create(client, a, title="secret-a")
    # User B cannot read A's note.
    r = client.get(f"/api/v1/notes/{note['id']}", headers=_hdr(b))
    assert r.status_code == 404
    # User B cannot list A's notes.
    lst = client.get("/api/v1/notes", headers=_hdr(b)).json()["items"]
    assert all(i["id"] != note["id"] for i in lst)
    # User B cannot patch or delete A's note.
    assert client.patch(
        f"/api/v1/notes/{note['id']}", json={"content": "hax"}, headers=_hdr(b)
    ).status_code == 404
    assert client.delete(f"/api/v1/notes/{note['id']}", headers=_hdr(b)).status_code == 404
    # And A still sees it intact.
    assert client.get(f"/api/v1/notes/{note['id']}", headers=_hdr(a)).status_code == 200
