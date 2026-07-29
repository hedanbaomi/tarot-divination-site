# Backend documentation

- [../README.md](../README.md) — setup, config, migration, deployment notes
- [api-reference.md](api-reference.md) — full endpoint reference with examples
- [android-token-guide.md](android-token-guide.md) — how the Android client
  stores and carries the long-lived device token

## Design summaries

### Email login & long-lived device sessions

- Email is the only account identifier; login and registration are the same
  flow (auto-register on first verify).
- Codes: 6 digits, single-use, 10-minute TTL, ≤5 wrong attempts, ≥60 s resend
  throttle, per-email + per-IP rate limits. Only the **digest** is stored.
- The send-code response is identical for new vs existing emails (no
  enumeration).
- If the mail provider fails, **no usable challenge is persisted** — the client
  gets the same generic response and no valid code state exists.
- On verify: register/find the device by the client `installation_id`, mint a
  32-byte opaque token, store its digest, return the raw token **once**.
- No short-lived access/refresh tokens, no rotation. Tokens survive restarts
  and offline periods; they die only on logout, device revoke, data clear, or
  account ban.

### Cloud notes sync & conflict strategy

- Client-generated UUID (`id`) enables offline-first creation and idempotent
  sync; re-posting the same id is a no-op.
- Soft delete via `deleted_at`; tombstones ship through `deleted=include`.
- Delta sync via `updated_after`; keyset pagination on `(updated_at, id)`.
- Optimistic concurrency via `version`; `PATCH` with stale `expected_version`
  returns `409` carrying the current version.
- Revoking a device never deletes cloud notes (data outlives sessions).
