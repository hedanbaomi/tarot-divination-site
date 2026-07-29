# API reference

Base path: `/api/v1`. Interactive docs at `/docs` (Swagger) and `/redoc` when
the server is running. All timestamps are UTC ISO-8601.

Common status codes:

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No content |
| 400 | Bad request (e.g. invalid/expired/used code, payload limit) |
| 401 | Missing/invalid/revoked device token |
| 403 | Account unavailable (e.g. banned) |
| 404 | Resource not found / not owned by you |
| 409 | Version conflict (notes) |
| 422 | Validation error (Pydantic) |
| 429 | Rate limited / resend throttle (see `Retry-After`) |

---

## Auth

### POST /api/v1/auth/email/send-code

Request a 6-digit verification code. **The response is identical whether or not
the email is already registered** — this endpoint cannot be used to enumerate
accounts.

```http
POST /api/v1/auth/email/send-code
Content-Type: application/json

{
  "email": "alice@example.com",
  "installation_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_name": "Pixel 8",
  "platform": "android"
}
```

```http
200 OK
{
  "message": "If this email is valid, a verification code is on its way.",
  "resend_in_seconds": 60
}
```

`429` if you resend within 60 s, or exceed per-email/per-IP limits; includes a
`Retry-After` header. Rules: 6-digit code, single-use, 10-minute expiry, max 5
wrong attempts.

### POST /api/v1/auth/email/verify-code

Verify the code and receive a **long-lived device token** (returned once). New
emails are auto-registered.

```http
POST /api/v1/auth/email/verify-code
Content-Type: application/json

{
  "email": "alice@example.com",
  "code": "482915",
  "installation_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_name": "Pixel 8",
  "platform": "android"
}
```

```http
200 OK
{
  "device_token": "v3ryL0ng0p4queU_r_lSafeToken...",
  "device_id": "d1f2...-...",
  "is_new_user": true
}
```

Store `device_token` securely (see the Android guide). It never expires on its
own.

### POST /api/v1/auth/logout

Revoke **only** the token in the `Authorization` header.

```http
POST /api/v1/auth/logout
Authorization: Bearer <token>
```
```http
204 No Content
```

### POST /api/v1/auth/logout-all

Revoke **every** active session for the current user.

```http
POST /api/v1/auth/logout-all
Authorization: Bearer <token>
```
```http
204 No Content
```

---

## Current user & devices

### GET /api/v1/me

```http
GET /api/v1/me
Authorization: Bearer <token>
```
```http
200 OK
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "alice@example.com",
  "status": "active",
  "created_at": "2026-07-29T12:00:00Z"
}
```

### GET /api/v1/me/devices

```http
GET /api/v1/me/devices
Authorization: Bearer <token>
```
```http
200 OK
{
  "devices": [
    {
      "id": "d1f2...-...",
      "installation_id": "550e8400-...",
      "name": "Pixel 8",
      "platform": "android",
      "created_at": "2026-07-29T12:00:00Z",
      "last_seen_at": "2026-07-29T12:05:00Z",
      "is_current": true,
      "session_active": true
    }
  ]
}
```

### DELETE /api/v1/me/devices/{device_id}

Revoke all sessions for a device. The device row and **its notes are not
deleted**.

```http
DELETE /api/v1/me/devices/d1f2...-...
Authorization: Bearer <token>
```
```http
204 No Content
```
`404` if the device does not exist or is not yours.

---

## Notes

> Cloud notes are an **optional** feature. In dev/tests `NOTES_ENABLED_FOR_ALL`
> grants access; production can require a real entitlement (payments are out of
> scope this round). All endpoints require a valid device token; you only ever
> see your own notes.

### POST /api/v1/notes

Create a note. **Idempotent on `id`**: re-posting the same client UUID returns
the existing note (no duplicate, no version bump).

```http
POST /api/v1/notes
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "title": "Daily draw",
  "content": "Three cards: Sun, Star, Moon...",
  "tags": ["daily", "reflection"],
  "reading_id": "r-2026-07-29-001",
  "reading_snapshot_ref": "snap/abc123"
}
```
```http
201 Created
{
  "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "user_id": "550e8400-...",
  "title": "Daily draw",
  "content": "Three cards: Sun, Star, Moon...",
  "tags": ["daily", "reflection"],
  "reading_id": "r-2026-07-29-001",
  "reading_snapshot_ref": "snap/abc123",
  "created_at": "2026-07-29T12:10:00Z",
  "updated_at": "2026-07-29T12:10:00Z",
  "deleted_at": null,
  "version": 1
}
```

Limits: title ≤ 200, content ≤ 100 000 chars, ≤ 32 tags, each tag ≤ 64 chars.
Oversized payloads are rejected (422). Only text + structured references; no
attachments, images, or HTML.

### GET /api/v1/notes

List with pagination, delta sync, and tombstone control.

| Param | Default | Notes |
|---|---|---|
| `limit` | 50 | 1..200 |
| `cursor` | — | opaque next-page cursor from the previous response |
| `updated_after` | — | ISO-8601 UTC; only notes changed after this time |
| `deleted` | `exclude` | `exclude` \| `include` \| `only` |

```http
GET /api/v1/notes?limit=50&updated_after=2026-07-29T00:00:00Z&deleted=include
Authorization: Bearer <token>
```
```http
200 OK
{
  "items": [ { "...": "NoteResponse" } ],
  "next_cursor": "2026-07-29T12:10:00Z||6ba7b810-...",
  "has_more": false,
  "server_time": "2026-07-29T12:11:00Z"
}
```

**Sync strategy:** store `server_time` from each response; next sync pass
`updated_after=<that time>&deleted=include` to receive changes plus tombstones.

### GET /api/v1/notes/{note_id}

Returns 404 if the note does not exist, is not yours, or is soft-deleted.

### PATCH /api/v1/notes/{note_id}

Partial update. Pass `expected_version` for optimistic concurrency; a mismatch
returns **409**.

```http
PATCH /api/v1/notes/6ba7b810-9dad-11d1-80b4-00c04fd430c8
Authorization: Bearer <token>
Content-Type: application/json

{ "content": "edited body", "expected_version": 1 }
```
```http
200 OK
{ "...": "NoteResponse", "version": 2, "updated_at": "2026-07-29T12:12:00Z" }
```

### DELETE /api/v1/notes/{note_id}

Soft delete (sets `deleted_at`, bumps `version`). Other devices learn about the
deletion via delta sync (`deleted=include`). Returns 204.

---

## Conflict & sync model

- Each write bumps `version` and `updated_at`.
- `PATCH` with a stale `expected_version` returns `409` with the current
  version in the detail; the client should re-fetch, merge, and retry.
- Delta sync uses `updated_after` + `deleted=include` to ship tombstones, so
  deletes propagate to all devices.
- Pagination is keyset on `(updated_at, id)`, stable under concurrent writes.
- Create is idempotent on the client-supplied `id`, so retries after a network
  blip never duplicate a note.
